# webtools_developer

Reads the analysis of a project and **builds the webtool from it**. Four doors and a sandbox: a
plan says what is built and out of what, one call per file writes it, a command checks what was
written and a repair door answers what the check refused, and a last door writes the README of the
project that now exists. Four questions, four contracts, each with its own provider, its own key and
its own consumption.

Everything it executes runs confined, in a directory of its own, with the network closed — except
while dependencies are being installed, which is the one step that has to reach out.

Full documentation: `docs/subsystems/developer/README.md` (at the root of the workspace).

```sh
uv sync                                    # the first time, and after a change of dependencies
./webtools_developer.sh --start            # port 9101, in the background
./webtools_developer.sh --stop
uv run pytest
```

One route, the trigger: `POST /projects/{project_id}/development` → `202`, and the build goes on
behind the answer. It is refused with `409` if the project is not in `CLIENT_VALIDATION`, because
before that the client has agreed to nothing, and because a second build would be a second build of
the same project, paid twice, into the same directory.

**What it produces is not in this repository.** The files go under `build.root`
(`/Users/domenico/webtools-builds` in this environment), one directory per project, and the path is
written on the project's step — it is how the driver finds what to try. Nothing goes to workspaces:
that store keeps versioned `.md` documents, and a source tree that has to be executed is not one of
those.

**While it runs, the step grows.** The plan and every file are written into the open `development`
step as they happen, so a project halfway through a build has something to show. A restart does
**not** resume: the project is left in `DEVELOPMENT` with its step open and its files on disk, which
is a project somebody has to look at.

**What a stack is, is configuration.** How a project is prepared, how a file of each kind is
checked, how the whole is checked, how it is started: all of it is read from `stacks.<name>`, and
every one of those steps may be absent — a page made of HTML and CSS installs nothing and starts
nothing, and is not verified worse for it. Nothing in the code lists the stacks or the kinds of
file.

Running a build on a real analysis, without a project and without anagraphics:

```sh
set -a; source ../configurator/bootstrap.env; set +a
PYTHONPATH=. uv run python scripts/build.py <analysis.md> <points.json> [<project-id>]
```

It makes **real calls, which cost** — one per file, so it is the most expensive script here. What it
spent is printed by door and by kind.

`webtools_developer/commons/` (the configuration client, the metrics client) and `policies/` are
**generated copies**: the originals are in `webtools/commons/` and `webtools/configurator/`, and the
deployers put them here. A copy is not edited where it sits.

The configuration is read at startup from anagraphics (`GET /configuration/developer`); the source
is `webtools/configurator/configuration/developer.json`. No defaults: if a field is missing the
server does not start. The API keys come from `webtools/configurator/secrets/developer.json`, outside
git. The sandbox profiles are named by the configuration and read by `sandbox-exec`, not by us:
`webtools/configurator/sandbox/`.
