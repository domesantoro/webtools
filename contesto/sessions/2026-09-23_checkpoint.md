# Checkpoint sessione 2026-09-23

Il **core del preanalyst**: il loader comune sull'invio, il primo modulo IA del progetto e il
**prevalidator**, cioè il primo cancello del flusso. Stato di partenza: il checkpoint del
2026-09-22.

Il piano concordato prima di eseguire sta in
`~/.claude/plans/ciao-klaus-oggi-cominciamo-whimsical-abelson.md`.

---

## 1. Nuovo file: `contesto/ottimizzazioni.md`

Dove si tiene traccia delle cose che **esistono e funzionano** ma potrebbero essere fatte meglio
(i todo, cioè le cose che non esistono, restano in `contesto/todos.md`). Una voce per punto:
com'è adesso, perché potrebbe non bastare, che cosa c'è da valutare.

Sei voci: il template della pre-specifica `prespec/1`; la soglia del rifiuto scelta a mano; le
probabilità non calibrate; il segreto in chiaro in Mongo; il prevalidator dentro il preanalyst; il
PDF del rifiuto in inglese e il form che si svuota.

## 2. Decisione: gli artefatti configurabili stanno nel configuratore

La policy della prevalidazione e il template della pre-specifica **non sono codice**: dicono che
cosa il sistema considera accettabile e che forma hanno i documenti che produce. Stanno quindi in
`configurator/policies/` e `configurator/documents/`, e nei sottosistemi ci vanno copie generate
dal nuovo deployer `documents`. Regola aggiunta in `CLAUDE.md`.

`templates/prespec.md.njk` si è spostato di conseguenza; `prespec.js` ora rende
`commons/prespec.md.njk`. Limite scritto nella documentazione: il template è accoppiato a
`prespec.js`, che gli passa le variabili.

## 3. Decisione: Jev no, CrewAI no, agente no

- **Jev** non è raggiungibile: nel repo non c'è endpoint né credenziale. Si è scritta l'interfaccia
  provider-agnostica e si è implementato il solo provider Anthropic. Aggiungere Jev domani è un
  file in `providers/` più una riga di configurazione. È la Fase 1-2 di
  `decision_engine_considerazioni.md` §25.
- **CrewAI** no: è Python e orchestra più agenti con ruoli; qui serve una chiamata sola, tipizzata,
  da un server Node.
- **Un agente** no: il prevalidator è una classificazione secca. È una **policy** — un `.md`
  versionato più uno schema di uscita.

## 4. Il loader comune

`commons/style/commons.css` (classi), `commons/templates/loader.njk` (markup),
`commons/script/webtools_loader.js` (comportamento) e un **nuovo deployer `script`**, il primo per
il JavaScript di browser comune. Si accende sul `submit` di un form marcato
`data-webtools-loader`, ma **solo se l'invio parte davvero**: controlla `evento.defaultPrevented`,
perché `gate.js` ferma il submit da sloggati per aprire la modale del login. Per questo si carica
dopo gate.js.

## 5. Il modulo IA e il prevalidator — preanalyst 0.17.0

- `src/ai/webtools_ai.js` + `src/ai/providers/anthropic.js`: una porta sola verso i fornitori,
  stesso contratto `{ ok, data | reason }` degli altri client. L'SDK ufficiale
  `@anthropic-ai/sdk`, uscita vincolata con `output_config.format` e uno schema JSON, niente
  thinking, policy nel `system` con `cache_control`. Modello `claude-haiku-4-5`: qualche millesimo
  di euro a prevalidazione.
- `src/prevalidator.js` + `configurator/policies/scope-v1.md`: quattro esiti con la loro
  probabilità (`run_out_certain`, `run_out_likely`, `safe`, `ultrasafe`), normalizzati dopo la
  lettura, più il flag **interno** `off_domain` e una motivazione. Il rifiuto ha **due** condizioni:
  esito più probabile `run_out_certain` **e** sopra `prevalidation.reject_threshold` (0,6).
