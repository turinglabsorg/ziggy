# Point judge eval

`points-eval.json` is a labelled set of story points for the semantic judge (`scripts/judge.mjs`)
and the lexical filter (`scripts/lint.mjs` `pointsReport`). `run-points-eval.mjs` runs it with the
real agent and writes `results/<date>.json` and a readable `results/<date>.md`. It is **not** part
of `npm test`: it calls `claude -p` (the tenant's story agent) about 50 times — the run of
2026-10-21 made 29 judge calls and 22 loop calls in about 12 minutes, for about $7.

`before-after.mjs` (also not in `npm test`) runs three stories of the set through the real
`refinePoints` from the set's points, and writes `results/<date>-before-after.{json,md}`: the
points before, every round's check (lexical reason, judge score, new fact, verdict), every
replacement, the points after and the dropped ones. The run of 2026-10-21 made 9 calls in 75 s,
for about $1.40.

```bash
node skill/eval/before-after.mjs                    # Corte dei conti, Pozzallo/Enel, Omicidio Russo
node skill/eval/before-after.mjs --stories id,id --date 2026-10-21
node skill/eval/run-points-eval.mjs                 # judge eval + loop on 10 live ragusa stories
node skill/eval/run-points-eval.mjs --no-loop       # judge eval only
node skill/eval/run-points-eval.mjs --set other.json --concurrency 3 --loop 10 --date 2026-10-21
```

After a change to the judge prompt, `POINT_SPEC` or the agent, run it again and set
`DEFAULT_JUDGE_THRESHOLD` (`scripts/judge.mjs`) to the threshold it recommends.

## What it measures

1. **Judge.** Every story of the set in one judge call (three at a time), as in production: the
   points of a story are judged together, in order, so each case is a point with its headline,
   dek and the points before it. Per case: the judge's score (highest similarity to headline,
   dek or an earlier point), new fact, `grounded`, `generic`; the lexical decision; the combined
   one (rejected when either rejects). Precision, recall and F1 of **reject** (positive =
   `repeat` or `generic`) for judge only, lexical only and combined at thresholds 0.4–0.8. The
   recommended threshold is the best combined F1 with recall ≥ 0.9 (the best F1 if none reaches
   it). The false positives (new facts rejected) and false negatives (repeats passed) are listed
   with their scores.
2. **Loop.** The 10 oldest of the latest 30 stories in the live ragusa feed, none skipped: the
   summary, then `refinePoints` at the recommended threshold. Per story: rounds, judge and
   rewrite calls, kept and dropped points with reasons, replacements, wall time; averages.

## The set

`{ version, description, counts, stories: [{ id, tenant, slug, date, title, dek, body, points:
[{ text, label, why, source, labelSource }] }] }`. `body` is the article as the feed's per-story
endpoint gives it (plain text, at most 2,500 characters), `""` where it is no longer available.

Sources:

- **Operator review** (`labelSource: "human"`): the four Corte dei conti points from the queue of
  21 October 2026 (`badPointsEVt4JeD`) that restate the dek in other words and all passed the
  lexical filter (one at 0.57 overlap). Story, dek and article from the live feed.
- **Published campaigns** of 6–7 October 2026 (`labelSource: "curated"`, `source: "published
  campaign …"`): `copy.headline`, `copy.dek` and `copy.points` as they went out, when points
  were written from title and dek only. The feed no longer serves those articles, so `body` is
  `""` and the judge runs without one (`grounded` is then true unless a point contradicts title
  or dek).
- **Live stories** of 12–19 October 2026 from the ragusa.buzz and alienwatch.buzz feeds
  (`labelSource: "curated"`, `source: "written for the eval from the article"`): headline, dek
  and article from the feed, and four points per story written from the article, on purpose a
  mix of new facts, paraphrases and generic lines.

`labelSource: "audit"` is reserved for rows of the published-captions copy audit; this version has
none. Italian (ragusa) and English (alienwatch) stories; story case files are not in the set (the
judge does not run on them).

## Labelling rule

Labels are given by meaning, against the CAN/CANNOT spec (`scripts/story.mjs` `POINT_SPEC`, also
in `SKILL.md`), never by running the lexical filter or the judge:

- `new` — the point carries at least one specific fact that the headline, the dek and the points
  before it do not: a number, a name not in title or dek, a date or time, a consequence, a next
  step, an attributed quote or position, a concrete detail (cause, method, where exactly), taken
  from the article.
- `repeat` — it restates the headline, the dek or an earlier point in other words: synonyms,
  reordered, the same fact worded more or less specifically, a number derivable from the ones
  already given (495mila → 57mila is "−88 %"), an attributed quote whose content is the headline.
  A restatement that also adds an unsupported inference or a judgement is still `repeat`.
- `generic` — commentary or evaluation ("resta da vedere", "una mattinata da dimenticare"), a
  statement about the sources or missing details ("le fonti non dicono…", "non è indicata una
  data"), a question or a call to action: no fact.

The test for every case: does a reader who already read the headline and the deck learn something
new and specific from this point? If not, it is `repeat` (or `generic` when it is not about the
story's facts at all).

The set includes hard cases on purpose: paraphrases with little word overlap (`la tranche del
Ministero dell'Interno attende un passaggio contabile` for `per i 5 milioni del Viminale manca la
variazione di bilancio`), and new facts with a lot of word overlap (the dek's subject plus a new
date, name or number: `Lo stop ai cantieri Enel è scattato il 19 ottobre, lo stesso giorno delle
scarificazioni`). Each point's `why` says what it repeats or adds.
