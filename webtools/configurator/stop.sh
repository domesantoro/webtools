#!/usr/bin/env bash
# Ferma tutto il sistema, in ordine inverso rispetto a start.sh.
#
#   ./stop.sh
#
# Prima il sito vetrina, per ultimo anagraphics: nessuno resta acceso a parlare
# con un servizio che non c'è più.
#
# Ogni servizio si ferma **con il proprio script di controllo**, che usa il file
# PID e verifica la riga di comando prima di fermare qualcosa. Qui non si cerca
# niente per nome né per porta: su questa macchina girano altri progetti. Un
# servizio già spento non è un errore: il suo script lo dice e si va avanti.
#
# Se uno script non riesce a fermare il suo servizio si prosegue con gli altri,
# e alla fine lo script esce con 1.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBTOOLS="$(cd "$DIR/.." && pwd)"

# nome : script di controllo, nell'ordine di arresto (l'inverso di start.sh).
SERVICES=(
  "front-gate:$WEBTOOLS/front-gate/webtools_front_gate.sh"
  "preanalyst:$WEBTOOLS/preanalyst/webtools_preanalyst.sh"
  "workspaces:$WEBTOOLS/webtools-workspaces/webtools_workspaces.sh"
  "sso:$WEBTOOLS/sso/webtools_sso.sh"
  "anagraphics:$WEBTOOLS/anagraphics/webtools_anagraphics.sh"
)

(( $# == 0 )) || { echo "Uso: $0" >&2; exit 2; }

falliti=()
for voce in "${SERVICES[@]}"; do
  nome="${voce%%:*}"
  script="${voce#*:}"
  echo "-- $nome"
  if ! "$script" --stop; then
    falliti+=("$nome")
  fi
done

echo
if (( ${#falliti[@]} > 0 )); then
  echo "Non fermati: ${falliti[*]}" >&2
  exit 1
fi
echo "Sistema fermato."
