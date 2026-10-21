#!/usr/bin/env node
/**
 * Points before and after refinePoints, with the real agent (`claude -p`, the tenant's story
 * agent): not part of `npm test`.
 *
 *   node skill/eval/before-after.mjs [--set <file>] [--stories id,id,id] [--date YYYY-MM-DD]
 *
 * Three stories of the eval set (points-eval.json): the Corte dei conti story with its four
 * human-labelled paraphrases, and two ragusa stories with an article and at least two points
 * labelled repeat or generic. Each goes through refinePoints from the set's points, in order
 * ("before"), at DEFAULT_JUDGE_THRESHOLD, up to 3 rounds. The agent calls are recorded as they
 * happen: every round's check (lexical reason, judge score and what it repeats, new fact,
 * verdict) and every replacement (the reply). Then the "after" points and the dropped ones.
 * A story without a body in the set takes it from the feed (`/feed/v1/briefings/<slug>`).
 *
 * Writes results/<date>-before-after.json and results/<date>-before-after.md next to this file.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_JUDGE_THRESHOLD, judgeConfig, judgeReason, parseJudge, strongest } from "../scripts/judge.mjs";
import { fetchStoryBody, lexicalReasons, parseSummaryLines, refinePoints, REFINE_ROUNDS, spawnAgent, storyAgent } from "../scripts/story.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const DEFAULT_STORIES = ["ragusa-modica-corte-human", "ragusa-pozzallo-enel", "ragusa-omicidio-russo"];

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback; };
const SET = opt("--set", join(HERE, "points-eval.json"));
const IDS = opt("--stories", DEFAULT_STORIES.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const DATE = opt("--date", new Date().toISOString().slice(0, 10));
const THRESHOLD = DEFAULT_JUDGE_THRESHOLD;
const log = (...a) => console.error(...a);

const loadTenant = (slug) => ({ slug, ...JSON.parse(readFileSync(join(REPO, "tenants", slug, "tenant.json"), "utf8")) });
const isJudge = (prompt) => /^(?:You check the points|Controlli i punti)/.test(prompt);
const isReplace = (prompt) => /^(?:These are the points|Questi sono i punti)/.test(prompt);
const bad = (s) => s.points.filter((p) => p.label !== "new").length;

/** The points a judge prompt carries, in order: the "N. text" lines after "Points:". */
function promptPoints(prompt) {
  const lines = prompt.split("\n");
  return lines.slice(lines.indexOf("Points:") + 1).map((l) => /^\d+\. (.*)$/.exec(l)?.[1]).filter((p) => p !== undefined);
}

/**
 * The story agent, recording each call in `log`: a judge call is one round's check (the lexical
 * reasons of the same list, the judge's verdicts); a replace call is the list it was given and
 * the reply.
 */
function recordingSpawn(tenant, story, trace) {
  return async (bin, args, options) => {
    const started = Date.now();
    const r = await spawnAgent(bin, args, options);
    const ms = Date.now() - started;
    const prompt = String(options.input ?? "");
    let cost = null, model = null;
    try { const j = JSON.parse(r.stdout); cost = j.total_cost_usd ?? null; model = Object.keys(j.modelUsage || {})[0] ?? null; } catch { /* not claude's JSON */ }
    if (isJudge(prompt)) {
      const points = promptPoints(prompt);
      const lexical = lexicalReasons(tenant, story, points);
      const parsed = r.status === 0 ? parseJudge(r.stdout, points.length) : null;
      trace.push({
        kind: "check", ms, cost, model, judge: parsed ? "ok" : "failed",
        points: points.map((point, i) => {
          if (!parsed) return { point, lexical: lexical[i], pass: !lexical[i], reason: lexical[i] };
          const v = { ...parsed[i], ...strongest(parsed[i]) };
          const judgePass = v.score < THRESHOLD && v.newFact !== "" && v.grounded !== false && !v.generic;
          const reason = lexical[i] || (judgePass ? null : judgeReason(v, THRESHOLD));
          return { point, lexical: lexical[i], score: v.score, against: v.against, newFact: v.newFact, grounded: v.grounded, generic: v.generic, judgePass, pass: !reason, reason };
        }),
      });
    } else if (isReplace(prompt)) {
      const asked = prompt.split("\n").map((l) => /^\d+\. (✓|✗) (.*)$/.exec(l)).filter(Boolean).map(([, mark, rest]) => {
        const cut = mark === "✗" ? rest.lastIndexOf(" — ") : -1;
        return cut < 0 ? { pass: mark === "✓", point: rest, why: null } : { pass: false, point: rest.slice(0, cut), why: rest.slice(cut + 3) };
      });
      trace.push({ kind: "replace", ms, cost, model, asked, reply: r.status === 0 ? parseSummaryLines(r.stdout) : null });
    } else {
      trace.push({ kind: "other", ms, cost, model });
    }
    return r;
  };
}

