#!/usr/bin/env bash
# Distributes the general style (commons/style) to the subprojects that use it.
# Every project has its own deploy function, with explicit targets: the projects'
# structure may differ and not all of them receive the style.
set -euo pipefail

WEBTOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$WEBTOOLS/commons/style"

# front-gate — the showcase site, static pages served by a Node server. The files
# live in public/; the pages load css/commons.css, which looks for the fonts in
# css/fonts/.
deploy_front_gate() {
  local css="$WEBTOOLS/front-gate/public/css"
  echo "→ front-gate"

  cp "$SOURCE/commons.css" "$css/commons.css"
  rm -rf "$css/fonts"
  cp -R "$SOURCE/fonts" "$css/fonts"
}

# preanalyst — the preanalysis gate, a page rendered by a Node server. The static
# files live in public/, which the page loads from the root: commons.css and
# fonts/ land there next to styles.css, the local style.
deploy_preanalyst() {
  local public="$WEBTOOLS/preanalyst/public"
  echo "→ preanalyst"

  cp "$SOURCE/commons.css" "$public/commons.css"
  rm -rf "$public/fonts"
  cp -R "$SOURCE/fonts" "$public/fonts"
}

# sso — the login and registration pages, rendered by a Node server. Same
# structure as the preanalyst: the static files live in public/.
deploy_sso() {
  local public="$WEBTOOLS/sso/public"
  echo "→ sso"

  cp "$SOURCE/commons.css" "$public/commons.css"
  rm -rf "$public/fonts"
  cp -R "$SOURCE/fonts" "$public/fonts"
}

deploy_front_gate
deploy_preanalyst
deploy_sso

echo "Style distributed."
