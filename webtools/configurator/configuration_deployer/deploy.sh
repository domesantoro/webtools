#!/usr/bin/env bash
# Distributes the configuration client (commons/configuration) to the Node
# subsystems, which use it at startup to read their own configuration from
# anagraphics. Every project has its own deploy function, with explicit targets.
#
# Anagraphics receives NOTHING from here: it is the one serving the configuration,
# and it reads its own straight from MongoDB.
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

deploy_configurator_fe() {
  local commons="$WEBTOOLS/configurator-fe/src/commons"
  echo "→ configurator-fe"

  mkdir -p "$commons"
  cp "$SOURCE/configuration_client.js" "$commons/configuration_client.js"
}

deploy_sso
deploy_workspaces
deploy_preanalyst
deploy_front_gate
deploy_configurator_fe

echo "Configuration client distributed."