async function runStory(tenant, s) {
  let body = String(s.body ?? "").trim(), bodySource = "set";
  if (!body) {
    body = await fetchStoryBody(tenant, { slug: s.slug });
    bodySource = body ? "feed" : "none";
  }
  const story = {
    title: s.title, dek: s.dek, slug: s.slug, date: s.date ?? null, body,
    url: tenant.feed?.storyUrl ? tenant.feed.storyUrl.replace("{slug}", s.slug) : null,
  };
  const before = s.points.map((p) => ({ text: p.text, label: p.label, labelSource: p.labelSource, why: p.why }));
  const trace = [];
  const t0 = Date.now();
  log(`  … ${s.id} (${body.length} chars of article from the ${bodySource})`);
  const r = await refinePoints(tenant, story, before.map((p) => p.text), { agent: storyAgent(tenant), spawnImpl: recordingSpawn(tenant, story, trace), threshold: THRESHOLD });
  log(`  ✓ ${s.id}: ${r.kept.length} kept, ${r.dropped.length} dropped, ${r.replaced.length} replaced, ${r.rounds} round(s), ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return {
    id: s.id, tenant: s.tenant, slug: s.slug, title: s.title, dek: s.dek, bodyChars: body.length, bodySource,
    before,
    trace,
    after: r.kept,
    dropped: r.dropped,
    replaced: r.replaced.map(({ point, reason, by }) => ({ point, reason, by })),
    rounds: r.rounds, judgeCalls: r.judgeCalls, rewriteCalls: r.rewriteCalls, judge: r.judge, threshold: r.threshold,
    ms: Date.now() - t0, costUsd: Math.round(trace.reduce((n, c) => n + (c.cost || 0), 0) * 1000) / 1000,
  };
}

// ── report ─────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
const verdictCell = (p) => {
  if (p.score === undefined) return "—";
  const flags = [p.grounded === false && "ungrounded", p.generic && "generic"].filter(Boolean);
  return `${p.score.toFixed(2)} vs ${p.against}${flags.length ? ` · ${flags.join(" · ")}` : ""}`;
};

function storyMarkdown(s) {
  const L = [];
  L.push(`## ${esc(s.title)}`, "");
  L.push(`\`${s.id}\` · article: ${s.bodyChars} characters (${s.bodySource === "set" ? "from the eval set" : s.bodySource === "feed" ? "fetched from the feed" : "none"}) · ${s.rounds} round(s), ${s.judgeCalls} judge and ${s.rewriteCalls} rewrite call(s), ${sec(s.ms)}${s.costUsd ? `, $${s.costUsd}` : ""}${s.judge !== "on" ? ` · judge ${s.judge}` : ""}`, "");
  L.push(`- **Headline:** ${esc(s.title)}`, `- **Deck:** ${esc(s.dek)}`, "");
  L.push(`### Before (the set's points, with their labels)`, "");
  L.push(`| # | point | label | why (label) |`, `|---|---|---|---|`);
  s.before.forEach((p, i) => L.push(`| ${i + 1} | ${esc(p.text)} | ${p.label} (${p.labelSource}) | ${esc(p.why)} |`));
  let round = 0, rewrite = 0;
  for (const step of s.trace) {
    if (step.kind === "check") {
      round++;
      L.push("", `### Round ${round}: check${step.judge === "failed" ? " (judge failed: lexical only)" : ""}`, "");
      L.push(`| # | point | lexical | judge | new fact | verdict |`, `|---|---|---|---|---|---|`);
      step.points.forEach((p, i) => L.push(`| ${i + 1} | ${esc(p.point)} | ${p.lexical ? esc(p.lexical) : "ok"} | ${verdictCell(p)} | ${esc(p.newFact) || "—"} | ${p.pass ? "✓ pass" : `✗ ${esc(p.reason)}`} |`));
    } else if (step.kind === "replace") {
      rewrite++;
      L.push("", `### Rewrite ${rewrite}: replace the ✗ points`, "");
      if (!step.reply) { L.push("The agent failed: the loop stops here."); continue; }
      L.push(`Reply, in order:`, "");
      step.reply.forEach((line, i) => L.push(`${i + 1}. ${esc(line)}`));
      if (step === s.trace.at(-1)) L.push("", `No new point in the reply: the ✗ points are dropped without another check.`);
    }
  }
  if (s.judgeCalls < s.rounds) L.push("", `(${s.rounds - s.judgeCalls} round(s) without a judge call: the lexical filter rejected every point.)`);
  L.push("", `### After`, "");
  if (!s.after.length) L.push("No points: the reel is the title slide and the close.");
  const rewritten = new Map(s.replaced.map((r) => [r.by, r]));
  s.after.forEach((p, i) => {
    const r = rewritten.get(p);
    L.push(`${i + 1}. ✓ ${esc(p)}${r ? ` *(new: replaces "${esc(r.point)}" — ${esc(r.reason)})*` : ""}${i >= 3 ? " *(reel only: the caption shows the first 3)*" : ""}`);
  });
  if (s.dropped.length) {
    L.push("", `Dropped:`, "");
    for (const d of s.dropped) L.push(`- ✗ ${esc(d.point)} — ${esc(d.reason)}`);
  }
  const chain = s.replaced.filter((r) => !s.after.includes(r.by));
  if (chain.length) {
    L.push("", `Replacements that failed again and were replaced or dropped later:`, "");
    for (const r of chain) L.push(`- ↻ "${esc(r.point)}" → "${esc(r.by)}"`);
  }
  return L.join("\n");
}

function markdown(result) {
  const L = [];
  L.push(`# Points before and after refinePoints — ${result.date}`, "");
  L.push(`Three stories of \`skill/eval/points-eval.json\` through the real \`refinePoints\` (\`skill/scripts/story.mjs\`): the set's points as they are, in order, are the "before"; the story agent (\`${result.agent.join(" ")}\`${result.model ? `, ${result.model}` : ""}) judges them and replaces the failing ones from the article, up to ${result.maxRounds} rounds, at the default threshold ${result.threshold}. A point fails when the lexical filter (\`lint.mjs\` \`pointsReport\`) or the judge (\`judge.mjs\`) rejects it. Generated by \`node skill/eval/before-after.mjs\`; the points are in Italian as the agent wrote them.`, "");
  L.push(`| story | before: new / repeat / generic | rounds | judge | rewrite | after | dropped | replaced | wall |`, `|---|---|---|---|---|---|---|---|---|`);
  for (const s of result.stories) {
    const n = (label) => s.before.filter((p) => p.label === label).length;
    L.push(`| ${esc(s.title).slice(0, 60)}… | ${n("new")} / ${n("repeat")} / ${n("generic")} | ${s.rounds} | ${s.judgeCalls} | ${s.rewriteCalls} | ${s.after.length} | ${s.dropped.length} | ${s.replaced.length} | ${sec(s.ms)} |`);
  }
  L.push("", `Agent calls: ${result.calls.total} (${result.calls.judge} judge, ${result.calls.replace} replace)${result.calls.costUsd ? `, $${result.calls.costUsd}` : ""}; ${sec(result.wallMs)} wall, the three stories in parallel.`, "");
  for (const s of result.stories) L.push(storyMarkdown(s), "");
  return L.join("\n").replace(/\n+$/, "") + "\n";
}

// ── run ────────────────────────────────────────────────────────────────────
const set = JSON.parse(readFileSync(SET, "utf8"));
const picked = IDS.map((id) => set.stories.find((s) => s.id === id) ?? (() => { throw new Error(`no story ${id} in ${SET}`); })());
for (const s of picked) {
  if (s.id !== "ragusa-modica-corte-human" && bad(s) < 2) log(`  ! ${s.id} has ${bad(s)} point(s) labelled repeat or generic (expected 2+)`);
}
const tenants = Object.fromEntries([...new Set(picked.map((s) => s.tenant))].map((slug) => [slug, loadTenant(slug)]));
for (const t of Object.values(tenants)) {
  if (!storyAgent(t)) throw new Error(`tenant ${t.slug} has no story agent (feed.agent)`);
  if (!judgeConfig(t).enabled) throw new Error(`the judge is off for ${t.slug} (tenant.feed.judge or ZIGGY_JUDGE)`);
}
log(`before/after: ${picked.length} stories, threshold ${THRESHOLD}, up to ${REFINE_ROUNDS} rounds`);
const started = Date.now();
const stories = await Promise.all(picked.map((s) => runStory(tenants[s.tenant], s)));
const trace = stories.flatMap((s) => s.trace);
const model = [...new Set(trace.map((c) => c.model).filter(Boolean))].join(", ") || null;
const result = {
  date: DATE,
  agent: storyAgent(tenants[picked[0].tenant]).command,
  model,
  threshold: THRESHOLD,
  maxRounds: REFINE_ROUNDS,
  wallMs: Date.now() - started,
  calls: {
    total: trace.length,
    judge: trace.filter((c) => c.kind === "check").length,
    replace: trace.filter((c) => c.kind === "replace").length,
    costUsd: Math.round(trace.reduce((n, c) => n + (c.cost || 0), 0) * 1000) / 1000,
  },
  stories,
};
const outDir = join(HERE, "results");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${DATE}-before-after.json`), JSON.stringify(result, null, 2) + "\n");
writeFileSync(join(outDir, `${DATE}-before-after.md`), markdown(result));
log(`wrote ${join("skill", "eval", "results", `${DATE}-before-after.json`)} and .md`);
console.log(JSON.stringify(stories.map((s) => ({ id: s.id, rounds: s.rounds, after: s.after, dropped: s.dropped })), null, 2));
