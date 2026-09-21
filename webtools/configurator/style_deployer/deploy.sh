#!/usr/bin/env bash
# Diffonde lo stile generale (commons/style) nei sotto progetti che lo usano.
# Ogni progetto ha la sua funzione di deploy, con destinazioni esplicite:
# la struttura dei progetti può essere diversa e non tutti ricevono lo stile.
set -euo pipefail

WEBTOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$WEBTOOLS/commons/style"

# front-gate — sito vetrina statico.
# Le pagine caricano css/commons.css, che cerca i font in css/fonts/.
deploy_front_gate() {
  local css="$WEBTOOLS/front-gate/css"
  echo "→ front-gate"

  cp "$SOURCE/commons.css" "$css/commons.css"
  rm -rf "$css/fonts"
  cp -R "$SOURCE/fonts" "$css/fonts"
}

# preanalyst — preanalysis gate, pagina resa da un server Node.
# I file statici stanno in public/, che la pagina carica dalla radice:
# commons.css e fonts/ finiscono lì accanto a styles.css, lo stile locale.
deploy_preanalyst() {
  local public="$WEBTOOLS/preanalyst/public"
  echo "→ preanalyst"

  cp "$SOURCE/commons.css" "$public/commons.css"
  rm -rf "$public/fonts"
  cp -R "$SOURCE/fonts" "$public/fonts"
}

# sso — le pagine di login e registrazione, rese da un server Node.
# Stessa struttura di preanalyst: i file statici stanno in public/.
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

echo "Stile distribuito."
