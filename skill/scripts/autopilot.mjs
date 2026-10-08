/**
 * Autopilot: the inbox, answered. For every new comment (and inbound DM) the autopilot asks the
 * tenant's configured agent what to do, within the tenant's playbook, and acts:
 *
 *   reply     → post the reply under the comment (or into the DM thread)
 *   hide      → hide the comment (spam, abuse)
 *   skip      → nothing; recorded so it is never re-asked
 *   escalate  → leave it, write it to the queue for a human
 *
 * The agent is any command that reads a prompt on stdin and prints text containing a JSON
 * object {"action": "...", "text": "..."} — by default `claude -p` (Claude Code headless),
 * configurable per tenant (tenant.json → autopilot.agent). No agent configured means every item
 * is queued for a human and nothing is posted: autopilot never guesses on its own.
 *
 * Policy knobs (tenant.json → autopilot):
 *   mode:            "auto" (act) | "draft" (write proposals to the queue, post nothing) | "off"
 *   maxPerRun:       cap on actions per run (default 10)
 *   skipAuthors:     usernames never answered (our own handles, bots)
 *   escalateWords:   words that force escalation (legal, refund, press, …)
 *   dms:             true to also answer inbound DMs (default false)
 *   linkReply:       opt-in (captions already carry the full story link). When set and a comment
 *                    on a post that carries a link contains one of `keywords`, the autopilot sends the
 *                    link as a private reply (DM) and acknowledges publicly — no agent involved.
 *                    { enabled: true, keywords: ["link", "source", "sources", "fonte", "fonti"],
 *                      template: "Here is the full story, with sources: {url}", ack: "Sent — check your DMs." }
 *   agent:           { command: ["claude","-p","--output-format","json"], timeoutMs: 120000 }
 *   jev:             opt-in: ask TypeSafe's Jev first (jev.mjs), so the agent only sees what needs
 *                    a written answer. true, or thresholds { escalateAt: 0.85, spamAt: 0.9, noReplyAt: 0.9 }.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inboxDir, logAction, pullInbox, reply, hide, dm, privateReply } from "./inbox.mjs";
import { JEV_DEFAULTS, route, scoreItems } from "./jev.mjs";
import { createClient } from "./postproxy.mjs";

export const DEFAULT_AGENT = { command: ["claude", "-p", "--output-format", "json"], timeoutMs: 120000 };

export function policyOf(tenant) {
  const a = tenant.autopilot || {};
  return {
    mode: a.mode || "draft",
    maxPerRun: a.maxPerRun ?? 10,
    skipAuthors: (a.skipAuthors || []).map((s) => s.toLowerCase().replace(/^@/, "")),
    escalateWords: (a.escalateWords || ["legal", "lawyer", "refund", "press", "journalist", "lawsuit", "copyright", "dmca"]).map((w) => w.toLowerCase()),
    dms: Boolean(a.dms),
    // opt-in: story captions already carry the full link, so nobody is asked to comment
    // LINK for a DM; enable per tenant only if a campaign still promises it
    linkReply: a.linkReply ? {
      enabled: true,
      keywords: ["link", "source", "sources", "fonte", "fonti", "article", "articolo"],
      template: "Here is the full story, with sources: {url}",
      ack: "Sent — check your DMs.",
      ...(a.linkReply === true ? {} : a.linkReply),
    } : null,
    agent: a.agent === null ? null : { ...DEFAULT_AGENT, ...(a.agent || {}) },
    jev: a.jev ? { ...JEV_DEFAULTS, ...(a.jev === true ? {} : a.jev) } : null,
    language: a.language || tenant.language || "en",
  };
}

export function loadPlaybook(tenant) {
  const file = join(tenant.dir, "playbook.md");
  return existsSync(file) ? readFileSync(file, "utf8") : `You are the social media manager for ${tenant.brand?.name || tenant.name}. Be brief, warm and factual. Never invent facts about the product.`;
}

/** The prompt handed to the agent. Pure, so tests can pin it. */
export function buildPrompt({ tenant, playbook, item, policy }) {
  const kind = item.type === "dm" ? "direct message" : "comment";
  const context = item.type === "dm"
    ? `Thread with @${item.participant || "unknown"} on ${item.platform}. Their latest message:\n"""${item.lastMessage || ""}"""`
    : `Post: ${item.postUrl || item.postId}${item.campaign ? ` (campaign ${item.campaign})` : ""} on ${item.platform}.\n@${item.author || "unknown"} wrote${item.depth ? " (in a reply thread)" : ""}:\n"""${item.body}"""`;
  return `${playbook.trim()}

---
You are answering ONE ${kind} as the brand account. Language of the reply: the language the person wrote in, otherwise ${policy.language}.
${context}

Decide, then answer with exactly one JSON object and nothing else:
{"action": "reply" | "skip" | "hide" | "escalate", "text": "<the reply, when action is reply; empty otherwise>", "reason": "<one short sentence>"}

Rules: reply only when a reply adds something (thanks, an answer, a pointer). Skip emoji-only or generic praise unless the playbook says to thank everyone. Hide only clear spam or abuse. Escalate anything legal, press, partnership, complaint about money, or anything you are unsure about. Keep replies under 220 characters, no hashtags, at most one emoji, never a promise the playbook does not make.`;
}

