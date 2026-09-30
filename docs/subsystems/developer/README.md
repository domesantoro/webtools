# Subsystem `webtools_developer`

> Code: `webtools/developer/`. Document current as of 2026-09-30, version 0.1.0.

## 0. Quick sheet

| | |
|---|---|
| Role | Reads the technical analysis of a project and builds the webtool from it |
| Technology | Python ≥ 3.12, FastAPI, uvicorn, httpx, one provider SDK behind an adapter, `sandbox-exec` for confinement |
| Port | **9101** (`listen.port` of the configuration) |
| Configuration | Read at startup from anagraphics (`GET /configuration/developer`). No defaults: if it is missing, the server does not start (§7) |
| Start / stop | `webtools/developer/webtools_developer.sh --start` / `--stop` |
| PID / Log | `webtools_developer.pid` / `webtools_developer.log`, in the subsystem's directory |
| Data | No database of its own: what a build does goes on the project in anagraphics, and the files it makes go under `build.root` on disk |
| Who calls it | **Nobody yet.** The trigger exists (§8); nothing closes the client's validation gate by calling it |
| What it calls | anagraphics (the project, its step, its progress, and the client when there is something to say), workspaces (the analysis in — nothing out), comm-center (telling the driver there is something to try, telling the client it stopped) |
| Tests | `uv run pytest`: 256 tests. No model is called; the commands and the confinement are real |

## 1. Role

The client has read the functional points and accepted them. From the analysis this subsystem
produces **a webtool that runs**: a tree of source files under the builds root, checked by the
commands its stack configures, with a README in the client's language, and a project in `ALPHA_TEST`
with a driver told there is something to try.

It decides nothing about the request and publishes nothing. The α-test is the driver's, and the demo
is published after it.

**Nobody waits in front of it.** A build is hundreds of model calls and a handful of commands, over
minutes or hours: the trigger answers `202` at once and the pipeline advances by what is written in
anagraphics.

## 2. The two rules this subsystem is built on

**The system talks to a model only through a contract, and is never tied to one provider.** A
**door** is one question asked of a model. Every door owns its contract — what it sends and what
comes back, in our words — and **contracts are not shared between doors**: two doors may run on
different providers, with different keys, different models and different consumption, and each has
to be able to change without the others being disentangled first. Four contracts looking alike is
the price of that independence, and it is paid on purpose.

A **provider is an adapter**: it takes the request in the contract's words, speaks whatever its API
speaks, and answers in the contract's words. It is the only file that may name that provider, import
its SDK, or know its fields, its roles, its error codes and what it calls a unit of consumption.

**What can be built, and how it is checked, is configuration.** The stacks, the commands each one is
prepared, checked and started with, the wrapper that confines them: none of it is written in the
code. A stack added to the configuration costs no code, and no file here contains a list of
languages, runtimes or kinds of file.

## 3. The four doors

They run in this order, and the order is not configurable.

| Door | Asked | Produces |
|---|---|---|
| `build_plan_ai` | once per build | the stack, and the ordered list of files with a purpose and a kind each |
| `write_file_ai` | once per file | the whole content of one file, and an account of what it exposes |
| `repair_file_ai` | once per failed check, up to a ceiling | the same file again, so that the check passes |
| `build_readme_ai` | once, at the end | the project's `README.md`, in the client's language |

### 3.1 The plan

It is handed the analysis, the agreed points, and **every configured stack with the commands that
will be run on it**. Two things come of handing over the commands: the answer can only name a stack
that exists — a name that is not among them is `unusable` and the build stops — and whoever plans
knows how the plan will be checked, which is what lets them produce a project whose own conventions
the checks rely on.

The plan is written into the open step before a single file exists, so a driver can read what is
about to be built.

What the door checks beyond the schema: the stack is one of ours, the list is not empty, no entry is
missing its path, purpose or kind, and no path appears twice. Each of those has its own reason on
`ai.unusable`, because a door that keeps choosing a stack that does not exist and one that keeps
coming back empty are two different things to fix.

### 3.2 One file at a time

A build asks for one file per call. Asking for a whole project in one answer produces a truncated
answer as soon as the project stops being trivial, and a truncated answer is not recoverable: there
is no way to know which half is missing.

Each call carries the analysis, the points, the whole plan, the stack's commands, **what the files
already written expose**, and the file to write now. What they expose and not what they contain: a
build of fifty files would otherwise send the whole project on every call.

`exposes` is the model's own account of what it wrote, and it is never read back out of the file.
Reading it back would mean parsing the language it is written in, and which languages exist is
exactly what this subsystem must not know.

### 3.3 Repair

A file its check refuses goes back, with the output of the command that refused it, up to
`attempts_per_file_max`. The output is the only material in this subsystem that neither we nor
another model wrote, which is why it is a door of its own rather than a second use of the write door.

The file that is sent is **read back off the disk**: the check ran on the bytes that are there, and
a repair written against anything else is a repair of a different file.

### 3.4 The README

Asked last, once every file exists and its checks have passed — which is the whole reason it is a
door and not one more file of the plan. What it has to say (what the tool is for, what to install,
what to configure, how to start it) is only true once the project is there and the commands are
known.

It is written in the **client's language**, carried as a fact from the analysis step, never inferred
from the text. It is the only thing the developer produces that a person outside reads.

**Its failure does not fail the build.** The project is built, checked and paid for; throwing that
away to recover one document would cost the whole build again. The step says `documented: false`,
the driver is told, and `build.finished` carries `documented: no` so that a tool delivered without
instructions is a number and not a silence.

## 4. A build, step by step

1. **the plan**, once, recorded before anything is written;
2. **each file**: written, checked with the command its kind configures, repaired while it is
   refused;
