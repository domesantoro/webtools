#!/usr/bin/env bash
# Distributes the languages (commons/i18n) to the subsystems that write something a
# person reads: the module and **every** catalogue in locales/, always together.
# Every project has its own deploy function, with explicit targets.
#
# There are two modules, one per language, and neither is generated from the other:
# `webtools_i18n.js` for the Node subsystems, which render pages, and
# `webtools_i18n.py` for the Python ones, which today render documents. They share
# the catalogues and nothing else — a page asks which language a request is in and
# how to escape a value into HTML, a document asks neither.
#
# A Node subsystem gets its copy in `src/commons/i18n/`, next to
# configuration_client.js which the module imports; a Python one in
# `<package>/commons/i18n/`, with the `__init__.py` that makes it importable, one
# directory below the configuration client it imports. Those files are not edited
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
  copy_catalogues "$target"
}

copy_into_python() {
  local target="$1"
  mkdir -p "$target"
  cp "$SOURCE/webtools_i18n.py" "$target/webtools_i18n.py"
  printf '%s\n' '"""Generated copies. The originals are in webtools/commons/."""' > "$target/__init__.py"
  copy_catalogues "$target"
}

copy_catalogues() {
  local target="$1"
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

# analyst — the proposal, the one document the client reads, in their language.
deploy_analyst() {
  echo "→ analyst"
  copy_into_python "$WEBTOOLS/analyst/webtools_analyst/commons/i18n"
}

deploy_preanalyst
deploy_sso
deploy_front_gate
deploy_analyst

echo "Languages distributed."
