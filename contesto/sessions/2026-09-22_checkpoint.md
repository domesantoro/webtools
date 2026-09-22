# Checkpoint sessione 2026-09-22

Ridefinizione del **lavoro autonomo** e nascita della pagina **Lavora con noi**, con i tre modi di
lavorare con webtools: ambassador, driver (abilitato o no), lavoro autonomo. Il modello è scritto
in `contesto/02. contesto_aggiornato.md` (Attori, Driver's interface, Lavoro autonomo,
Ripartizione, Domande aperte); quello che la pagina promette e non esiste ancora è in
`contesto/todos.md`.

Stato di partenza: il checkpoint del 2026-09-21.

---

## 1. Via lo sconto sulla fee del lavoro autonomo

- Tolto da pagina, configurazione (`billing.autonomous_fee_discount_percent` di preanalyst) e dato
  del progetto (`billing.autonomous_fee_discount` in anagraphics).
- **Migrazione eseguita** sul DB `webtools`: `$unset` sui 2 progetti che avevano il campo
  (anagraphics §8.8).
- L'informativa del blocco "Lavoro autonomo" ora dice: niente quota del driver, a consumo con i
  token, più la fee di sistema; link «Vuoi saperne di più?» a
  `lavora-con-noi.html#lavoro-autonomo`, in una nuova scheda (per non perdere il form), **senza**
  scritte che lo annuncino. Indirizzo del front-gate in `subsystems_infos.front_gate.url`.

## 2. front-gate

