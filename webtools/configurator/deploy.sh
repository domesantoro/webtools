#!/usr/bin/env bash
# The general deployer: it runs every sub-deployer, in order.
#
# Each sub-deployer distributes one thing (the style, the browser scripts, the
# documents and the policies, the sso client, the configuration client, the
# languages) and knows by itself which projects receive it and where it goes. Here
# we only say which ones exist and in what order they run.
#
#   ./deploy.sh            runs every sub-deployer
#   ./deploy.sh style      runs only the style one
#   ./deploy.sh style sso  runs the ones named, in the order written here
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# name → script. The order of this list is the order of execution.
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
  local name="$1" script="$2"
  if [[ ! -x "$script" ]]; then
    if [[ ! -f "$script" ]]; then
      echo "Sub-deployer missing: $script" >&2
      return 1
    fi
    # The file is there but not executable: run it with bash instead of stopping.
    echo "== $name (with bash: $script is not executable)"
    bash "$script"
    return
  fi
  echo "== $name"
  "$script"
}

main() {
  local requested=("$@")
  local done_count=0

  for entry in "${DEPLOYERS[@]}"; do
    local name="${entry%%:*}" script="${entry#*:}"
    if (( ${#requested[@]} > 0 )); then
      local wanted=0
      for r in "${requested[@]}"; do
        [[ "$r" == "$name" ]] && wanted=1
      done
      (( wanted )) || continue
    fi
    run "$name" "$script"
    done_count=$(( done_count + 1 ))
  done

  if (( done_count == 0 )); then
    echo "No deployer matches: ${requested[*]}" >&2
    echo "Available: ${DEPLOYERS[*]%%:*}" >&2
    return 2
  fi
  echo "Deploy done ($done_count sub-deployers)."
}

main "$@"
