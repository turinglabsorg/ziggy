# Round prompt — step 2 "Punti" (Italian)

The operator's round prompt lives outside this repository. This is the proposed replacement for
its step 2, in Italian, ready to paste. It matches `skill/SKILL.md → Running a round`: the plan
carries each story's article as `body`, and the reel slides and the caption share one filtered
list of points (`story.mjs` `storyPoints`, `lint.mjs` `pointsReport`).

What changed from the previous text:

- The source of the points is title, dek **and** the article (`body` in the plan), not title and
  dek alone ("Solo ciò che dicono titolo e dek").
- The points must prefer facts that title and dek do not hold: numbers, names, dates, what
  happens next.
- The reel slides and the caption share the points. A point that repeats title, dek or an
  earlier point is dropped from both; it does not block the story. The reel shows up to 4 of the
  points left, the caption the first 3.
- With fewer than 2 points left, Ziggy asks the summary agent once to rewrite them from the
  article, telling it which ones were dropped, and keeps the list with more points left.
- The summary line reads `· 3 punti (1 scartato)` (points left on the reel, points dropped), with
  `riscritti` when the agent replaced them.

## Text to paste

```text
2. Punti. Per ogni storia del piano scrivi 4 punti nel file dei punti (3 solo se titolo, dek e
   testo insieme non hanno un quarto fatto; non inventarne mai uno).
   - Solo ciò che dicono titolo, dek e testo (campo body del piano). Copia numeri, nomi e luoghi
     come sono scritti. Nessun'altra fonte, nessuna conoscenza tua. Se body è vuoto, scrivi dai
     soli titolo e dek.
   - Preferisci i fatti che titolo e dek non dicono: numeri, nomi, date, cosa succede dopo
     (conseguenze, prossimi passi). Il punto 1 non ripete mai il titolo.
   - Un fatto per punto, una frase semplice, massimo 90 caratteri. Letti in ordine raccontano la
     storia: cosa è successo (chi, dove, quando), poi i dettagli, poi cosa succede dopo.
   - Ogni punto aggiunge un fatto che titolo, dek e i punti prima non hanno. Le slide del reel e
     la didascalia usano gli stessi punti: un punto che ripete il titolo, il dek o un punto
     precedente viene tolto da entrambi, e la storia esce comunque. Il reel mostra fino a 4 dei
     punti rimasti, uno per slide; la didascalia i primi 3, come righe "•" sotto il dek.
   - Se restano meno di 2 punti, Ziggy chiede una volta al riassuntore di riscriverli con fatti
     nuovi dal testo, dicendogli quali sono stati scartati, e tiene la lista con più punti
     rimasti. Zero o un punto va bene: il reel è il titolo, quell'unica slide e la chiusura. Il
     dek non viene mai spezzato in slide.
   - Niente aggettivi di giudizio, commenti, domande, emoji, hashtag o inviti all'azione.
   - Mantieni le cautele della fonte ("avrebbe", "secondo"): un'accusa non diventa mai un fatto.
   - Nel riepilogo, "· 3 punti (1 scartato)" dice quanti punti sono rimasti nel reel e quanti
     sono stati scartati perché ripetevano; "riscritti" vuol dire che li ha riscritti il
     riassuntore. "nessun punto" di solito vuol dire che i punti ripetevano titolo e dek: dal
     giro successivo scrivili dal testo.
```
