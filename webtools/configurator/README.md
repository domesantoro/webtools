# configurator — avvio e deployer

Qui stanno i programmi che **avviano il sistema**, la **configurazione di tutti i sottosistemi** e i
programmi che **distribuiscono le parti comuni** dentro i sottosistemi che le usano.

## La configurazione

Ogni valore configurabile di un sottosistema (indirizzi, porte, pool di IP, durate, limiti, prezzi,
nomi di cookie…) sta in **un file JSON per sottosistema**, in `configuration/`:

| File | Chi lo legge |
|---|---|
| `configuration/anagraphics.json` | anagraphics, direttamente da Mongo |
| `configuration/sso.json` | sso |
| `configuration/workspaces.json` | webtools-workspaces |
| `configuration/preanalyst.json` | preanalyst |
| `configuration/front-gate.json` | front-gate |

I file sono **strutturati**: i campi si raggruppano per argomento (`listen`, `access`, `subsystems_infos`,
`session`, `limits`, …), non si scrivono piatti. Il campo `subsystem` non si scrive: lo dà il nome
del file. Il significato dei campi sta nella documentazione del sottosistema che li legge.

`load_configuration.sh` li porta nella collection `configuration` di anagraphics, che li serve con
`GET /configuration/{subsystem}`. **La configurazione che vive sta lì, non nei file**: questi sono
il seme — i valori con cui nasce un ambiente nuovo — e la forma attesa, cioè quali campi esistono.
Quello che gira può divergere, ed è normale.

Per questo il caricamento aggiunge **solo i campi che mancano**: un campo che c'è non si tocca
qualunque valore abbia, un campo tolto da un file resta in Mongo, un sottosistema senza più un file
non viene cancellato. Un campo nuovo introdotto da uno sviluppo entra da solo al primo avvio, e
niente di quello che è stato cambiato in esercizio si perde. Lo dice mentre lo fa:

```
Configurazione di 'webtools': 5 sottosistemi letti da configuration/
  preanalyst: aggiunti prevalidation.max_underspecified_attempts
```

Per tornare ai file bisogna chiederlo — `./load_configuration.sh --reset [sottosistema …]` — ed è
l'unico modo: cancella le modifiche di quei sottosistemi e li riporta a quello che dice il file. Un
campo nuovo va aggiunto **anche** al file, o l'ambiente successivo nascerà senza.

Non si carica niente se anche un solo file non è JSON valido.

Ogni sottosistema legge la sua configurazione **all'avvio**, e **non ha valori di default**: se il
documento manca, o un campo manca o è del tipo sbagliato, scrive nel log `webtools_<nome> non
parte: …` con il percorso del campo ed esce con 1. I sottosistemi Node la leggono con il client
comune `commons/configuration/configuration_client.js` (vedi sotto, deployer `configuration`).

### Bootstrap

`bootstrap.env` contiene le sole informazioni che non possono stare nella configurazione, perché
servono a raggiungerla:

| Variabile | A che serve |
|---|---|
| `WEBTOOLS_ANAGRAPHICS_URL` | Dove sta anagraphics. Gli altri lo chiamano qui; anagraphics ne ricava host e porta di ascolto |
| `WEBTOOLS_CONFIGURATION_TIMEOUT_MS` | Quanto aspettare mentre si legge la configurazione, all'avvio |
| `WEBTOOLS_MONGO_URI`, `WEBTOOLS_MONGO_DB` | Il database di anagraphics, dove sta anche la configurazione |

Lo caricano gli script di controllo (`webtools_*.sh --start`) e `load_configuration.sh`. Per un
avvio a mano in primo piano: `set -a; source webtools/configurator/bootstrap.env; set +a`.

### Cambiare un valore

```sh
$EDITOR webtools/configurator/configuration/sso.json
webtools/configurator/start.sh --restart     # carica la configurazione e riavvia tutto
```

Un servizio acceso continua con la configurazione letta quando è partito: senza riavvio un cambio
non ha effetto.

## Avviare e fermare tutto

