#!/usr/bin/env node
/**
 * The point judge's eval, with the real agent (`claude -p`, the tenant's story agent): not part
 * of `npm test`.
 *
 *   node skill/eval/run-points-eval.mjs [--set <file>] [--concurrency 3] [--loop 10 | --no-loop] [--date YYYY-MM-DD]
 *
 * 1. Judge: every story of the eval set (points-eval.json) in one judge call, 3 at a time. Per
 *    case: the semantic score and verdict, the lexical decision (lint.mjs via storyPoints) and
 *    the combined one (rejected when either rejects). Precision, recall and F1 of "reject"
 *    (positive = repeat or generic) for judge only, lexical only and combined at thresholds
 *    0.4–0.8, the recommended threshold (best combined F1 with recall ≥ 0.9, else best F1), and
 *    the false positives and negatives there.
 * 2. Loop: the 10 oldest of the latest 30 stories in the live ragusa feed, none skipped: the
 *    summary, then refinePoints at the recommended threshold. Rounds, judge and rewrite calls,
 *    kept and dropped points with reasons, wall time; averages.
 *
 * Writes results/<date>.json and results/<date>.md next to this file.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { judgePoints } from "../scripts/judge.mjs";
import {
  askSummaryAgent, buildSummaryPrompt, fetchStories, fetchStoryBody, lexicalReasons, parseSummaryLines, refinePoints, spawnAgent, storyAgent,
} from "../scripts/story.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const THRESHOLDS = [0.4, 0.5, 0.6, 0.7, 0.8];
const MIN_RECALL = 0.9;

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback; };
const SET = opt("--set", join(HERE, "points-eval.json"));
const CONCURRENCY = Number(opt("--concurrency", 3)) || 3;
const LOOP = argv.includes("--no-loop") ? 0 : Number(opt("--loop", 10)) || 0;
const DATE = opt("--date", new Date().toISOString().slice(0, 10));
const log = (...a) => console.error(...a);

const loadTenant = (slug) => ({ slug, ...JSON.parse(readFileSync(join(REPO, "tenants", slug, "tenant.json"), "utf8")) });

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/** Every agent call, timed: which prompt (summary, judge, replace), how long, cost and model from claude's JSON. */
const calls = [];
const kindOf = (prompt) => (/^(?:You check the points|Controlli i punti)/.test(prompt) ? "judge" : /^(?:These are the points|Questi sono i punti)/.test(prompt) ? "replace" : "summary");
const meteredSpawn = (phase) => async (bin, args, options) => {
  const started = Date.now();
  const r = await spawnAgent(bin, args, options);
  let cost = null, model = null;
  try { const j = JSON.parse(r.stdout); cost = j.total_cost_usd ?? null; model = Object.keys(j.modelUsage || {})[0] ?? null; } catch { /* not claude's JSON */ }
  calls.push({ phase, kind: kindOf(options.input), ms: Date.now() - started, ok: !r.error && r.status === 0, cost, model });
  return r;
};

const ratio = (a, b) => (b ? a / b : 0);
const round3 = (x) => Math.round(x * 1000) / 1000;
function metrics(cases, rejects) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const c of cases) {
    const pos = c.label !== "new", rej = rejects(c);
    if (pos && rej) tp++; else if (!pos && rej) fp++; else if (pos) fn++; else tn++;
  }
  const precision = ratio(tp, tp + fp), recall = ratio(tp, tp + fn);
  return { tp, fp, fn, tn, precision: round3(precision), recall: round3(recall), f1: round3(ratio(2 * precision * recall, precision + recall)), accuracy: round3(ratio(tp + tn, cases.length)) };
}

const judgeRejects = (c, t) => Boolean(c.judge) && !(c.judge.score < t && c.judge.newFact !== "" && c.judge.grounded !== false && !c.judge.generic);
const combinedRejects = (c, t) => Boolean(c.lexical) || judgeRejects(c, t);

