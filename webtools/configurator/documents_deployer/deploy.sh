#!/usr/bin/env bash
# Distributes the configurator's documents and policies to the subsystems that use
# them.
#
#   configurator/documents/   the models of the documents the system produces. One
#                             per document, named after the engine that renders it:
#                             `.md.njk` for the preanalyst (Node, nunjucks),
#                             `.md.j2` for the analyst (Python, Jinja2)
#   configurator/policies/    the decision policies: what a model is asked and by
#                             what criteria it answers
#
# They are configuration, not code: they say what the system considers acceptable
# and what shape the documents it produces have. They live here, and the
# subsystems get **generated copies**, as for the style and the templates. A copy
# is not edited where it sits: edit the original and run this deployer again.
#
# Which policy is used is said by the subsystem's configuration
# (`prevalidation.policy` for the preanalyst), not by this script. **Which policies a
# subsystem receives is said here**, one by one, and the two have to agree: a policy
# named in a configuration and not listed here is a subsystem that does not start, and a
# policy listed here and used by nobody is a file in a directory that nobody reads.
#
# They used to go out with a glob, every policy to every subsystem, and that was the
# same defect this script already refuses for the document templates: a policy this
# subsystem never asks for has no business being here, and the day somebody adds one for
# another subsystem it would arrive in all of them. With four policies for the developer
# added, the analyst and the preanalyst were each carrying four files they never read.
#
# So each subsystem's copies are the ones named for it, and **the ones it no longer uses
# are removed**: the directory is generated whole, so a copy left behind from an earlier
# list is a file nobody wrote on purpose.
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

# The policies named for one subsystem, put there and nothing else left beside them.
# A name with no file behind it stops the deploy: it can only be a typo, and carrying on
# would leave a subsystem whose configuration names a policy that never arrived — which
# shows up much later, as a server that does not start.
deploy_policies() {
  local target="$1"
  shift
  mkdir -p "$target"

  local wanted=()
  for name in "$@"; do
    if [[ ! -f "$POLICIES/$name.md" ]]; then
      echo "Policy missing: $POLICIES/$name.md (named for $target)" >&2
      return 1
    fi
    copy_policy "$POLICIES/$name.md" "$target/$name.md"
    wanted+=("$name.md")
  done

  # Whatever else is in there was put there by an earlier list of this script's.
  for existing in "$target"/*.md; do
    [[ -e "$existing" ]] || continue
    local base
    base="$(basename "$existing")"
    local keep=0
    for name in "${wanted[@]}"; do
      [[ "$base" == "$name" ]] && keep=1
    done
    if (( ! keep )); then
      echo "   removing $base, which this subsystem does not use"
      rm -f "$existing"
    fi
  done
}

# preanalyst — renders the pre-specification and prevalidates the scope. The
# document goes in templates/commons/, next to the other templates that are not
# edited inside the subsystem; the policies go in policies/.
deploy_preanalyst() {
  echo "→ preanalyst"

  mkdir -p "$WEBTOOLS/preanalyst/templates/commons"
  cp "$DOCUMENTS/prespec.md.njk" "$WEBTOOLS/preanalyst/templates/commons/prespec.md.njk"

  # The scope a request has to be inside, the brief for the rounds of questions, and the
  # criteria the answers are judged by.
  deploy_policies "$WEBTOOLS/preanalyst/policies" \
    scope-v1 preanalysis-v1 preanalysis-validation-v1
}

# analyst — writes the technical analysis and the proposal, and renders both: whoever
# produces a document holds its model. They go in documents/, next to nothing else,
# because they are configuration and not code; the policies go in policies/.
#
# The models are named one by one and not copied with a glob: a model this subsystem
# does not render has no business being here, and a glob would bring it in the day
# somebody adds one for another subsystem.
deploy_analyst() {
  echo "→ analyst"

  mkdir -p "$WEBTOOLS/analyst/documents"
  cp "$DOCUMENTS/analysis.md.j2" "$WEBTOOLS/analyst/documents/analysis.md.j2"
  cp "$DOCUMENTS/proposal.md.j2" "$WEBTOOLS/analyst/documents/proposal.md.j2"

  # One per door: the analysis, the judgement on taking the work on, the points the
  # client agrees to.
  deploy_policies "$WEBTOOLS/analyst/policies" \
    analysis-technical-v1 analysis-sustainability-v1 functional-points-v1
}

# developer — builds the webtool from the analysis. It renders no document of ours:
# the one document it produces, the built project's README, is written by a model in
# the client's language and has no model of ours to fill in. So it takes the policies
# and nothing else.
deploy_developer() {
  echo "→ developer"

  # One per door: the plan, writing a file, repairing one, the built project's README.
  deploy_policies "$WEBTOOLS/developer/policies" \
    build-plan-v1 write-file-v1 repair-file-v1 build-readme-v1
}

deploy_preanalyst
deploy_analyst
deploy_developer

echo "Documents and policies distributed."