```sh
webtools/configurator/start.sh             # avvia quello che non è già acceso
webtools/configurator/start.sh --restart   # ferma prima quelli accesi, poi riavvia tutto
webtools/configurator/stop.sh              # ferma tutto, in ordine inverso
```

`stop.sh` ferma ogni servizio con il suo script di controllo (file PID e riga di comando
verificata, mai per nome o per porta). Un servizio già spento non è un errore; se uno non si
ferma, si prosegue con gli altri e alla fine lo script esce con 1.

Prima di avviare, `start.sh` lancia `load_configuration.sh`: se la configurazione non si carica
(per esempio perché MongoDB è spento) si ferma lì, senza avviare niente. Gli indirizzi che stampa
li legge da `configuration/*.json` e da `bootstrap.env`, non ne tiene una copia sua.

L'ordine di avvio è `anagraphics` → `sso` → `workspaces` → `preanalyst` → `front-gate`: il primo
tiene i dati, il secondo autentica, il terzo conserva i file dei progetti, il quarto li usa tutti e
tre, e il sito vetrina viene per ultimo perché è la porta d'ingresso. All'arresto si va al contrario, così nessuno resta acceso
a parlare con un servizio che non c'è più. Se un servizio non parte, ci si ferma lì: avviare
quelli dopo servirebbe solo a riempire i log di errori.

**Senza `--restart` un servizio già acceso non viene toccato**: il suo script risponde "è già in
esecuzione" e si va avanti. `--restart` serve quando si è cambiato il codice e le istanze accese
sono quelle vecchie.

Ogni servizio si avvia e si ferma **con il proprio script di controllo**, che ferma solo il
processo del file PID dopo averne verificato la riga di comando. Qui dentro non si cerca niente
per nome né per porta: su questa macchina girano altri progetti.


## Distribuire le parti comuni

Le parti comuni vivono in `webtools/commons/` e sono l'originale. Dentro i sottosistemi ci finiscono
delle **copie generate**, che non si modificano lì: si modifica l'originale e si rilancia il deployer.

```sh
webtools/configurator/deploy.sh            # tutti i sotto-deployer, nell'ordine scritto in deploy.sh
webtools/configurator/deploy.sh style      # solo lo stile
webtools/configurator/deploy.sh style sso  # solo quelli indicati
```

Un nome che non esiste fa uscire con codice 2 e stampa l'elenco di quelli disponibili.

## I sotto-deployer

| Nome | Script | Che cosa distribuisce | A chi |
|---|---|---|---|
| `style` | `style_deployer/deploy.sh` | `commons/style/commons.css` e `commons/style/fonts/` | front-gate, preanalyst, sso |
| `template` | `template_deployer/deploy.sh` | `commons/templates/*.njk`: il guscio comune delle pagine, il selettore della lingua, il loader | preanalyst, sso; front-gate solo `locale_switch.njk` |
| `script` | `script_deployer/deploy.sh` | `commons/script/*.js`, il JavaScript di **browser** comune (oggi il loader) | preanalyst, sso, front-gate (in `public/`) |
| `documents` | `documents_deployer/deploy.sh` | `configurator/documents/*.njk` e `configurator/policies/*.md`: la forma dei documenti che il sistema produce e i criteri delle decisioni | preanalyst (in `templates/commons/` e `policies/`) |
| `i18n` | `i18n_deployer/deploy.sh` | `commons/i18n/webtools_i18n.js` e **tutti** i cataloghi `commons/i18n/locales/*.json` | preanalyst, sso, front-gate (in `src/commons/i18n/`) |
| `sso` | `sso_deployer/deploy.sh` | `commons/sso/sso_client.js` (server) e `commons/sso/sso_popup.js` (browser) | preanalyst |
| `specs` | `specs_deployer/deploy.sh` | `commons/specs/spec_front_matter.js`, il front matter delle specifiche | preanalyst, webtools-workspaces (in `src/commons/`) |
| `configuration` | `configuration_deployer/deploy.sh` | `commons/configuration/configuration_client.js`, il client della configurazione | sso, webtools-workspaces, preanalyst, front-gate (in `src/commons/`) |

