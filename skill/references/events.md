# Events

`ziggy events` turns a tenant's public events calendar into two kinds of video. It writes a
campaign and renders it. Only `--week --publish` posts (live, at once: see
[Publishing the week](#publishing-the-week)); without it nothing is posted, and the teaser is
never published by this command. `ziggy serve` runs `--week --publish --notify` once a week
for a tenant with `events.schedule` ([The weekly job](#the-weekly-job)).

```bash
ziggy events ragusa --week --dry-run                 # the selection for the week, nothing written
ziggy events ragusa --week                           # campaign eventi-<monday> + reel and post renders
ziggy events ragusa --week --from 2026-10-26         # a given week (any day of it: snapped to its Monday)
ziggy events ragusa --week --no-render               # campaign and posters only; render later with ziggy video
ziggy events ragusa --week --publish --dry-run       # the selection + what would be published, nothing written or posted
ziggy events ragusa --week --publish --notify        # render, publish live on daily.only, summary to ZIGGY_REPORT_HOOK
ziggy events ragusa --teaser                         # the evergreen teaser (campaign eventi-teaser)
```

Flags: `--force` overwrites an existing campaign, `--json` prints the selection (and the render
manifest, and with `--publish` the outcome per platform) as JSON with progress on stderr,
`--quality` passes through to the render, `--now <ISO>` pins the clock (tests).

## The week

Monday to Sunday in the tenant's time zone (`events.tz`, default `Europe/Rome`). Run on Friday,
Saturday or Sunday, the command takes the **next** week; Monday to Thursday, the **current** one.
`--from YYYY-MM-DD` overrides both and is snapped to its Monday. Days are calendar dates, so the
DST change (last Sunday of October) never moves a day.

When the week holds today, events that are already over are left out (`già passato`).

## Where the events come from

`events.apiUrl` (`https://ragusa.buzz/v1/events`), read twice:

- `?from=<monday>&to=<sunday>&limit=1000` — the API filters on the start, `to` included;
- `?from=<monday − 45 days>&to=<sunday − 7>` — long events that began earlier (exhibitions, a
  run of shows). The selection keeps what overlaps the week.

Fields used: `id`, `title`, `startsLocal`/`endsLocal` (local wall time), `allDay`, `category`,
`place.town`/`place.name`, `sources[].sourceId/name`, `poster.url` (a path on the API host),
`url`.

An end at `00:00` is read as a **date**: that day is the last one («dal 30 ottobre all'1
novembre» arrives as `2026-11-01T00:00`). Two exceptions: the sources listed in
`events.exclusiveEndSources` write ends the iCal way (the day after; Ragusa:
`ccn-antica-ibla-api`), and a timed event ending at `00:00` the day after it starts runs to
midnight and stays on its own night.

## The selection (`scripts/events.mjs`, pure)

1. **Overlap** with the week.
2. **Exclusions**, each listed with its reason: `excludeCategories` (default religione,
   istituzionale, corsi, formazione), `excludeTitles` (case-insensitive regex sources, default
   `cresim`, `consiglio comunale`, `seduta`), and events with no town.
3. **Merge** into one card:
   - the same title in the same town: lowercase, no accents or punctuation, every dash the
     same, single spaces («… - Pinocchio» = «… – PINOCCHIO»), a leading «TOWN – » dropped;
     recurrences become one card with every in-week day;
   - near-duplicates from other sources: same town, overlapping days, and the shorter title's
     distinctive words (no stopwords, numbers or the town) at least 75% in the longer one, one of
     them not generic («ChocoModica 2026» = «Chocomodica, festival del cioccolato modicano»).

   The card keeps the title of the listing with the most sources (then a poster, then the
   earliest), the first poster, and all sources.
4. **Score** (`events.weights`, defaults in the code): poster +3, evening start ≥ 18:00 +2, a day
   on Friday–Sunday +2, category weight (musica-live, teatro, sagre, feste +3; mostre, cinema,
   libri, danza +2; bambini, natura, sport +1), starts inside the week +1, runs more than 14 days −2.
5. **Pick** greedily up to `maxEvents` (6); each pick in a town costs the next candidates there
   `sameTown` (2), so the reel spreads across the province. Ties go to the earlier event, then
   the title, then the id: the same input always gives the same reel.
6. **Order** the picks by their first day in the week, then time (all-day first).

Fewer than `minEvents` (3) valid cards: no campaign, no render, exit code **3** with
`⏭️ <tenant> · solo N eventi validi per <settimana> …`. With `--notify` the line also goes to
the existing report hook (`ZIGGY_REPORT_HOOK`, the shell command `ziggy serve` fires with each
report, text in `ZIGGY_REPORT_TEXT`); without a hook it is only printed.

### Card labels

| case | date chip | time |
|------|-----------|------|
| one day | `ven 30 ott` | `20:30` / `tutto il giorno` |
| a show on two nights | `31 ott e 1 nov` | `sab 20:30 · dom 18:30` (or one time when equal) |
| several days, starting this week | `30 ott – 1 nov` (two days: `31 ott e 1 nov`) | `tutto il giorno` / `dalle 08:00` |
| started before the week | `fino al 30 ott` / `fino all'1 nov` | `in corso` |

Categories show in Italian from `events.categoryLabels` (empty or unknown → «Evento»).

## The weekly campaign

`tenants/<slug>/campaigns/eventi-<monday>/` (gitignored like every campaign):

- `posters/<eventId>.webp` — the chosen cards' posters, downloaded from the API. A poster that
  cannot be fetched leaves its card typographic; it never blocks the reel.
- `campaign.json` — `template: eventi-settimana`, `week`, `copy` (title, range, CTA, url,
  «Organizzi qualcosa? Proponilo sul sito»), `timing`, `events[]` (title, date chip, time,
  days, category + label, town, venue, poster path, `credit` «Locandina: <source>», sources,
  url), `audio.bed: "news"`, and `posts.instagram_reel` / `posts.facebook_reel` captions that end
  with the calendar url. It has no `copy.headline` and no `story`, so the daily loop's coverage
  never mistakes it for a news story; it is not stamped with a jingle, so the rotation does not
  move (a tenant with jingles gets a stable pick by campaign name).

Length: 3 s intro + one card per event + 3.5 s outro, held between 15 and 20 s (six cards:
2.25 s each).

Renders land as usual in `~/.ziggy/tenants/<slug>/renders/eventi-<monday>/`:
`<slug>-eventi-<monday>-reel-1080x1920.mp4|png` and `…-post-1080x1350.mp4|png`.

## Publishing the week

`--publish` (with `--week` only) goes on after the render and publishes the reel **live, now**
(no draft, no schedule) through `publishCampaign`, the same path as `ziggy post`, so each post is
a line in `posts.jsonl` like a round's. The line carries the time it went out as `scheduledAt`,
so the rounds' slot and Facebook accounting see it.

- **Platforms**: the tenant's reel kinds, `tenant.daily.only` that the campaign defines
  (Ragusa: `instagram_reel`, `facebook_reel`), one post each, Instagram first. A kind whose
  Postproxy profile is not active is reported (`ricollega il profilo`) and the others still go.
- **The check**: the reel must pass the round's `checkReel` (rendered, an audio track, mean
  volume above −40 dB, at least 10 s), because nobody looks at it first. A reel that fails is
  not published on any platform.
- **Facebook guard**: `facebook_reel` goes out only if `fbguard.mjs` allows it now, with the
  round's rules and the tenant's `daily.facebook` (Ragusa: at most 3 a day, 4 h apart, a 48 h
  pause after a Meta 368). Every live Facebook post counts: the ones a round queued and the
  ones that went out at once. When the guard says no, Instagram goes out alone and Facebook is
  reported held with the reason (`pause`, `gap`, `cap`, `disabled`). This command never drops
  queued posts: after a 368 that is the next round's job.
- **Idempotent**: a platform that already has a live (not deleted) post of this campaign in
  `posts.jsonl` is never published again (`already published`). A re-run reuses the week's
  campaign and its renders (`--force` rebuilds and re-renders them, still without a second
  post), so running the same command again later publishes only what is missing — e.g. the
  Facebook post the guard held. To retry a platform whose post failed on Postproxy, remove it
  first with `ziggy delete` (it logs the delete event).
- **Fewer than `minEvents`**: no campaign, no render, no post, exit 3, the `⏭️` line.
- **`--dry-run`**: the selection and, per platform, `would publish live now` / `already
  published` / held by the guard; nothing is written, rendered or posted (it reads
  `posts.jsonl` and Postproxy only).
- **`--notify`**: one Italian line through `ZIGGY_REPORT_HOOK`, e.g.

  ```
  🗓️ Ragusa Buzz · Eventi della settimana 26 ott – 1 nov: reel pubblicato su Instagram (id …), Facebook (id …)
  🗓️ Ragusa Buzz · Eventi della settimana 26 ott – 1 nov: reel pubblicato su Instagram (id …), Facebook (in attesa: un altro post Facebook a meno di 4 ore)
  ```

  A render or Postproxy error sends `✗ … reel non pubblicato (…)` instead.
- **Exit codes**: 0 published (a Facebook post held by the guard included), 1 a platform failed,
  its profile is down or the reel failed the check, 3 skipped. It needs the Postproxy key
  (`POSTPROXY_API_KEY_<SLUG>` in a container, hush on a dev machine), also for `--dry-run`.

## The weekly job

`ziggy serve` runs `ziggy events <slug> --week --publish --notify` for every served tenant with
an `events.schedule` block:

```json
"events": { "schedule": { "weekday": "mon", "time": "07:00", "tz": "Europe/Rome" } }
```

`weekday` is `mon`…`sun`, `time` is local `HH:MM`, `tz` falls back to `events.tz`. Serve checks
every minute and runs the job:

- never before the time, and only on that weekday (in `tz`, so 07:00 stays 07:00 across the DST
  change). A process that was down at 07:00 catches up later the **same** day; on a later day
  it waits for the next week;
- at most once per ISO week: the week is written to `$ZIGGY_HOME/state/<slug>-events-schedule.json`
  (`lastWeek`, `startedAt`, then `finishedAt` and the exit `code`) **before** the run starts, so
  a restart — even one in the middle of the run — never runs it twice. Re-run it by hand
  (idempotent) if a run was cut short;
- with `--no-daily` too (production runs `serve ragusa alienwatch --no-daily`); `--no-events`
  turns it off;
- as a child CLI run like daily and report (keys from `POSTPROXY_API_KEY_<SLUG>`), waiting while
  the same tenant's `daily` run is going. Serve has no lock with a round run by hand
  (`docker exec … round`): the two may overlap, renders included.

Exit 3 (a skipped week) is not an error. `GET /healthz` shows `tenants.<slug>.events`:
`schedule`, `next` (the next run, ISO), `lastWeek`, and the last run's `lastOk`/`error`. Serve
also logs `events → weekly mon 07:00 Europe/Rome, next …` at boot.

## The teaser

`ziggy events <slug> --teaser` writes `eventi-teaser` (template `eventi-teaser`, 13.5 s, reel
and post). It is evergreen, meant to be boosted at any time: no dates, no event titles, no real
posters. Hook «Che si fa a Ragusa?», the categories (`events.teaser.categories`, default
concerti, mostre, teatro, sagre), the towns ticker (`events.teaser.towns`), «Aggiornato ogni
giorno» over a calendar grid, then the url and «Organizzi qualcosa? Proponilo sul sito».

## Templates

`eventi-settimana` and `eventi-teaser` (see `DESIGN.md`). Layout numbers live in
`TEMPLATE_VARIANTS` in `scripts/video.mjs` and reach the CSS as `--v-*` variables; the cards and
words are built by `eventTemplateTokens` (`__EV_*__` tokens).
