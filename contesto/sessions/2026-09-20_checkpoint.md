# Checkpoint sessione 2026-09-20

Due sessioni: driver e codici sconto in `webtools_anagraphics` (§1–2), poi la nascita del
sottosistema `preanalyst` (§3). Stato di partenza: il checkpoint del 2026-09-19.

---

## 1. Creato `CLAUDE.md` nella root

Prima non esisteva, né qui né globale. Contiene solo lo **scopo**, una **overview** del flusso e
del modello di prezzo, **quattro regole generali** (nomi `webtools_`, avvio/arresto con PID
verificato, errori con stato HTTP + codice stabile, stime sempre a caso peggiore) e il **modo di
lavorare** (richieste puntuali, stop è stop, risposte brevi).

Scelta esplicita dell'utente: **niente mappa del workspace e niente questioni locali dei
sottoprogetti**, perché la struttura non è stabile. Il dettaglio resta in `contesto/02` e nella
documentazione dei sottosistemi.

Il file **si aggiorna a fine sessione**, e solo se sono emerse questioni davvero generali.

---

## 2. `webtools_anagraphics` — versione 0.2.1

### 2.1 Due collection nuove

| Collection | Chiave univoca | Contenuto |
|---|---|---|
| `drivers` | `uid` (UUID) | `uid`, `username`, `screen_name` |
| `discounts` | `discount_code` (UUID) | `discount_code`, `driver` (`uid` + `screen_name`), `percentage` |

`discounts` ha anche un indice **non** univoco su `driver.uid`.

Dati presenti nel DB `webtools`:

| | |
|---|---|
| Driver reale | `7633be3d-e701-42ca-9fea-6c6d1bb4b7d1` · `dome.santoro@gmail.com` · `Dome` |
| Driver di prova | `639718a3-ea41-4533-bdb8-73ac58b3b1b2` · `driver.prova@example.com` · `Prova`, senza sconti |
| Codice sconto | `e8013cf2-34eb-4bc3-8a34-b08fb24a1bf3`, del driver `Dome`, `percentage: 5` |

### 2.2 Quattro endpoint nuovi (sola lettura, come i due esistenti)

- `GET /drivers` → `{"drivers":[…]}`, ordinati per `uid`, **solo `uid` e `screen_name`**.
- `GET /drivers/{uid}` → il driver completo, `username` incluso. Altrimenti `404 DRIVER_NOT_FOUND`.
- `GET /drivers/{uid}/discounts` → `{"uid":…, "discounts":[…]}`.
- `GET /discounts/{discount_code}` → lo sconto. Altrimenti `404 DISCOUNT_NOT_FOUND`.

Codici d'errore nuovi: `DRIVER_NOT_FOUND`, `DISCOUNT_NOT_FOUND`.

### 2.3 Decisioni prese, con il perché

- **Nomi in inglese e snake_case** (`discounts`, `screen_name`, `discount_code`), non `sconti` /
  `screenName`: coerenza con `configuration`, `anagraphics`, `project_id`, `subsystem`.
- **Driver ridondato dentro lo sconto** (`uid` + `screen_name`), come chiesto: chi legge uno
  sconto ha subito il nome da mostrare. Prezzo: un cambio di `screen_name` **non si propaga**,
  va fatto a mano finché non c'è il CRUD. Il comando `mongosh` che aggiorna entrambe le
  collection è in §8.4 della documentazione del sottosistema.
- **`percentage` in punti percentuali**: `5` significa 5%, non 0,05.
- **Lista vuota ≠ driver inesistente.** `GET /drivers/{uid}/discounts` verifica prima il driver:
  driver esistente senza sconti → `200` e `[]`; driver inesistente → `404`. Costa una lettura in
  più, ma il consumer non deve dedurre l'esistenza del driver dal numero di sconti.
- **`username` fuori dalla lista** (costante `DRIVER_SUMMARY` in `db.py`). Non è una misura di
  sicurezza finché non c'è il login — chi chiama la lista può chiamare anche i singoli driver —
  ma evita di distribuire tutti gli identificativi di accesso in una risposta sola.
- **Login ignorato**, come da indicazione: `username` per ora è solo un dato.

### 2.4 Verifiche

- `uv run pytest`: **17 test verdi** (erano 9). L'ultima modifica (`username` fuori dalla lista)
  non è stata rilanciata su richiesta dell'utente: i test sono stati aggiornati ma non eseguiti.
- Prova dal vivo sul DB reale, tutti e sei gli endpoint più i 404. Il server è stato avviato solo
  per le prove e **rispento**: a fine sessione è **spento**.

### 2.5 Documentazione

Aggiornate `docs/subsystems/anagraphics/README.md` (scheda rapida, ruolo, mappa dei file, modello
dati §5.3–5.4, errori, endpoint §6.4–6.7 con rinumerazione fino a §6.10, comandi `mongosh`, test,
limiti noti, changelog) e il README breve del sottosistema.

---

## 3. Seconda sessione — nasce `preanalyst` (preanalysis gate)

Sottosistema nuovo: `webtools/preanalyst/`, la pagina da cui il cliente entra nel flusso.
Documentazione completa in `docs/subsystems/preanalyst/README.md`.

### 3.1 Struttura

Node **senza dipendenze** (`node:http`), porta **8200**, nessun database. `src/` diviso per
responsabilità: `settings.js`, `anagraphics.js` (client HTTP), `referral.js` (gli stati della
provenienza), `questions.js` (le domande come dati), `page.js` (HTML), `server.js`, `index.js`.
Controllo con `webtools_preanalyst.sh --start/--stop`, gemello di quello di anagraphics: nohup,
file PID verificato con `ps`, mai per nome né per porta.

