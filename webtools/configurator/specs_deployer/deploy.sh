#!/usr/bin/env bash
# Diffonde il modulo del front matter delle specifiche (commons/specs) nei
# sottosistemi che leggono o scrivono specifiche. Ogni progetto ha la sua
# funzione di deploy, con destinazioni esplicite.
set -euo pipefail

WEBTOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$WEBTOOLS/commons/specs"

# preanalyst — legge il project_id dalle specifiche caricate.
deploy_preanalyst() {
  local commons="$WEBTOOLS/preanalyst/src/commons"
  echo "→ preanalyst"

  mkdir -p "$commons"
  cp "$SOURCE/spec_front_matter.js" "$commons/spec_front_matter.js"
}

# webtools-workspaces — timbra la chiave riservata prima di conservare il file.
deploy_workspaces() {
  local commons="$WEBTOOLS/webtools-workspaces/src/commons"
  echo "→ webtools-workspaces"

  mkdir -p "$commons"
  cp "$SOURCE/spec_front_matter.js" "$commons/spec_front_matter.js"
}

deploy_preanalyst
deploy_workspaces

echo "Modulo delle specifiche distribuito."
