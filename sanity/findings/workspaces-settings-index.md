# workspaces-settings-index

Paths: `webtools/webtools-workspaces/src/settings.js`, `webtools/webtools-workspaces/src/index.js`
Examined: 2026-09-26

Thirty-six lines and thirty-five, and both are the fourth copy of a file this audit has read three
times already — `diff` against `webtools/sso/src/index.js` is the subsystem's name and the extra
`(root: …)` on the startup line. Everything recorded against the earlier three holds here, and one
of those things has not yet been counted for this member.

`settings.js` is the better half. `absoluteRoot` (`:27-35`) is the only place in the repository
that takes a configured string apart, says what the two acceptable shapes are, explains why the
expansion cannot be left to JSON or to the shell, and refuses the third shape outright rather than
resolving it against whatever the working directory happens to be. It is quoted approvingly at
`findings/configurator-configuration-rest.md`.

---

## 1. The fourth `server.listen` with no `error` handler

- `webtools/webtools-workspaces/src/index.js:21-29` — `const server = createServer(settings);` then
  `server.listen(settings.port, settings.host, () => { … })`, with no `server.on("error", …)`
- Shape: **5 — only the success path**
- Class: **the outcomes of asking the operating system for a port.** Two of them, and the callback
  passed to `listen` is only ever called for one. `EADDRINUSE` — an ordinary event on a machine
  `CLAUDE.md` explicitly says runs other projects — emits `error` on the server, which nothing
  listens for, so Node turns it into an uncaught exception and the process dies with a stack trace
  six lines below a file that prints a sentence for its other failure (`:18`,
  "webtools_workspaces is not starting: …").
- This is the same finding as `summary.md` 10, 13 and 14, at the fourth of the four node
  subsystems. It is counted here rather than folded into those because it is a different file and
  this member had not been examined; what is not counted again is the observation that none of the
  four is a place where it could be fixed once.
- The consequence here is the quietest of the four and the most confusing: workspaces is called by
  programs, never by a browser, so nobody notices the absence directly. `webtools_workspaces.sh`
  sees the process die, prints "Start failed. Last lines of the log:" and shows the trace, and
  `webtools/configurator/start.sh:104-106` then stops the whole startup — correctly, and naming
  workspaces rather than the port.
- Severity: `breaks-now`
- Smallest generalising change: `server.on("error", …)` with the sentence this file already knows
  how to write, ideally in the one place the four subsystems could share.

---

## 2. The root is checked for its shape and never for being the right place

- `webtools/webtools-workspaces/src/settings.js:19-21,27-35` — `absoluteRoot` establishes that
  `storage.root` is absolute, expanding `~`, and refuses anything else. Nothing touches the path.
- `webtools/webtools-workspaces/src/index.js:23-29` — the startup line prints `(root: …)` and the
  server is declared up
- `webtools/webtools-workspaces/src/store.js:66` — `mkdir(dir, { recursive: true })`, at the first
  upload, is where the path is used for the first time
- Shape: **5 — only the success path**, with **6 — world narrowed to fit the code**
- Class: **the values `storage.root` may hold.** The shape check divides them into two: not
  absolute (refused, with a good message) and absolute (accepted). The second group is where the
  interesting members are, and none of them is distinguished:
  - a path the process cannot create or write — every upload is a `500 INTERNAL_ERROR`
    (`findings/workspaces-server.md` 1), discovered by a client rather than by the operator, with
    a code that names the wrong party;
  - **a path that is merely wrong** — and this is the member with no failure at all.
    `~/webtools_dat/workspaces` instead of `~/webtools_data/workspaces` is absolute, is under the
    home directory, and `mkdir(…, {recursive: true})` creates the whole tree on the first upload.
    Every write succeeds. A second, empty workspace root now exists, the specifications go into it,
    and the directory the operator looks at stays as it was. Nothing in the system is in a position
    to notice: the store does not decide, the server does not decide, and `settings.js` accepted
    it.
- The value is configuration, so the file is the seed and the number that counts is in Mongo
  (`webtools/configurator/README.md:26-28`): editing it there is the ordinary operation, and it is
  edited without a restart of anything that would check it.
- What is missing is not validation of the string — that is done, and well. It is that the one
  resource this subsystem exists to manage is never established at the moment it could still be
  reported: startup, where the file already has the right words for a refusal
  (`index.js:16-19`).
- Severity: `latent` — one configured value edited.
- Smallest generalising change: at startup, create the root and write into it, the way `writeSpec`
  will have to anyway, and refuse to start when it cannot — which also settles the hard-link
  requirement recorded at `findings/workspaces-store.md` 2. Failing that, print whether the root
  already existed on the startup line, so that "created a brand-new empty tree" and "found the one
  with the client's files in it" are not the same sentence.

---

## Noted, not raised as findings

- `index.js:31-35` — `server.close(() => process.exit(0))` on `SIGTERM` and `SIGINT`, byte for byte
  the same as `webtools/preanalyst/src/index.js:31-35`, `webtools/sso/src/index.js:31-35` and
  `webtools/front-gate/src/index.js:28-32`. Recorded at `findings/preanalyst-index.md`,
  `findings/sso-settings-index-page.md` and `findings/front-gate-settings-index-page.md`; this is
  the fourth copy and is not counted again.
- `index.js:24` — "The start script waits for this line before saying the server is up", with the
  line printed at `:25-28`. The two ends of the agreement recorded at
  `findings/front-gate-runner.md` 1; here the comment at least names the other party, which the
  other three do too.
- `index.js:14-20` — `ConfigurationError` is caught and printed as a sentence, and anything else is
  rethrown, which at the top level of an ES module becomes an unhandled rejection and a trace. Two
  outcomes, one answered and one deliberately not: an error that is not about the configuration is
  a defect, and a trace is the right answer to a defect.
- `settings.js:16-17` — "An internal subsystem: it answers only callers from the pool's IPs. It is
  a check on the connection's IP, **not an authorisation**." The distinction stated where the value
  is read, which is what keeps `server.js:8-9`'s "the caller does that" from reading as a claim
  that the pool is a permission system.
- `settings.js:22` — "A specification is text: 10 MB is already an awful lot", a configured limit
  with its reasoning next to the field that reads it.
- `settings.js` has no `allowedNext`-style fallback and no `??` anywhere: the "no default values"
  rule of `webtools/configurator/README.md:46-48` holds here without exception.
