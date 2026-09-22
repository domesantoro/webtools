#!/usr/bin/env bash
# Diffonde le lingue (commons/i18n) nei sottosistemi che rendono pagine: il
# modulo webtools_i18n.js e **tutti** i cataloghi di locales/, sempre insieme.
# Ogni progetto ha la sua funzione di deploy, con destinazioni esplicite.
#
# Tutto arriva in `src/commons/i18n/` del sottosistema, accanto a
# configuration_client.js che il modulo importa. Quei file non si modificano lì:
# si modifica commons/i18n e si rilancia questo deployer.
#
# I cataloghi si ricopiano da zero, così una lingua tolta dall'originale sparisce
# anche dalle copie.
set -euo pipefail

WEBTOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$WEBTOOLS/commons/i18n"

copia_in() {
  local destinazione="$1"
  mkdir -p "$destinazione"
  cp "$SOURCE/webtools_i18n.js" "$destinazione/webtools_i18n.js"
  rm -rf "$destinazione/locales"
  cp -R "$SOURCE/locales" "$destinazione/locales"
}

# preanalyst — la pagina della pre-analisi.
deploy_preanalyst() {
  echo "→ preanalyst"
  copia_in "$WEBTOOLS/preanalyst/src/commons/i18n"
}

# sso — le pagine di login e registrazione.
deploy_sso() {
  echo "→ sso"
  copia_in "$WEBTOOLS/sso/src/commons/i18n"
}

# front-gate — il sito vetrina.
deploy_front_gate() {
  echo "→ front-gate"
  copia_in "$WEBTOOLS/front-gate/src/commons/i18n"
}

deploy_preanalyst
deploy_sso
deploy_front_gate

echo "Lingue distribuite."
