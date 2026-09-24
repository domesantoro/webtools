#!/usr/bin/env bash
# Distributes the languages (commons/i18n) to the subsystems that render pages:
# the webtools_i18n.js module and **every** catalogue in locales/, always together.
# Every project has its own deploy function, with explicit targets.
#
# Everything lands in the subsystem's `src/commons/i18n/`, next to
# configuration_client.js which the module imports. Those files are not edited
# there: edit commons/i18n and run this deployer again.
#
# The catalogues are copied from scratch, so a language removed from the original
# disappears from the copies too.
set -euo pipefail

WEBTOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$WEBTOOLS/commons/i18n"

copy_into() {
  local target="$1"
  mkdir -p "$target"
  cp "$SOURCE/webtools_i18n.js" "$target/webtools_i18n.js"
  rm -rf "$target/locales"
  cp -R "$SOURCE/locales" "$target/locales"
}

# preanalyst — the pre-analysis page.
deploy_preanalyst() {
  echo "→ preanalyst"
  copy_into "$WEBTOOLS/preanalyst/src/commons/i18n"
}

# sso — the login and registration pages.
deploy_sso() {
  echo "→ sso"
  copy_into "$WEBTOOLS/sso/src/commons/i18n"
}

# front-gate — the showcase site.
deploy_front_gate() {
  echo "→ front-gate"
  copy_into "$WEBTOOLS/front-gate/src/commons/i18n"
}

deploy_preanalyst
deploy_sso
deploy_front_gate

echo "Languages distributed."