- Pagina **`lavora-con-noi.html`** con tre sezioni (id `#ambassador`, `#driver`,
  `#lavoro-autonomo`). Testi scritti con l'utente: la frase sulla cancellazione del codice è la sua
  («certezza semideterministica dell'unicità del codice»). La nota sui token è una **nota a fondo
  sezione** con richiamo in apice, 12px, senza filetto.
- "Lavora con noi" è l'ultima voce del menu, **prima di "Inizia"**; tolta dal footer.
- **Header e footer centralizzati**: `templates/layout.njk` + `partials/header.njk` e
  `partials/footer.njk`; ogni pagina imposta `page`, `title`, `description` e il blocco `main`.
  Confronto prima/dopo: pagine identiche salvo il link FAQ di "Quanto costa".
- Testo del footer: `*footer placeholder*`.

## 3. Brand **webtools**

Il servizio si chiama **webtools** (marchio, titoli, testi); "webtool" resta il nome comune del
prodotto. Cambiati gli originali in `webtools/commons/` e ridistribuiti (deployer `style` e
`template`). Regola aggiunta in `CLAUDE.md`.

## 4. anagraphics — da 0.6.0 a 0.7.0

- `billing`: via `autonomous_fee_discount`, nuovo **`ambassador_uid`**.
- Driver: campo **`enabled`**, anche nella lista `GET /drivers`. `Dome` e `Prova` abilitati; nuovo
  driver di prova **`Non abilitato`** (`f234b930-…`) con un codice sconto al 10%
  (`91165eb1-…`). Seed rilanciato sul DB `webtools`.
- Test: 45.

## 5. preanalyst — da 0.11.0 a 0.15.0

- **Ambassador** `?ambassador=<uid>`: box "Invito" («Ti ha invitato a usare webtools.») solo senza
  `?driver=`/`?discount=`, con uid di un driver (abilitato o no), diverso da chi compila; sparisce
  con il lavoro autonomo segnato. All'invio si ricontrolla e va in `billing.ambassador_uid`
  (`src/ambassador.js`).
- **Driver non abilitati**: stati nuovi `driver_disabled` e `discount_driver_disabled` nel box
  («non è abilitato a seguire progetti, e con lui non possiamo proseguire. Contattalo»); lo sconto
  non viaggia col form.
- **Ricontrollo all'invio** di driver e sconto (`src/project_driver.js`): valgono solo con un
  driver esistente, abilitato e diverso da chi compila; lo sconto porta il suo driver. Prima i
  campi nascosti finivano nel progetto senza verifica. Anagraphics giù → `503`.
- Verifiche: pagine con `curl`, funzioni di controllo contro anagraphics vera. **Non provato**:
  un invio reale da browser con login.

## 6. Decisione: la fee del lavoro autonomo

La fee si paga **sempre a parte**. Il lavoro autonomo scala i token nelle fasi; alla demo il
driver acquista il codice pagando normalmente, e paga **solo la fee**. Scritto in
`02. contesto_aggiornato.md` (Lavoro autonomo); tolta la domanda aperta.

## 7. Stato

Tutti i servizi riavviati e accesi con il codice nuovo.

---

# Sessione 2 — Internazionalizzazione (it + en)

Il sistema si mostra in italiano e in inglese. La lingua interna (codici, dati, API,
pre-specifica, log) resta inglese: si traduce solo quello che vede l'utente.

## 8. Decisioni

- **Cataloghi solo comuni**: tutti i testi di tutti i sottosistemi in
  `webtools/commons/i18n/locales/<lingua>.json`, chiavi inglesi per area (`common.*`, `sso.*`,
  `preanalyst.*`, `front_gate.*`). Nessun catalogo locale. Il deployer `i18n` copia modulo e
  cataloghi in `src/commons/i18n/` di sso, preanalyst, front-gate.
- **Solo chiavi/valori**, nessun template per lingua, anche per le pagine lunghe.
- **Riserva inglese**: chiave mancante in una lingua → testo inglese; lingua di riserva `en`.
- **Lingua in sessione utente, mai nell'URL**: cookie comune `webtools_locale` letto da tutti i
  sottosistemi a ogni richiesta (anche per l'anonimo); senza cookie `Accept-Language`, poi `en`.
  Per chi è entrato anche in `sessions.data.locale` e `users.locale`: al login vince il profilo
  (se manca, prende la lingua della pagina e la salva) e il login riscrive il cookie.
- **Selettore nel piè di pagina** (`EN / IT`), mai in testata né fra le voci di menu: markup unico
  in `commons/templates/locale_switch.njk`.

## 9. Cosa è cambiato

- `commons/i18n/webtools_i18n.js`: `t`, `t_html` (HTML del catalogo, valori ripuliti), `has`,
  `euro` per lingua, `pageContext`, `readChange` per `POST /locale`. Configurazione `i18n` in
  sso, preanalyst, front-gate (locales, fallback, cookie, durata, limite del corpo).
- `POST /locale` in tutti e tre i frontend. sso: `POST /session/locale`, codice `INVALID_LOCALE`;
  client comune `saveSessionLocale`. sso 0.5.0, test 47.
- anagraphics **0.8.0**: `PUT /users/{username}/locale`, `PUT /sessions/{token}/locale`. Test 50.
- preanalyst **0.16.0**: `questions.js` tiene solo struttura e testi inglesi della pre-specifica
  (opzioni `[codice, testo spec]`, id delle sezioni in inglese); `upload.js` riceve i messaggi
  dalla pagina; `language` della pre-specifica = lingua della pagina.
- front-gate: tutte le pagine a chiavi, prezzo per lingua (`400 €` / `€400`). Stile del piè di
  pagina spostato in `commons.css`.
- Controllo: `node webtools/commons/i18n/webtools_i18n_check.mjs` (chiavi usate assenti in `en`,
  chiavi da tradurre).

## 10. Da rivedere

- I template di front-gate non erano in git: riscritti a chiavi, testi italiani ricostruiti.
  Rileggere le pagine in italiano.
- L'inglese è una prima stesura: da rileggere.
- Le risposte in testo semplice di preanalyst («Non trovato», «Metodo non ammesso») sono ancora
  in italiano e fuori dal contratto a codici.
- Il selettore nel piè di pagina è verificato solo nell'HTML, non a schermo dall'agente.

## 11. Stato

Tutti i servizi riavviati con configurazioni e codice nuovi.
