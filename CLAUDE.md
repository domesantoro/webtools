# ftab — webtools

## Scopo

Una piccola "fabbrica" di **software su misura per problemi piccoli e concreti**: tracker,
classifiche, piccoli archivi, strumenti di organizzazione, sostituti di fogli Excel o di
procedure manuali.

Principio guida: **problemi piccoli → soluzioni piccole**. Scope definito, niente progetti
eterni, niente cicli infiniti di feedback, automazione forte del lavoro interno, intervento
umano concentrato su decisioni ed eccezioni, cliente proprietario dei propri account e
ambienti.

## Overview

Il cliente arriva dal sito vetrina e formula il suo bisogno in una **pre-analisi**. Un
**prevalidator** controlla che lo scope sia accettabile, un **analysis engine** produce
l'analisi, che viene validata prima da un **driver** (la figura umana che supervisiona i
progetti) e poi dal cliente. Un **developer AI** sviluppa, il driver supervisiona l'α-test,
la **demo** viene pubblicata. Il cliente accetta o rifiuta la demo; se accetta, si paga.
In ogni cancello il rifiuto porta la richiesta in REJECTED.

Il prezzo ha un **tier standard** garantito e un **tier a consumo**, scelto dal cliente
all'inizio, il cui prezzo viene calcolato alla demo sui consumi reali più la quota del driver.

I driver si registrano da **Lavora con noi**: solo quelli **abilitati** (dopo un colloquio)
seguono progetti di clienti; ogni driver può essere **ambassador** (invita clienti, prende metà
della fee) e fare **lavoro autonomo** (progetti suoi, pagati con i suoi token più la fee).

Siamo nella fase di **PoC**: si costruisce un perimetro ridotto della pipeline per misurare
il costo AI reale di un webtool, l'accettazione delle demo e i turni reali di una pre-analisi.
**PoC limita il perimetro, non la qualità**: stessi standard di un sistema reale.

Il dettaglio — attori, architettura, flusso, modello di prezzo, domande aperte — sta in
`contesto/02. contesto_aggiornato.md`, che è il documento corrente (quello in
`contesto/outdated/` non va usato). Il riferimento visivo del flusso è
`struttura/design/Sequence.drawio.pdf`.

## Regole generali

- **Il servizio si chiama "webtools"** (marchio, titoli, testi: «usare webtools»). "webtool" è
  solo il nome comune del prodotto: «un webtool», «il webtool viene sviluppato».
- **Niente nomi generici** per pacchetti, moduli, processi e servizi: prefisso `webtools_`
  (es. `webtools_anagraphics`, mai `app` o `anagraphics` da solo).
- **Avvio e arresto sicuri**: file PID con verifica della riga di comando. Mai `pkill -f` con
  pattern generici, mai fermare un processo individuato dalla porta: su questa macchina girano
  altri progetti. Prima di fare prove, controllare se c'è già un'istanza dell'utente attiva e
  non toccarla.
- **Errori delle API**: stato HTTP corretto e codice stabile, `{"error": "<CODICE>"}`. Mai
  testi discorsivi da interpretare.
- **Parti comuni**: l'originale sta in `webtools/commons/`, dentro i sottosistemi ci sono
  **copie generate** dai deployer (`webtools/configurator/deploy.sh`). Una copia non si
  modifica dov'è: si modifica l'originale e si rilancia il deployer.
- **Configurazione dal sottosistema di configurazione.** Ogni dato configurabile (indirizzi,
  porte, pool di IP, durate, limiti, prezzi, nomi di cookie…) sta in
  `webtools/configurator/configuration/<sottosistema>.json` e lo serve anagraphics
  (`GET /configuration/{subsystem}`), mai scritto dentro il sottosistema: né costanti nel
  codice, né variabili d'ambiente, né **valori di default**. Il sottosistema la legge all'avvio
  e, se manca un campo, non parte. Dall'ambiente arriva solo il bootstrap
  (`webtools/configurator/bootstrap.env`). Vale per ogni sviluppo nuovo.
- **Configurazioni strutturate, non piatte.** I file di configurazione si organizzano in oggetti
  JSON annidati per argomento (`listen`, `access`, `subsystems_infos`, `session`, `limits`, …),
  quando rende la configurazione più leggibile e ordinata: è la scelta da preferire.
- **HTML nei template, mai dentro il codice**: le pagine si scrivono in file `.njk` resi con
  nunjucks, con l'autoescape acceso. Comporre HTML con stringhe nel JavaScript rende l'escape
  una questione di memoria di chi scrive, e i valori arrivano quasi sempre da fuori.
- **Testi rivolti all'utente solo nei cataloghi delle lingue**: `webtools/commons/i18n/locales/
  <lingua>.json`, chiavi inglesi per area, mai testo nei template o nel codice e mai cataloghi
  locali. Solo chiavi/valori, niente template per lingua. Riserva: l'inglese. La lingua sta nel
  cookie comune (e, per chi è entrato, in sessione e profilo), mai nell'URL. La lingua interna
  del sistema (codici, dati, API, pre-specifica, log) resta l'inglese.
- **Testi rivolti all'utente: asciutti e funzionali.** Una frase dice che cosa fare, a che
  cosa serve o che cosa succede. Niente toni motivazionali, niente frasi che celebrano il
  cliente o il nostro metodo, niente linguaggio da pubblicità. Se una frase si può togliere
  senza perdere informazione, si toglie. Un'affermazione si fa solo se è verificabile: «ogni
  cosa che escludi è un giro di domande in meno» si può controllare, «la domanda più utile di
  tutte» no. **Nessun testo non richiesto**: una frase in più si aggiunge se serve a chi legge,
  mai per riempire, e non deve dare per scontato da dove arriva l'utente — la stessa pagina la
  raggiungono strade diverse.
- **Niente che si apra da solo.** Una finestra, una scheda o un'azione che parte senza che
  l'utente l'abbia chiesta è un errore, anche quando è comoda: prima si dice che cosa sta per
  succedere, poi si aspetta che lo chieda.
- **Importi in centesimi di euro**, interi, in tutto il progetto: dati, API, configurazioni
  (`40000` = 400 €). I nomi dei campi finiscono in `_cents`. Si converte in euro solo per
  mostrarli.
- **Stime economiche: sempre il caso peggiore** — tutte le mancate conversioni dopo la demo,
  quindi 5 pipeline complete per vendita, e le ore contate su tutti i progetti dell'imbuto,
  non solo sulle vendite. Salvo richiesta esplicita diversa.

## Modo di lavorare

- Si procede per **richieste puntuali**. Niente lavoro in autonomia, niente piani grandi non
  richiesti, niente modifiche oltre quanto chiesto.
- Quando l'utente dice **"stop"** o "fermo", ci si ferma subito.
- **Risposte brevi e concrete.** Una sessione per argomento, per contenere il contesto.
- Le decisioni e lo stato di fine giornata si annotano in `contesto/sessions/`. Il checkpoint è
  **uno per giornata**, non uno per sessione: se il file del giorno esiste già, alla chiusura
  della sessione successiva **si aggiunge**, senza riscrivere né cancellare ciò che c'è.
- **Manutenzione di questo file**: si aggiorna a fine sessione, e solo se sono emerse
  questioni davvero **generali**. Le questioni locali di un sottoprogetto restano nella sua
  documentazione; lo stato di avanzamento resta nei checkpoint.