Il sso **non** riceve il client del sso: lui è il servizio, non un suo consumatore. Allo stesso
modo anagraphics non riceve il client della configurazione: è lui a servirla. I template comuni
invece li riceve, perché anche le sue pagine usano lo stesso guscio.

I template arrivano in `templates/commons/` e si estendono con `{% extends "commons/base.njk" %}`.

Tutti i testi delle pagine, di tutti i sottosistemi, stanno nei cataloghi di `commons/i18n/locales/`
(un file per lingua, chiavi in inglese divise per area): è l'unico posto dove si traduce o si
aggiunge una lingua. Una chiave che manca in una lingua si prende dalla lingua di riserva
(`i18n.fallback_locale`, l'inglese). La lingua scelta sta nel cookie `i18n.cookie_name`, comune a
tutti i sottosistemi.
Per controllare che ogni chiave usata esista, e vedere che cosa manca da tradurre:
`node webtools/commons/i18n/webtools_i18n_check.mjs`.

## I segreti

Le chiavi delle API sono configurazione come tutto il resto, ma `configuration/` è in git. Stanno
quindi in **`secrets/`**, che in git non c'è: un file per sottosistema, con lo stesso nome e la
stessa forma annidata del file di configurazione.

`load_configuration.sh` li **fonde in profondità** sul file di configurazione prima di scrivere il
documento in Mongo: le chiavi del segreto si affiancano a quelle della configurazione senza
cancellare i rami vicini, e il sottosistema legge una configurazione sola da
`GET /configuration/{subsystem}` senza sapere che un pezzo era segreto.

```sh
cd webtools/configurator/secrets
cp preanalyst.json.example preanalyst.json    # poi ci si mette il valore vero
cd .. && ./load_configuration.sh && ./start.sh --restart
```

In git restano soltanto il `README.md` della cartella e i file `*.example`.

## I documenti e le policy

Due cose che sembrano codice e non lo sono:

- **`documents/`** — la **forma** dei documenti che il sistema produce: oggi `prespec.md.njk`, il
  template della pre-specifica;
- **`policies/`** — i criteri delle decisioni, cioè che cosa si chiede a un modello e con quali
  regole risponde: oggi `scope-v1.md`, la policy della prevalidazione.

Dicono che cosa il sistema considera accettabile e che aspetto hanno i suoi documenti: sono
configurazione, quindi stanno qui, e nei sottosistemi ci vanno copie generate (deployer
`documents`). **Quale** policy si usa lo dice la configurazione del sottosistema
(`prevalidation.policy`), non il deployer.

Le copie delle policy portano in testa un commento HTML con l'avviso «non modificare qui»: chi le
manda a un modello toglie i commenti in testa, così l'avviso non finisce nel prompt.

Un limite di `prespec.md.njk`: è accoppiato a `preanalyst/src/prespec.js`, che gli passa le
variabili. Si può cambiare la forma del documento, non inventare campi che il codice non manda.

## Come sono fatti

Ogni sotto-deployer ha **una funzione per ogni progetto**, con le destinazioni scritte per esteso:

```sh
deploy_preanalyst() {
  local public="$WEBTOOLS/preanalyst/public"
  echo "→ preanalyst"
  cp "$SOURCE/commons.css" "$public/commons.css"
  ...
}
```

Niente cicli su un elenco di cartelle: la struttura dei progetti è diversa da progetto a progetto
(uno è un sito statico, gli altri sono server Node) e non tutti ricevono tutto. Scrivere le
destinazioni una per una costa tre righe e si legge senza dover indovinare niente.

Il deployer generale non sa che cosa fanno i sotto-deployer: sa solo quali esistono e in che
ordine girano. Per aggiungerne uno, si crea la cartella con il suo `deploy.sh` e si aggiunge una
voce alla lista `DEPLOYERS` in `deploy.sh`.

## Aggiungere un progetto che riceve una parte comune

Una funzione nuova nel sotto-deployer giusto, più la sua chiamata in fondo allo script. Poi va
aggiornata la tabella qui sopra e la documentazione del sottosistema, che deve dire quali dei suoi
file sono copie generate.
