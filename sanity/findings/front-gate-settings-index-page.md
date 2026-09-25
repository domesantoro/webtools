# front-gate-settings-index-page

Paths: `webtools/front-gate/src/settings.js`, `webtools/front-gate/src/index.js`,
`webtools/front-gate/src/page.js`
Examined: 2026-09-25

Ninety-five lines between the three. `settings.js` is the shortest configuration in the repository
and the one that best shows the rule's second clause: the showcase site is public, so there is no
`access.allowed_ips` here and nothing stands in its place — an absent capability left absent rather
than given a permissive default. Three findings, two of which are the third copy of a defect already
recorded twice.

---

## 1. Only the start that succeeds is handled

- `webtools/front-gate/src/index.js:23-26` — `server.listen(port, host, callback)` with no
  `server.on("error", …)`
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the outcomes of asking for a port.** As at `webtools/preanalyst/src/index.js:23-29` and
  `webtools/sso/src/index.js:23-29`, word for word: a port already taken, a host this machine does
  not have, a port this user may not bind — none handled, all reachable from configured values, and
  the result is a stack trace from a file whose own convention six lines earlier is one readable
  sentence.
- The third copy. What was a defect in one file is now a property of the way this repository starts
  processes, and there is still no place where fixing it fixes it.
- Severity: `breaks-now`
- Smallest generalising change: the same six lines as the other two — which is the argument for
  their being one file.

## 2. Shutdown handles the server that has nothing in flight

- `webtools/front-gate/src/index.js:28-32` — `server.close(() => process.exit(0))`
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the states the server may be in when the signal arrives.** No bound on the wait, no
  second-signal handling, no forced exit; what actually decides is
  `webtools/front-gate/webtools_front_gate.sh`, which waits 10 s and sends `SIGKILL`. Identical to
  finding 2 of `findings/sso-settings-index-page.md` and finding 2 of
  `findings/preanalyst-index.md`. The front-gate streams files (`server.js:72`), so a slow client is
  the case that reaches it.
- Severity: `stylistic`

## 3. The pages are declared here and their templates are checked for at request time

- `webtools/front-gate/src/page.js:21-30` (`PAGES`) and `:35-40` (`env.render(template, …)`),
  reached from `server.js:107-108`
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the states the templates directory may be in.** `PAGES` names eight addresses and seven
  files; whether those files are there is discovered when a visitor asks for one. A template
  renamed, a deploy that copied some files and not others, a working tree checked out halfway: each
  of them turns into a `500 INTERNAL_ERROR` per visitor, with a nunjucks stack trace in the log,
  on a public site — and the first to find out is the visitor, not the operator who deployed.
- Everything needed to check it is in hand at startup: the list is a constant in this file, the
  directory is `:11`, and `index.js` already refuses to start on a configuration it does not like
  and says why. This is the same shape recorded for the preanalyst's policy files
  (`findings/preanalyst-analyst.md`, `findings/preanalyst-prevalidator.md`): a deployed artefact
  assumed present, so a deploy that did not deliver it fails at use time instead of at startup.
- Severity: `latent`
- Smallest generalising change: resolve the seven templates once at startup and refuse to start
  with the missing name in the message.

---

## Noted, not raised as findings

- `settings.js:14-16` — `httpUrl` is used for `preanalyst.url` with the reason written next to it
  ("a `javascript:` in there would be code run on click"). The class of values a configured string
  may hold, narrowed deliberately and at the right place.
- `settings.js` asks for no IP pool, no session, no body limit: the showcase site needs none of them
  and none is invented. `CLAUDE.md`'s "absent is absent, which is not a default", kept.
- `page.js:19-20` — the addresses are Italian because they are the addresses of the static site that
  came before ("the pages link to each other with `<name>.html`"), and the comment says so. Product
  addresses rather than internal identifiers; the templates are examined at unit 41.
- `page.js:38-39` — every page is given `preanalystUrl` and `standardPrice` whether it uses them or
  not. Harmless; recorded because the price is formatted per locale here (`ui.euro`), which is the
  right place for it.
- The lookup `PAGES[pathname]` itself is finding 4 of `findings/front-gate-server.md`.
