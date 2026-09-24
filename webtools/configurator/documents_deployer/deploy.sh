#!/usr/bin/env bash
# Distributes the configurator's documents and policies to the subsystems that use
# them.
#
#   configurator/documents/   the models of the documents the system produces
#                             (the shape of the pre-specification, for now)
#   configurator/policies/    the decision policies: what a model is asked and by
#                             what criteria it answers
#
# They are configuration, not code: they say what the system considers acceptable
# and what shape the documents it produces have. They live here, and the
# subsystems get **generated copies**, as for the style and the templates. A copy
# is not edited where it sits: edit the original and run this deployer again.
#
# Which policy is used is said by the subsystem's configuration
# (`prevalidation.policy` for the preanalyst), not by this script.
set -euo pipefail

WEBTOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCUMENTS="$WEBTOOLS/configurator/documents"
POLICIES="$WEBTOOLS/configurator/policies"

# The policies are markdown with no room for a comment: the warning goes in front
# as an HTML comment, invisible to whoever reads the rendered document. Whoever
# sends the policy to a model strips the leading comments (`src/prevalidator.js`),
# so the warning does not end up in the prompt.
copy_policy() {
  local source="$1" target="$2"
  {
    echo "<!-- GENERATED COPY: do not edit here."
    echo "     The original is webtools/configurator/policies/$(basename "$source");"
    echo "     edit it there and run configurator/documents_deployer/deploy.sh again. -->"
    cat "$source"
  } > "$target"
}

# preanalyst — renders the pre-specification and prevalidates the scope. The
# document goes in templates/commons/, next to the other templates that are not
# edited inside the subsystem; the policies go in policies/.
deploy_preanalyst() {
  echo "→ preanalyst"

  mkdir -p "$WEBTOOLS/preanalyst/templates/commons"
  cp "$DOCUMENTS/prespec.md.njk" "$WEBTOOLS/preanalyst/templates/commons/prespec.md.njk"

  mkdir -p "$WEBTOOLS/preanalyst/policies"
  for policy in "$POLICIES"/*.md; do
    copy_policy "$policy" "$WEBTOOLS/preanalyst/policies/$(basename "$policy")"
  done
}

deploy_preanalyst

echo "Documents and policies distributed."