// ── 1. the judge on the eval set ───────────────────────────────────────────
async function judgeEval() {
  const set = JSON.parse(readFileSync(SET, "utf8"));
  const tenants = Object.fromEntries([...new Set(set.stories.map((s) => s.tenant))].map((slug) => [slug, loadTenant(slug)]));
  const spawnImpl = meteredSpawn("judge-eval");
  const started = Date.now();
  log(`judge: ${set.stories.length} stories, ${set.stories.reduce((n, s) => n + s.points.length, 0)} cases, ${CONCURRENCY} at a time`);
  const judged = await mapLimit(set.stories, CONCURRENCY, async (story) => {
    const tenant = tenants[story.tenant];
    const texts = story.points.map((p) => p.text);
    const t0 = Date.now();
    let verdicts = null, attempts = 0;
    while (!verdicts && attempts < 2) {
      attempts++;
      // threshold 1: every verdict comes back; the thresholds are applied below
      verdicts = await judgePoints(tenant, story, texts, { spawnImpl, threshold: 1 });
    }
    log(`  ${verdicts ? "✓" : "✗"} ${story.id} (${((Date.now() - t0) / 1000).toFixed(1)} s${attempts > 1 ? `, ${attempts} tries` : ""})`);
    const lexical = lexicalReasons(tenant, story, texts);
    return story.points.map((p, i) => ({
      story: story.id, tenant: story.tenant, i, text: p.text, label: p.label, labelSource: p.labelSource, why: p.why,
      lexical: lexical[i],
      judge: verdicts ? { score: verdicts[i].score, against: verdicts[i].against, newFact: verdicts[i].newFact, grounded: verdicts[i].grounded, generic: verdicts[i].generic, vsTitle: verdicts[i].vsTitle, vsDek: verdicts[i].vsDek, vsPoints: verdicts[i].vsPoints } : null,
    }));
  });
  const cases = judged.flat();
  const failed = set.stories.filter((_, k) => judged[k].every((c) => !c.judge)).map((s) => s.id);
  const lexicalOnly = metrics(cases, (c) => Boolean(c.lexical));
  const byThreshold = THRESHOLDS.map((t) => ({ threshold: t, judge: metrics(cases, (c) => judgeRejects(c, t)), lexical: lexicalOnly, combined: metrics(cases, (c) => combinedRejects(c, t)) }));
  const eligible = byThreshold.filter((r) => r.combined.recall >= MIN_RECALL);
  const best = (eligible.length ? eligible : byThreshold).slice().sort((a, b) => b.combined.f1 - a.combined.f1 || b.combined.precision - a.combined.precision || Math.abs(a.threshold - 0.6) - Math.abs(b.threshold - 0.6))[0];
  const t = best.threshold;
  const row = (c) => ({ story: c.story, text: c.text, label: c.label, lexical: c.lexical, ...(c.judge ? { score: c.judge.score, against: c.judge.against, newFact: c.judge.newFact, grounded: c.judge.grounded, generic: c.judge.generic } : { judge: "failed" }) });
  const perLanguage = Object.fromEntries(["ragusa", "alienwatch"].map((slug) => [slug, metrics(cases.filter((c) => c.tenant === slug), (c) => combinedRejects(c, t))]));
  const perLabel = Object.fromEntries(["new", "repeat", "generic"].map((label) => {
    const of = cases.filter((c) => c.label === label);
    return [label, { cases: of.length, rejectedLexical: of.filter((c) => c.lexical).length, rejectedJudge: of.filter((c) => judgeRejects(c, t)).length, rejectedCombined: of.filter((c) => combinedRejects(c, t)).length }];
  }));
  const judgeCalls = calls.filter((c) => c.phase === "judge-eval");
  return {
    set: { file: SET.replace(`${REPO}/`, ""), stories: set.stories.length, cases: cases.length, counts: set.counts },
    recommended: { threshold: t, rule: eligible.length ? `best combined F1 with recall ≥ ${MIN_RECALL}` : `no threshold reaches recall ${MIN_RECALL}: best combined F1` },
    byThreshold,
    perLanguage,
    perLabel,
    falsePositives: cases.filter((c) => c.label === "new" && combinedRejects(c, t)).map(row),
    falseNegatives: cases.filter((c) => c.label !== "new" && !combinedRejects(c, t)).map(row),
    lexicalCatches: cases.filter((c) => c.label !== "new" && c.lexical).length,
    judgeOnlyCatches: cases.filter((c) => c.label !== "new" && !c.lexical && judgeRejects(c, t)).length,
    failedStories: failed,
    time: { wallMs: Date.now() - started, calls: judgeCalls.length, failedCalls: judgeCalls.filter((c) => !c.ok).length, avgCallMs: Math.round(ratio(judgeCalls.reduce((n, c) => n + c.ms, 0), judgeCalls.length)), costUsd: round3(judgeCalls.reduce((n, c) => n + (c.cost || 0), 0)) },
    cases,
  };
}

