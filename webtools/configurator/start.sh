#!/usr/bin/env bash
# Starts the whole system, in the right order.
#
#   ./start.sh             starts the services that are not already running
#   ./start.sh --restart   stops the running ones first, then restarts everything
#
# The order matters: anagraphics holds the data and the others query it, the sso
# authenticates, workspaces stores the files, the preanalyst uses all three, and
# the showcase site (front-gate) comes last because it is the front door. On
# shutdown we go the other way, so nobody is left running and talking to a service
# that is no longer there.
#
# Every service is started and stopped **with its own control script**, which uses
# the PID file and checks the command line before stopping anything. Nothing is
# looked up here by name or by port: other projects run on this machine.
#
# Without --restart, a service already running is left where it is: its script
# answers "is already running" and we move on. A working instance is not touched
# just because this command was run.
#
# Before starting, the configuration is loaded (load_configuration.sh): the
# services read it from anagraphics at startup, and without it they do not start.
# A service already running carries on with the configuration it read when it
# started.
#
# Loading **does not overwrite**: the configuration that lives is in Mongo and the
# files are the seed, so only the fields Mongo does not have come in from here. A
# value changed in operation survives every restart; to take it back to the file's
# you need `./load_configuration.sh --reset [subsystem]`.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBTOOLS="$(cd "$DIR/.." && pwd)"

# name : control script. The order is the startup order. The name is also that of
# the file in configuration/ (anagraphics aside: its address is in
# bootstrap.env).
SERVICES=(
  "anagraphics:$WEBTOOLS/anagraphics/webtools_anagraphics.sh"
  "sso:$WEBTOOLS/sso/webtools_sso.sh"
  "workspaces:$WEBTOOLS/webtools-workspaces/webtools_workspaces.sh"
  "preanalyst:$WEBTOOLS/preanalyst/webtools_preanalyst.sh"
  "front-gate:$WEBTOOLS/front-gate/webtools_front_gate.sh"
)

usage() {
  echo "Usage: $0 [--restart]" >&2
  exit 2
}

restart=0
case "${1:-}" in
  "") ;;
  --restart) restart=1 ;;
  *) usage ;;
esac
(( $# <= 1 )) || usage

field() { cut -d: -f"$1" <<< "$2"; }

# A service's address, only to be shown: it is read from where it really lives, so
# there is no second copy of it here.
address() {
  if [[ "$1" == "anagraphics" ]]; then
    (set -a; source "$DIR/bootstrap.env"; echo "$WEBTOOLS_ANAGRAPHICS_URL")
    return
  fi
  python3 -c 'import json, sys; l = json.load(open(sys.argv[1]))["listen"]; print("http://%s:%s" % (l["host"], l["port"]))' \
    "$DIR/configuration/$1.json" 2>/dev/null || echo "?"
}

# The configuration is in Mongo: if Mongo does not answer, nothing is loaded and
# no service starts. Better to stop here with a clear message.
load_configuration() {
  echo "== configuration"
  if ! "$DIR/load_configuration.sh"; then
    echo "!! Configuration not loaded: no service started." >&2
    echo "   If MongoDB is down: brew services start mongodb-community" >&2
    exit 1
  fi
  echo
}

stop_all() {
  echo "== shutdown (reverse order)"
  for (( i = ${#SERVICES[@]} - 1; i >= 0; i-- )); do
    local entry="${SERVICES[$i]}"
    local name script
    name="$(field 1 "$entry")"
    script="$(field 2 "$entry")"
    echo "-- $name"
    "$script" --stop
  done
  echo
}

start_all() {
  echo "== startup"
  for entry in "${SERVICES[@]}"; do
    local name script
    name="$(field 1 "$entry")"
    script="$(field 2 "$entry")"
    echo "-- $name ($(address "$name"))"
    # If a service does not start we stop here: starting the ones after it, which
    # depend on it, would only multiply the errors in the logs.
    "$script" --start
  done
}

load_configuration
# Not `(( restart )) && stop_all`: with restart=0 that line counts as "false" and
# with `set -e` it would end the script without starting anything.
if (( restart )); then
  stop_all
fi
start_all

echo
echo "System started."
for entry in "${SERVICES[@]}"; do
  echo "  $(field 1 "$entry"): $(address "$(field 1 "$entry")")"
done
