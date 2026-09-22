#!/usr/bin/env bash
# Avvia tutto il sistema, nell'ordine giusto.
#
#   ./start.sh             avvia i servizi che non sono già in esecuzione
#   ./start.sh --restart   ferma prima quelli accesi, poi riavvia tutto
#
# L'ordine conta: anagraphics tiene i dati e gli altri lo interrogano, il sso
# autentica, workspaces conserva i file, preanalyst usa tutti e tre, e il sito
# vetrina (front-gate) viene per ultimo perché è la porta d'ingresso. All'arresto si va al contrario, così nessuno
# resta acceso a parlare con un servizio che non c'è più.
#
# Ogni servizio si avvia e si ferma **con il proprio script di controllo**, che
# usa il file PID e verifica la riga di comando prima di fermare qualcosa. Qui
# non si cerca niente per nome né per porta: su questa macchina girano altri
# progetti.
#
# Senza --restart, un servizio già acceso viene lasciato dov'è: il suo script
# risponde "è già in esecuzione" e si va avanti. Non si tocca un'istanza che sta
# lavorando solo perché è stato lanciato questo comando.
#
# Prima di avviare si carica la configurazione (load_configuration.sh): i
# servizi la leggono da anagraphics all'avvio, e senza non partono. Un servizio
# già acceso continua con la configurazione che ha letto quando è partito.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBTOOLS="$(cd "$DIR/.." && pwd)"

# nome : script di controllo. L'ordine è quello di avvio. Il nome è anche quello
# del file in configuration/ (anagraphics a parte: il suo indirizzo sta in
# bootstrap.env).
SERVICES=(
  "anagraphics:$WEBTOOLS/anagraphics/webtools_anagraphics.sh"
  "sso:$WEBTOOLS/sso/webtools_sso.sh"
  "workspaces:$WEBTOOLS/webtools-workspaces/webtools_workspaces.sh"
  "preanalyst:$WEBTOOLS/preanalyst/webtools_preanalyst.sh"
  "front-gate:$WEBTOOLS/front-gate/webtools_front_gate.sh"
)

usage() {
  echo "Uso: $0 [--restart]" >&2
  exit 2
}

restart=0
case "${1:-}" in
  "") ;;
  --restart) restart=1 ;;
  *) usage ;;
esac
(( $# <= 1 )) || usage

campo() { cut -d: -f"$1" <<< "$2"; }

# L'indirizzo di un servizio, solo da mostrare: si legge da dove sta davvero,
# così non ce n'è una seconda copia qui.
indirizzo() {
  if [[ "$1" == "anagraphics" ]]; then
    (set -a; source "$DIR/bootstrap.env"; echo "$WEBTOOLS_ANAGRAPHICS_URL")
    return
  fi
  python3 -c 'import json, sys; l = json.load(open(sys.argv[1]))["listen"]; print("http://%s:%s" % (l["host"], l["port"]))' \
    "$DIR/configuration/$1.json" 2>/dev/null || echo "?"
}

# La configurazione sta in Mongo: se Mongo non risponde, non si carica e nessun
# servizio parte. Meglio fermarsi qui con un messaggio chiaro.
carica_configurazione() {
  echo "== configurazione"
  if ! "$DIR/load_configuration.sh"; then
    echo "!! Configurazione non caricata: nessun servizio avviato." >&2
    echo "   Se MongoDB è spento: brew services start mongodb-community" >&2
    exit 1
  fi
  echo
}

ferma_tutto() {
  echo "== arresto (ordine inverso)"
  for (( i = ${#SERVICES[@]} - 1; i >= 0; i-- )); do
    local voce="${SERVICES[$i]}"
    local nome script
    nome="$(campo 1 "$voce")"
    script="$(campo 2 "$voce")"
    echo "-- $nome"
    "$script" --stop
  done
  echo
}

avvia_tutto() {
  echo "== avvio"
  for voce in "${SERVICES[@]}"; do
    local nome script
    nome="$(campo 1 "$voce")"
    script="$(campo 2 "$voce")"
    echo "-- $nome ($(indirizzo "$nome"))"
    # Se un servizio non parte ci si ferma qui: avviare quelli dopo, che
    # dipendono da lui, servirebbe solo a moltiplicare gli errori nei log.
    "$script" --start
  done
}

carica_configurazione
# Non `(( restart )) && ferma_tutto`: con restart=0 quella riga vale "falso" e
# con `set -e` chiuderebbe lo script senza avviare niente.
if (( restart )); then
  ferma_tutto
fi
avvia_tutto

echo
echo "Sistema avviato."
for voce in "${SERVICES[@]}"; do
  echo "  $(campo 1 "$voce"): $(indirizzo "$(campo 1 "$voce")")"
done
