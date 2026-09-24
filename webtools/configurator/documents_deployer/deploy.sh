#!/usr/bin/env bash
# Diffonde i documenti e le policy del configurator nei sottosistemi che li usano.
#
#   configurator/documents/   i modelli dei documenti che il sistema produce
#                             (la forma della pre-specifica, per ora)
#   configurator/policies/    le policy delle decisioni: che cosa si chiede a un
#                             modello e con quali criteri risponde
#
# Sono configurazione, non codice: dicono che cosa il sistema considera
# accettabile e che forma hanno i documenti che produce. Stanno qui e nei
# sottosistemi ci vanno **copie generate**, come per lo stile e i template.
# Una copia non si modifica dov'è: si modifica l'originale e si rilancia questo
# deployer.
#
# Quale policy si usa lo dice la configurazione del sottosistema
# (`prevalidation.policy` per il preanalyst), non questo script.
set -euo pipefail

WEBTOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCUMENTS="$WEBTOOLS/configurator/documents"
POLICIES="$WEBTOOLS/configurator/policies"

# Le policy sono markdown senza posto per un commento: l'avviso si mette davanti
# come commento HTML, invisibile a chi legge il documento reso. Chi manda la
# policy a un modello toglie i commenti in testa (`src/prevalidator.js`), così
# l'avviso non finisce nel prompt.
copia_policy() {
  local origine="$1" destinazione="$2"
  {
    echo "<!-- COPIA GENERATA: non modificare qui."
    echo "     L'originale è webtools/configurator/policies/$(basename "$origine");"
    echo "     si modifica lì e si rilancia configurator/documents_deployer/deploy.sh. -->"
    cat "$origine"
  } > "$destinazione"
}

# preanalyst — rende la pre-specifica e prevalida lo scope.
# Il documento va in templates/commons/, accanto agli altri template che non si
# modificano nel sottosistema; le policy in policies/.
deploy_preanalyst() {
  echo "→ preanalyst"

  mkdir -p "$WEBTOOLS/preanalyst/templates/commons"
  cp "$DOCUMENTS/prespec.md.njk" "$WEBTOOLS/preanalyst/templates/commons/prespec.md.njk"

  mkdir -p "$WEBTOOLS/preanalyst/policies"
  for policy in "$POLICIES"/*.md; do
    copia_policy "$policy" "$WEBTOOLS/preanalyst/policies/$(basename "$policy")"
  done
}

deploy_preanalyst

echo "Documenti e policy distribuiti."
