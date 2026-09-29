# anagraphics-runner

Paths: `webtools/anagraphics/webtools_anagraphics.sh`, `webtools/anagraphics/pyproject.toml`
Examined: 2026-09-26

The fifth copy of the one start/stop script, and the most interesting of the five: `diff` against
`webtools/sso/webtools_sso.sh` shows that it differs in exactly the places where the member
genuinely differs — the interpreter, how the process is recognised on the command line, and the
sentence the start is confirmed by — and nowhere else. That is evidence for the fix proposed at
`findings/sso-runner.md` rather than against it: the five scripts are one script with three
member-specific values, and today those three values are chosen by copying.

Its command-line check is also the strictest of the five: `[[ "$cmd" == "$PYTHON -m $MODULE"* ]]`
is anchored at the start, where the node scripts use `*"node"*" $ENTRY"*`, which a path containing
the word `node` would satisfy.

Two findings. Neither is re-counted from the other four scripts.

---

## 1. The start is confirmed by a sentence that belongs to somebody else

- `webtools/anagraphics/webtools_anagraphics.sh:70` — `grep -q "Uvicorn running on"` against the
  log
- The line is not produced by anything in this repository: it is uvicorn's own startup log,
  emitted at `INFO` by `uvicorn.server`. Nothing in `webtools_anagraphics/__main__.py` prints a
  confirmation of its own.
- `webtools/anagraphics/pyproject.toml:8` — `"uvicorn>=0.30"`, a lower bound
- Shape: **4 — capability inferred from resemblance**, with **6 — world narrowed to fit the code**
- Class: **the versions and configurations of uvicorn this subsystem may run on.** The dependency
  is declared as a lower bound with no upper one, so every release from 0.30 onward is a legitimate
  member, and the script's contract with the member in front of the author is the exact wording of
  one of its log lines and the fact that `INFO` is being emitted at all. Neither is anything
  uvicorn undertakes to keep: a rewording, a change of level, or `log_level="warning"` passed to
  `uvicorn.run` (`__main__.py:25-32`, an ordinary thing to want once the log is noisy) each make
  `--start` return 1 with "has not confirmed the start within 10 s" for a server that is serving,
  and leave the PID file in place so the process keeps running while the operator is told it did
  not start.
- The other four scripts have the same shape and one degree less of it: their sentence is printed
  by our own `src/index.js`, so both ends are in the repository and a rename is at least
  greppable. That finding is recorded at `findings/front-gate-runner.md` 1 and is not counted
  again; what is counted here is that this member's agreement is with a third party.
- Severity: `latent` — it takes a uvicorn upgrade (`uv sync --upgrade`, permitted by the declared
  bound) or a logging option, both of which somebody is entitled to change without ever opening
  this script.
- Smallest generalising change: the one proposed at `findings/front-gate-runner.md` — wait for the
  port to accept a connection, which is what "it is up" actually means and which no library's
  wording can move. Failing that, print our own confirmation line from `__main__.py` after
  `uvicorn.run` has bound, so that both ends of the agreement are ours.

---

## 2. Two versions for one subsystem, and one of them is published as a description of the API

- `webtools/anagraphics/pyproject.toml:3` — `version = "0.1.0"`
- `webtools/anagraphics/webtools_anagraphics/main.py:24` —
  `app = FastAPI(title="anagraphics", version="0.9.0")`
- Shape: **2 — invented value**
- Class: **the consumers of `/openapi.json`.** FastAPI publishes that `version` in the OpenAPI
  document it serves, which is the one machine-readable statement this subsystem makes about
  itself, and the number in it is a literal that no process sets and that disagrees with the
  packaging metadata by eight minor versions. Neither number is derived from anything: no tag, no
  release step, no check. A reader who takes `0.9.0` to mean that the API has a history and that
  `0.9` differs from `0.8` in some knowable way is inferring exactly the sort of capability the
  audited rule is about, from a string that carries no such information.
- Today the only consumer is a person looking at `/docs`, so nothing breaks. What makes it worth
  recording rather than noting is that it is the field a second consumer — a generated client, a
  compatibility check between the preanalyst and anagraphics — would naturally key on, and it would
  be keying on a number nobody maintains.
- Severity: `stylistic`
- Smallest generalising change: publish one number, read from the packaging metadata, or publish
  none and say the API is unversioned. An unversioned API is an honest statement; two versions is
  not.

---

## Noted, not raised as findings

- The three findings of `findings/preanalyst-runner.md` hold here word for word and are not
  re-counted: the `uncertain` about whether `ps -p <pid> -o command=` can come back truncated
  (`:27-28` — and this member's command line is the longest of the five, about 95 characters), the
  `latent` about `kill -KILL` whose outcome is discarded before an unconditional
  `rm -f "$PID_FILE"` (`:96-98`), and the `stylistic` about a declared interpreter version never
  checked at run time — here `requires-python = ">=3.12"` (`pyproject.toml:5`), with the process
  actually running on 3.13.
- Finding 1 of `findings/sso-runner.md` — one copy of this script per subsystem and no original —
  holds here too and is not re-counted.
- `:101-107` — `case "${1:-}"` accepts `--start` and `--stop` and answers everything else with the
  usage and exit code 2. It is the in-repository counterexample to finding 3 of
  `findings/anagraphics-scripts.md`, where two scripts in `scripts/` take every unrecognised
  argument to mean "write to the database".
- `:38-41` — `[[ ! -x "$PYTHON" ]]` with the message naming the fix (`run 'uv sync' in $DIR`). The
  sso script's equivalent check that the entry file exists was dropped here and not replaced: a
  missing `webtools_anagraphics/` package is caught only by the "the process died, here is the log"
  branch at `:64-69`, which does handle it.
- `:16` — `PYTHON="$DIR/.venv/bin/python"` assumes uv put the environment inside the subsystem.
  `UV_PROJECT_ENVIRONMENT` can put it elsewhere. The message at `:39` names the command that fixes
  it, which is the right answer for the member that is not there.
- `pyproject.toml:2` — `name = "anagraphics"`, where `CLAUDE.md` asks for the `webtools_` prefix on
  packages, modules, processes and services. The package directory is `webtools_anagraphics`; the
  project name is not. A different rule from the one this audit is about.
- `pyproject.toml:6-10` — dependencies declared as lower bounds with a `uv.lock` beside them, so
  what runs is pinned and recorded. The sso has neither bound nor lock
  (`findings/sso-runner.md`), which is the same question answered two ways in one repository.
- `main.py:24` — FastAPI also serves `/docs`, `/redoc` and `/openapi.json`, which are not disabled.
  They are reachable only from the IP pool. An exposure question, not the audited rule.
