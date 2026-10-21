# Punti: cosa possono dire

Specifica per redattori e operatori. I **punti** sono le frasi brevi che accompagnano una notizia
sotto titolo e sommario: le slide del reel (fino a 4, una per slide) e le righe "•" della
didascalia (i primi 3). È **una sola lista**: un punto che ripete è una ripetizione sulla slide
quanto nella didascalia, e viene tolto da entrambe.

Il testo delle sezioni 1–4 è lo stesso che ricevono il riassuntore, la riscrittura e il giudice
(`skill/scripts/story.mjs` `POINT_SPEC`, versione italiana). Se cambia, va cambiato anche lì, in
`skill/SKILL.md`, in `AGENTS.md` e in `docs/round-prompt-points.it.md`. Il testo da incollare nel
prompt del giro per scrivere i punti è in `docs/round-prompt-points.it.md`.

## 1. Cosa PUÒ dire un punto

Gli esempi di questa sezione e della prossima sono per una notizia con titolo "Ragusa, chiuso il
ponte di via Roma per lavori" e sommario "Il Comune ha chiuso il ponte al traffico per consolidare
i piloni; i bus passano da via Ercolano."

Ogni punto porta **almeno una** di queste cose, sempre presa dall'articolo:

| | Esempio |
|---|---|
| un numero, una cifra o una quantità | "L'appalto vale 1,2 milioni di euro." |
| un nome (persona, ente, luogo) che non è nel titolo né nel sommario | "I lavori li esegue la ditta Edilsud di Modica." |
| una data, un orario o una scadenza | "Il ponte resterà chiuso almeno fino al 20 gennaio." |
| una conseguenza | "Il bus 3 allunga il percorso di dieci minuti." |
| un prossimo passo: cosa succede dopo | "A dicembre il Comune verifica i piloni consolidati." |
| una breve citazione o posizione attribuita ("secondo…", «…») | "Per l'assessore Rossi «era un intervento non rinviabile»." |
| un dettaglio concreto: la causa, il modo, dove esattamente | "Le crepe sono sul secondo pilone, lato stazione." |

Mantieni le cautele della fonte ("avrebbe", "secondo"): un'accusa non diventa mai un fatto.

## 2. Cosa NON PUÒ dire

| Non può dire | Esempio da scartare |
|---|---|
| il titolo, il sommario o un altro punto con altre parole (sinonimi, ordine diverso, lo stesso fatto detto in modo più o meno preciso) | "Il ponte di via Roma non è più percorribile dalle auto per i lavori." |
| commenti o giudizi generici ("una vicenda importante", "resta da vedere") | "Una scelta che pesa sulla viabilità di tutta la città." |
| frasi sulle fonti ("le fonti non dicono…", "non ci sono dettagli"): non aggiungono fatti | "Le fonti non indicano quando il ponte riaprirà." |
| fatti che non sono nell'articolo: niente conoscenze esterne, niente deduzioni | "È il terzo ponte chiuso in città quest'anno." (se l'articolo non lo dice) |
| domande, emoji, hashtag, inviti all'azione | "Quando riaprirà? Diteci la vostra 👇" |

Ripetere con altre parole è il caso più insidioso: "ha dedicato una scheda specifica al dissesto
del Comune" sotto un sommario che dice "dedica a Modica una scheda sul dissesto" è lo stesso fatto,
anche se metà delle parole è diversa.

## 3. Ogni punto si capisce da solo

Il reel mostra un punto per slide: chi legge una slide deve capire di chi o di cosa parla senza
ricostruirlo dagli altri punti. Ogni punto:

