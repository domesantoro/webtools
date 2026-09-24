# Checkpoint 2026-09-24

## 1. La chat dei giri di specifica: da mock grafico a interazione vera

La pagina `/analysis/{id}` era un guscio. È stata riempita in tre passaggi nella stessa giornata.

**Prima il mock grafico** (preanalyst 0.20.0): un messaggio alla volta, il campo che si blocca
finché la risposta non arriva, Invio manda e Maiusc+Invio va a capo. Risposte finte pescate a caso
dal catalogo, niente scritto da nessuna parte. Serviva a guardare l'interazione prima di decidere
chi conduce i giri.

**Poi il riepilogo e i turni** (0.22.0): colonna destra che rilegge dal progetto che cosa è stato
deciso all'invio — driver, sconto, ambassador, lavoro autonomo — e il contatore dei turni. Nuova
configurazione `analysis.max_turns` / `analysis.warn_from_turn` (30/20 nel file, 5/3 in Mongo per
poter provare il giro intero senza scrivere trenta messaggi).

**Poi la robustezza** (0.23.0): la chat e i turni **stanno sul progetto**, non nel browser. Quando
la prevalidazione passa si apre un passo `analysis` con `result: "open"` e dentro
`{turns_left, chat}`; si apre anche all'apertura della pagina se manca, per i progetti nati prima.
Tre rotte nuove: `POST .../messages` (i due messaggi e il turno scalato in **una scrittura sola**),
`POST .../turns` (sposta turni dal credito dell'utente al progetto) e `POST .../turns/buy` (finto
acquisto). Il credito dell'utente sta in `billing.turns_credit` su anagraphics.

**Il criterio sull'ordine delle due scritture:** prima si scala il credito, poi si accredita sul
progetto — il credito è la parte che non deve potersi spendere due volte, e anagraphics lo verifica
**dentro** il filtro della scrittura (`{"uid": …, "billing.turns_credit": {"$gte": amount}}`), non
prima. Se il secondo passaggio non riesce il credito si restituisce.

Due mock ancora in piedi, segnati in `contesto/todos.md`: la risposta del modello e l'acquisto.

## 2. Due difetti trovati provando dal browser

**Dopo il login il form non ripartiva.** Era una scelta vecchia, con un commento che la spiegava;
l'unica giustificazione vera era la casella del **lavoro autonomo**, che può comparire solo dopo il
login e che nessuno ha ancora visto. Ora l'invio riparte da solo, tranne in quel caso, dove si
accende un avviso sopra il bottone.

**Una richiesta con dentro «a» finiva in REJECTED definitivo.** La policy elencava «an empty form»
fra i casi di `non_sequitur` e non diceva quale esito vincesse quando la richiesta non dice niente.
Era un buco di precedenza, non un errore del modello.

**Il criterio, scritto ora nella policy:** `non_sequitur` ha bisogno di **qualcosa di detto** che
non si possa costruire; il vuoto è `underspecified`. Fra i due si sceglie quello che **richiede**,
perché non costano uguale — uno rimanda indietro, l'altro rifiuta per sempre.

Nella stessa revisione è andato via il segnale della lunghezza da `underspecified`: «è lunga una
riga sola» non vuol dire niente. Verificato: la stessa pre-specifica che era stata rifiutata ora dà
`underspecified` a 1.00, e i cinque esempi tengono il loro esito.

**La modale del rifiuto ha tre testi** invece di uno (`rejectionCase()` legge l'esito dall'ultimo
passo): `out_of_scope`, `not_software` — l'unico che parla del servizio invece che della richiesta —
e `not_recognised` per l'`underspecified` che ha finito i giri.

## 3. Tutto il repository tradotto in inglese

Cambiata la regola in `CLAUDE.md` e tradotto: codice, commenti, test, documentazione,
`contesto/`, i README dei sottosistemi, le descrizioni dei `package.json` e del `pyproject.toml`,
i commenti CSS e dei template, `bootstrap.env`. Rinominata `scripts/esempi/` in `scripts/examples/`
con i cinque file.

**Resta italiano, per scelta e ora scritto nella regola:** i cataloghi delle lingue, le citazioni di
testo di prodotto dentro un documento inglese, le cinque pre-specifiche di esempio (sono documenti
scritti da un cliente: tradurle cambierebbe il caso di prova) e quello che è già chiuso —
`contesto/sessions/`, `contesto/outdated/`, `workbench/`. Fuori dalla regola, e da decidere:
`backups/`, `sites/` e i `.drawio` di `Fasterthanabullet/`.

**Due cose imparate dalla traduzione**, che valgono per la prossima volta:

- **Gli script di avvio leggevano il log.** `webtools_*.sh` cerca la riga `<nome> in ascolto su`
  per sapere che il server è partito: tradurre il `console.log` senza il `grep` rompe l'avvio. Vanno
  cambiati insieme.
- **Una rinomina incompleta non la prendono i test.** `orfani` → `orphans` in
  `load_configuration.py` era rimasto a metà in un ramo che i test non coprono, ed è saltato fuori
  solo eseguendo lo script. Dopo una rinomina, eseguire, non solo testare.

Test alla fine: anagraphics 70, sso 47, preanalyst 16, workspaces 13, tutti verdi. I conteggi nei
README erano fermi a 62 e 35: corretti.

## 4. Da riprendere

- I due mock da smontare (`contesto/todos.md`): chi conduce davvero i giri di specifica, e il
  payment engine al posto del finto acquisto.
- Il tasto «Scarica la conversazione» non fa ancora niente. Quando lo farà: `POST /upload` pretende
  il `project_id` nel front matter, quindi il file scaricato deve portarlo, o il giro «vai avanti
  con il tuo agente AI» si interrompe all'ultimo passo.
- Il tasto «Va bene così, procediamo!» si accende quando i turni finiscono, ma che cosa faccia è
  ancora da specificare.
- La configurazione in Mongo ha `analysis.max_turns: 5`: va rimessa a 30 quando si smette di
  provare.
- Provare dal browser quello che oggi ho verificato solo via HTTP: il riavvio automatico dell'invio
  dopo il login, l'avviso del lavoro autonomo, il contatore e il box dei turni finiti.
