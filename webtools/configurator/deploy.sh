#!/usr/bin/env bash
# Deployer generale: lancia tutti i sotto-deployer, in ordine.
#
# Ogni sotto-deployer distribuisce una cosa sola (lo stile, gli script di browser, i
# documenti e le policy, il client del sso, il client della configurazione, le lingue) e
# sa da sé quali progetti la ricevono e dove va messa. Qui si dice soltanto quali
# esistono e in che ordine girano.
#
#   ./deploy.sh            lancia tutti i sotto-deployer
#   ./deploy.sh style      lancia solo quello dello stile
#   ./deploy.sh style sso  lancia quelli indicati, nell'ordine scritto qui
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# nome → script. L'ordine di questa lista è l'ordine di esecuzione.
DEPLOYERS=(
  "style:$DIR/style_deployer/deploy.sh"
  "template:$DIR/template_deployer/deploy.sh"
  "script:$DIR/script_deployer/deploy.sh"
  "documents:$DIR/documents_deployer/deploy.sh"
  "i18n:$DIR/i18n_deployer/deploy.sh"
  "sso:$DIR/sso_deployer/deploy.sh"
  "specs:$DIR/specs_deployer/deploy.sh"
  "configuration:$DIR/configuration_deployer/deploy.sh"
)

run() {
  local nome="$1" script="$2"
  if [[ ! -x "$script" ]]; then
    if [[ ! -f "$script" ]]; then
      echo "Sotto-deployer mancante: $script" >&2
      return 1
    fi
    # Il file c'è ma non è eseguibile: si lancia con bash invece di fermarsi.
    echo "== $nome (con bash: $script non è eseguibile)"
    bash "$script"
    return
  fi
  echo "== $nome"
  "$script"
}

main() {
  local richiesti=("$@")
  local eseguiti=0

  for voce in "${DEPLOYERS[@]}"; do
    local nome="${voce%%:*}" script="${voce#*:}"
    if (( ${#richiesti[@]} > 0 )); then
      local voluto=0
      for r in "${richiesti[@]}"; do
        [[ "$r" == "$nome" ]] && voluto=1
      done
      (( voluto )) || continue
    fi
    run "$nome" "$script"
    eseguiti=$(( eseguiti + 1 ))
  done

  if (( eseguiti == 0 )); then
    echo "Nessun deployer corrisponde a: ${richiesti[*]}" >&2
    echo "Disponibili: ${DEPLOYERS[*]%%:*}" >&2
    return 2
  fi
  echo "Deploy completato ($eseguiti sotto-deployer)."
}

main "$@"
