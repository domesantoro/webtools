#!/usr/bin/env bash
# Porta nella collection `configuration` di anagraphics quello che ai sottosistemi
# manca. Anagraphics la serve con GET /configuration/{subsystem}.
#
#   ./load_configuration.sh                      aggiunge i campi mancanti
#   ./load_configuration.sh --reset              riporta tutto ai file
#   ./load_configuration.sh --reset preanalyst   riporta ai file solo quello
#
# **La configurazione che vive sta in Mongo.** I file di configuration/ sono il
# seme — i valori con cui nasce un ambiente nuovo — e la forma attesa: dicono
# quali campi esistono. Quello che gira può divergere, ed è normale.
#
# Quindi qui si aggiungono **solo i campi che mancano**: un campo che c'è non si
# tocca, un campo tolto da un file resta in Mongo, un sottosistema senza più un
# file non viene cancellato. Un campo nuovo introdotto da uno sviluppo entra da
# solo, senza interventi a mano. Per tornare ai file serve dirlo: `--reset`.
#
# I file di secrets/ (fuori da git: chiavi delle API) si fondono in profondità e
# **sostituiscono sempre** il valore che trovano: una chiave ruotata deve valere.
#
# Lo lancia start.sh prima di avviare i servizi — ora che non sovrascrive, farlo
# a ogni avvio non porta via niente. A mano serve per caricare senza riavviare.
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
"$PYTHON" -m scripts.load_configuration "$DIR/configuration" "$DIR/secrets" "$@"
