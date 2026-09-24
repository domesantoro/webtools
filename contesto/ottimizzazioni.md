# Ottimizzazioni

Cose che **esistono e funzionano**, ma che potrebbero essere fatte meglio. Le cose che non
esistono ancora stanno in `contesto/todos.md`.

Una voce per punto, sempre con la stessa struttura: com'è adesso, perché potrebbe non
bastare, che cosa c'è da valutare.

---

## 1. Il template della pre-specifica (`prespec/1`)

_Aperto il 2026-09-23. Riguarda: preanalyst — `src/prespec.js`, `templates/prespec.md.njk`._

**Com'è adesso.** Il front matter porta `project_id`, `kind: prespec`, `template: prespec/1`,
`language` e, in `answers`, i soli **codici** delle sei risposte chiuse (`today`, `users`,
`devices`, `volume`, `personal_data`, `existing_data`). Il corpo è in inglese: una sezione per
ogni sezione del form, un `###` per ogni domanda; le risposte chiuse col loro testo inglese, le
risposte aperte citate in blockquote nella lingua del cliente, i campi vuoti scritti
`Not provided.`. In fondo **Open points**: i campi vuoti e le risposte `unknown`. Le skill
restano fuori dal front matter perché l'elenco delle caselle è aperto e ha accanto un campo
libero, quindi il codice da solo racconterebbe metà della risposta.

**Perché potrebbe non bastare.** Il template non è mai stato letto da un destinatario vero: né
da un modello (prevalidator, analysis engine) né da un driver. Restano da verificare:

- il corpo ripete in chiaro quello che il front matter ha già in codice;
- le risposte aperte sono in una lingua e la struttura in un'altra: chi legge ne trova due nello
  stesso documento;
- gli Open points sono un elenco piatto, senza priorità e senza distinguere «non ha risposto» da
  «non lo sa»;
- `template: prespec/1` c'è, ma nessuno oggi lo legge per decidere come trattare il documento.

**Da valutare.** Se il corpo in chiaro serve davvero o basta il front matter più le domande; se
le risposte aperte vanno tradotte in inglese al momento della scrittura; se gli Open points vanno
tipizzati; come si versiona il template quando cambia (`prespec/2`) e chi controlla la versione
leggendo un documento vecchio.

---

## 2. La soglia del rifiuto è un numero scelto a mano

_Aperto il 2026-09-23. Riguarda: preanalyst — `prevalidation.reject_threshold`._

**Com'è adesso.** Una richiesta si rifiuta se `run_out_certain` è l'esito più probabile **e** supera
0,6. Il numero è stato scelto perché sembrava ragionevole.

**Perché potrebbe non bastare.** Nessuno ha ancora visto come si distribuiscono i giudizi su
richieste vere, quindi non si sa se 0,6 rifiuta troppo o troppo poco. Un rifiuto è definitivo e
l'utente non ha appello: sbagliarlo per eccesso costa clienti, per difetto costa pipeline intere.

**Da valutare.** Raccogliere i primi giudizi veri prima di toccare la soglia; decidere se serve una
fascia di mezzo in cui la richiesta non si rifiuta ma si segnala al driver; capire se la soglia
debba essere una sola o dipendere dall'esito secondo più probabile.

## 3. Le probabilità dichiarate da un modello non sono calibrate

_Aperto il 2026-09-23. Riguarda: preanalyst — `src/prevalidator.js`, policy `scope-v1`._

**Com'è adesso.** Il modello dichiara quattro numeri, si normalizzano e si trattano come una
distribuzione di probabilità.

**Perché potrebbe non bastare.** Un modello che scrive `0.8` non sta dicendo che ha ragione otto
volte su dieci: è un numero verosimile, non una frequenza misurata. Finché nessuno confronta quei
numeri con le decisioni vere — quelle del driver, e l'esito finale del progetto — la confidenza è
un'impressione con la virgola.

