#!/usr/bin/env bash
# Diffonde il client della configurazione (commons/configuration) nei
# sottosistemi Node, che lo usano all'avvio per leggere la propria
# configurazione da anagraphics. Ogni progetto ha la sua funzione di deploy,
# con destinazioni esplicite.
#
# Anagraphics NON riceve niente da qui: è lui a servire la configurazione, e la
# propria la legge direttamente da MongoDB.
set -euo pipefail

WEBTOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$WEBTOOLS/commons/configuration"

deploy_sso() {
  local commons="$WEBTOOLS/sso/src/commons"
  echo "→ sso"

  mkdir -p "$commons"
  cp "$SOURCE/configuration_client.js" "$commons/configuration_client.js"
}

deploy_workspaces() {
  local commons="$WEBTOOLS/webtools-workspaces/src/commons"
  echo "→ webtools-workspaces"

  mkdir -p "$commons"
  cp "$SOURCE/configuration_client.js" "$commons/configuration_client.js"
}

deploy_preanalyst() {
  local commons="$WEBTOOLS/preanalyst/src/commons"
  echo "→ preanalyst"

  mkdir -p "$commons"
  cp "$SOURCE/configuration_client.js" "$commons/configuration_client.js"
}

deploy_front_gate() {
  local commons="$WEBTOOLS/front-gate/src/commons"
  echo "→ front-gate"

  mkdir -p "$commons"
  cp "$SOURCE/configuration_client.js" "$commons/configuration_client.js"
}

deploy_sso
deploy_workspaces
deploy_preanalyst
deploy_front_gate

echo "Client della configurazione distribuito."