// ── 2. the loop on live stories ────────────────────────────────────────────
async function loopEval(threshold) {
  const tenant = loadTenant("ragusa");
  const agent = storyAgent(tenant);
  const spawnImpl = meteredSpawn("loop");
  const latest = (await fetchStories(tenant, { maxItems: 30 })).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 30);
  const picked = latest.slice(-LOOP).reverse();
  log(`loop: ${picked.length} stories (the oldest of the latest ${latest.length}), threshold ${threshold}`);
  const started = Date.now();
  const stories = await mapLimit(picked, CONCURRENCY, async (story) => {
    const t0 = Date.now();
    const body = await fetchStoryBody(tenant, story);
    let summary = [], error = null, r = null;
    try {
      summary = parseSummaryLines(await askSummaryAgent(agent, buildSummaryPrompt(tenant, { ...story, body }), { spawnImpl }));
      r = await refinePoints(tenant, { ...story, body }, summary, { agent, spawnImpl, threshold });
    } catch (e) { error = e.message; }
    const summaryMs = r ? Date.now() - t0 - r.ms : Date.now() - t0;
    log(`  ${r ? "✓" : "✗"} ${story.slug.slice(0, 60)} · ${r ? `${r.kept.length} kept, ${r.dropped.length} dropped, ${r.rounds} round(s)` : error}`);
    return {
      slug: story.slug, date: story.date, title: story.title, dek: story.dek, bodyChars: body.length, summary,
      kept: r?.kept ?? [], dropped: r?.dropped ?? [], replaced: (r?.replaced ?? []).map(({ point, reason, by }) => ({ point, reason, by })),
      rounds: r?.rounds ?? 0, judgeCalls: r?.judgeCalls ?? 0, rewriteCalls: r?.rewriteCalls ?? 0, judge: r?.judge ?? null,
      summaryMs, refineMs: r?.ms ?? 0, wallMs: Date.now() - t0, error,
    };
  });
  const ok = stories.filter((s) => !s.error);
  const avg = (f) => round3(ratio(ok.reduce((n, s) => n + f(s), 0), ok.length));
  const reasons = {};
  for (const s of ok) for (const d of s.dropped) { const k = String(d.reason).replace(/^semantic [\d.]+ vs .*/, "semantic"); reasons[k] = (reasons[k] || 0) + 1; }
  const loopCalls = calls.filter((c) => c.phase === "loop");
  return {
    threshold,
    stories,
    averages: { rounds: avg((s) => s.rounds), judgeCalls: avg((s) => s.judgeCalls), rewriteCalls: avg((s) => s.rewriteCalls), summaryPoints: avg((s) => s.summary.length), kept: avg((s) => s.kept.length), dropped: avg((s) => s.dropped.length), replaced: avg((s) => s.replaced.length), wallMs: Math.round(avg((s) => s.wallMs)), refineMs: Math.round(avg((s) => s.refineMs)) },
    roundsHistogram: ok.reduce((h, s) => ({ ...h, [s.rounds]: (h[s.rounds] || 0) + 1 }), {}),
    dropReasons: reasons,
    errors: stories.filter((s) => s.error).map((s) => ({ slug: s.slug, error: s.error })),
    time: { wallMs: Date.now() - started, calls: loopCalls.length, byKind: loopCalls.reduce((h, c) => ({ ...h, [c.kind]: (h[c.kind] || 0) + 1 }), {}), failedCalls: loopCalls.filter((c) => !c.ok).length, costUsd: round3(loopCalls.reduce((n, c) => n + (c.cost || 0), 0)) },
  };
}

