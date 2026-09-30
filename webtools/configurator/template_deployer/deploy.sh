#!/usr/bin/env bash
# Distributes the shared templates (commons/templates) to the subsystems that render pages.
# Every project has its own deploy function, with explicit targets.
#
# The templates land in the subsystem's `templates/commons/`, which extends them
# with `{% extends "commons/base.njk" %}`. The directory is kept apart from the
# local templates because those files are not edited there: edit commons/templates
# and run this deployer again.
#
# front-gate has a shell of its own (templates/layout.njk) and uses only
# `locale_switch.njk` from here, the footer's language switcher.
set -euo pipefail

WEBTOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$WEBTOOLS/commons/templates"

copy_into() {
  local target="$1"
  mkdir -p "$target"
  # Every .njk is copied: the shared ones are few and all of them are needed by whoever renders pages.
  cp "$SOURCE"/*.njk "$target/"
}

# preanalyst — the pre-analysis page.
deploy_preanalyst() {
  echo "→ preanalyst"
  copy_into "$WEBTOOLS/preanalyst/templates/commons"
}

# sso — the login and registration pages.
deploy_sso() {
  echo "→ sso"
  copy_into "$WEBTOOLS/sso/templates/commons"
}

# front-gate — the showcase site: the language switcher only.
deploy_front_gate() {
  echo "→ front-gate"
  mkdir -p "$WEBTOOLS/front-gate/templates/commons"
  cp "$SOURCE/locale_switch.njk" "$WEBTOOLS/front-gate/templates/commons/locale_switch.njk"
}

# projects-hub — the lists of projects. The shell and the language switcher, and not
# `loader.njk`: nothing on these pages is slow enough to need a spinner, and a file
# copied in and never included is one more thing that looks used.
deploy_projects_hub() {
  echo "→ projects-hub"
  local target="$WEBTOOLS/projects-hub/templates/commons"
  mkdir -p "$target"
  cp "$SOURCE/base.njk" "$target/base.njk"
  cp "$SOURCE/locale_switch.njk" "$target/locale_switch.njk"
}

deploy_preanalyst
deploy_sso
deploy_front_gate
deploy_projects_hub

echo "Shared templates distributed."