/** Run the agent command with the prompt on stdin; return { action, text, reason, raw }. */
export function askAgent(agent, prompt) {
  const [bin, ...args] = agent.command;
  const r = spawnSync(bin, args, { input: prompt, encoding: "utf8", timeout: agent.timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ZIGGY_AUTOPILOT: "1" } });
  if (r.error) throw new Error(r.error.code === "ENOENT" ? `agent command not found: ${bin}` : r.error.message);
  if (r.status !== 0) throw new Error(`agent exited ${r.status}: ${(r.stderr || "").trim().slice(0, 400)}`);
  return parseDecision(r.stdout);
}

export function parseDecision(stdout) {
  let text = stdout.trim();
  // `claude -p --output-format json` wraps the answer: { "result": "..." }
  try {
    const outer = JSON.parse(text);
    if (outer && typeof outer === "object" && !("action" in outer)) text = outer.result ?? outer.text ?? outer.content ?? text;
    if (Array.isArray(text)) text = text.map((p) => p.text || "").join("\n");
  } catch { /* plain text */ }
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`agent returned no JSON decision: ${String(text).slice(0, 200)}`);
  const decision = JSON.parse(match[0]);
  const action = String(decision.action || "escalate").toLowerCase();
  if (!["reply", "skip", "hide", "escalate"].includes(action)) throw new Error(`agent returned unknown action ${action}`);
  return { action, text: String(decision.text || "").trim(), reason: decision.reason || "", raw: stdout };
}

