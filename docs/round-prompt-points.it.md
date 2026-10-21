# Round prompt — step 2 "Punti" (Italian)

The operator's round prompt lives outside this repository. This is the proposed replacement for
its step 2, in Italian, ready to paste. It matches `skill/SKILL.md → Running a round`: the plan
carries each story's article as `body`, and the reel slides and the caption share one list of
points, checked by shared words (`lint.mjs` `pointsReport`) and by meaning (`judge.mjs`), with the
failing ones replaced from the article (`story.mjs` `refinePoints`). The full Italian spec for
editors and operators — what a point can and cannot say, how Ziggy measures similarity, the loop,
the eval results and before/after examples — is in `docs/punti-cosa-possono-dire.it.md`.

What changed from the previous text:

- The source of the points is title, dek **and** the article (`body` in the plan), not title and
  dek alone ("Solo ciò che dicono titolo e dek").
- What a point can and cannot say is written out (`story.mjs` `POINT_SPEC`, the same text the
  summarizer and the judge get): each point carries a number, a name not in title or dek, a date,
  a consequence, a next step, an attributed quote or a concrete detail; it never restates title,
  dek or another point in other words, never comments, never talks about the sources ("le fonti
  non dicono…"), never adds what the article does not say.
- The reel slides and the caption share the points. A point that repeats title, dek or an earlier
  point — in other words too: the summary agent judges the meaning — is replaced by the agent with
  another fact from the article, up to 3 rounds, and dropped if it still repeats. It does not block
  the story. The reel shows up to 4 of the points left, the caption the first 3.
- The summary line reads `· 3 punti (1 scartato, 2 giri)`: points left on the reel, points
  dropped, and the rounds of checks when more than one (a second round means some points were
  replaced).

## Text to paste

```text
2. Punti. Per ogni storia del piano scrivi 4 punti nel file dei punti (3 solo se titolo, dek e
   testo insieme non hanno un quarto fatto; non inventarne mai uno).
   - Solo ciò che dicono titolo, dek e testo (campo body del piano). Copia numeri, nomi e luoghi
     come sono scritti. Nessun'altra fonte, nessuna conoscenza tua. Se body è vuoto, scrivi dai
     soli titolo e dek.
   - Un fatto per punto, una frase semplice, massimo 90 caratteri. Letti in ordine raccontano la
     storia: cosa è successo (chi, dove, quando), poi i dettagli, poi cosa succede dopo. Il
     punto 1 non ripete mai il titolo.
   - Cosa PUÒ dire un punto. Ogni punto porta almeno una di queste cose, sempre presa
     dall'articolo:
     - un numero, una cifra o una quantità;
     - un nome (persona, ente, luogo) che non è nel titolo né nel sommario;
     - una data, un orario o una scadenza;
     - una conseguenza;
     - un prossimo passo: cosa succede dopo;
     - una breve citazione o posizione attribuita ("secondo…", «…»);
     - un dettaglio concreto: la causa, il modo, dove esattamente.
   - Cosa NON PUÒ dire:
     - il titolo, il sommario o un altro punto con altre parole (sinonimi, ordine diverso, lo
       stesso fatto detto in modo più o meno preciso);
     - commenti o giudizi generici ("una vicenda importante", "resta da vedere");
     - frasi sulle fonti ("le fonti non dicono…", "non ci sono dettagli"): non aggiungono fatti;
     - fatti che non sono nell'articolo: niente conoscenze esterne, niente deduzioni;
     - domande, emoji, hashtag, inviti all'azione.
     Mantieni le cautele della fonte ("avrebbe", "secondo"): un'accusa non diventa mai un fatto.
   - La prova: chi ha già letto titolo e sommario impara da questo punto qualcosa di nuovo e
     preciso? Se no, è una ripetizione: non scriverlo.
   - Ziggy controlla ogni punto due volte: per parole in comune e per significato (il
     riassuntore lo confronta con titolo, sommario, testo e punti precedenti). Un punto che
     ripete, non aggiunge un fatto o non è nel testo viene sostituito dal riassuntore con un
     altro fatto del testo (i tuoi punti buoni restano identici, al loro posto), fino a 3 giri;
     se ripete ancora, viene tolto. La storia esce comunque. Le slide del reel e la didascalia
     usano gli stessi punti: il reel ne mostra fino a 4, uno per slide; la didascalia i primi 3,
     come righe "•" sotto il dek. Zero o un punto va bene: il reel è il titolo, quell'unica
     slide e la chiusura. Il dek non viene mai spezzato in slide.
   - Nel riepilogo, "· 3 punti (1 scartato, 2 giri)" dice quanti punti sono rimasti nel reel,
     quanti sono stati tolti e, se più di uno, quanti giri di controllo sono serviti (un secondo
     giro vuol dire che il riassuntore ha sostituito qualche punto). "nessun punto" di solito
     vuol dire che i punti ripetevano titolo e dek: dal giro successivo scrivili dal testo.
```
