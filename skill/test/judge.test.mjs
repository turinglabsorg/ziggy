import assert from "node:assert/strict";
import { test } from "node:test";

import { buildJudgePrompt, DEFAULT_JUDGE_THRESHOLD, judgeConfig, judgePoints, judgeReason, parseJudge, strongest } from "../scripts/judge.mjs";
import { POINT_SPEC, refinePoints, storyPoints } from "../scripts/story.mjs";
import { fakeStoryAgent, judgedPoints, judgeReply } from "./helpers.mjs";

// the case that started it: four points that only restate the dek, each under the 0.6 word overlap
const MODICA = {
  title: "Modica, la Corte dei conti accende i riflettori sul dissesto",
  dek: "La Sezione delle autonomie dedica a Modica una scheda sul dissesto; il Pd chiede l'insediamento della commissione d'inchiesta e il bilancio riequilibrato, mentre la Procura di Ragusa contesta l'ex sindaco.",
  slug: "modica-corte-dei-conti-dissesto-1a2b3c4d",
  url: "https://ragusa.buzz/#/b/modica-corte-dei-conti-dissesto-1a2b3c4d?lang=it",
  sources: 3, languages: 1,
};
const PARAPHRASES = [
  "La Sezione delle autonomie ha dedicato una scheda specifica al dissesto del Comune.",
  "Il Pd chiede che la commissione d'inchiesta del consiglio comunale venga insediata.",
  "Lo stesso partito sollecita anche il bilancio riequilibrato dell'ente.",
  "Intanto la Procura di Ragusa muove contestazioni all'ex sindaco.",
];
const FACTS = [
  "Il disavanzo del Comune supera i 40 milioni di euro.",
  "La scheda è nella relazione 2026 sugli enti in dissesto.",
  "Il consiglio comunale torna a riunirsi giovedì 30 ottobre.",
  "Il nuovo piano dovrà essere approvato entro il 31 dicembre.",
];
const BODY = `La relazione 2026 della Sezione delle autonomie sugli enti in dissesto dedica una scheda a Modica. ${FACTS[0]} ${FACTS[2]} ${FACTS[3]}`;
const RAGUSA = { slug: "ragusa", name: "Ragusa Buzz", language: "it", feed: { url: "https://ragusa.buzz/feed/v1/briefings?lang=it&limit=50", agent: { command: ["fake-agent"] }, displayUrl: "ragusa.buzz" }, social: { cta: "La storia completa: {url}", hashtags: "#Ragusa" } };
const ECHO = { vsDek: 0.9, newFact: "" };

test("the lexical filter lets the Modica paraphrases through: the judge exists for them", () => {
  assert.deepEqual(storyPoints(RAGUSA, MODICA, PARAPHRASES).kept, PARAPHRASES);
});

test("judgeConfig: tenant.json feed.judge, then the environment, then the default", () => {
  assert.deepEqual(judgeConfig({}, {}), { enabled: true, threshold: DEFAULT_JUDGE_THRESHOLD });
  assert.deepEqual(judgeConfig({}, { ZIGGY_JUDGE_THRESHOLD: "0.7" }), { enabled: true, threshold: 0.7 });
  assert.deepEqual(judgeConfig({ feed: { judge: { threshold: 0.5 } } }, { ZIGGY_JUDGE_THRESHOLD: "0.7" }), { enabled: true, threshold: 0.5 }, "tenant.json wins");
  assert.equal(judgeConfig({ feed: { judge: { threshold: 7 } } }, { ZIGGY_JUDGE_THRESHOLD: "x" }).threshold, DEFAULT_JUDGE_THRESHOLD, "out of range or not a number: the default");
  assert.equal(judgeConfig({ feed: { judge: false } }, {}).enabled, false);
  for (const v of ["0", "false", "off"]) assert.equal(judgeConfig({}, { ZIGGY_JUDGE: v }).enabled, false, v);
  assert.equal(judgeConfig({}, { ZIGGY_JUDGE: "1" }).enabled, true);
});

