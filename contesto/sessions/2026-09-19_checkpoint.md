# Checkpoint sessione 2026-09-19

Sessione di lavoro con Claude Code (Opus 5). Qui c'è lo stato del workspace a fine giornata e cosa serve sapere per ripartire in una sessione nuova.

---

## 1. Decisione di fine giornata

L'analisi economica (§ 5) mostra che, come attività secondaria, il progetto non raggiunge il compenso attuale dell'utente (70 €/h netti). Nessuna delle leve individuate è ritenuta realistica.

**Decisione: si sviluppa la PoC, poi si vedrà.** "PoC" limita il **perimetro**, cioè quali fasi e funzioni si costruiscono, **non la qualità**. Valgono gli stessi standard di un sistema reale: nomi specifici, avvio e arresto robusti, test, contratti d'errore chiari, documentazione. Niente scorciatoie "tanto è una PoC". La PoC deve misurare:
1. il costo AI reale dello sviluppo di un webtool;
2. il tasso di accettazione delle demo;
3. i turni reali di una pre-analisi con un utente non tecnico.

---

## 2. Documenti di contesto (`contesto/`)

| File | Contenuto |
|---|---|
| `02. contesto_aggiornato.md` | Visione, attori, architettura dalla Sequence, flusso, **modello di prezzo** (tier standard, estensioni a pagamento, tier a consumo), domande aperte (lasciate aperte di proposito) |
| `03. analisi_costi_e_sostenibilita.md` | Analisi dei costi AI e fiscale con le uscite distribuite lungo i cancelli. **Non** è il caso peggiore |
| `04. analisi_costi_caso_peggiore.md` | Stesse tabelle nel **caso peggiore**: tutte le mancate conversioni dopo la demo, 5 pipeline per vendita |
| `05. previsione_annuale_scenario_plausibile.md` | Previsione di un anno plausibile: mercato, imbuto, conto economico, ore |
| `outdated/01. overview_progetto_microsoftware.md` | Vecchia overview, marcata OUTDATED |

Riferimento per il flusso: `struttura/design/Sequence.drawio.pdf`.

---

## 3. Cosa è stato costruito

### 3.1 Sito vetrina — `webtools/front-gate/`
- Sito statico di 6 pagine, restyling **"bottega digitale"**:
  - carta, inchiostro e un solo accento vermiglio;
  - font Fraunces, Inter e JetBrains Mono, salvati nel progetto;
  - mockup con ombre nette e cartellini prezzo.
- La versione grigia originale è salvata in `backups/front-gate-static-grigio/`.
- `css/styles.css` contiene **solo** gli stili specifici del sito: hero, mockup, cartellini, esempi, flow, pagine interne, footer.
- `css/commons.css` e `css/fonts/` sono **copie generate** dal deployer (§ 3.3): non vanno modificate lì.
- I contenuti riflettono ancora il **vecchio modello**, con il prezzo fisso a 400 €. Mancano il tier a consumo e le estensioni: da aggiornare.

### 3.2 Stile condiviso — `webtools/commons/style/`
- `commons.css`: solo ciò che serve alla **coerenza tra siti diversi**:
  - font e token (colori, raggi, ombre);
  - base, titoli e layout (`.container`, `.section`);
  - marchio (`.brand*`);
  - header e navigazione, compreso il menu mobile;
  - bottoni (`.btn`, `.btn-primary`);
  - schede (`.card`, `.card-sm`, `.card-head`);
  - `.eyebrow`, `.text-link`, accordion, animazioni.
- `fonts/`: i 4 font woff2.
- **Esclusi di proposito**, perché promozionali o specifici del sito: cartellini prezzo, fascia scura, contenuti dei mockup, "pillole" dei passi.
- `mark.svg` resta in `front-gate/assets/`.
- Il JS del menu mobile (`front-gate/js/main.js`) non è condiviso: se altri siti useranno lo stesso header, andrà reso comune anche quello.

### 3.3 Deployer dello stile — `webtools/configurator/style_deployer/deploy.sh`
- Nessun parametro, **una funzione per ogni progetto** con destinazioni esplicite. Non tutti i progetti ricevono lo stile e le strutture possono essere diverse.
- Oggi c'è solo `deploy_front_gate`: copia `commons.css` in `front-gate/css/` e sostituisce `front-gate/css/fonts/`.
- Lo lancia l'utente.