- `off_domain` non arriva mai al cliente: andrà al driver quando ci sarà l'area driver.
- 6 test (`npm test`), i primi del sottosistema.
- `scripts/prevalidate.js` prova una policy su un file, con tre pre-specifiche di esempio in
  `scripts/esempi/`. Fa una chiamata vera, quindi costa.

## 6. La pipeline del progetto — anagraphics 0.9.0

Il campo `state` piatto diventa l'oggetto `pipeline`: `{state, steps}`, con `steps` lista **in
ordine** — il registro delle decisioni di `decision_engine_considerazioni.md` §13. Nuova
`POST /projects/{id}/pipeline/steps`, con elenchi chiusi per i nomi dei passi e degli stati: un
nome inventato non entra nel database. Sul passo si conservano i **token**, non un importo: una
prevalidazione costa frazioni di centesimo e un campo `_cents` intero varrebbe sempre `0`.

**Migrazione eseguita** sul DB `webtools`: 4 progetti, `state` → `pipeline.state`
(`scripts/migrate_pipeline.py`, idempotente, con `--dry-run`). Test da 50 a **55**.

## 7. Il rifiuto

`/submit` → prevalidazione → passo sulla pipeline → `303`:

| Caso | `result` | `pipeline.state` | Dove va l'utente |
|---|---|---|---|
| Passa | `passed` | `ANALYSIS` | `/analysis/{id}` (la pagina vuota di oggi) |
| Rifiutata | `rejected` | `REJECTED` | `/?rejected={id}`, con la modale |
| Controllo non riuscito | `failed` | `PREVALIDATION` | `/analysis/{id}` |

**Se il controllo non riesce il progetto resta**: una richiesta valida non si butta via perché un
controllo non ha funzionato.

La modale ha **un solo bottone**, «ok», che porta alla home del front-gate; il PDF è un **link**
nel testo. Il testo **non dice perché**: dice che webtools probabilmente non è lo strumento adatto,
e basta — non nomina dimensione né dominio, e non cambia in base alla configurazione o a chi
guarda. `GET /projects/{id}/rejection.pdf` impagina la pre-specifica letta da workspaces; la
motivazione estesa ci finisce **solo** se `prevalidation.rejection_reason_in_pdf` è `true` oppure
se chi scarica è un driver.

## 8. I segreti

Nuova cartella `configurator/secrets/`, fuori da git (restano `README.md` e `*.example`), fusa in
profondità sulla configurazione da `load_configuration.sh` prima della scrittura in Mongo: il
sottosistema legge una configurazione sola e non sa che un pezzo era segreto. Regola aggiunta in
`CLAUDE.md`. Nuovo accessore `number()` nel client della configurazione, per le soglie.

## 9. Stato

Tutti i servizi riavviati con configurazione e codice nuovi. Verificati: fusione del segreto,
migrazione, 55 test di anagraphics, 6 del preanalyst, loader nelle due lingue, `?rejected=`
ignorato da chi non ha diritto, PDF `401` da sloggato, catena completa fino alla chiamata HTTP vera
al fornitore.

## 10. Da fare subito

**La chiave Anthropic non c'è.** In `configurator/secrets/preanalyst.json` c'è il segnaposto
dell'esempio: ogni prevalidazione risponde `401` e il passo si segna `failed`. Messa la chiave
vera, `./load_configuration.sh && ./start.sh --restart`.

**Non provato**: il giro completo dal browser con login, e una prevalidazione vera con una chiave
valida. Che cosa succede **dopo** una prevalidazione passata non è ancora specificato: la pagina
dell'analisi resta il guscio vuoto.

---

# Ripresa della sessione (pomeriggio)

