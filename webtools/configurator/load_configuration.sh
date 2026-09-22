#!/usr/bin/env bash
# Carica la configurazione dei sottosistemi (configuration/*.json) nella
# collection `configuration` di anagraphics, che poi la serve con
# GET /configuration/{subsystem}.
#
#   ./load_configuration.sh
#
# I file sono la fonte: ogni documento in Mongo viene sostituito per intero e
# quelli senza più un file vengono cancellati. Lo lancia start.sh prima di
# avviare i servizi; a mano serve solo per caricare senza riavviare.
#
# I sottosistemi leggono la configurazione all'avvio: dopo averla cambiata va
# riavviato chi la usa (start.sh --restart).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANAGRAPHICS="$DIR/../anagraphics"
PYTHON="$ANAGRAPHICS/.venv/bin/python"

if [[ ! -x "$PYTHON" ]]; then
  echo "Ambiente di anagraphics mancante: lancia prima 'uv sync' in $ANAGRAPHICS" >&2
  exit 1
fi

set -a
# shellcheck source=bootstrap.env
source "$DIR/bootstrap.env"
set +a

cd "$ANAGRAPHICS"
"$PYTHON" -m scripts.load_configuration "$DIR/configuration"
