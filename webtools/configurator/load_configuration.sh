#!/usr/bin/env bash
# Brings into anagraphics' `configuration` collection whatever the subsystems are
# missing. Anagraphics serves it with GET /configuration/{subsystem}.
#
#   ./load_configuration.sh                      adds the missing fields
#   ./load_configuration.sh --reset              takes everything back to the files
#   ./load_configuration.sh --reset preanalyst   takes only that one back
#
# **The configuration that lives is in Mongo.** The files in configuration/ are the
# seed — the values a new environment is born with — and the expected shape: they
# say which fields exist. What is running may diverge, and that is normal.
#
# So here **only the missing fields** are added: a field that is there is not
# touched, a field removed from a file stays in Mongo, a subsystem that no longer
# has a file is not deleted. A new field introduced by a piece of work arrives by
# itself, with no manual intervention. To go back to the files you have to say so:
# `--reset`.
#
# The files in secrets/ (outside git: API keys) are deep-merged and **always
# replace** the value they find: a rotated key must count.
#
# start.sh runs it before starting the services — now that it does not overwrite,
# doing it at every start carries nothing away. By hand it is for loading without
# restarting.
#
# The subsystems read the configuration at startup: after changing it, whoever uses
# it must be restarted (start.sh --restart).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANAGRAPHICS="$DIR/../anagraphics"
PYTHON="$ANAGRAPHICS/.venv/bin/python"

if [[ ! -x "$PYTHON" ]]; then
  echo "Anagraphics environment missing: run 'uv sync' in $ANAGRAPHICS first" >&2
  exit 1
fi

set -a
# shellcheck source=bootstrap.env
source "$DIR/bootstrap.env"
set +a

cd "$ANAGRAPHICS"
"$PYTHON" -m scripts.load_configuration "$DIR/configuration" "$DIR/secrets" "$@"