test("the judge prompt: task, the CAN/CANNOT spec, four calibration examples, the JSON shape, then the story and the points", () => {
  const it = buildJudgePrompt(RAGUSA, { ...MODICA, body: BODY, points: PARAPHRASES });
  assert.match(it, /^Controlli i punti di una notizia/);
  assert.match(it, /vsTitle: dal titolo/);
  assert.match(it, /vsPoints: da ciascun punto prima di lui, un valore per punto/);
  assert.match(it, /Conta il significato, non le parole: 1 = la stessa informazione con altre parole/);
  assert.match(it, /newFact: il fatto nuovo e preciso che il punto aggiunge, in massimo 12 parole/);
  assert.ok(it.includes(POINT_SPEC.it));
  // calibration: a paraphrase ~0.9, a partial overlap that adds a number ~0.3, a line about the sources (generic), a new name and amount ~0.1
  assert.match(it, /"vsTitle":0\.9,"vsDek":0\.9,"newFact":""/);
  assert.match(it, /"vsTitle":0\.3,"vsDek":0\.3,"newFact":"chiusura di almeno 90 giorni"/);
  assert.match(it, /Le fonti non indicano[^\n]*"generic":true/);
  assert.match(it, /"vsTitle":0\.1,"vsDek":0\.1,"newFact":"appalto da 1,2 milioni/);
  assert.match(it, /Rispondi SOLO con questo JSON[^\n]*\n\{"points":\[\{"i":0,"vsTitle":0\.0,"vsDek":0\.0,"vsPoints":\[\],"newFact":"","grounded":true,"generic":false\}\]\}\n/);
  assert.ok(it.endsWith([`Headline: ${MODICA.title}`, `Deck: ${MODICA.dek}`, `Article: ${BODY}`, "Points:", ...PARAPHRASES.map((p, i) => `${i}. ${p}`)].join("\n")), it);
  const en = buildJudgePrompt({ language: "en" }, { title: "T", dek: "D", body: "", points: ["One."] });
  assert.match(en, /^You check the points of a news story/);
  assert.ok(en.includes(POINT_SPEC.en));
  assert.match(en, /The €1\.2 million contract went to Northline Builders/);
  assert.ok(en.endsWith("Headline: T\nDeck: D\nArticle: (no article: grounded is true unless the point contradicts the headline or the deck)\nPoints:\n0. One."), en);
  // the article clipped at a sentence end, like the summary's
  const long = Array.from({ length: 200 }, (_, i) => `Sentence ${i} of the article.`).join(" ");
  const clipped = buildJudgePrompt({ language: "en" }, { title: "T", dek: "D", body: long, points: ["One."] }).match(/\nArticle: (.*)\nPoints:/)[1];
  assert.ok(clipped.length <= 2500 && clipped.endsWith("article.") && long.startsWith(clipped), `${clipped.length} characters`);
});

test("parseJudge: the claude JSON wrapper, code fences, prose around it; null on anything malformed", () => {
  const two = [{ i: 0, vsTitle: 0.2, vsDek: 0.9, vsPoints: [], newFact: "", grounded: true, generic: false }, { i: 1, vsTitle: 0.1, vsDek: 0.1, vsPoints: [0.3], newFact: "40 milioni di disavanzo", grounded: true, generic: false }];
  const raw = JSON.stringify({ points: two });
  assert.deepEqual(parseJudge(raw, 2), two);
  assert.deepEqual(parseJudge(JSON.stringify({ type: "result", result: raw }), 2), two, "claude --output-format json");
  assert.deepEqual(parseJudge(JSON.stringify({ result: "```json\n" + raw + "\n```" }), 2), two, "fenced inside the wrapper");
  assert.deepEqual(parseJudge(`Ecco il giudizio {non json} richiesto:\n${raw}\nFine.`, 2), two, "prose and stray braces around it");
  assert.deepEqual(parseJudge(JSON.stringify({ points: [...two].reverse() }), 2), two, "out of order: sorted by i");
  // defaults: no i (position), no vsPoints on the first, grounded true, generic false, newFact ""
  assert.deepEqual(parseJudge(JSON.stringify({ points: [{ vsTitle: "0.4", vsDek: 0 }] }), 1), [{ i: 0, vsTitle: 0.4, vsDek: 0, vsPoints: [], newFact: "", grounded: true, generic: false }]);
  // longer vsPoints than earlier points: cut to them
  assert.deepEqual(parseJudge(JSON.stringify({ points: [two[0], { ...two[1], vsPoints: [0.3, 0.5] }] }), 2)[1].vsPoints, [0.3]);
  for (const [bad, why] of [
    ["", "empty"], ["not json at all", "no JSON"], [JSON.stringify({ result: "no" }), "wrapper without points"],
    [JSON.stringify({ points: [two[0]] }), "a point missing"],
    [JSON.stringify({ points: [two[0], two[0]] }), "a point twice"],
    [JSON.stringify({ points: [two[0], { ...two[1], i: 2 }] }), "i out of range"],
    [JSON.stringify({ points: [{ ...two[0], vsDek: 1.5 }, two[1]] }), "score over 1"],
    [JSON.stringify({ points: [{ ...two[0], vsTitle: -0.1 }, two[1]] }), "score under 0"],
    [JSON.stringify({ points: [two[0], { ...two[1], vsPoints: [] }] }), "vsPoints shorter than the earlier points"],
    [JSON.stringify({ points: [two[0], { ...two[1], vsPoints: ["high"] }] }), "vsPoints not a number"],
    [JSON.stringify({ points: [{ ...two[0], grounded: "maybe" }, two[1]] }), "grounded not a boolean"],
    [JSON.stringify({ points: [{ ...two[0], newFact: 42 }, two[1]] }), "newFact not a string"],
  ]) assert.equal(parseJudge(bad, 2), null, why);
  assert.deepEqual(parseJudge(JSON.stringify({ points: [] }), 0), []);
});

test("strongest and judgeReason: the highest similarity and what it is against", () => {
  assert.deepEqual(strongest({ vsTitle: 0.2, vsDek: 0.83, vsPoints: [0.5] }), { score: 0.83, against: "dek" });
  assert.deepEqual(strongest({ vsTitle: 0.2, vsDek: 0.3, vsPoints: [0.1, 0.9] }), { score: 0.9, against: "point 2" });
  assert.deepEqual(strongest({ vsTitle: 0.7, vsDek: 0.7, vsPoints: [0.7] }), { score: 0.7, against: "title" }, "a tie goes to the first");
  const base = { score: 0.2, against: "dek", newFact: "x", grounded: true, generic: false };
  assert.equal(judgeReason({ ...base, score: 0.83 }, 0.6), "semantic 0.83 vs dek");
  assert.equal(judgeReason({ ...base, grounded: false, score: 0.9 }, 0.6), "ungrounded");
  assert.equal(judgeReason({ ...base, generic: true }, 0.6), "generic");
  assert.equal(judgeReason({ ...base, newFact: "" }, 0.6), "no new fact");
});

test("judgePoints: one call per story; pass = under the threshold, a new fact, grounded, not generic", async () => {
  const points = [...PARAPHRASES.slice(0, 1), ...FACTS.slice(0, 3), "Le fonti non indicano la cifra esatta."];
  const table = {
    [PARAPHRASES[0]]: { vsDek: 0.88, newFact: "" },
    [FACTS[1]]: { vsDek: 0.55, newFact: "relazione 2026" },
    [FACTS[2]]: { grounded: false },
    "Le fonti non indicano la cifra esatta.": { generic: true, newFact: "" },
  };
  const agent = fakeStoryAgent({ judge: table });
  const story = { ...MODICA, body: BODY };
  const verdicts = await judgePoints(RAGUSA, story, points, { spawnImpl: agent.spawnImpl });
  assert.equal(agent.prompts.judge.length, 1);
  assert.deepEqual(judgedPoints(agent.prompts.judge[0]), points);
  assert.deepEqual(verdicts.map((v) => [v.point, v.pass, v.score, v.against]), [
    [points[0], false, 0.88, "dek"],
    [points[1], true, 0.1, "title"],
    [points[2], true, 0.55, "dek"],
    [points[3], false, 0.1, "title"],
    [points[4], false, 0.1, "title"],
  ]);
  assert.deepEqual(verdicts.map((v) => judgeReason(v, 0.6)).filter((_, i) => !verdicts[i].pass), ["semantic 0.88 vs dek", "ungrounded", "generic"]);
  assert.deepEqual(Object.keys(verdicts[0]), ["point", "score", "against", "newFact", "grounded", "generic", "pass", "vsTitle", "vsDek", "vsPoints"]);
  // the threshold: tenant.json, then ZIGGY_JUDGE_THRESHOLD, then an explicit option
  const at = async (opts, tenant = RAGUSA) => (await judgePoints(tenant, story, points, { spawnImpl: fakeStoryAgent({ judge: table }).spawnImpl, ...opts }))[2].pass;
  assert.equal(await at({ threshold: 0.5 }), false, "0.55 repeats at 0.5");
  assert.equal(await at({}, { ...RAGUSA, feed: { ...RAGUSA.feed, judge: { threshold: 0.5 } } }), false);
  process.env.ZIGGY_JUDGE_THRESHOLD = "0.5";
  try { assert.equal(await at({}), false); } finally { delete process.env.ZIGGY_JUDGE_THRESHOLD; }
  assert.equal(await at({}), true);
  // no points: nothing asked
  assert.deepEqual(await judgePoints(RAGUSA, story, [], { spawnImpl: () => assert.fail("nothing to judge") }), []);
});

test("judgePoints: off, no agent, a failing agent or an unreadable reply → null, never a throw", async () => {
  const story = { ...MODICA, body: BODY };
  const never = () => assert.fail("the judge is off");
  assert.equal(await judgePoints({ ...RAGUSA, feed: { ...RAGUSA.feed, judge: false } }, story, FACTS, { spawnImpl: never }), null);
  process.env.ZIGGY_JUDGE = "0";
  try { assert.equal(await judgePoints(RAGUSA, story, FACTS, { spawnImpl: never }), null); } finally { delete process.env.ZIGGY_JUDGE; }
  assert.equal(await judgePoints({ ...RAGUSA, feed: { ...RAGUSA.feed, agent: null } }, story, FACTS, { spawnImpl: never }), null);
  for (const reply of [
    { status: 1, stdout: "", stderr: "rate limited" },
    { error: Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }) },
    { status: 0, stdout: JSON.stringify({ type: "result", is_error: true, result: "Credit balance is too low" }), stderr: "" },
    { status: 0, stdout: judgeReply(FACTS.slice(0, 2)), stderr: "" },
  ]) assert.equal(await judgePoints(RAGUSA, story, FACTS, { spawnImpl: () => reply }), null, JSON.stringify(reply).slice(0, 60));
  assert.equal(await judgePoints(RAGUSA, story, FACTS, { spawnImpl: () => { throw new Error("boom"); } }), null);
});