- **dice di chi o di cosa parla**: "il presidente della commissione d'inchiesta", non "il
  presidente"; niente "la nomina", "l'atto", "lo stesso partito" senza il loro riferimento. Il
  soggetto principale della notizia, quello del titolo, può restare sottinteso ("Disavanzo di
  117,6 milioni…" in una notizia su Modica va bene);
- **è preciso**: niente elenchi di parole generiche al posto dei fatti.

| da scartare | perché | meglio |
|---|---|---|
| "Nomina del presidente ferma tra incompatibilità, dimissioni e un parere atteso da mesi." | presidente di cosa? quale parere? tre parole generiche al posto dei fatti | "Commissione d'inchiesta senza presidente: si attende un parere della Segreteria generale." |
| "Il dirigente ha firmato l'atto dopo un parere atteso da settimane." | quale dirigente, quale atto, quale parere? | "L'ingegnere capo ha firmato l'ordinanza di chiusura dopo il parere del Genio civile." |

Il primo è una slide vera, dalla coda del 21 ottobre 2026 (Corte dei conti e Modica): il punto
parla della commissione d'inchiesta del consiglio comunale, ma sulla slide non lo dice.

## 4. La prova del lettore

> Chi ha già letto titolo e sommario impara da questo punto qualcosa di nuovo e preciso?
> Se no, è una ripetizione.

In pratica: copri tutto tranne titolo e sommario, leggi il punto e prova a dire in poche parole
(al massimo 12) **qual è il fatto nuovo**. Se non riesci a nominarlo, o se il "fatto nuovo" è solo
una parola diversa per una cosa già detta, il punto non va bene. Lo stesso vale contro i punti
prima di lui: il terzo punto non può ridire il primo.

## 5. Come Ziggy misura la somiglianza

Ogni punto passa due controlli. **Basta che uno dei due lo scarti** perché il punto non vada.

### Filtro lessicale (parole in comune)

`skill/scripts/lint.mjs` `pointsReport`. Confronta le **parole di contenuto** (almeno 3 lettere,
senza parole vuote, accenti e maiuscole ignorati). La sovrapposizione è: parole in comune / parole
dell'insieme più piccolo, calcolata solo tra insiemi di almeno 4 parole. Un punto è scartato se:

| motivo | quando |
|---|---|
| `title` | sovrapposizione **≥ 0,8** con il titolo |
| `dek` | sovrapposizione **≥ 0,6** con il sommario intero o con una sua frase |
| `point` | sovrapposizione **≥ 0,6** con un punto tenuto prima (o le stesse parole e gli stessi numeri) |
| `no new words` | ha almeno 2 parole, ognuna già in titolo, sommario o punti precedenti, e nessun numero nuovo |
| `lint` | crea una ripetizione nella didascalia completa (titolo, sommario, punti, fonti, link, hashtag) |
| `max` | ci sono già 4 punti |

È veloce e non sbaglia quasi mai quando scarta, ma **non vede le parafrasi**: il punto sulla
"scheda specifica al dissesto" ha sovrapposizione 0,57 con il sommario e passava.

### Giudice semantico (significato)

`skill/scripts/judge.mjs` `judgePoints`. Lo stesso agente che scrive il riassunto (`feed.agent`
del tenant; di default `claude -p`, nessuna chiave in più) riceve in **una sola chiamata per
storia**, a ogni giro, titolo, sommario, articolo (fino a 2.500 caratteri), questa specifica e i
punti in ordine. Per ogni punto risponde:

- `vsTitle`, `vsDek`, `vsPoints`: quanta della sua informazione è già data dal titolo, dal
  sommario e da ciascun punto precedente, **per significato e non per parole**, da 0 a 1
  (1 = la stessa informazione con altre parole; 0 = un'informazione del tutto nuova; un punto che
  riprende un fatto noto ma aggiunge un numero, un nome o una data vale poco);
- `newFact`: il fatto nuovo in al massimo 12 parole, vuoto se non ce n'è;
- `grounded`: `false` se il punto dice qualcosa che l'articolo non dice;
- `generic`: `true` per commenti, giudizi, frasi sulle fonti, domande, inviti all'azione;
- `vague`: `true` se, letto solo sulla sua slide, il punto non dice di chi o di cosa parla, o
  accenna a dei fatti senza dirli (sezione 3). Una risposta senza `vague` vale `false`.

Il **punteggio** del punto è il più alto dei tre confronti. Il punto passa solo se:

- punteggio **< soglia** (oggi **0,8**: `DEFAULT_JUDGE_THRESHOLD` in `skill/scripts/judge.mjs`,
  scelta con l'eval della sezione 7),
- `newFact` non è vuoto,
- `grounded` non è `false`,
- `generic` non è `true`,
- `vague` non è `true`.

Altrimenti il motivo è uno di: `semantic 0.83 vs dek` (ripete il sommario; oppure `vs title`,
`vs point 2`), `ungrounded` (non è nell'articolo), `generic`, `vague` (vago), `no new fact`, in
quest'ordine.

Se l'agente sbaglia, va in errore o risponde qualcosa di illeggibile, il giudice non dà un
verdetto e **decide il solo filtro lessicale**: una storia o un giro non si fermano mai per il
giudice.

### Configurazione

| dove | valore | effetto |
|---|---|---|
| `tenant.json` → `feed.judge` | `false` | giudice spento per il tenant |
| `tenant.json` → `feed.judge` | `{ "threshold": 0.7 }` | soglia del tenant |
| ambiente | `ZIGGY_JUDGE=0` (anche `false`, `off`, `no`) | giudice spento |
| ambiente | `ZIGGY_JUDGE_THRESHOLD=0.7` | soglia |
| `tenant.json` → `feed.agent` | `null` | nessun agente: niente riassunto, giudice e riscritture; solo filtro lessicale |

La soglia viene da `tenant.json`, poi dall'ambiente, poi dal default 0,8; vale un numero maggiore
di 0 e fino a 1. Il giudice è spento se lo spegne `tenant.json` **o** l'ambiente. Abbassare la
soglia rende il controllo più severo (scarta più punti), alzarla più permissivo.

## 6. Il ciclo: controlla, riscrivi, scarta

`skill/scripts/story.mjs` `refinePoints`.

1. **Giro 1.** Filtro lessicale e giudice su tutti i punti. Se passano tutti, finito.
2. **Riscrittura.** Altrimenti l'agente riceve la lista con ✓ e ✗ e, per ogni punto scartato, il
   motivo ("ripete il sommario (0.85)", "generico: un commento o una frase sulle fonti, nessun
   fatto", "vago: sulla sua slide non dice di chi o di cosa parla, o accenna a dei fatti senza
   dirli", "non è nell'articolo", "non aggiunge un fatto nuovo"). Sostituisce **solo** i punti ✗:
   prende un altro fatto dell'articolo che titolo, sommario e altri punti non dicono, oppure
   riformula il punto perché aggiunga un fatto nuovo. Ogni punto nuovo dice di chi o di cosa
   parla, con il nome preso dall'articolo, e dice il fatto invece di elencare parole generiche. I
   punti ✓ restano identici, parola per parola, al loro posto. Se l'articolo non ha un altro
   fatto, toglie il punto invece di inventarlo.
3. **Giro 2 e 3.** La nuova lista viene controllata di nuovo, tutta. Al massimo **3 giri** di
   controllo, quindi al massimo 2 riscritture.
4. **Scarto.** Dopo l'ultimo giro, ciò che ancora non passa viene tolto.

Casi particolari:

- **Senza articolo** (il `body` è vuoto): niente riscritture, perché i fatti nuovi vengono solo
  da lì; i punti vengono comunque giudicati e quelli che non passano tolti.
- **Senza agente**: solo filtro lessicale, nessuna riscrittura.
- **La storia esce comunque.** Da 0 a 4 punti va bene: il reel ne mostra fino a 4, la didascalia
  i primi 3. Con 0 punti il reel è titolo e chiusura e la didascalia non ha il paragrafo dei
  punti.
- Vale per i punti del riassunto (`ziggy story`, il ciclo quotidiano) e per i punti
  dell'operatore nel giro (`ziggy round --points`).
- Nel riepilogo del giro, `· 3 punti (1 scartato, 2 giri)` dice quanti punti sono rimasti, quanti
  sono stati tolti e, se più di uno, quanti giri di controllo sono serviti. Con `--json`: `points`,
  `captionPoints`, `dropped`, `rewritten`, `rounds` e `judge` (`status` on/off/failed,
  `threshold`, `calls`, `rewrites`, `ms`).
- **Casefile esclusi** (Alien Watch, `casefile.mjs`): i loro punti fissi Confermato / Non
  confermato / Perché conta li scrive l'operatore e passano solo il lint della didascalia.

## 7. Risultati dell'eval (21 ottobre 2026, seconda versione)

Set: `skill/eval/points-eval.json` versione 2, 30 storie, 120 punti etichettati per significato
secondo questa specifica (54 nuovi, 54 ripetizioni, 11 generici, 1 vago; ragusa in italiano e
alienwatch in inglese). Rispetto alla prima versione ci sono due storie della coda del 21 ottobre
2026 riviste dall'operatore: Pozzallo e il Corso Capitani ("A ciascuno sono andate una targa
ricordo e una piccola vela…" ripete il titolo) e Corte dei conti e Modica ("Nomina del presidente
ferma…" è vago). Dettagli in `skill/eval/results/2026-10-21-v2.md`; la prima versione, con il
ciclo, è in `skill/eval/results/2026-10-21.md`.

| scarto = ripetizione, generico o vago | precisione | richiamo | F1 |
|---|---|---|---|
| solo filtro lessicale | 92,3% | 18,2% (12 su 66) | 0,304 |
| solo giudice, soglia 0,8 | 93,0% | 100% | 0,964 |
| **filtro + giudice, soglia 0,8** | **91,7%** | **100%** | **0,957** |
| filtro + giudice, soglia 0,7 | 90,4% | 100% | 0,950 |

- Nessuno scarto mancato: le 66 ripetizioni, frasi generiche e punti vaghi sono stati scartati
  tutti, compresi i due casi nuovi dell'operatore. La slide di Pozzallo ha preso 0,80 contro il
  titolo, proprio sulla soglia, ed è stata segnata anche come vaga ("A ciascuno"). Quella di
  Modica ha preso 0,50 ed è stata scartata come vaga. Attenzione: la slide di Modica è l'esempio
  della sezione 3, quindi il giudice la trova nel suo stesso prompt. Il caso conferma la regola,
  non dimostra che il giudice la sappia generalizzare.
- 6 fatti nuovi scartati per errore (erano 3). 4 sono segnati come vaghi, e tre di questi aprono
  con un riferimento che la slide non spiega ("L'Hub…", "Per i tre esponenti quei fondi…", "The
  source…"): erano etichettati come nuovi prima di questa regola, e vanno rivisti. Il quarto è "Il
  disavanzo indicato nella scheda…", dove "la scheda" è quella del sommario. Gli altri due sono
  un'attribuzione segnata come generica e la data del 19 ottobre sui cantieri Enel (scartata dal
  filtro lessicale).
- La soglia consigliata passa da 0,7 a 0,8. I fatti nuovi hanno avuto al massimo 0,7; le
  ripetizioni sotto lo 0,8 non nominavano alcun fatto nuovo e sono state scartate per quello.
  L'unica ripetizione con un "fatto nuovo" è la slide di Pozzallo, a 0,80. Fra 0,7 e 0,8 cambia
  un solo punto (un fatto nuovo a 0,7), e il punteggio può variare di circa 0,1 da una chiamata
  all'altra: lo scarto per "vago" fa da seconda rete.
- Il giudice ha segnato come vaghe anche 10 ripetizioni e 1 frase generica, già scartate per
  altro.
- 30 chiamate al giudice, circa 26 secondi l'una, 4,5 minuti in tutto con 3 chiamate alla volta.
- Ciclo (dalla prima versione, alla soglia 0,7, prima della regola sui punti vaghi): su 10 storie
  reali di ragusa 1,1 giri in media, una storia su 10 ha avuto una riscrittura, nessun punto
  tolto; circa 98 secondi per storia, riassunto compreso.

## 8. Esempi prima e dopo

Dalla prova del 21 ottobre 2026 con l'agente vero, alla soglia di allora, 0,7, prima della regola
sui punti vaghi (`skill/eval/results/2026-10-21-before-after.md`, generato da
`skill/eval/before-after.mjs`). In
tutti e tre i casi è bastata una riscrittura: al secondo giro i punti passavano tutti, nessuno è
stato tolto.

### Corte dei conti e Modica: quattro parafrasi del sommario

Titolo: "Modica, la Corte dei conti la indica al Parlamento mentre la commissione d'inchiesta non
parte". Sommario: "La Sezione delle autonomie dedica a Modica una scheda sul dissesto; il Pd chiede
l'insediamento della commissione d'inchiesta e il bilancio riequilibrato, mentre la Procura di
Ragusa contesta l'ex sindaco."

| prima | esito | dopo |
|---|---|---|
| La Sezione delle autonomie ha dedicato una scheda specifica al dissesto del Comune. | 1,00 vs sommario | La scheda indica un disavanzo di 117,6 milioni di euro. |
| Il Pd chiede che la commissione d'inchiesta del consiglio comunale venga insediata. | 1,00 vs sommario | Istituita il 2 febbraio 2026, la commissione è ferma sulla nomina del presidente. |
| Lo stesso partito sollecita anche il bilancio riequilibrato dell'ente. | 1,00 vs sommario | Per Francesco Stornello, segretario cittadino del Pd, il dato è «devastante». |
| Intanto la Procura di Ragusa muove contestazioni all'ex sindaco. | 1,00 vs sommario | La Procura chiede il rinvio a giudizio di Ignazio Abbate e di altri quattro indagati. |

Il filtro lessicale li lasciava passare tutti e quattro: hanno poche parole in comune con il
sommario. Il giudice li riconosce come la stessa informazione. Al loro posto ci sono una cifra, una
data, una citazione attribuita e un prossimo passo, tutti presi dall'articolo.

### Omicidio Russo: i punti buoni restano, le parafrasi cambiano

Sommario: "Secondo gli investigatori il movente risalirebbe a una lite di due anni prima per una
sigaretta negata; la difesa di Alex Ventura chiede una nuova perizia psichiatrica."

| prima | esito | dopo |
|---|---|---|
| In primo grado Alex Ventura è stato condannato a 26 anni. | passa (0,20) | identico |
| La prossima udienza è il 10 dicembre, con la requisitoria del Procuratore generale. | passa (0,10) | identico |
| Per chi indaga, tutto nascerebbe da una sigaretta negata due anni prima. | ripete il sommario (filtro lessicale e giudice, 0,95) | Secondo l'accusa, Ventura avrebbe preso un fucile in casa e sparato da vicino. |
| La difesa vuole un nuovo esperto che valuti la salute mentale dell'imputato. | 0,95 vs sommario (solo il giudice) | La Corte d'Assise di Siracusa aveva disposto oltre 2 milioni di euro di risarcimenti. |

"Un nuovo esperto che valuti la salute mentale" è la "nuova perizia psichiatrica" del sommario
con altre parole. La riscrittura mantiene la cautela della fonte ("Secondo l'accusa… avrebbe").

### Pozzallo e i cantieri Enel: il caso limite

| prima | esito | dopo |
|---|---|---|
| Lo stop ai cantieri Enel è scattato il 19 ottobre, lo stesso giorno delle scarificazioni. | ripete il sommario (filtro lessicale; il giudice gli dava 0,60 e lo avrebbe passato) | Il Comune spende ogni anno somme ingenti di fondi regionali e nazionali per le strade. |
| Dall'Enel, al momento, non risulta alcuna replica. | generico | Per il sindaco, il degrado delle strade lasciate senza ripristino è «inaccettabile». |
| Il sindaco ha fermato tutte le ditte che lavorano per conto dell'Enel in città. | 0,95 vs sommario | Lo stop resterà in vigore finché l'Enel non prenderà impegni chiari su scavi e asfalto. |
| Una scelta che riguarda la sicurezza di tutti gli automobilisti pozzallesi. | non è nell'articolo, generico | L'asfalto rovinato è un pericolo soprattutto per motociclisti e ciclisti. |

Qui il controllo costa qualcosa. La data del 19 ottobre e il silenzio dell'Enel erano fatti nuovi
e sono stati sostituiti. Due punti nuovi perdono l'attribuzione dell'articolo: "somme ingenti" è
un argomento del sindaco ("Secondo Ammatuna…") e l'asfalto "è descritto come" un pericolo. Il
giudice controlla che il fatto sia nell'articolo, non che la cautela sia rimasta: la regola
"mantieni le cautele della fonte" dipende da chi scrive i punti, a mano o con l'agente.
