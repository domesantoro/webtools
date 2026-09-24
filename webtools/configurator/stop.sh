#!/usr/bin/env bash
# Stops the whole system, in the reverse order of start.sh.
#
#   ./stop.sh
#
# The showcase site first, anagraphics last: nobody is left running and talking to
# a service that is no longer there.
#
# Every service is stopped **with its own control script**, which uses the PID file
# and checks the command line before stopping anything. Nothing is looked up here
# by name or by port: other projects run on this machine. A service already down is
# not an error: its script says so and we move on.
#
# If a script cannot stop its service we carry on with the others, and at the end
# this script exits with 1.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBTOOLS="$(cd "$DIR/.." && pwd)"

# name : control script, in shutdown order (the reverse of start.sh).
SERVICES=(
  "front-gate:$WEBTOOLS/front-gate/webtools_front_gate.sh"
  "preanalyst:$WEBTOOLS/preanalyst/webtools_preanalyst.sh"
  "workspaces:$WEBTOOLS/webtools-workspaces/webtools_workspaces.sh"
  "sso:$WEBTOOLS/sso/webtools_sso.sh"
  "anagraphics:$WEBTOOLS/anagraphics/webtools_anagraphics.sh"
)

(( $# == 0 )) || { echo "Usage: $0" >&2; exit 2; }

failed=()
for entry in "${SERVICES[@]}"; do
  name="${entry%%:*}"
  script="${entry#*:}"
  echo "-- $name"
  if ! "$script" --stop; then
    failed+=("$name")
  fi
done

echo
if (( ${#failed[@]} > 0 )); then
  echo "Not stopped: ${failed[*]}" >&2
  exit 1
fi
echo "System stopped."
