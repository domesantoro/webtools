#!/usr/bin/env bash
# Avvia tutto il sistema, nell'ordine giusto.
#
#   ./start.sh             avvia i servizi che non sono già in esecuzione
#   ./start.sh --restart   ferma prima quelli accesi, poi riavvia tutto
#
# L'ordine conta: anagraphics tiene i dati e gli altri due lo interrogano, il sso
# autentica e preanalyst lo usa. All'arresto si va al contrario, così nessuno
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
# Il sito vetrina (front-gate) non compare: è statico, non ha un processo.
set -euo pipefail

WEBTOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# nome : script di controllo : indirizzo. L'ordine è quello di avvio.
SERVICES=(
  "anagraphics:$WEBTOOLS/anagraphics/webtools_anagraphics.sh:http://127.0.0.1:8100"
  "sso:$WEBTOOLS/sso/webtools_sso.sh:http://127.0.0.1:8300"
  "preanalyst:$WEBTOOLS/preanalyst/webtools_preanalyst.sh:http://127.0.0.1:8200"
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

# Mongo serve ad anagraphics. Se non risponde, il sistema si avvia lo stesso e
# risponde 503: meglio dirlo adesso che far cercare il guasto dopo.
controlla_mongo() {
  command -v mongosh >/dev/null 2>&1 || return 0
  if ! mongosh --quiet --eval 'db.runCommand({ping:1})' >/dev/null 2>&1; then
    echo "!! MongoDB non risponde: anagraphics si avvia ma risponderà 503." >&2
    echo "   brew services start mongodb-community" >&2
  fi
}

ferma_tutto() {
  echo "== arresto (ordine inverso)"
  for (( i = ${#SERVICES[@]} - 1; i >= 0; i-- )); do
    local voce="${SERVICES[$i]}"
    local nome script
    nome="$(campo 1 "$voce")"
    script="$(cut -d: -f2 <<< "$voce")"
    echo "-- $nome"
    "$script" --stop
  done
  echo
}

avvia_tutto() {
  echo "== avvio"
  for voce in "${SERVICES[@]}"; do
    local nome script indirizzo
    nome="$(campo 1 "$voce")"
    script="$(cut -d: -f2 <<< "$voce")"
    indirizzo="$(cut -d: -f3- <<< "$voce")"
    echo "-- $nome ($indirizzo)"
    # Se un servizio non parte ci si ferma qui: avviare quelli dopo, che
    # dipendono da lui, servirebbe solo a moltiplicare gli errori nei log.
    "$script" --start
  done
}

controlla_mongo
# Non `(( restart )) && ferma_tutto`: con restart=0 quella riga vale "falso" e
# con `set -e` chiuderebbe lo script senza avviare niente.
if (( restart )); then
  ferma_tutto
fi
avvia_tutto

echo
echo "Sistema avviato."
for voce in "${SERVICES[@]}"; do
  echo "  $(campo 1 "$voce"): $(cut -d: -f3- <<< "$voce")"
done
