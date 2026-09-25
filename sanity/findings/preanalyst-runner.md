# preanalyst-runner

Paths: `webtools/preanalyst/webtools_preanalyst.sh`, `webtools/preanalyst/package.json`
Examined: 2026-09-25

Start and stop. The script does what `CLAUDE.md` asks and does it carefully: the PID file is trusted
only after the process's command line has been checked, never a `pkill` and never a lookup by port;
the start waits for the server's own confirmation line and, if the process died, prints the tail of
**this run's** log by remembering the byte offset first (`:58-60`); the stop escalates to `SIGKILL`
only after ten seconds and says so. Three findings, all at the edges of the class of situations it
can meet.

---

## 1. Whether the command line can come back truncated is not established

- `webtools/preanalyst/webtools_preanalyst.sh:28-30` — `cmd="$(ps -p "$pid" -o command= 2>/dev/null)"`
  then `[[ "$cmd" == *"node"*" $ENTRY"* ]]`
- Shape: **4 — capability inferred from resemblance**
- Class: **what `ps` returns for a process.** The test needs the *whole* command line, because the
  path it looks for is at the end of it and `$ENTRY` is an absolute path — here already
  `/Users/domenico/workspaces/webtools/webtools/preanalyst/src/index.js`, and longer wherever the
  repository sits deeper. If the output is cut short, the pattern does not match and `running_pid`
  answers "this is not our server".
- What that costs is not symmetric. `--stop` then prints "webtools_preanalyst is not running",
  **removes the PID file** (`:89-92`) and returns success, while the server goes on running with the
  port held and no PID file left to find it by — which is exactly the situation `CLAUDE.md` forbids
  fixing with `pkill` or by port. The next `--start` finds no PID file, starts a second instance, and
  that one dies on the port with a stack trace (`findings/preanalyst-index.md`, finding 1).
- Severity: `uncertain`. What would need to be known, and what this audit does not assert: whether
  `ps -p <pid> -o command=` on the platforms this is run on (macOS here, Linux on a server) can
  truncate the command line — and at what width — when its output is captured rather than shown on a
  terminal. Guessing either way would be the defect being hunted.
- Smallest generalising change: ask for the full width explicitly (`ps -ww`), which costs nothing
  and removes the question.

## 2. The last-resort kill is the one outcome that is not checked

- `webtools/preanalyst/webtools_preanalyst.sh:103-105` —
  `kill -KILL "$pid" 2>/dev/null || true` followed unconditionally by `rm -f "$PID_FILE"`
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the outcomes of a `SIGKILL`.** Every other step of this script checks what happened: the
  PID file is verified, the process is confirmed dead in a loop, the failed start is distinguished
  from the slow one. This one line assumes success and, by `|| true`, deliberately discards the only
  evidence there was — a process that is not ours any more, one this user may not signal, a process
  stuck in an uninterruptible state.
- The PID file is then removed regardless, so the system is left in the same state as finding 1: a
  server that may still be holding the port, and nothing that names it. The script's own message
  says "sending SIGKILL", not "killed", so the operator has no reason to doubt it.
- Severity: `latent`
- Smallest generalising change: wait for it as the `SIGTERM` loop does, and if the process is still
  there, say so and keep the PID file — a stop that did not stop is news.

## 3. That node exists is checked; that it is a node this code can run on is not

- `webtools/preanalyst/webtools_preanalyst.sh:17` (`NODE="$(command -v node || true)"`) and `:40-43`,
  against `webtools/preanalyst/package.json:8-10` (`"engines": { "node": ">=20" }`)
- Shape: **1 — partial-class requirement**
- Class: **the node binaries that may be first on `PATH`.** The package declares which members of
  that class it works on; nothing establishes it. `engines` is advisory — it is enforced at install
  time by npm's configuration, not at run time, and this script does not install anything. The code
  needs a global `fetch` (Node 18) and `AbortSignal.timeout` (17.3), and `node --test` for the suite.
- The failure is loud, which is why this is not worse: on an older node the configuration read dies
  at startup and the script reports a failed start with the log. But the message is a `ReferenceError`
  where every other startup failure in this subsystem has a sentence
  (`webtools/preanalyst/src/index.js:18`), and the operator is told that the server would not start,
  not that their node is too old.
- Severity: `stylistic`
- Smallest generalising change: compare the version once, in the script, and refuse with a sentence —
  the one place where the requirement is already written down is two files away.

---

## Noted, not raised as findings

- `:56-84` — the three outcomes of a start (already running, died, alive but silent) are each
  handled, each with its own message, and the third deliberately leaves the process alone rather
  than killing what it does not understand. This is the shape the audit asks for.
- `:60,74,77` — the log offset is taken before the start so that the confirmation and the error tail
  are read from this run only. A log is an append-only class of lines, and it is treated as one.
- `webtools/preanalyst/package.json` — `package-lock.json` is present next to it, so the dependency
  ranges (`^0.128.0`, `^3.2.4`, `^0.20.2`, `^2.9.1`) resolve to fixed versions on install. The class
  of versions the provider code may meet is therefore pinned, which is what makes the `usage` field
  questions in `findings/preanalyst-prevalidator-ai.md` answerable at all.
