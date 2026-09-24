# Segreti

Quello che non può stare in `configuration/`, perché quella cartella è in git:
chiavi delle API, credenziali di servizi esterni.

Un file per sottosistema, con lo stesso nome del file di configurazione
(`preanalyst.json` ↔ `configuration/preanalyst.json`) e la stessa forma annidata.
`load_configuration.sh` lo **fonde in profondità** sul file di configurazione prima
di scrivere il documento in Mongo: il sottosistema legge una configurazione sola da
`GET /configuration/{subsystem}` e non sa che un pezzo era segreto.

Fondere in profondità vuol dire che il segreto aggiunge le sue chiavi senza
cancellare le altre: `ai.providers.anthropic.api_key` si affianca a
`ai.providers.anthropic.model`, non lo sostituisce.

Questa cartella è in `.gitignore`, tranne questo README e i file `*.example`.
Per partire: si copia l'esempio, si toglie `.example` dal nome e si mette il valore
vero.

    cp preanalyst.json.example preanalyst.json

Dopo averli cambiati va rilanciato `../load_configuration.sh` e riavviato chi li
usa (`../start.sh --restart`): i sottosistemi leggono la configurazione all'avvio.
