#!/usr/bin/env bash
# Diffonde i template comuni (commons/templates) nei sottosistemi che rendono pagine.
# Ogni progetto ha la sua funzione di deploy, con destinazioni esplicite.
#
# I template arrivano in `templates/commons/` del sottosistema, che li estende con
# `{% extends "commons/base.njk" %}`. La cartella è separata dai template locali
# perché quei file non si modificano lì: si modifica commons/templates e si
# rilancia questo deployer.
#
# front-gate ha un guscio suo (templates/layout.njk) e usa di qui solo
# `locale_switch.njk`, il selettore della lingua del piè di pagina.
set -euo pipefail

WEBTOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$WEBTOOLS/commons/templates"

copia_in() {
  local destinazione="$1"
  mkdir -p "$destinazione"
  # Si copiano tutti i .njk: quelli comuni sono pochi e servono tutti a chi rende pagine.
  cp "$SOURCE"/*.njk "$destinazione/"
}

# preanalyst — la pagina della pre-analisi.
deploy_preanalyst() {
  echo "→ preanalyst"
  copia_in "$WEBTOOLS/preanalyst/templates/commons"
}

# sso — le pagine di login e registrazione.
deploy_sso() {
  echo "→ sso"
  copia_in "$WEBTOOLS/sso/templates/commons"
}

# front-gate — il sito vetrina: solo il selettore della lingua.
deploy_front_gate() {
  echo "→ front-gate"
  mkdir -p "$WEBTOOLS/front-gate/templates/commons"
  cp "$SOURCE/locale_switch.njk" "$WEBTOOLS/front-gate/templates/commons/locale_switch.njk"
}

deploy_preanalyst
deploy_sso
deploy_front_gate

echo "Template comuni distribuiti."
