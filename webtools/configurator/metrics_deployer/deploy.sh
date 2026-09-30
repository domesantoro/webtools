#!/usr/bin/env bash
# Distributes the metrics client (commons/metrics) to the subsystems, which use it
# to send measurements to webtools_metrics. Every project has its own deploy
# function, with explicit targets.
#
# There are two clients, one per language, and neither is generated from the other:
# `webtools_metrics_client.js` for the Node subsystems and
# `webtools_metrics_client.py` for the Python ones. The JavaScript one could not
# have been copied across in any case — what it relies on in order not to wait, a
# promise the runtime carries by itself, has no equivalent in a synchronous Python
# call. A Python subsystem gets its copy under `<package>/commons/`, beside the
# configuration client, and reads one configuration field more than the Node ones:
# `metrics.pending_max`, the bound on the measurements still in hand.
#
# Metrics itself receives NOTHING from here: it is the one being measured into, and
# it does not measure itself through its own HTTP API — the one thing it counts about
# itself, the measurements it refuses, it folds straight into its own collection.
#
# Anagraphics takes the Python client like any other Python subsystem, but **without
# the configuration client beside it**: it reads its own configuration straight from
# MongoDB and receives no copy of that one, so it builds the metrics client itself
# from the fields rather than through `load_metrics`. That is why `load_metrics`
# imports the configuration client inside the function and not at the top of the
# file.
set -euo pipefail

WEBTOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$WEBTOOLS/commons/metrics"

deploy_sso() {
  local commons="$WEBTOOLS/sso/src/commons"
  echo "→ sso"

  mkdir -p "$commons/metrics"
  cp "$SOURCE/webtools_metrics_client.js" "$commons/metrics/webtools_metrics_client.js"
}

deploy_workspaces() {
  local commons="$WEBTOOLS/webtools-workspaces/src/commons"
  echo "→ webtools-workspaces"

  mkdir -p "$commons/metrics"
  cp "$SOURCE/webtools_metrics_client.js" "$commons/metrics/webtools_metrics_client.js"
}

deploy_preanalyst() {
  local commons="$WEBTOOLS/preanalyst/src/commons"
  echo "→ preanalyst"

  mkdir -p "$commons/metrics"
  cp "$SOURCE/webtools_metrics_client.js" "$commons/metrics/webtools_metrics_client.js"
}

deploy_front_gate() {
  local commons="$WEBTOOLS/front-gate/src/commons"
  echo "→ front-gate"

  mkdir -p "$commons/metrics"
  cp "$SOURCE/webtools_metrics_client.js" "$commons/metrics/webtools_metrics_client.js"
}

deploy_configurator_fe() {
  local commons="$WEBTOOLS/configurator-fe/src/commons"
  echo "→ configurator-fe"

  mkdir -p "$commons/metrics"
  cp "$SOURCE/webtools_metrics_client.js" "$commons/metrics/webtools_metrics_client.js"
}

# Python subsystems. The copy goes inside the package, under `commons/`, beside
# the configuration client its import reaches for.
deploy_analyst() {
  local commons="$WEBTOOLS/analyst/webtools_analyst/commons"
  echo "→ analyst"

  mkdir -p "$commons"
  cp "$SOURCE/webtools_metrics_client.py" "$commons/webtools_metrics_client.py"
}

deploy_sso
deploy_workspaces
deploy_preanalyst
deploy_front_gate
deploy_configurator_fe
deploy_drivers_pool() {
  local commons="$WEBTOOLS/drivers-pool/webtools_drivers_pool/commons"
  echo "→ drivers-pool"

  mkdir -p "$commons"
  cp "$SOURCE/webtools_metrics_client.py" "$commons/webtools_metrics_client.py"
}

deploy_comm_center() {
  local commons="$WEBTOOLS/comm-center/webtools_comm_center/commons"
  echo "→ comm-center"

  mkdir -p "$commons"
  cp "$SOURCE/webtools_metrics_client.py" "$commons/webtools_metrics_client.py"
}

# The only subsystem whose `commons/` this deployer creates on its own: the
# configuration deployer, which writes that `__init__.py` everywhere else, does not
# come here.
deploy_anagraphics() {
  local commons="$WEBTOOLS/anagraphics/webtools_anagraphics/commons"
  echo "→ anagraphics"

  mkdir -p "$commons"
  printf '%s\n' '"""Generated copies. The originals are in webtools/commons/."""' > "$commons/__init__.py"
  cp "$SOURCE/webtools_metrics_client.py" "$commons/webtools_metrics_client.py"
}

deploy_projects_hub() {
  local commons="$WEBTOOLS/projects-hub/src/commons"
  echo "→ projects-hub"

  mkdir -p "$commons/metrics"
  cp "$SOURCE/webtools_metrics_client.js" "$commons/metrics/webtools_metrics_client.js"
}

deploy_analyst
deploy_drivers_pool
deploy_comm_center
deploy_anagraphics
deploy_projects_hub

echo "Metrics client distributed."