function queue(slug, entry) {
  appendFileSync(join(inboxDir(slug), "queue.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

export function readQueue(slug) {
  const file = join(inboxDir(slug), "queue.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** Pre-agent triage: things the policy settles without asking anyone. */
export function triage(item, policy) {
  const author = (item.author || item.participant || "").toLowerCase().replace(/^@/, "");
  if (author && policy.skipAuthors.includes(author)) return { action: "skip", reason: "author on skip list" };
  const text = (item.body || item.lastMessage || "").toLowerCase();
  if (policy.escalateWords.some((w) => text.includes(w))) return { action: "escalate", reason: "escalation keyword" };
  if (!text.trim()) return { action: "skip", reason: "empty" };
  if (item.type === "comment" && item.postLink && policy.linkReply?.enabled && !item.mine) {
    const words = text.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/);
    if (policy.linkReply.keywords.some((k) => words.includes(k.toLowerCase()))) {
      return { action: "link", text: policy.linkReply.template.replace("{url}", item.postLink), ack: policy.linkReply.ack, reason: "link keyword" };
    }
  }
  return null;
}

/**
 * One autopilot run. Returns a report: { handled: [...], queued: [...], errors: [...], mode }.
 * `dryRun` decides but posts nothing.
 */
export async function runAutopilot({ tenant, client = createClient(), dryRun = false, log = () => {}, ask = askAgent, score = scoreItems }) {
  const policy = policyOf(tenant);
  const report = { tenant: tenant.slug, mode: policy.mode, handled: [], queued: [], errors: [], at: new Date().toISOString() };
  if (policy.mode === "off") { log("autopilot is off for this tenant"); return report; }

  const inbox = await pullInbox({ tenant, client, includeDms: policy.dms, log });
  report.errors.push(...inbox.errors);
  const items = [
    ...inbox.comments.new.map((c) => ({ type: "comment", ...c })),
    ...(policy.dms ? inbox.chats.filter((ch) => ch.isNew).map((ch) => ({ type: "dm", ...ch })) : []),
  ];
  if (!items.length) { log("nothing new"); return report; }
  const playbook = loadPlaybook(tenant);
  let actions = 0;

  // Jev scores what the policy rules leave open, in one pass before the loop; its sure answers
  // never reach the agent. No scores (off, no key, Jev down) → the agent decides, as before.
  const open = policy.jev ? items.filter((item) => !triage(item, policy)) : [];
  const scores = new Map();
  if (open.length) {
    const scored = await score(open);
    if (scored) open.forEach((item, i) => scores.set(item.id, scored[i]));
    else log("jev unavailable: the agent decides every item");
  }
  report.jev = policy.jev ? { asked: scores.size, settled: 0 } : null;

  for (const item of items) {
    if (actions >= policy.maxPerRun) { queue(tenant.slug, { item: strip(item), decision: { action: "escalate", reason: "maxPerRun reached" } }); report.queued.push({ item: strip(item), reason: "maxPerRun reached" }); continue; }
    let decision = triage(item, policy);
    if (!decision && scores.get(item.id)) {
      decision = route(scores.get(item.id), item, policy.jev);
      if (decision) { report.jev.settled++; log(`jev ${decision.action} ${item.type} ${item.id}: ${decision.reason}`); }
    }
    if (!decision) {
      if (!policy.agent) decision = { action: "escalate", reason: "no agent configured" };
      else {
        try { decision = ask(policy.agent, buildPrompt({ tenant, playbook, item, policy })); }
        catch (error) { decision = { action: "escalate", reason: `agent error: ${error.message}` }; report.errors.push(error.message); }
      }
    }
    const record = { item: strip(item), decision };
    const act = policy.mode === "auto" && !dryRun;
    try {
      if (decision.action === "reply" && decision.text) {
        if (act) {
          if (item.type === "dm") await dm({ tenant, client, chatId: item.id, text: decision.text, by: "autopilot" });
          else await reply({ tenant, client, postId: item.postId, profileId: item.profileId, commentId: item.id, text: decision.text, by: "autopilot" });
          actions++;
          report.handled.push(record);
          log(`replied to @${item.author || item.participant}: ${decision.text}`);
        } else { queue(tenant.slug, record); report.queued.push(record); log(`proposed reply to @${item.author || item.participant}: ${decision.text}`); }
      } else if (decision.action === "link" && item.type === "comment") {
        if (act) {
          await privateReply({ tenant, client, postId: item.postId, profileId: item.profileId, commentId: item.id, text: decision.text, by: "autopilot" });
          if (decision.ack) await reply({ tenant, client, postId: item.postId, profileId: item.profileId, commentId: item.id, text: decision.ack, by: "autopilot" });
          actions++;
          report.handled.push(record);
          log(`sent the link to @${item.author} by DM`);
        } else { queue(tenant.slug, record); report.queued.push(record); log(`would DM the link to @${item.author}`); }
      } else if (decision.action === "hide" && item.type === "comment") {
        if (act) { await hide({ tenant, client, postId: item.postId, profileId: item.profileId, commentId: item.id, by: decision.by || "autopilot" }); actions++; report.handled.push(record); log(`hid comment ${item.id} (${decision.reason})`); }
        else { queue(tenant.slug, record); report.queued.push(record); }
      } else if (decision.action === "skip") {
        logAction(tenant.slug, { action: "skip", by: decision.by || "autopilot", itemId: item.id, reason: decision.reason });
        report.handled.push(record);
      } else {
        queue(tenant.slug, record);
        report.queued.push(record);
        log(`escalated ${item.type} ${item.id}: ${decision.reason}`);
      }
    } catch (error) {
      report.errors.push(`${item.id}: ${error.message}`);
      queue(tenant.slug, { ...record, error: error.message });
    }
  }
  appendFileSync(join(inboxDir(tenant.slug), "runs.jsonl"), JSON.stringify({ at: report.at, mode: report.mode, handled: report.handled.length, queued: report.queued.length, errors: report.errors.length, ...(report.jev ? { jev: report.jev } : {}) }) + "\n");
  return report;
}

function strip(item) {
  const { raw, replies, ...rest } = item;
  return rest;
}
