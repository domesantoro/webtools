#!/usr/bin/env bash
# Distributes the specifications' front matter module (commons/specs) to the
# subsystems that read or write specifications. Every project has its own deploy
# function, with explicit targets.
set -euo pipefail

WEBTOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$WEBTOOLS/commons/specs"

# preanalyst — reads the project_id from uploaded specifications.
deploy_preanalyst() {
  local commons="$WEBTOOLS/preanalyst/src/commons"
  echo "→ preanalyst"

  mkdir -p "$commons"
  cp "$SOURCE/spec_front_matter.js" "$commons/spec_front_matter.js"
}

# webtools-workspaces — stamps the reserved key before storing the file.
deploy_workspaces() {
  local commons="$WEBTOOLS/webtools-workspaces/src/commons"
  echo "→ webtools-workspaces"

  mkdir -p "$commons"
  cp "$SOURCE/spec_front_matter.js" "$commons/spec_front_matter.js"
}

deploy_preanalyst
deploy_workspaces

echo "Specifications module distributed."