// ── report ─────────────────────────────────────────────────────────────────
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const verdictCell = (c) => (c.judge === "failed" ? "judge failed" : `${c.score.toFixed(2)} vs ${c.against}${c.newFact ? ` · new: "${esc(c.newFact)}"` : " · no new fact"}${c.grounded === false ? " · ungrounded" : ""}${c.generic ? " · generic" : ""}`);

function markdown({ judge, loop, model }) {
  const t = judge.recommended.threshold;
  const L = [];
  L.push(`# Point judge eval — ${DATE}`, "");
  L.push(`Agent: \`${(storyAgent(loadTenant("ragusa")).command || []).join(" ")}\`${model ? ` (${model})` : ""}. Eval set: \`${judge.set.file}\`, ${judge.set.stories} stories, ${judge.set.cases} cases (${judge.set.counts.new} new, ${judge.set.counts.repeat} repeat, ${judge.set.counts.generic} generic).`, "");
  L.push(`## Headline`, "");
  const rec = judge.byThreshold.find((r) => r.threshold === t);
  L.push(`- **Recommended threshold: ${t}** (${judge.recommended.rule}).`);
  L.push(`- Combined (lexical + judge) at ${t}: precision ${pct(rec.combined.precision)}, recall ${pct(rec.combined.recall)}, F1 ${rec.combined.f1}.`);
  L.push(`- Lexical only: precision ${pct(rec.lexical.precision)}, recall ${pct(rec.lexical.recall)}, F1 ${rec.lexical.f1} — it catches ${judge.lexicalCatches} of ${judge.set.counts.repeat + judge.set.counts.generic} repeats/generic; the judge adds ${judge.judgeOnlyCatches} more.`);
  L.push(`- Judge only at ${t}: precision ${pct(rec.judge.precision)}, recall ${pct(rec.judge.recall)}, F1 ${rec.judge.f1}.`);
  L.push(`- Judge calls: ${judge.time.calls} (${judge.time.failedCalls} failed, ${judge.failedStories.length} stories without a verdict), ${sec(judge.time.avgCallMs)} per call, ${sec(judge.time.wallMs)} wall at concurrency ${CONCURRENCY}${judge.time.costUsd ? `, $${judge.time.costUsd}` : ""}.`);
  if (loop) L.push(`- Loop on ${loop.stories.length} live stories at ${loop.threshold}: ${loop.averages.rounds} rounds, ${loop.averages.judgeCalls} judge and ${loop.averages.rewriteCalls} rewrite calls, ${loop.averages.kept} points kept and ${loop.averages.dropped} dropped per story on average; ${sec(loop.averages.wallMs)} per story (summary included).`);
  L.push("", `## Reject = repeat or generic: precision / recall / F1`, "");
  L.push(`| threshold | judge only | lexical only | combined |`, `|---|---|---|---|`);
  for (const r of judge.byThreshold) {
    const f = (m) => `${pct(m.precision)} / ${pct(m.recall)} / ${m.f1} (FP ${m.fp}, FN ${m.fn})`;
    L.push(`| ${r.threshold}${r.threshold === t ? " ✓" : ""} | ${f(r.judge)} | ${f(r.lexical)} | ${f(r.combined)} |`);
  }
  L.push("", `By tenant (combined at ${t}): ${Object.entries(judge.perLanguage).map(([k, m]) => `${k} P ${pct(m.precision)} R ${pct(m.recall)} F1 ${m.f1}`).join("; ")}.`, "");
  L.push(`| label | cases | rejected lexical | rejected judge | rejected combined |`, `|---|---|---|---|---|`);
  for (const [label, r] of Object.entries(judge.perLabel)) L.push(`| ${label} | ${r.cases} | ${r.rejectedLexical} | ${r.rejectedJudge} | ${r.rejectedCombined} |`);
  L.push("", `## False positives at ${t}: new facts rejected (${judge.falsePositives.length})`, "");
  if (!judge.falsePositives.length) L.push("None.");
  for (const c of judge.falsePositives) L.push(`- \`${c.story}\` "${esc(c.text)}" — ${c.lexical ? `lexical: ${c.lexical}; ` : ""}${verdictCell(c)}`);
  L.push("", `## False negatives at ${t}: repeats or generic passed (${judge.falseNegatives.length})`, "");
  if (!judge.falseNegatives.length) L.push("None.");
  for (const c of judge.falseNegatives) L.push(`- \`${c.story}\` [${c.label}] "${esc(c.text)}" — ${verdictCell(c)}`);
  if (loop) {
    L.push("", `## Loop: summary + refinePoints on live ragusa stories (threshold ${loop.threshold})`, "");
    L.push(`The ${loop.stories.length} oldest of the latest 30 stories in the feed, none skipped.`, "");
    L.push(`| story | summary | kept | dropped (reason) | replaced | rounds | judge | rewrite | wall |`, `|---|---|---|---|---|---|---|---|---|`);
    for (const s of loop.stories) {
      L.push(`| ${esc(s.title).slice(0, 70)} | ${s.summary.length} | ${s.kept.length} | ${s.dropped.length ? s.dropped.map((d) => esc(d.reason)).join(", ") : "—"} | ${s.replaced.length} | ${s.rounds} | ${s.judgeCalls} | ${s.rewriteCalls} | ${sec(s.wallMs)}${s.error ? ` ✗ ${esc(s.error)}` : ""} |`);
    }
    const a = loop.averages;
    L.push(`| **average** | ${a.summaryPoints} | ${a.kept} | ${a.dropped} | ${a.replaced} | ${a.rounds} | ${a.judgeCalls} | ${a.rewriteCalls} | ${sec(a.wallMs)} |`, "");
    L.push(`Rounds: ${Object.entries(loop.roundsHistogram).map(([k, v]) => `${v} × ${k}`).join(", ")}. Drop reasons: ${Object.entries(loop.dropReasons).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}. Agent calls: ${loop.time.calls} (${Object.entries(loop.time.byKind).map(([k, v]) => `${k} ${v}`).join(", ")}; ${loop.time.failedCalls} failed), ${sec(loop.time.wallMs)} wall${loop.time.costUsd ? `, $${loop.time.costUsd}` : ""}.`);
    L.push("", `### Kept and dropped points`, "");
    for (const s of loop.stories) {
      L.push(`**${esc(s.title)}**`, "");
      for (const p of s.kept) L.push(`- ✓ ${esc(p)}`);
      for (const d of s.dropped) L.push(`- ✗ ${esc(d.point)} — ${esc(d.reason)}`);
      for (const r of s.replaced) L.push(`- ↻ ${esc(r.point)} — ${esc(r.reason)} → "${esc(r.by)}"`);
      L.push("");
    }
  }
  return L.join("\n") + "\n";
}

const judge = await judgeEval();
log(`recommended threshold: ${judge.recommended.threshold}`);
const loop = LOOP ? await loopEval(judge.recommended.threshold) : null;
const model = [...new Set(calls.map((c) => c.model).filter(Boolean))].join(", ") || null;
const outDir = join(HERE, "results");
mkdirSync(outDir, { recursive: true });
const result = { date: DATE, model, agent: storyAgent(loadTenant("ragusa")).command, judge, loop, calls: { total: calls.length, costUsd: round3(calls.reduce((n, c) => n + (c.cost || 0), 0)) } };
writeFileSync(join(outDir, `${DATE}.json`), JSON.stringify(result, null, 2) + "\n");
writeFileSync(join(outDir, `${DATE}.md`), markdown(result));
log(`wrote ${join("skill", "eval", "results", `${DATE}.json`)} and .md`);
console.log(JSON.stringify({ recommended: judge.recommended, headline: judge.byThreshold.find((r) => r.threshold === judge.recommended.threshold), loop: loop?.averages ?? null }, null, 2));
