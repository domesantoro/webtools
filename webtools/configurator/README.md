# configurator — avvio e deployer

Qui stanno i programmi che **avviano il sistema** e che **distribuiscono le parti comuni** dentro
i sottosistemi che le usano.

## Avviare tutto

```sh
webtools/configurator/start.sh             # avvia quello che non è già acceso
webtools/configurator/start.sh --restart   # ferma prima quelli accesi, poi riavvia tutto
```

L'ordine di avvio è `anagraphics` → `sso` → `preanalyst`: il primo tiene i dati, il secondo
autentica, il terzo li usa tutti e due. All'arresto si va al contrario, così nessuno resta acceso
a parlare con un servizio che non c'è più. Se un servizio non parte, ci si ferma lì: avviare
quelli dopo servirebbe solo a riempire i log di errori.

**Senza `--restart` un servizio già acceso non viene toccato**: il suo script risponde "è già in
esecuzione" e si va avanti. `--restart` serve quando si è cambiato il codice e le istanze accese
sono quelle vecchie.

Ogni servizio si avvia e si ferma **con il proprio script di controllo**, che ferma solo il
processo del file PID dopo averne verificato la riga di comando. Qui dentro non si cerca niente
per nome né per porta: su questa macchina girano altri progetti.

Prima dell'avvio si controlla che MongoDB risponda: se non risponde, lo script lo dice e prosegue
— anagraphics parte comunque, ma risponderà `503`.

Il sito vetrina `front-gate` non compare: è statico, non ha un processo.

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
| `template` | `template_deployer/deploy.sh` | `commons/templates/*.njk`, il guscio comune delle pagine | preanalyst, sso |
| `sso` | `sso_deployer/deploy.sh` | `commons/sso/sso_client.js` (server) e `commons/sso/sso_popup.js` (browser) | preanalyst |

Il sso **non** riceve il client: lui è il servizio, non un suo consumatore. I template comuni
invece li riceve, perché anche le sue pagine usano lo stesso guscio.

I template arrivano in `templates/commons/` e si estendono con `{% extends "commons/base.njk" %}`.

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