test("refinePoints: every point passes in round 1 → one judge call, no rewrite", async () => {
  const agent = fakeStoryAgent({ replace: () => assert.fail("nothing to replace") });
  const r = await refinePoints(RAGUSA, { ...MODICA, body: BODY }, FACTS, { spawnImpl: agent.spawnImpl });
  assert.deepEqual([r.points, r.kept, r.dropped, r.replaced, r.rewritten], [FACTS, FACTS, [], [], false]);
  assert.deepEqual([r.rounds, r.judgeCalls, r.rewriteCalls, r.judge, r.threshold], [1, 1, 0, "on", DEFAULT_JUDGE_THRESHOLD]);
  assert.ok(Number.isInteger(r.ms) && r.ms >= 0);
});

test("refinePoints: the Modica paraphrases fail the judge, the agent replaces only them, round 2 passes", async () => {
  const points = [FACTS[0], ...PARAPHRASES.slice(0, 3)];
  const agent = fakeStoryAgent({
    judge: Object.fromEntries(PARAPHRASES.map((p) => [p, ECHO])),
    // the full list back, as asked: the passing one verbatim, the others replaced
    replace: [FACTS[0], FACTS[1], FACTS[2], FACTS[3]].join("\n"),
  });
  const r = await refinePoints(RAGUSA, { ...MODICA, body: BODY }, points, { spawnImpl: agent.spawnImpl });
  assert.deepEqual(r.points, FACTS);
  assert.deepEqual([r.rounds, r.judgeCalls, r.rewriteCalls, r.rewritten], [2, 2, 1, true]);
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.replaced.map((x) => [x.point, x.reason, x.by]), PARAPHRASES.slice(0, 3).map((p, i) => [p, "semantic 0.90 vs dek", FACTS[i + 1]]));
  assert.match(agent.prompts.replace[0], /^Questi sono i punti di una notizia[^\n]*\n1\. ✓ Il disavanzo[^\n]*\n2\. ✗ La Sezione delle autonomie ha dedicato[^\n]* — ripete il sommario \(0\.90\)\n/);
  assert.ok(agent.prompts.replace[0].includes(POINT_SPEC.it));
  assert.ok(agent.prompts.replace[0].endsWith(`Article: ${BODY}`));
  // a reply of another length: the lines that are not a passing point fill the failing places in order
  const short = fakeStoryAgent({ judge: Object.fromEntries(PARAPHRASES.map((p) => [p, ECHO])), replace: `${FACTS[1]}\n${FACTS[0]}` });
  const s = await refinePoints(RAGUSA, { ...MODICA, body: BODY }, points, { spawnImpl: short.spawnImpl });
  assert.deepEqual(s.points, [FACTS[0], FACTS[1]]);
  assert.deepEqual(s.dropped.map((d) => d.point), PARAPHRASES.slice(1, 3), "no replacement: left out with their reason");
  assert.deepEqual(s.dropped.map((d) => d.reason), ["semantic 0.90 vs dek", "semantic 0.90 vs dek"]);
  // a reply that moves a passing point: it is never a replacement, and never there twice
  const moved = fakeStoryAgent({ judge: Object.fromEntries(PARAPHRASES.map((p) => [p, ECHO])), replace: [FACTS[1], FACTS[0], FACTS[2], FACTS[3]].join("\n") });
  const m = await refinePoints(RAGUSA, { ...MODICA, body: BODY }, points, { spawnImpl: moved.spawnImpl });
  assert.deepEqual(m.points, [FACTS[0], FACTS[2], FACTS[3]]);
  assert.deepEqual(m.dropped, [{ point: PARAPHRASES[0], reason: "semantic 0.90 vs dek" }]);
});