La sessione precedente si era interrotta per un problema di rete a metà di una modifica: il
**quinto esito della prevalidazione**, `underspecified`. Policy, `prevalidator.js`, configurazione e
gli elenchi chiusi di anagraphics erano già a posto; `server.js` era rimasto a metà — la nuova
`verdict()` non era ancora usata, e `runPrevalidation` restituiva ancora un booleano che nessuno
confrontava più con niente: **anche una richiesta rifiutata finiva su `/analysis/{id}`**. Da lì si è
ripreso.

## 11. Il ritorno indietro

Una richiesta che dice **troppo poco** per essere giudicata non si rifiuta: il progetto resta, va in
`UNDERSPECIFIED` e l'utente rivede il form **con dentro quello che aveva scritto**, più un avviso in
testa. Riscrive, rimanda, e si prevalida di nuovo. La pre-specifica diventa una versione nuova dello
stesso progetto.

| Caso | `result` | `pipeline.state` | Dove va l'utente |
|---|---|---|---|
| Passa | `passed` | `ANALYSIS` | `/analysis/{id}` |
| Rifiutata | `rejected` | `REJECTED` | `/?rejected={id}`, con la modale |
| Dice troppo poco | `underspecified` | `UNDERSPECIFIED` | il form, riempito com'era |
| Controllo non riuscito | `failed` | `PREVALIDATION` | `/analysis/{id}` |

Le decisioni prese:

- **La pagina si rende in risposta al POST**, non si reindirizza: un `303` riporterebbe un form
  vuoto, e chiedere qualche dettaglio in più restituendo un foglio bianco è un invito che nessuno
  può accogliere. Il prezzo è che ricaricare rimanda il form, e con esso una prevalidazione che
  costa. Limite scritto in §16.7 e in §13.
- **Il `project_id` del campo nascosto si ricontrolla** su anagraphics: progetto esistente, di chi
  manda il form, fermo in `UNDERSPECIFIED`. Non si riscrive il progetto di un altro, non si rianima
  un rifiutato.
- **I giri si contano sui passi della pipeline**, che è l'unico registro dove quel numero esiste:
  niente contatore da tenere aggiornato altrove. Sopra `max_underspecified_attempts` si rifiuta —
  continuare a rimandare indietro non è un invito, è un muro. Oggi il tetto è 100: è un numero da
  decidere, non una misura.
- **La colonna del driver non torna** al secondo giro: driver, sconto, ambassador e lavoro autonomo
  sono stati fissati al primo invio e non si rileggono dal form. Rimetterli mostrerebbe una scelta
  che non conta più. Il blocco del caricamento resta.
- Il tetto vale **solo** per `underspecified`: una richiesta che nel frattempo diventa chiara passa,
  qualunque sia il numero di giri già fatti.

## 12. Che cosa si è toccato

- `preanalyst`: `server.js` (`runPrevalidation` col verdetto, `serveFormAgain`), `settings.js`
  (`max_underspecified_attempts`), `page.js` (le risposte già date arrivano ai campi),
  `templates/page.njk` (avviso e campo nascosto), `macros/fields.njk` (i campi si riportano dietro
  la risposta), `public/styles.css` (`.form-notice`).
- Testi nei cataloghi comuni: `preanalyst.underspecified.title` / `.text`, in italiano e in inglese,
  distribuiti con `./deploy.sh i18n`.
- `anagraphics`: il test del passo che rimanda indietro. Test da 55 a **56**.
- Test del preanalyst da 6 a **14**: `normalize` a cinque esiti, `verdict` (compreso il tetto dei
  giri) e il conteggio dei giri in `tests/server.test.js`.
- Documentazione: §16.2, §16.3, §16.6 (nuova), §16.7 (nuova), §16.8, §8 (la tabella della
  configurazione ora elenca anche `ai.*` e `prevalidation.*`), §11, §13, §4.1 (la mappa dei file era
  ferma a prima della prevalidazione), changelog di preanalyst (0.18.0) e anagraphics (0.9.1).
  Nota nella voce 6 di `contesto/ottimizzazioni.md`: il form che ricompare compilato ora esiste, ma
  solo per il ritorno indietro, non dopo un rifiuto.

