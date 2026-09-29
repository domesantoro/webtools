# webtools_analyst

Turns a finished pre-analysis into what the rest of the flow needs: the **technical analysis** the
tool is built from, a **judgement** on whether to propose taking the work on, and the **functional
points** the client agrees to. Three questions to a model, three doors, each with its own provider,
its own key and its own consumption.

Full documentation: `docs/subsystems/analyst/README.md` (at the root of the workspace).

```sh
uv sync                                  # the first time, and after a change of dependencies
./webtools_analyst.sh --start            # port 9800, in the background
./webtools_analyst.sh --stop
uv run pytest
```

One route, the trigger: `POST /projects/{project_id}/analysis` → `202`, and the run goes on behind
the answer. It is refused with `409` if the project is not in `PREANALYSIS`, because a second run
would be a second analysis, paid twice.

**Nothing calls it yet**: the preanalyst still has a placeholder where the button at the end of the
rounds of questions should trigger it. The three doors can also be run by hand on real material:

```sh
set -a; source ../configurator/bootstrap.env; set +a
PYTHONPATH=. uv run python scripts/analyse.py <pre-specification.md> [<transcript.json>]
```

It makes **real calls, which cost**. What each one consumed is printed by kind.

`webtools_analyst/commons/` (the configuration client, the metrics client, the languages) and
`documents/` and `policies/` are **generated copies**: the originals are in `webtools/commons/` and
`webtools/configurator/`, and the deployers put them here. A copy is not edited where it sits.

The configuration is read at startup from anagraphics (`GET /configuration/analyst`); the source is
`webtools/configurator/configuration/analyst.json`. No defaults: if a field is missing the server
does not start. The API keys come from `webtools/configurator/secrets/analyst.json`, outside git.
