#!/usr/bin/env bash
# Distributes the configuration client (commons/configuration) to the subsystems,
# which use it at startup to read their own configuration from anagraphics. Every
# project has its own deploy function, with explicit targets.
#
# There are two clients, one per language, and they are not generated from each
# other: `configuration_client.js` for the Node subsystems and
# `configuration_client.py` for the Python ones. A Python subsystem gets its copy
# under `<package>/commons/`, with the `__init__.py` that makes it importable —
# that file is part of the copy and is written here, not kept by hand.
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

deploy_metrics_fe() {
  local commons="$WEBTOOLS/metrics-fe/src/commons"
  echo "→ metrics-fe"

  mkdir -p "$commons"
  cp "$SOURCE/configuration_client.js" "$commons/configuration_client.js"
}

# Python subsystems. The copy goes inside the package, under `commons/`.
deploy_metrics() {
  local commons="$WEBTOOLS/metrics/webtools_metrics/commons"
  echo "→ metrics"

  mkdir -p "$commons"
  printf '%s\n' '"""Generated copies. The originals are in webtools/commons/."""' > "$commons/__init__.py"
  cp "$SOURCE/configuration_client.py" "$commons/configuration_client.py"
}

deploy_analyst() {
  local commons="$WEBTOOLS/analyst/webtools_analyst/commons"
  echo "→ analyst"

  mkdir -p "$commons"
  printf '%s\n' '"""Generated copies. The originals are in webtools/commons/."""' > "$commons/__init__.py"
  cp "$SOURCE/configuration_client.py" "$commons/configuration_client.py"
}

deploy_sso
deploy_workspaces
deploy_preanalyst
deploy_front_gate
deploy_configurator_fe
deploy_metrics_fe
deploy_metrics
deploy_drivers_pool() {
  local commons="$WEBTOOLS/drivers-pool/webtools_drivers_pool/commons"
  echo "→ drivers-pool"

  mkdir -p "$commons"
  printf '%s\n' '"""Generated copies. The originals are in webtools/commons/."""' > "$commons/__init__.py"
  cp "$SOURCE/configuration_client.py" "$commons/configuration_client.py"
}

deploy_comm_center() {
  local commons="$WEBTOOLS/comm-center/webtools_comm_center/commons"
  echo "→ comm-center"

  mkdir -p "$commons"
  printf '%s\n' '"""Generated copies. The originals are in webtools/commons/."""' > "$commons/__init__.py"
  cp "$SOURCE/configuration_client.py" "$commons/configuration_client.py"
}

deploy_projects_hub() {
  local commons="$WEBTOOLS/projects-hub/src/commons"
  echo "→ projects-hub"

  mkdir -p "$commons"
  cp "$SOURCE/configuration_client.js" "$commons/configuration_client.js"
}

deploy_developer() {
  local commons="$WEBTOOLS/developer/webtools_developer/commons"
  echo "→ developer"

  mkdir -p "$commons"
  printf '%s\n' '"""Generated copies. The originals are in webtools/commons/."""' > "$commons/__init__.py"
  cp "$SOURCE/configuration_client.py" "$commons/configuration_client.py"
}

deploy_analyst
deploy_drivers_pool
deploy_comm_center
deploy_projects_hub
deploy_developer

echo "Configuration client distributed."