## 13. Stato

Test verdi: 14 (preanalyst) e 56 (anagraphics). Rendering del form ripopolato provato a freddo, con
i cataloghi veri: avviso, campo nascosto, risposte aperte con l'escape giusto, scelte segnate,
nessuna chiave mancante.

**Non provato**: il giro vero dal browser. I servizi girano ancora con il codice e la configurazione
di prima — per vederlo funzionare servono
`webtools/configurator/load_configuration.sh && webtools/configurator/start.sh --restart` e, per una
prevalidazione vera, la chiave Anthropic (vedi §10: manca ancora).

---

# Secondo tempo: il prevalidator alla prova

Le prime prove vere, dal form e da `scripts/prevalidate.js`, con la chiave valida. Tre cose sono
uscite dalle prove, non dalla lettura del codice.

## 14. `400` dall'API: lo schema aveva vincoli non ammessi

`{ type: "number", minimum: 0, maximum: 1 }` sulle probabilità. **L'uscita vincolata non accetta i
vincoli numerici** — né `minLength`/`maxLength`, `multipleOf`, schemi ricorsivi — e l'API risponde
`400`. Gli SDK ripuliscono lo schema da soli soltanto quando è uno Zod passato a `messages.parse()`;
il nostro è JSON grezzo e arriva com'è. Tolti: l'intervallo lo controllava già `normalize()`, quindi
il controllo vero era comunque a valle.

## 15. Il sesto esito: `non_sequitur`

**Il caso.** La pre-specifica fuori dominio (un logo, dei testi, un parere, dei PC da riparare)
tornava «distribuzione non utilizzabile» e il passo finiva `failed`. Il modello aveva risposto
benissimo — flag alzato, motivazione esatta — ma con **tutte le probabilità a zero**: nessuno dei
cinque esiti si applicava a una richiesta che non è software. Una distribuzione che somma a zero non
dà nessun esito. Il caso che il prevalidator riconosceva meglio era l'unico che non sapeva
registrare.

**La soluzione.** `non_sequitur`, sesto esito: quello che la pipeline non potrebbe costruire a
nessuna dimensione. Rifiuta come `run_out_certain` e con la stessa soglia — due condizioni, non una.
La policy ora vieta esplicitamente la distribuzione di zeri. La guardia in `normalize()` resta: il
modello non è tenuto a obbedire.

**`off_domain` resta**, ed è un'altra cosa: software che si potrebbe sviluppare ma non è un webtool.
Era stato tolto per errore — iniziativa non richiesta, rimessa subito. Gli esiti dicono quanto è
grande e se software ce n'è; il flag dice se quel software è dei nostri. Non decide niente e non
arriva al cliente.

## 16. Il perimetro non si insegna per esempi

La prova del flag ha scoperto un problema più grosso della prova. Il modello motivava così:

> «webtools are internal tools for tracking and organising; this is a showcase site»

Nessuno gliel'aveva detto: l'aveva **dedotto dall'elenco** — tracker, classifiche, archivi,
sostituti di Excel — che è l'unica definizione che la policy dava, ed è quella del documento di
contesto. Conseguenze: un sito vetrina finiva in `non_sequitur` invece che fuori dominio, e «deve
venire bello» veniva contato come rischio di scope (complice la prima riga della policy, «You do not
design the tool», letta come «il design non è affar nostro»).

La policy ora dà **prima il criterio**: un webtool è uno strumento piccolo per un'esigenza
specifica — qualcuno ha qualcosa da fare, torna, e il webtool è ciò con cui la fa. Gli esempi
vengono dopo, con scritto che illustrano e non delimitano. Per il flag, tre cose che **non** mettono
fuori dominio, scritte per nome prima dei casi: chi può usarlo, com'è fatto fuori, quanto è grande.
Nel dubbio: che cosa sta facendo la persona davanti allo schermo.

