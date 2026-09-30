#!/usr/bin/env bash
# Stops the whole system, in the reverse order of start.sh.
#
#   ./stop.sh
#
# The two pages the system is looked at from first, then the showcase site,
# anagraphics last: nobody is left running and talking to a service that is no
# longer there.
#
# Every service is stopped **with its own control script**, which uses the PID file
# and checks the command line before stopping anything. Nothing is looked up here
# by name or by port: other projects run on this machine. A service already down is
# not an error: its script says so and we move on.
#
# If a script cannot stop its service we carry on with the others, and at the end
# this script exits with 1.
#
# **This list is a second copy of start.sh's, kept by hand, and it has already fallen
# out of step once**: the analyst, the drivers' pool and the communications centre were
# added there and not here, so `./stop.sh` left three services running and said the
# system was stopped. Whoever adds a service adds it in both files, in mirrored
# positions.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBTOOLS="$(cd "$DIR/.." && pwd)"

# name : control script, in shutdown order (the reverse of start.sh).
SERVICES=(
  "metrics-fe:$WEBTOOLS/metrics-fe/webtools_metrics_fe.sh"
  "configurator-fe:$WEBTOOLS/configurator-fe/webtools_configurator_fe.sh"
  "front-gate:$WEBTOOLS/front-gate/webtools_front_gate.sh"
  "projects-hub:$WEBTOOLS/projects-hub/webtools_projects_hub.sh"
  "analyst:$WEBTOOLS/analyst/webtools_analyst.sh"
  "comm-center:$WEBTOOLS/comm-center/webtools_comm_center.sh"
  "drivers-pool:$WEBTOOLS/drivers-pool/webtools_drivers_pool.sh"
  "preanalyst:$WEBTOOLS/preanalyst/webtools_preanalyst.sh"
  "workspaces:$WEBTOOLS/webtools-workspaces/webtools_workspaces.sh"
  "sso:$WEBTOOLS/sso/webtools_sso.sh"
  "metrics:$WEBTOOLS/metrics/webtools_metrics.sh"
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
