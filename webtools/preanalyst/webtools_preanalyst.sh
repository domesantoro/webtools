#!/usr/bin/env bash
# Control of the webtools_preanalyst server: --start | --stop
#
# - --start: starts it in the background (nohup), detached from the terminal.
#            PID in webtools_preanalyst.pid, log in webtools_preanalyst.log (appended).
# - --stop:  stops the process named by the PID file, and only after checking that
#            that PID really is our server (never by name or by port).
#
# The server has no default values: from the environment it takes only the
# variables of ../configurator/bootstrap.env (loaded here by --start) and the rest
# from its configuration in anagraphics. If anything is missing, it does not
# start.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOOTSTRAP="$DIR/../configurator/bootstrap.env"
NODE="$(command -v node || true)"
ENTRY="$DIR/src/index.js"
PID_FILE="$DIR/webtools_preanalyst.pid"
LOG_FILE="$DIR/webtools_preanalyst.log"

# Prints the PID if the PID file points at a live process that is our server.
running_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid cmd
  pid="$(cat "$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  cmd="$(ps -p "$pid" -o command= 2>/dev/null)" || return 1
  # It must be node running our very own src/index.js.
  [[ "$cmd" == *"node"*" $ENTRY"* ]] || return 1
  echo "$pid"
}

start() {
  local pid
  if pid="$(running_pid)"; then
    echo "webtools_preanalyst is already running (PID $pid)."
    return 0
  fi
  if [[ -z "$NODE" ]]; then
    echo "Node not found in PATH." >&2
    return 1
  fi
  if [[ ! -f "$ENTRY" ]]; then
    echo "Startup file missing: $ENTRY" >&2
    return 1
  fi
  if [[ ! -f "$BOOTSTRAP" ]]; then
    echo "Startup file missing: $BOOTSTRAP" >&2
    return 1
  fi
  set -a
  # shellcheck source=../configurator/bootstrap.env
  source "$BOOTSTRAP"
  set +a
  rm -f "$PID_FILE"

  local log_offset
  log_offset=0
  [[ -f "$LOG_FILE" ]] && log_offset=$(( $(wc -c < "$LOG_FILE") ))
  echo "=== start $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$LOG_FILE"

  cd "$DIR"
  nohup "$NODE" "$ENTRY" >> "$LOG_FILE" 2>&1 &
  pid=$!
  echo "$pid" > "$PID_FILE"

  # Waits up to 10 s for the confirmation line printed by src/index.js, or for the
  # process to die.
  for _ in $(seq 1 50); do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "Start failed. Last lines of the log:" >&2
      tail -c +"$((log_offset + 1))" "$LOG_FILE" | tail -n 20 >&2
      return 1
    fi
    if tail -c +"$((log_offset + 1))" "$LOG_FILE" | grep -q "webtools_preanalyst listening on"; then
      echo "webtools_preanalyst started (PID $pid). Log: $LOG_FILE"
      return 0
    fi
    sleep 0.2
  done
  echo "The process (PID $pid) is alive but has not confirmed the start within 10 s: check $LOG_FILE" >&2
  return 1
}

stop() {
  local pid
  if ! pid="$(running_pid)"; then
    rm -f "$PID_FILE"
    echo "webtools_preanalyst is not running."
    return 0
  fi
  kill -TERM "$pid"
  for _ in $(seq 1 50); do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "webtools_preanalyst stopped (PID $pid)."
      return 0
    fi
    sleep 0.2
  done
  echo "No exit within 10 s after SIGTERM: sending SIGKILL to PID $pid." >&2
  kill -KILL "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
}

case "${1:-}" in
  --start) start ;;
  --stop)  stop ;;
  *)
    echo "Usage: $0 --start | --stop" >&2
    exit 2
    ;;
esac