`deploy.sh` ha ora la funzione `deploy_preanalyst`, che copia `commons.css` e `fonts/` in
`public/`. Verificato cancellando lo stile e riavviando il server: **il server non se lo inventa**,
l'unica sorgente è il deployer. `public/styles.css`, `public/assets/mark.svg` e `src/` non sono
toccati dal deploy.

### 3.2 Decisioni prese, con il perché

- **La pagina è resa dal server, il browser non parla mai con anagraphics.** Se le letture le
  facesse il JavaScript del browser funzionerebbe finché tutto sta su un Mac solo, e si romperebbe
  al primo deploy vero, perché anagraphics accetta solo gli IP del suo pool.
- **Due modi di arrivare da un driver**: `?discount=<codice>` (con sconto) e `?driver=<uid>`
  (senza). Se arrivano insieme **vince `discount`**, perché è l'unico con un effetto economico;
  il caso finisce nel log, perché un link con entrambi è quasi sempre un errore di chi l'ha fatto.
- **`?driver=` non fa letture in più**: l'elenco dei driver era già in mano. Conseguenza accettata:
  non si distingue "driver cancellato" da "uid inventato".
- **`discount_expired` copre anche il guasto tecnico**, come richiesto. La differenza resta nel
  log. Va rivisto quando lo sconto varrà soldi veri.
- **Niente ferma la pre-analisi**: `GET /` risponde **sempre 200**, anche con anagraphics giù.
- **Quello che arriva nell'URL non si perde**: `discount` e `driver` restano agganciati al form
  come campi nascosti anche quando non si sono potuti risolvere. Se il guasto è nostro, non deve
  pagarlo l'utente con lo sconto perduto.

### 3.3 Il form della pre-analisi

Le domande stanno in **`src/questions.js`, come dati**: rifinirle non richiede di toccare l'HTML.
Cinque sezioni: *Il problema*, *Chi lo usa e dove*, *Che cosa deve saper fare*, *Che cosa NON
deve fare*, *I dati*. Il bottone d'invio è disabilitato: non si manda ancora niente da nessuna
parte.

Tre correzioni dell'utente, importanti per il seguito:

- La prima versione di "che cosa deve saper fare" elencava **otto attività** (registrare, cercare,
  calcolare…). Bocciata: descriveva la forma che noi immaginiamo per la soluzione, non le capacità
  che servono, e limitava il cliente al nostro schema. Sostituita con **20 skill** corrispondenti a
  pezzi di ecosistema reale (PDF, OCR, codici a barre, date, validazioni, email…), su due colonne,
  più un campo "Altro".
- Dall'elenco sono state **tolte le skill che richiedono un componente esterno da configurare**
  (SMS/WhatsApp, pagamenti, Google, AI): si possono fare, ma vanno viste caso per caso, e ora
  passano dall'"Altro". Alcune voci sono state riscritte per cambiarne il senso: *emettere*
  fatture → **creare** fatture, *far firmare dal telefono* → **raccogliere una firma sullo
  schermo**. Regola generale che ne esce: una casella deve promettere quello che facciamo davvero.
- Sezione "Tempi e contatti" **eliminata**: nome, email e scadenza non si chiedono qui. Verranno
  con la registrazione, se il cliente prosegue.

### 3.4 Regola nuova: niente testi motivazionali

Una didascalia scritta in tono da brochure («la domanda più utile di tutte…») è stata bocciata
duramente. La regola è ora in **`CLAUDE.md`** (Regole generali), in cima a `src/questions.js` e
nella documentazione del sottosistema: i testi rivolti all'utente dicono che cosa fare, a che cosa
servono o che cosa succede, e **un'affermazione si fa solo se è verificabile**. Niente toni
motivazionali, niente complimenti al cliente, niente pubblicità del metodo.

### 3.5 Stato a fine giornata

- Il server era acceso con `HOST=0.0.0.0` per provarlo da altri dispositivi: da telefono
  funzionava, **da un altro Mac no**, e la diagnosi era rimasta aperta (firewall di questo Mac
  spento, node in ascolto su `*:8200`, quindi il problema stava dall'altra parte).
- `webtools_anagraphics` acceso, avviato dall'utente.
- Nessun test automatico su preanalyst: è un buco noto. Il primo candidato è `referral.js`,
  logica pura con sei esiti.

---

## 4. Da fare

Invariato rispetto al 2026-09-19, più:

1. **PoC della pipeline**: ancora da definire quali fasi includere e in che ordine.
2. Aggiornare i testi del front-gate al nuovo modello di prezzo (dicono ancora 400 € fissi).
3. CRUD di `webtools_anagraphics`. Serve anche per propagare `screen_name` sugli sconti.
4. Togliere il driver di prova `Prova` quando si esce dalla PoC.
5. Decidere a cosa servono davvero i codici sconto nel flusso: oggi il dato esiste, ma nessun
   sottosistema lo usa e non è ancora stabilito chi applica lo sconto e su cosa.
6. Test di `referral.js` con `node --test`.
7. Il vero contenuto della pre-analisi: dove finisce la richiesta quando si preme invio.
8. Collegare il bottone "Inizia" del `front-gate` alla pagina della pre-analisi.
9. Capire perché la pagina non si apriva dall'altro Mac.
10. Decidere se il link `?driver=` deve lasciare traccia a valle: è l'unico modo per sapere che un
    progetto arriva da un driver **senza** passare da uno sconto, cioè per pagargli la sua quota.
