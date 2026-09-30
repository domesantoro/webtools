# Checkpoint 2026-09-30

The developer is written. It reads the analysis of a project and builds the webtool from it: four
doors, a sandbox, 257 tests, and a server that starts and answers. **No build has been run on real
material**: not one paid call has been made, and that is the next thing to do.

The session started badly. The first thing asked for was a possible architecture, and what came back
was a set of invented alternatives — who writes the code, as if the name did not settle it — and then
a plan carrying assumptions that had not been argued: that the developer executes what it writes, and
git inside every build. Both were taken apart by the user before anything was built. The second one
was removed outright: the history of a build is already on the step, and git would have been the same
facts in a second place.

## 1. What the developer is

`webtools/developer/`, Python, port **9101** — 9100 is taken by another project on this machine. One
route, `POST /projects/{project_id}/development` → `202`, refused with `409` unless the project is in
`CLIENT_VALIDATION`: before that the client has agreed to nothing, and building would be building at
our own expense.

Four doors, four contracts, four configurations:

| Door | Asked | Produces |
|---|---|---|
| `build_plan_ai` | once | the stack, and the ordered list of files with a purpose and a kind each |
| `write_file_ai` | once per file | one file, whole, and an account of what it exposes |
| `repair_file_ai` | per refused check, to a ceiling | that file again, so the check passes |
| `build_readme_ai` | once, last | the project's README, in the client's language |

## 2. The decisions, and why each one is that way

**One file per call.** Asking for a whole project produces a truncated answer as soon as the project
stops being trivial, and a truncated answer is not recoverable: there is no way to know which half is
missing. Each call carries the analysis, the points, the plan, the stack's commands, and **what the
files already written expose** — not what they contain, or a build of fifty files would send the whole
project on every call.

**`exposes` is the model's own account and is never read back off the disk.** Reading it back would
mean parsing the language the file is written in, and which languages exist is exactly what this
subsystem must not know.

**The plan door is handed every stack with the commands that will be run on it.** Two things come of
it: the answer can only name a stack that exists, and whoever plans knows how the plan will be
checked, which is what lets them produce a project whose own conventions the checks rely on.

**The README is a door and not one more file of the plan**, because what it says is only true once the
project exists and the commands are known. Written in the client's language, carried as a fact from
the analysis step. **Its failure does not fail the build**: the project is built, checked and paid
for, and recovering one document would cost the whole build again. The step says `documented: false`,
the driver is told, and `build.finished` carries `documented: no` so that a tool delivered without
instructions is a number and not a silence.

**A failure of the whole-project check or of the start is not repaired.** Repairing needs a file to
repair, and the output of a test run does not say which file it is. Choosing the one that resembles
the text of an error is a guess. The build ends with that outcome and the output goes on the step.

**The preparation comes after the files**, because what a package manager reads — a manifest, a lock
file — is one of the files the plan names. The cost is that a per-file check needing the dependencies
installed cannot work this way, and a stack like that configures `whole` and leaves `checks` empty. It
is written in `build.py`, because it is the one ordering decision somebody configuring a new stack has
to know.

**The build's progress lives in the open `development` step**, written as it happens with
`PATCH .../steps/development` — the convention the rounds of questions already run on. So a project
halfway through has the plan and the files to show. **A restart does not resume**: the project is left
in `DEVELOPMENT` with its step open and its files on disk, which is a project somebody has to look at.
Resuming would mean deciding which of the written files to trust.

**What a build consumed goes on the step, per door and per kind**, never summed across kinds and never
turned into money. That is what the metered tier is priced from, and the money at the demo is not
taken from metrics.

**The files are not in workspaces.** Workspaces keeps versioned `.md` with a ceiling per document, and
a source tree that has to be executed is not one of those — nor can a store behind HTTP be the
directory a command runs in. They go under `build.root`, outside the repository, one directory per
project, and that path is on the step because it is how the driver finds what to try.

## 3. What is configuration, and what the code does not know

The stacks, and for each one: how it is prepared, how a file of each kind is checked, how the whole is
checked, how it is started. **All four are optional, and absent means that step does not exist for
that stack** — a page made of HTML and CSS installs nothing and starts nothing, and is not verified
worse for it. What is refused is a step that is there and malformed, because absent and wrong are
different things.

