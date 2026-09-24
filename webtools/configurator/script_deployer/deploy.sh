#!/usr/bin/env bash
# Distributes the shared browser JavaScript (commons/script) to the subsystems
# that render pages. Every project has its own deploy function, with explicit
# targets: the projects' structure may differ and not all of them use it.
#
# The files land among the subsystem's static files, next to commons.css, and the
# page loads them from the root (`/webtools_loader.js`). The copies are not edited
# there: edit commons/script and run this deployer again.
set -euo pipefail

WEBTOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$WEBTOOLS/commons/script"

copy_into() {
  local target="$1"
  mkdir -p "$target"
  # Every .js is copied: the shared ones are few and all of them are needed by whoever renders pages.
  cp "$SOURCE"/*.js "$target/"
}

# preanalyst — the loader on the form submission.
deploy_preanalyst() {
  echo "→ preanalyst"
  copy_into "$WEBTOOLS/preanalyst/public"
}

# sso — the login and registration pages.
deploy_sso() {
  echo "→ sso"
  copy_into "$WEBTOOLS/sso/public"
}

# front-gate — the showcase site.
deploy_front_gate() {
  echo "→ front-gate"
  copy_into "$WEBTOOLS/front-gate/public"
}

deploy_preanalyst
deploy_sso
deploy_front_gate

echo "Shared scripts distributed."
