/**
 * Jev (TypeSafe System One): small typed judgments, about half a second and a few hundred tokens
 * each. The autopilot asks it first, so the tenant's agent — an expensive model — only sees the
 * items that need a written answer: Jev judges, the agent writes, the code acts.
 *
 * Three atomic questions per item (TypeSafe's advice: one thing per question, literal wording):
 *   escalate     does a person at the brand have to handle it (complaint, legal, press, business)?
 *   spam         is it spam, a scam, a bot or self-promotion?
 *   needs_reply  would a reply from the brand add something for this person?
 * and routing by confidence: a sure "escalate" goes to the queue, a sure "spam" is hidden, a sure
 * "nothing to answer" is skipped, and everything else goes to the agent as before.
 *
 * The key reaches Jev the way every key reaches Ziggy: as TYPESAFE_API_KEY in the environment,
 * injected by `hush run`. The autopilot already runs under hush with the tenant's Postproxy key,
 * and hush hands its child one secret, so when the key is not in the environment the scoring runs
 * as its own `hush run … -- node jev.mjs` child: states on stdin, scores on stdout. Any failure
 * returns no scores, and the agent decides every item as before.
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hushBin, hushNames, nodeBin } from "./secrets.mjs";

export const JEV_KEY_ENV = "TYPESAFE_API_KEY";
export const JEV_SECRET = "TYPESAFE_API_KEY";
export const JEV_MODEL = "jev-1.13.0";
export const JEV_DEFAULTS = { escalateAt: 0.85, spamAt: 0.9, noReplyAt: 0.9 };

export function jevUrl() {
  return process.env.ZIGGY_JEV_URL || "https://api.typesafe.ai/v1/systemone";
}

const noul = (instructions, yes, no) => ({ type: "noul", instructions, criteria: { true: yes, false: no } });

export const QUESTIONS = {
  escalate: noul(
    "Does `message` need a person at the brand: a complaint, a refund or money matter, a legal or press matter, a business or partnership request, a threat, or a personal crisis?",
    "A person at the brand has to handle this message",
    "An ordinary message a social media reply can handle, or no reply at all",
  ),
  spam: noul(
    "Is `message` spam: a scam, a bot, self-promotion, an unrelated link, or an offer to buy followers?",
    "Spam, scam, bot or self-promotion",
    "A real person writing about the post or the brand, even briefly or rudely",
  ),
  needs_reply: noul(
    "Would a reply from the brand add something for the author of `message`: an answer to a question, a correction, or thanks for a specific point they made?",
    "The message asks something or makes a point a reply should address",
    "Nothing to answer: emoji only, generic praise, a tag of a friend, or a reaction that needs no reply",
  ),
};

/** What Jev reads about an item: the message and where it was written, nothing else. */
export function stateOf(item) {
  return {
    kind: item.type === "dm" ? "direct message" : "comment",
    platform: item.platform || null,
    message: String(item.body || item.lastMessage || "").slice(0, 4000),
    post: item.type === "dm" ? null : item.postBody ? String(item.postBody).slice(0, 1000) : null,
  };
}

export async function askJev(state, questions = QUESTIONS, { key = process.env[JEV_KEY_ENV], timeoutMs = 15000 } = {}) {
  if (!key) throw new Error(`${JEV_KEY_ENV} is not set`);
  const response = await fetch(jevUrl(), {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: JEV_MODEL, state, questions }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Jev answered HTTP ${response.status}`);
  const data = await response.json();
  if (!data?.answers) throw new Error("Jev returned no answers");
  return data.answers;
}

/** One score object per state ({ escalate, spam, needs_reply }), or null for a state Jev could not judge. */
export async function scoreStates(states, { concurrency = 4 } = {}) {
  const out = new Array(states.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < states.length) {
      const i = next++;
      try {
        const answers = await askJev(states[i]);
        out[i] = Object.fromEntries(Object.keys(QUESTIONS).map((k) => [k, Number(answers[k]?.noul)]));
        if (Object.values(out[i]).some((v) => !Number.isFinite(v))) out[i] = null;
      } catch { out[i] = null; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, states.length) }, worker));
  return out;
}

/**
 * Scores for `items`, in order (null entries where Jev could not judge), or null when Jev is not
 * available at all: no key in the environment and none in hush, or the hush child failed.
 */
export async function scoreItems(items) {
  if (!items.length) return [];
  const states = items.map(stateOf);
  if (process.env[JEV_KEY_ENV]) return scoreStates(states);
  const hush = hushNames();
  if (!hush.ok || !hush.names.includes(JEV_SECRET)) return null;
  const self = fileURLToPath(import.meta.url);
  const r = spawnSync(hushBin(), ["run", "--name", JEV_SECRET, "--env", JEV_KEY_ENV, "--redact", "--", nodeBin(), self],
    { input: JSON.stringify(states), encoding: "utf8", timeout: 30000 + 5000 * states.length, maxBuffer: 8 * 1024 * 1024 });
  if (r.error || r.status !== 0) return null;
  try {
    const scores = JSON.parse(r.stdout);
    return Array.isArray(scores) && scores.length === items.length ? scores : null;
  } catch { return null; }
}

/** The decision Jev's scores settle on their own, or null when the agent should decide. Pure. */
export function route(scores, item, thresholds = JEV_DEFAULTS) {
  if (!scores) return null;
  const t = { ...JEV_DEFAULTS, ...thresholds };
  const pct = (v) => v.toFixed(2);
  if (scores.escalate >= t.escalateAt) return { action: "escalate", reason: `jev: needs a person (${pct(scores.escalate)})`, by: "jev", scores };
  if (scores.spam >= t.spamAt) return { action: item.type === "comment" ? "hide" : "skip", reason: `jev: spam (${pct(scores.spam)})`, by: "jev", scores };
  if (scores.needs_reply <= 1 - t.noReplyAt) return { action: "skip", reason: `jev: nothing to answer (${pct(scores.needs_reply)})`, by: "jev", scores };
  return null;
}

async function main() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const states = JSON.parse(Buffer.concat(chunks).toString("utf8") || "[]");
  process.stdout.write(JSON.stringify(await scoreStates(states)) + "\n");
}

// Run directly (the hush child): score the states on stdin. Importing this module does nothing.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(`jev: ${error.message}`); process.exit(1); });
}
