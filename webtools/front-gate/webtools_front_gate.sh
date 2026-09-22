#!/usr/bin/env bash
# Controllo del server webtools_front_gate: --start | --stop
#
# - --start: avvia in background (nohup), slegato dal terminale.
#            PID in webtools_front_gate.pid, log in webtools_front_gate.log (in append).
# - --stop:  ferma il processo indicato dal file PID, solo dopo aver verificato
#            che quel PID sia davvero il nostro server (mai per nome o per porta).
#
# Il server non ha valori di default: prende dall'ambiente solo le variabili di
# ../configurator/bootstrap.env (caricate qui con --start) e il resto dalla sua
# configurazione in anagraphics. Se manca qualcosa, non parte.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOOTSTRAP="$DIR/../configurator/bootstrap.env"
NODE="$(command -v node || true)"
ENTRY="$DIR/src/index.js"
PID_FILE="$DIR/webtools_front_gate.pid"
LOG_FILE="$DIR/webtools_front_gate.log"

# Stampa il PID se il file PID punta a un processo vivo che è il nostro server.
running_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid cmd
  pid="$(cat "$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  cmd="$(ps -p "$pid" -o command= 2>/dev/null)" || return 1
  # Deve essere node che esegue proprio il nostro src/index.js.
  [[ "$cmd" == *"node"*" $ENTRY"* ]] || return 1
  echo "$pid"
}

start() {
  local pid
  if pid="$(running_pid)"; then
    echo "webtools_front_gate è già in esecuzione (PID $pid)."
    return 0
  fi
  if [[ -z "$NODE" ]]; then
    echo "Node non trovato nel PATH." >&2
    return 1
  fi
  if [[ ! -f "$ENTRY" ]]; then
    echo "File di avvio mancante: $ENTRY" >&2
    return 1
  fi
  if [[ ! -f "$BOOTSTRAP" ]]; then
    echo "File di avvio mancante: $BOOTSTRAP" >&2
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

  # Attende fino a 10 s la riga di conferma stampata da src/index.js,
  # o che il processo muoia.
  for _ in $(seq 1 50); do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "Avvio fallito. Ultime righe del log:" >&2
      tail -c +"$((log_offset + 1))" "$LOG_FILE" | tail -n 20 >&2
      return 1
    fi
    if tail -c +"$((log_offset + 1))" "$LOG_FILE" | grep -q "webtools_front_gate in ascolto su"; then
      echo "webtools_front_gate avviato (PID $pid). Log: $LOG_FILE"
      return 0
    fi
    sleep 0.2
  done
  echo "Il processo (PID $pid) è vivo ma non ha confermato l'avvio entro 10 s: controlla $LOG_FILE" >&2
  return 1
}

stop() {
  local pid
  if ! pid="$(running_pid)"; then
    rm -f "$PID_FILE"
    echo "webtools_front_gate non è in esecuzione."
    return 0
  fi
  kill -TERM "$pid"
  for _ in $(seq 1 50); do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "webtools_front_gate fermato (PID $pid)."
      return 0
    fi
    sleep 0.2
  done
  echo "Nessuna uscita entro 10 s dopo SIGTERM: invio SIGKILL a PID $pid." >&2
  kill -KILL "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
}

case "${1:-}" in
  --start) start ;;
  --stop)  stop ;;
  *)
    echo "Uso: $0 --start | --stop" >&2
    exit 2
    ;;
esac
