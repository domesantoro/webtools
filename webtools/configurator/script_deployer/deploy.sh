#!/usr/bin/env bash
# Diffonde il JavaScript di browser comune (commons/script) nei sottosistemi che
# rende pagine. Ogni progetto ha la sua funzione di deploy, con destinazioni
# esplicite: la struttura dei progetti può essere diversa e non tutti lo usano.
#
# I file finiscono fra i file statici del sottosistema, accanto a commons.css, e
# la pagina li carica dalla radice (`/webtools_loader.js`). Le copie non si
# modificano lì: si modifica commons/script e si rilancia questo deployer.
set -euo pipefail

WEBTOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$WEBTOOLS/commons/script"

copia_in() {
  local destinazione="$1"
  mkdir -p "$destinazione"
  # Si copiano tutti i .js: quelli comuni sono pochi e servono tutti a chi rende pagine.
  cp "$SOURCE"/*.js "$destinazione/"
}

# preanalyst — il loader sull'invio del form.
deploy_preanalyst() {
  echo "→ preanalyst"
  copia_in "$WEBTOOLS/preanalyst/public"
}

# sso — le pagine di login e registrazione.
deploy_sso() {
  echo "→ sso"
  copia_in "$WEBTOOLS/sso/public"
}

# front-gate — il sito vetrina.
deploy_front_gate() {
  echo "→ front-gate"
  copia_in "$WEBTOOLS/front-gate/public"
}

deploy_preanalyst
deploy_sso
deploy_front_gate

echo "Script comuni distribuiti."