### 3.4 Sottosistema `webtools_anagraphics` — `webtools/anagraphics/`
- Python + FastAPI + pymongo, gestito con `uv`. MongoDB 8 locale (Homebrew), database `webtools`.
- Collection:
  - `configuration`, chiave `subsystem`: contiene `{subsystem: "front-gate"}`;
  - `anagraphics`, chiave `project_id` (**UUID**): contiene il progetto di prova `1f251606-bdba-40c4-bbee-bfedc6e57f70`.
- **Solo lettura**: `GET /configuration/{subsystem}`, `GET /anagraphics/{project_id}`.
- **Errori**: stato HTTP + codice stabile, `{"error": "<CODICE>", ...}`. Codici: `CONFIGURATION_NOT_FOUND`, `PROJECT_NOT_FOUND`, `ROUTE_NOT_FOUND`, `METHOD_NOT_ALLOWED`, `IP_NOT_ALLOWED` (403), `DATABASE_UNAVAILABLE` (503), `INTERNAL_ERROR` (500).
- **Pool di IP**: `ALLOWED_IPS`, default localhost. Conta solo l'IP della connessione (`proxy_headers=False`).
- **Avvio e arresto**:
  ```sh
  webtools/anagraphics/webtools_anagraphics.sh --start
  webtools/anagraphics/webtools_anagraphics.sh --stop
  ```
  File PID e log sono accanto allo script. `--stop` ferma solo il processo del file PID, dopo averne verificato la riga di comando.
- Test: `uv run pytest`, 9 test sul database `webtools_test`.
- Documentazione completa: `docs/subsystems/anagraphics/README.md`.
- **A fine sessione il server era acceso** sulla porta 8100, PID 65654.
- Previsti più avanti: CRUD completo ed estensione delle strutture dati.

---

## 4. Regole di lavoro emerse (valgono per le prossime sessioni)

- **Niente nomi generici** per pacchetti, processi e servizi: usare il prefisso `webtools_` (es. `webtools_anagraphics`).
- **Start e stop sicuri**: mai `pkill -f` con pattern generici, mai fermare un processo individuato dalla porta. File PID verificato.
- **Prima di fare prove**, controllare se l'utente ha già un'istanza attiva e non toccarla.
- **Non procedere in autonomia** su modifiche non richieste. Quando l'utente dice "stop" o "fermo", fermarsi subito.
- **Stime economiche: sempre il caso peggiore**, con tutte le mancate conversioni dopo la demo, salvo richiesta esplicita diversa. Le ore si contano su tutti i progetti dell'imbuto (vendite × 5).
- **Errori delle API**: stato HTTP + codice stabile, mai testi discorsivi da interpretare.
- Il driver valida e supervisiona, **non** assorbe i fallimenti dell'AI. Non si vendono personalizzazioni di basi preconfezionate.
- **PoC ≠ lavoro approssimativo**: il perimetro è ridotto, gli standard no.
- Risposte brevi e concrete. Una sessione per argomento, per contenere il contesto.

---

## 5. Sintesi dell'analisi economica

- Costo AI per vendita, conversione al 20%, **caso peggiore**:

  | Profilo / caso | Costo AI per vendita | Esito |
  |---|---|---|
  | Top sfavorevole (Opus ovunque) | $376 | **ogni vendita in perdita** |
  | Top medio | $149 | — |
  | Economico medio (Haiku + Sonnet) | $55 | — |

- Fiscalità: dipendente Poste con RAL 54k. **Forfettario escluso** (soglia dei 35k da lavoro dipendente). Regime ordinario, INPS Gestione Separata 24%, marginale IRPEF effettiva ~44–45,5%.
- Scenario plausibile: ~25 vendite l'anno, **~2.400 € netti**, ~139 ore, **~17 €/h**.
- Con 400 € e ~4,2 ore di lavoro umano per vendita il tetto è **~30 €/h netti**, contro i 70 €/h netti attuali dell'utente.
- Per arrivare a 70 €/h servirebbe una di queste leve, oggi ritenute non realistiche:
  - ~1,8 ore di lavoro umano per vendita;
  - un prezzo di ~890 € IVA inclusa;
  - le ore fatte dal pool di driver.

---

## 6. Prossimi passi

1. **PoC della pipeline.** Da definire con l'utente quali fasi includere e in che ordine. Durante lo sviluppo va misurato il consumo di token per fase.
2. Aggiornare i testi del front-gate al nuovo modello di prezzo, quando l'utente lo chiede.
3. Estendere `webtools_anagraphics` verso il CRUD, quando l'utente lo chiede.

In una sessione nuova, partire da questo checkpoint e da `contesto/02`.