**La definizione è stata copiata in `CLAUDE.md`** (sezione «Che cos'è un webtool»), che è il posto
dove deve stare: la policy la applica, non la inventa. Da valutare se portarla anche in
`contesto/02. contesto_aggiornato.md`, che oggi ha solo l'elenco.

Verifica su cinque casi, tutti con la motivazione giusta e mai più «public-facing»:

| Caso | Esito | `off_domain` |
|---|---|---|
| Preventivi dell'elettricista — non somiglia a nessun esempio | `safe` | dentro |
| Presenze agli allenamenti | `safe` | dentro |
| Sito dell'agriturismo | `ultrasafe` | **fuori** |
| Quiz della festa patronale | `safe` | **fuori** |
| Logo, testi, parere, PC da riparare | `non_sequitur` | dentro |

## 17. I costi, misurati

Haiku 4.5, $1/MTok in ingresso e $5 in uscita: **circa 0,33 centesimi di dollaro a prevalidazione**
al mattino, **~0,45 adesso** che la policy è cresciuta. Col criterio del caso peggiore — 5 pipeline
per vendita — il primo cancello incide meno di 2 centesimi per vendita, più i giri di
`underspecified`.

**La cache non si accende**: `cache_creation_input_tokens: 0`. Haiku 4.5 vuole un prefisso di almeno
4096 token e la policy, misurata con `count_tokens`, ne fa **3051**: mancano ~1000 token. Il
`cache_control` viene accettato e ignorato in silenzio. Voce 8 di `ottimizzazioni.md`, con la
conclusione operativa: **se restiamo su Haiku la policy va estesa**, perché sotto soglia ogni riga
si paga intera a ogni chiamata e sopra si paga un decimo.

**I token di un tentativo andato storto non si perdono più**: se il modello ha risposto, `usage` e
`model` finiscono sul passo `failed`. Un costo che non si registra non si misura.

## 18. Gli esempi

Tutti e cinque generati dal codice vero (`readAnswers` + `renderPrespec`): hanno la forma esatta di
quello che scrive `/submit`, front matter compreso. Prima i tre originali erano scritti a mano, con
codici che in `questions.js` non esistono più. `fuori-dominio.md` è diventato `non-sequitur.md` —
che è l'esito che gli tocca — e il nome liberato è andato a un esempio nuovo per il **flag**, il
sito dell'agriturismo.

## 19. Stato di chiusura

- Test: **16** preanalyst, **56** anagraphics. Tutti verdi.
- Servizi riavviati, configurazione e policy distribuite. Il `max_underspecified_attempts` della
  configurazione (100) è letto e servito: il tetto funziona, ma **100 è di fatto nessun limite** —
  il numero è ancora da decidere.
- Speso in chiamate di prova nella giornata: **meno di 5 centesimi**.
- Due voci nuove in `contesto/ottimizzazioni.md`: **7** (il log non ha livelli) e **8** (la cache
  della policy non si accende).
- Non provato: il giro `underspecified` completo dal browser, cioè riscrivere e rimandare
  davvero — il codice c'è, la pagina si rende, ma il secondo invio non è mai stato fatto a mano.

## 20. Correzione: la configurazione che vive sta in Mongo

Coda della giornata, ed è una **correzione di architettura**, non un'aggiunta.

`load_configuration.sh` sostituiva ogni documento **per intero** a ogni avvio, e `start.sh` lo
lancia prima di ogni avvio: un valore cambiato in esercizio spariva al primo riavvio, in silenzio.
La regola che lo stabiliva («i file sono la fonte») stava nel `CLAUDE.md` e non era una decisione
presa: era finita lì da una sessione passata, scritta da me.

**Come funziona adesso.** La configurazione che vive sta in Mongo, nella collection
`configuration`. I file di `configurator/configuration/` sono il **seme** — i valori con cui nasce
un ambiente nuovo — e la **forma attesa**, cioè quali campi esistono. Il caricamento aggiunge
**solo i campi che mancano**: un campo che c'è non si tocca qualunque valore abbia (anche `0`,
`false`, `null`), un campo tolto da un file resta, un sottosistema senza più un file non viene
cancellato. Così un campo nuovo introdotto da uno sviluppo entra da solo al primo avvio — che era
l'unica cosa buona del vecchio comportamento — senza portare via niente.