test("refinePoints: still failing after 3 rounds → dropped with its last reason; the story keeps the rest", async () => {
  const tries = ["Il caso di Modica è una vicenda importante per tutta la provincia.", "Resta da vedere come finirà la vicenda del dissesto.", "Sarà una questione decisiva per il futuro della città."];
  const agent = fakeStoryAgent({
    judge: { [PARAPHRASES[3]]: ECHO, [tries[0]]: { generic: true, newFact: "" }, [tries[1]]: { generic: true, newFact: "" }, [tries[2]]: { generic: true, newFact: "" } },
    replace: tries.map((t) => `${FACTS[0]}\n${t}`),
  });
  const r = await refinePoints(RAGUSA, { ...MODICA, body: BODY }, [FACTS[0], PARAPHRASES[3]], { spawnImpl: agent.spawnImpl });
  assert.deepEqual(r.points, [FACTS[0]]);
  assert.deepEqual(r.dropped, [{ point: tries[1], reason: "generic" }]);
  assert.deepEqual([r.rounds, r.judgeCalls, r.rewriteCalls, r.rewritten], [3, 3, 2, false]);
  // maxRounds is the limit: one round is judge and drop
  const once = await refinePoints(RAGUSA, { ...MODICA, body: BODY }, [FACTS[0], PARAPHRASES[3]], { spawnImpl: fakeStoryAgent({ judge: { [PARAPHRASES[3]]: ECHO } }).spawnImpl, maxRounds: 1 });
  assert.deepEqual([once.points, once.dropped, once.rounds, once.rewriteCalls], [[FACTS[0]], [{ point: PARAPHRASES[3], reason: "semantic 0.90 vs dek" }], 1, 0]);
  // all four paraphrases, and an agent with no other fact (it gives them back): 0 points, never a throw
  const stuck = fakeStoryAgent({ judge: Object.fromEntries(PARAPHRASES.map((p) => [p, ECHO])), replace: PARAPHRASES.join("\n") });
  const none = await refinePoints(RAGUSA, { ...MODICA, body: BODY }, PARAPHRASES, { spawnImpl: stuck.spawnImpl });
  assert.deepEqual([none.points, none.dropped.length, none.rounds, none.rewriteCalls], [[], 4, 1, 1]);
});

