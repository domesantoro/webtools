#!/usr/bin/env bash
# Distributes the sso client (commons/sso) to the subsystems that have a login.
# Every project has its own deploy function, with explicit targets: the projects'
# structure may differ and not all of them receive the client.
#
# The sso receives NOTHING from here: it is the service, not a consumer of it.
set -euo pipefail

WEBTOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$WEBTOOLS/commons/sso"

# preanalyst — two files, two different targets:
#   - the server client goes in src/commons/, where the server imports it;
#   - the browser script goes in public/, where the page downloads it from.
# The directories are kept apart from the rest because those files are not edited
# there: edit commons/sso and run this deployer again.
deploy_preanalyst() {
  local commons="$WEBTOOLS/preanalyst/src/commons"
  local public="$WEBTOOLS/preanalyst/public"
  echo "→ preanalyst"

  mkdir -p "$commons"
  cp "$SOURCE/sso_client.js" "$commons/sso_client.js"
  cp "$SOURCE/sso_popup.js" "$public/sso_popup.js"
}

# projects-hub — the server client only. `sso_popup.js` is not copied: these pages have
# no popup. The preanalyst opens one because a half-filled form must not be lost and
# because it replaces the fragments it had already rendered; neither holds here, where
# there is nothing on the page to lose and the whole page is rendered again anyway. So
# the hub sends the browser to the login and takes it back afterwards.
deploy_projects_hub() {
  local commons="$WEBTOOLS/projects-hub/src/commons"
  echo "→ projects-hub"

  mkdir -p "$commons"
  cp "$SOURCE/sso_client.js" "$commons/sso_client.js"
}

deploy_preanalyst
deploy_projects_hub

echo "sso client distributed."