Per tornare ai file bisogna chiederlo: `./load_configuration.sh --reset [sottosistema …]`, che è
l'unico modo per cancellare le modifiche.

**I segreti sono l'eccezione**: i file di `secrets/` sostituiscono sempre il valore che trovano.
Una chiave d'API non è un dato che si modifica dal sistema, e quel file è l'unico posto dove
qualcuno la scrive: se la ruoti deve valere quella nuova.

Provato sul campo: soglia portata a 0,8 in Mongo e campo dei tentativi tolto a mano →
`./load_configuration.sh` → la soglia resta 0,8, il campo mancante rientra a 100, la chiave del
fornitore al posto suo. Poi `--reset preanalyst` riporta la soglia a 0,6. Sei test nuovi
(`tests/test_load_configuration.py`), anagraphics da 56 a **62**.

Aggiornati `CLAUDE.md` (la regola), `configurator/README.md`, §5.3 della documentazione di
anagraphics, i commenti di `load_configuration.sh` e `start.sh`.

**Resta aperto**: il backoffice di configurazione dei `todos.md`. Ora che Mongo è la fonte, quando
il backoffice esisterà scriverà lì — e va deciso se e come i file seguono, perché un campo nuovo va
aggiunto anche al file o l'ambiente successivo nasce senza.

## 21. Correzione: la pagina di ritorno è la stessa pagina

Provando il giro `underspecified` dal browser è saltato fuori che la colonna destra tornava
mutilata: prima spariva il blocco del **lavoro autonomo**, poi il box del **driver** e quello
dell'**ambassador**. Non era un guasto ma una scelta sbagliata, scritta in `serveFormAgain` con la
motivazione che «le condizioni economiche sono già fissate, quei box non contano più»: vero che non
contano più, falso che vadano tolti. Chi rivede il form deve ritrovarlo com'era, o sembra che si sia
rotto qualcosa.

**Il criterio, per le prossime volte:** quando una pagina si ripresenta, quello che non è più
modificabile si mette **in sola lettura**, non si toglie.

Come funziona adesso: i parametri dell'indirizzo non ci sono più — è la risposta a un `POST` — ma
non servono, perché quello che portavano è registrato sul progetto. `driverLinkOfProject()` in
`src/driver_link.js` ricostruisce il link da `review.driver_uid` + `preset`, e rilegge
`billing.discount_code` per la percentuale; `billing.ambassador_uid` ridà il box dell'invito.

I box si leggono e non si toccano: nessun campo nascosto riparte col form (`driver`, `discount`,
`ambassador` — l'ultimo stava nel suo partial e andava spento a parte), l'avviso «questo driver
verrà ignorato» non compare, e la casella del lavoro autonomo mostra `billing.autonomous_work` ed è
`disabled`, con una riga che dice che la scelta è stata fatta. In un lavoro autonomo il box del
driver resta spento, com'è al primo invio.

Verificato sui quattro casi (driver con sconto, driver senza sconto, ambassador, lavoro autonomo):
box presenti, nomi giusti, avviso giallo al suo posto, e fra i nascosti solo `submission_id`,
`project_id` e il `return_to` del selettore lingua.

Per provare dal browser servono i link del driver **Prova** (`639718a3-…`, abilitato), non quelli di
Dome: l'utente di prova entra come Dome, e i propri link sono `own_link` per definizione.