test("refinePoints: no article → judged and dropped, no rewrite; the body is fetched when the story has none", async () => {
  const agent = fakeStoryAgent({ judge: { [PARAPHRASES[0]]: ECHO }, replace: () => assert.fail("no article, no rewrite") });
  let fetched = 0;
  const noBody = async () => { fetched++; return new Response("nope", { status: 404 }); };
  const r = await refinePoints(RAGUSA, MODICA, [FACTS[0], PARAPHRASES[0]], { spawnImpl: agent.spawnImpl, fetchImpl: noBody });
  assert.equal(fetched, 1);
  assert.deepEqual([r.points, r.dropped, r.rounds, r.rewriteCalls], [[FACTS[0]], [{ point: PARAPHRASES[0], reason: "semantic 0.90 vs dek" }], 1, 0]);
  assert.match(agent.prompts.judge[0], /\nArticle: \(nessun articolo/);
  // with the article: fetched, judged against it
  const withBody = fakeStoryAgent();
  await refinePoints(RAGUSA, MODICA, FACTS, { spawnImpl: withBody.spawnImpl, fetchImpl: async () => new Response(JSON.stringify({ data: { bodyHtml: `<p>${BODY}</p>` } }), { status: 200 }) });
  assert.ok(withBody.prompts.judge[0].includes(`\nArticle: ${BODY}\nPoints:\n`));
});

test("refinePoints: no agent → the lexical filter alone, nothing fetched or asked; the judge failing → the lexical filter decides", async () => {
  const echo = MODICA.title; // the headline itself: a lexical repeat
  const never = async () => assert.fail("no agent, no fetch");
  const r = await refinePoints(RAGUSA, MODICA, [echo, ...PARAPHRASES], { agent: null, fetchImpl: never });
  assert.deepEqual([r.points, r.dropped.map((d) => d.reason), r.rounds, r.judgeCalls, r.rewriteCalls, r.judge], [PARAPHRASES, ["no new words"], 1, 0, 0, "off"]);
  // off in tenant.json: the same, but the agent still replaces the lexical failures from the article
  const off = fakeStoryAgent({ judge: () => assert.fail("the judge is off"), replace: [FACTS[0], ...PARAPHRASES.slice(0, 3)].join("\n") });
  const o = await refinePoints({ ...RAGUSA, feed: { ...RAGUSA.feed, judge: false } }, { ...MODICA, body: BODY }, [echo, ...PARAPHRASES.slice(0, 3)], { spawnImpl: off.spawnImpl });
  assert.deepEqual([o.points, o.rounds, o.judge, o.rewritten], [[FACTS[0], ...PARAPHRASES.slice(0, 3)], 2, "off", true]);
  // a judge that answers nonsense: lexical from then on, the paraphrases stay
  const broken = fakeStoryAgent({ judge: () => "Mi dispiace, non posso.", replace: () => assert.fail("every point passes the lexical filter") });
  const b = await refinePoints(RAGUSA, { ...MODICA, body: BODY }, PARAPHRASES, { spawnImpl: broken.spawnImpl });
  assert.deepEqual([b.points, b.dropped, b.judge, b.judgeCalls], [PARAPHRASES, [], "failed", 1]);
  // a rewrite that fails: what passed stays
  const down = fakeStoryAgent({ judge: { [PARAPHRASES[0]]: ECHO }, replace: { status: 1, stdout: "", stderr: "boom" } });
  const d = await refinePoints(RAGUSA, { ...MODICA, body: BODY }, [PARAPHRASES[0], FACTS[0]], { spawnImpl: down.spawnImpl });
  assert.deepEqual([d.points, d.dropped.map((x) => x.reason), d.rewriteCalls], [[FACTS[0]], ["semantic 0.90 vs dek"], 1]);
});
