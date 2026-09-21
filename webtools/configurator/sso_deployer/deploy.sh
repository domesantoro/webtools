#!/usr/bin/env bash
# Diffonde il client del sso (commons/sso) nei sottosistemi che hanno un login.
# Ogni progetto ha la sua funzione di deploy, con destinazioni esplicite: la
# struttura dei progetti può essere diversa e non tutti ricevono il client.
#
# Il sso NON riceve niente da qui: lui è il servizio, non un suo consumatore.
set -euo pipefail

WEBTOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$WEBTOOLS/commons/sso"

# preanalyst — due file, due destinazioni diverse:
#   - il client del server va in src/commons/, dove lo importa il server;
#   - lo script del browser va in public/, da dove lo scarica la pagina.
# Le cartelle sono separate dal resto perché quei file non si modificano qui:
# si modifica commons/sso e si rilancia questo deployer.
deploy_preanalyst() {
  local commons="$WEBTOOLS/preanalyst/src/commons"
  local public="$WEBTOOLS/preanalyst/public"
  echo "→ preanalyst"

  mkdir -p "$commons"
  cp "$SOURCE/sso_client.js" "$commons/sso_client.js"
  cp "$SOURCE/sso_popup.js" "$public/sso_popup.js"
}

deploy_preanalyst

echo "Client del sso distribuito."