**Da valutare.** Tenere il registro dei passi (c'è già: `pipeline.steps`) e confrontarlo con quello
che è successo davvero; misurare accordo, errori e override del driver, come dice
`decision_engine_considerazioni.md` §13 e §9; se serve, tarare i numeri invece di fidarsene.

## 4. Il segreto sta in chiaro in Mongo e viaggia su HTTP

_Aperto il 2026-09-23. Riguarda: configurator — `secrets/`, anagraphics — `GET /configuration/…`._

**Com'è adesso.** La chiave del fornitore AI sta fuori da git, ma viene fusa nella configurazione,
scritta in chiaro nella collection `configuration` e servita in chiaro da anagraphics a chi la
chiede dagli IP del pool.

**Perché potrebbe non bastare.** Chi legge il database legge la chiave. Chi entra nel pool di IP
legge la chiave. Oggi gira tutto su una macchina sola e il perimetro è quello, ma la prima volta che
un sottosistema andrà su un'altra macchina questa scelta va rifatta.

**Da valutare.** Se la configurazione debba distinguere i campi segreti dagli altri; se anagraphics
debba servirli solo a chi li possiede; se serva un gestore di segreti vero quando si esce da
localhost.

## 5. Il prevalidator sta dentro il preanalyst

_Aperto il 2026-09-23. Riguarda: preanalyst — `src/ai/`, `src/prevalidator.js`._

**Com'è adesso.** Il modulo IA e la policy della prevalidazione vivono dentro il preanalyst. Il
fornitore è intercambiabile, il sottosistema no.

**Perché potrebbe non bastare.** `decision_engine_considerazioni.md` descrive un decision engine a
sé, che prende tutte le decisioni non deterministiche del sistema con la stessa interfaccia e lo
stesso registro. I prossimi cancelli — validazione dell'analisi, pooling dei driver, dev failure —
rifaranno le stesse cose: se ognuno se le riscrive in casa, il registro delle decisioni non esiste.

**Da valutare.** Quando conviene estrarre `src/ai/` in un sottosistema; se il secondo cancello è già
il momento giusto; che cosa resta nel sottosistema (la policy) e che cosa se ne va (il trasporto).

## 6. Il PDF del rifiuto è in inglese, e il form si svuota

_Aperto il 2026-09-23. Riguarda: preanalyst — `src/rejection_pdf.js`, §16.5 del README._

**Com'è adesso.** Dopo un rifiuto l'utente torna sulla pagina del form, che è vuota, e l'unico modo
per non perdere quello che aveva scritto è scaricare il PDF. Il PDF nasce dalla pre-specifica, che
ha le domande in inglese: chi ha compilato in italiano si ritrova un documento in due lingue.

**Perché potrebbe non bastare.** Il documento serve proprio a chi ha appena ricevuto un no: è il
momento peggiore per consegnargli qualcosa di scomodo da leggere.

**Da valutare.** Se il PDF debba essere costruito dalle domande tradotte invece che dal markdown
della pre-specifica; se il form debba ricomparire compilato invece che vuoto, e a quel punto se il
PDF serva ancora.

_Nota del 2026-09-23._ Il form che ricompare compilato ora esiste, ma solo per il ritorno indietro
di `underspecified` (§16.6): le risposte si ripassano al template e i campi se le riportano dietro.
Dopo un **rifiuto** il form resta vuoto, perché ci si arriva con un `303` e quelle risposte non sono
più da nessuna parte. Il pezzo che manca è conservarle — o rileggere la pre-specifica dal
workspaces, che è già scritta — non il modo di rimetterle nella pagina.

## 7. Il log non ha livelli

_Aperto il 2026-09-23. Riguarda: tutti i sottosistemi — `console.*` nei Node, `logging` e uvicorn in
anagraphics._

**Com'è adesso.** Ogni sottosistema scrive nel suo log con quello che ha sottomano: `console.log`,
`console.warn` e `console.error` nei quattro servizi Node, `logging` della libreria standard più
l'access log di uvicorn in anagraphics. Nel `src/` di ciascuno:

| | `console.error` | `console.warn` | `console.log` |
|---|---|---|---|
| preanalyst | 24 | 6 | 6 |
| sso | 15 | 10 | 2 |
| webtools-workspaces | 2 | 1 | 2 |
| front-gate | 2 | 1 | 1 |

Nella giornata di oggi il preanalyst ha scritto **33** righe sue; anagraphics ne ha scritte **589**,
quasi tutte access log di uvicorn. Il grosso del volume è la parte che nessuno ha scelto.

Sette cose, in ordine di quanto costano:

1. **Non c'è un livello, quindi non c'è una manopola.** `error` contro `warn` è l'unica distinzione,
   e finiscono nello stesso file: non si può abbassare la verbosità in esercizio né alzarla per
   seguire un caso. È anche l'ultimo pezzo di configurazione che non sta nel configuratore.
2. **Il livello è scelto a sentimento.** «login rifiutato: password sbagliata» è `warn`, ma è un
   fatto ordinario del sistema, non un guasto; i client HTTP scrivono `error` anche per un `404` che
   il chiamante si aspetta. Chi legge impara a ignorare gli `error`, che è il modo peggiore di avere
   un livello.
3. **Le righe non hanno un'ora.** L'unica data è `=== start <data> ===`, che scrive lo script di
   avvio. In un file in append una riga senza ora dice poco, e la rotazione non c'è.
4. **Il prefisso vuol dire tre cose.** `[preanalyst]` è il servizio che scrive, `[credentials]` il
   modulo, `[anagraphics]` dentro il preanalyst il servizio **chiamato** — e si confonde col log di
   anagraphics. `[ai]` e `[ai/anthropic]` sono due profondità diverse.
5. **Due mondi che non si somigliano.** I Node scrivono a mano su stdout, anagraphics usa `logging`
   e sopra ci mette uvicorn, che decide da sé che cosa è interessante.
6. **Nel log ci sono dati personali.** «login di <email>», «entrato <email>», in un file senza
   rotazione né scadenza.
7. **Una richiesta non si segue.** Un invio tocca preanalyst, sso, anagraphics, workspaces e il
   fornitore: nei quattro log non c'è niente che leghi le righe fra loro.

**Perché potrebbe non bastare.** Il log è l'unico posto dove si vede una prevalidazione che è
costata soldi, un passo scritto sulla pipeline, un progetto rimasto senza pre-specifica. Senza
livelli non si può né tacere quando tutto va bene né parlare quando serve; senza un'ora, una riga
non si può mettere in fila con le altre. Finché i sottosistemi erano due e li si guardava mentre
giravano andava bene: adesso sono cinque e uno chiama un fornitore a pagamento.

**Da valutare.**

- **Quali livelli, e la regola per sceglierli.** `error | warn | info | debug` basta; il punto è
  quando si usa quale. Una proposta da discutere: `error` = il sistema non ha potuto fare il suo
  lavoro, `warn` = l'ha fatto in modo degradato, `info` = un fatto del flusso che vogliamo poter
  ricostruire (un progetto nato, una prevalidazione, un rifiuto), `debug` = il dettaglio tecnico.
  Con questa regola un login rifiutato è `info`.
- **Dove sta la soglia.** In configurazione, per sottosistema (`log.level` in
  `configurator/configuration/<sottosistema>.json`), come ogni altro dato configurabile. Se serva
  anche per modulo è da vedere.
- **Un modulo comune** (`commons/log/`, copia generata dal deployer come il client del sso e quello
  della configurazione) oppure una libreria: una dipendenza in più contro un formato che mantiene
  qualcun altro.
- **Il formato della riga**: ora, livello, sottosistema, modulo, messaggio. Testo per una persona o
  JSON per un programma — oggi il log lo legge un essere umano con `tail -f`, ma è la scelta che poi
  non si cambia più.
- **Che cosa fa il prefisso**: un nome solo, con un significato solo. Il servizio chiamato va nel
  messaggio, non nel prefisso.
- **L'access log di uvicorn**: spegnerlo e scrivere noi le righe che contano, o tenerlo e accettare
  che sia il grosso del volume.
- **Email e nomi**: se restino in chiaro, se diventino l'`uid`, o se restino solo a `debug`.
- **Un identificativo di richiesta** che passi da un sottosistema all'altro, e se convenga adesso o
  quando i sottosistemi saranno di più.
- **La rotazione del file**, che è già nei limiti noti di ogni sottosistema: se si tocca il log, si
  decide anche quella.

## 8. La cache della policy non si accende

_Aperto il 2026-09-23. Riguarda: preanalyst — `src/ai/providers/anthropic.js`, §16.1 del README._

**Com'è adesso.** Ogni prevalidazione manda al fornitore due cose: la **policy**, che è sempre la
stessa parola per parola (~1300 token), e la **pre-specifica** del cliente, che cambia ogni volta
(~600 token). Il fornitore offre uno sconto per una situazione come questa: si marca il pezzo che
non cambia — è il `cache_control` che c'è nel codice — e lui lo tiene da parte, così dalla seconda
chiamata in poi quel pezzo costa un decimo invece che intero.

Lo sconto però ha una soglia: il pezzo marcato deve essere lungo **almeno 4096 token** perché il
fornitore si prenda la briga di tenerlo. La soglia dipende dal modello — 512 token sui modelli più
nuovi, 1024 su Sonnet 5, 4096 su Haiku 4.5, che è quello che usiamo. La policy è **troppo corta, e
la cache non si accende mai.**

Quanto corta, misurato con `count_tokens` (che non costa niente):

| | Token |
|---|---:|
| Policy `scope-v1` del mattino | ~1300 |
| Policy `scope-v1` dopo `non_sequitur` e il criterio del webtool | **3051** |
| Soglia della cache su `claude-haiku-4-5` | 4096 |
| **Quello che manca** | **1045** |

Non c'è nessun errore: il marcatore viene accettato e ignorato in silenzio. Si vede solo guardando
i contatori della risposta, che infatti dicono zero:

```
"cache_creation_input_tokens": 0, "cache_read_input_tokens": 0
```

Quindi la policy si ripaga per intero a ogni prevalidazione: sono circa **il 70% dei token in
ingresso**. La frase del README «dalla seconda chiamata si paga meno» oggi è falsa, ed è stata
corretta.

**Perché potrebbe non bastare.** In denaro, oggi, è poco: la policy costa circa 0,13 centesimi di
dollaro a prevalidazione, e con la cache accesa ne costerebbe un decimo — un risparmio di poco più
di un dollaro ogni mille prevalidazioni. La ragione per cui vale la pena tenerne traccia non è la
cifra di oggi ma il fatto che **cresce con tutto**: con il numero di prevalidazioni, con la
lunghezza della policy, e soprattutto con i cancelli successivi, dove le istruzioni saranno più
lunghe di una pagina e il modello più caro di Haiku. La stessa trappola si ripresenterà lì, e lì
peserà.

**Da valutare.**

- **Se restiamo su Haiku, la policy va estesa.** È la conclusione operativa: mancano ~1000 token,
  cioè un terzo di quello che c'è già, e sotto quella soglia ogni riga scritta si paga per intero a
  ogni prevalidazione, mentre sopra si paga un decimo dalla seconda in poi. Il testo in più non
  sarebbe riempitivo: la policy ha ancora parecchio da dire — altri casi a confronto come quelli
  che hanno sistemato il confine di `off_domain`, esempi di richieste giudicate con la loro
  distribuzione, i segnali di una dimensione che cresce. Sono le cose che la rendono più precisa,
  e che oggi non si scrivono per non allungarla. Il conto si rovescia: **conviene scriverle**.
- Se invece si cambia modello, la soglia scende da sola (1024 su Sonnet 5, 512 sui più nuovi) ma il
  prezzo per token sale: va confrontato il conto completo, non solo lo sconto.
- Una misura prima di decidere: la policy attuale sta a 3051 token, e il documento del cliente ne
  aggiunge fra 400 e 900. Ogni prevalidazione oggi costa circa 0,45 centesimi di dollaro, contro i
  0,33 di stamattina — **la crescita della policy si è già mangiata un terzo in più a chiamata**.
- Se il posto giusto per il marcatore resti il `system`, quando i cancelli saranno più d'uno e
  condivideranno dei pezzi di istruzioni.
- Che cosa conservare: oggi sul passo della pipeline si salvano solo `input_tokens` e
  `output_tokens`. Il giorno che la cache funziona, il costo vero non si ricava più da quei due
  numeri — servono anche `cache_creation_input_tokens` e `cache_read_input_tokens`, che si pagano a
  tariffe diverse (una volta e mezzo il prezzo pieno in scrittura, un decimo in lettura).
