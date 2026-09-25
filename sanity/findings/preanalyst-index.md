# preanalyst-index

Path: `webtools/preanalyst/src/index.js`
Examined: 2026-09-25

Thirty-five lines: read the configuration, start listening, handle the two stop signals. The
configuration half is exactly right — a `ConfigurationError` stops the process with a readable line,
and any **other** error is re-thrown rather than swallowed (`:17`), which is the distinction most
startup files get wrong. Two findings, both on the half after it.

---

## 1. Only the start that succeeds is handled

- `webtools/preanalyst/src/index.js:23-29` — `server.listen(port, host, callback)`, with no
  `server.on("error", …)`
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the outcomes of asking for a port.** The callback is the one where it worked. The others
  are ordinary: `EADDRINUSE` (the port already taken — by an earlier instance, or by another
  project, which `CLAUDE.md` says explicitly is the situation on this machine), `EACCES`,
  `EADDRNOTAVAIL` when `listen.host` names an address this machine does not have — and `host` and
  `port` are configured values (`webtools/configurator/configuration/preanalyst.json:2-4`), read
  from Mongo, editable by whoever operates the system.
- With no handler the `error` event is an uncaught exception: the process dies with a stack trace
  where the file's own convention, eight lines earlier, is a sentence that says what is wrong and
  why the server is not starting. The consequence is bounded by the runner, which notices the
  process died and prints the tail of the log
  (`webtools/preanalyst/webtools_preanalyst.sh:70-76`) — so the reason does reach the operator,
  inside a stack trace.
- Severity: `breaks-now` — reachable as things stand, with no change to anything; the consequence is
  a worse message, not a lost start.
- Smallest generalising change: handle `error` on the server the way `ConfigurationError` is
  handled — one line saying the port could not be taken, and exit 1.

## 2. Shutdown handles the server that has nothing in flight

- `webtools/preanalyst/src/index.js:31-35` — `server.close(() => process.exit(0))`
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the states the server may be in when the signal arrives.** `close` stops new connections
  and calls back when the **last existing one** has ended. An analysis turn holds a response open
  for as long as the model takes — up to `analyst.conversation.timeout_ms`, 120 000 ms
  (`webtools/configurator/configuration/preanalyst.json:56`) — so the callback, and with it
  `process.exit(0)`, may be two minutes away. There is no bound, no second signal handling, and no
  forced exit.
- What actually happens is decided elsewhere: the runner waits 10 s and then sends `SIGKILL`
  (`webtools/preanalyst/webtools_preanalyst.sh:95-105`). So the request is cut anyway, the exit code
  is not the one this file intends, and the graceful path exists only for the case that did not need
  it. The two halves of one behaviour — how long we are willing to wait — are decided in two files,
  and only the shell one is a real decision.
- Severity: `stylistic`
- Smallest generalising change: decide the grace period here, from the configuration, and stop when
  it expires; or say in this file that the deadline is the runner's.

---

## Noted, not raised as findings

- `:14-20` — `if (!(error instanceof ConfigurationError)) throw error;` is the shape this audit
  asks for: the failure this file knows how to explain is explained, and the ones it does not know
  are not disguised as it.
- `:24-28` — the start line is a contract with the runner (`webtools_preanalyst.sh:77` greps for
  it), and the comment says so, so nobody rewrites it thinking it is prose.