There is no occurrence of `node`, `npm`, `javascript` or `package.json` anywhere in the code; the seed
carries one example stack, `web`, beside a `page` that has none of those steps precisely so the code
cannot presume the first.

## 4. The sandbox, which was verified rather than assumed

Two profiles, and the difference is the network: `preparation` may reach out, `closed` may not, and
everything else runs under it. Proved by running it: under `closed`, a connection is refused, a write
outside the builds root is refused, reading the secrets directory is refused, and a write inside the
build's own directory succeeds; under `preparation`, `npm install` completes.

Three things that only came out by running it:

- **`HOME` has to be the build's directory.** The first `npm install` failed because it looked for its
  cache in the user's home, which the profile denies. With `HOME` inside the build, a build cannot read
  or poison the cache of whoever runs the developer either.
- **A command is looked up before it is run.** Through a wrapper, a command that does not exist comes
  back as the wrapper's non-zero exit with `command not found` printed — indistinguishable from a check
  that read the file and refused it. The build would have sent good files to the repair door because a
  runtime was missing, until it ran out of attempts.
- **macOS refuses `RLIMIT_AS`** whatever the number. The ceilings are now probed in the parent, the
  ones the kernel takes are applied, and the ones it refuses are named in the log at startup: a number
  in a configuration that nothing enforces is worse than no number, because it reads as a guarantee.

## 5. The rest of the repository

- **vocabulary**: `developer` as a sender; four phases, one per door; `build.planned`,
  `build.prepared`, `build.file_written`, `build.verified`, `build.unchecked`, `build.repaired`,
  `readme.written`, `build.finished`. `build.unchecked` is its own metric and not an outcome of
  `build.verified`, because an unchecked file and a file that passed are the opposite of each other.
- **comm-center**: `POST /communications/alpha-test-ready`, its own form — what waits is a tool that
  runs, not a document to read — carrying whether the build came with its README.
- **start.sh**: the developer after the analyst, for the same kind of reason: nothing calls it, and
  what it needs up is above it.
- **the three deployers**: the configuration client, the metrics client, and the policies.

## 6. The policies deployer, corrected

It distributed every policy to every subsystem with a glob. The same script already refuses that for
the document templates — a model this subsystem does not render has no business being here — and the
argument holds identically for policies. Adding the developer's four made it visible: the analyst and
the preanalyst were each carrying four files they never read.

Now each subsystem's policies are named one by one, a name with no file behind it stops the deploy, and
**a copy the current list does not name is removed**, since the directory is generated whole. The
preanalyst has three, the analyst three, the developer four.

## 7. One thing the session got wrong about its own tests

The first version of the build tests used `node --check` as the real check, with a skip when node was
absent. On a machine without node those tests would not have failed — they would have disappeared, and
the coverage of the repair loop with them. They now run a check that is about no language at all: a
command that refuses a file carrying a marker and says so in its own words, with the assertion being
that **whatever the command printed reaches the repair door**, which is what the loop actually
promises. One test keeps a real parser and says that is what it is for.

## 8. What this leaves open

- **Nothing calls it.** The trigger belongs where the client accepts the proposal; there is a gate
  there and nothing behind it.
- **No real build has been run.** Not one paid call. The hand script is `scripts/build.py`, and it is
  the most expensive in the repository: one call per file.
- **The registries the preparation may reach are not restricted.** `sandbox-exec` filters by kind of
  traffic, not by host, so the profile allows outbound traffic and nothing narrows it to a list. It
  needs a proxy that accepts those hosts and refuses the rest, with the package managers pointed at it.
  It is said inside the profile rather than left looking enforced.
- **No ceiling on memory on this machine**, for the reason in §4.
- **A whole-project failure costs the whole build.** Nothing is repaired, and the next build starts
  from nothing: a plan and every file paid for again. Whether that is worth changing depends on how
  often it happens, which no run has yet said.
- **The four doors share one key.** Copied from the analyst's; giving them four is a line of
  configuration.