3. **the preparation**, once, after every file is there — it cannot come first, because what a
   package manager reads is one of the files the plan names;
4. **the whole project**, checked with the stack's own command;
5. **the start**, the only check that passes by the command *not* finishing;
6. **the README**.

**A failure of step 4 or 5 is not repaired, and that is deliberate.** Repairing needs a file to
repair, and the output of a test run or a process that would not start does not say which file it
is. Picking one by resemblance to the text of an error is a guess; instead the build ends with that
outcome and the output goes on the step, where the driver reads it.

**Where a per-file check sits relative to the preparation.** Before it, so the feedback is
immediate. It costs one thing: a stack whose per-file check needs the dependencies installed cannot
be checked that way, and a stack like that configures `whole` and leaves `checks` empty.

## 5. The sandbox

Everything a build executes runs through `sandbox.py`:

- inside the build's own directory, which is the working directory **and** `HOME`. `HOME` matters:
  a package manager keeps its cache under it, and left alone a build would read and write the cache
  of whoever is running the developer;
- with an environment built here and nothing inherited — `HOME`, `PATH` and `TMPDIR`, and `PATH`
  comes from the configuration because where a runtime lives is a fact about the machine;
- under ceilings on processor time, file size and core dumps, applied in the child between fork and
  exec so that everything the command launches inherits them;
- inside the wrapper its profile names.

**Two profiles, and the difference is the network.** `preparation` may reach out; `closed` may not,
and everything else runs under it — writing files, checking them, starting the result. A webtool
that phones home while being checked is not something to run on this machine, and a check that
quietly needed the network would pass here and fail at the client's.

**What the wrapper is, is not the code's business.** It is a list of words from the configuration,
put in front of the command. On this machine it is `sandbox-exec` with a profile from
`webtools/configurator/sandbox/`; those two `.sb` files are read by `sandbox-exec` and never by us,
which is why no copy of them is deployed into the subsystem. No command runs without a wrapper: a
profile with no wrapper stops the subsystem at startup, because the absent thing in that case is the
confinement itself.

### 5.1 What is not enforced, and should be

- **The registries the preparation may reach.** `sandbox-exec` filters by kind of traffic, not by
  host, so the preparation profile allows outbound traffic and nothing narrows it to a list.
  Narrowing it needs a proxy that accepts those hosts and refuses the rest, with the package
  managers pointed at it. It is said in the profile itself rather than left looking enforced.
- **A ceiling on memory.** macOS refuses `RLIMIT_AS` whatever the number, so on this machine a build
  runs without it. It is probed at startup and said in the log: a number in a configuration that
  nothing enforces is worse than no number, because it reads as a guarantee.

## 6. The run, and what it writes

| Moment | What is written |
|---|---|
| trigger | step `development` `open`, state `DEVELOPMENT`, in one write |
| during | the plan and each file, into that open step (`PATCH .../steps/development`) |
| built | step `development` `passed`, state `ALPHA_TEST`, then step `alpha_test` `open` |
| not built | step `development` `failed`, state `FAILED`, and the client is told |

The refusal of a second trigger is decided on the **state**, never on whether an open step is there:
a project that has been through a phase has no open step for it.

**A restart does not resume.** The progress on the step is there to be read by a person; a developer
restarted mid-build leaves the project in `DEVELOPMENT` with its step open and its files on disk.
Resuming would mean deciding which of the written files to trust, and that is a decision with
nobody's name on it.

The closing step carries the stack, the directory, the files, whether it is documented, the notes
the doors wrote about their own work, **what it consumed per door and per kind**, the attempts and
the duration. The consumption is on the step and not taken from metrics, because that is what the
metered tier is priced from.

### 6.1 How a build can end

`built`, and then ten ways it cannot, each with its own name because each is a different thing to
do about it: `no_plan`, `too_many_files`, `preparation_failed` (somebody else's service),
`file_not_written`, `file_not_repaired` (the model), `whole_check_failed`, `start_failed`,
`attempts_exhausted` and `timed_out` (ceilings of ours), `broken` (a defect of ours).

## 7. Configuration

`webtools/configurator/configuration/developer.json` is the seed and the expected shape. Blocks:
`listen`, `access`, `limits`, `subsystems_infos`, `metrics`, `build` (the root and the ceilings),
`sandbox` (the path, the ceilings, the two profiles' wrappers), `stacks`, and one per door: `plan`,
`write`, `repair`, `readme`.

The keys are deep-merged from `webtools/configurator/secrets/developer.json`, outside git.

**Every step of a stack is optional and absence is honoured.** What is refused is a step that is
there and malformed — a command that is a string where it should be a list — because absent and
wrong are different things and only one of them is a decision somebody made.

## 8. The API

`POST /projects/{project_id}/development` → `202 {project_id, started: true}`.

Refusals, as a status and a stable code: `PROJECT_NOT_FOUND` (404), `PROJECT_NOT_READY`,
`DEVELOPMENT_ALREADY_STARTED`, `PROJECT_REJECTED` (409), `ANAGRAPHICS_UNAVAILABLE` (503),
`BODY_TOO_LARGE` (413), `IP_NOT_ALLOWED` (403).

## 9. What is measured

One phase per door (`development_plan`, `development_file`, `development_repair`,
`development_readme`) so that what the plan cost, what writing cost and what repairing cost can be
read apart. `ai.call` carries the tokens, once per call; nothing else does.

About the build itself: `build.planned`, `build.prepared`, `build.file_written`, `build.verified`,
`build.unchecked` (a file of a kind this stack has no check for — its own metric, because an
unchecked file and a file that passed are the opposite of each other), `build.repaired`,
`readme.written`, and `build.finished`, which is the number the price model rests on.
