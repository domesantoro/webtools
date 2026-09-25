# sso-settings-index-page

Paths: `webtools/sso/src/settings.js`, `webtools/sso/src/index.js`, `webtools/sso/src/page.js`
Examined: 2026-09-25

The three small files around the server: what the configuration must contain, how the process
starts and stops, and what data each page is given. `settings.js` is a model of the configuration
rule — no defaults, one field per line with the reason for it written next to it, and the process
refusing to start on a missing field. `page.js` keeps every scrap of HTML out of the code and says
why ("this is not the place for something that works *if you remember*"). Five findings; the first
two are the same two already recorded against `webtools/preanalyst/src/index.js`, in a file that
repeats it line for line.

---

## 1. Only the start that succeeds is handled

- `webtools/sso/src/index.js:23-29` — `server.listen(port, host, callback)`, with no
  `server.on("error", …)`
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the outcomes of asking for a port.** `EADDRINUSE`, `EACCES`, `EADDRNOTAVAIL` for a
  `listen.host` this machine does not have — all ordinary, all reachable from configured values
  (`webtools/configurator/configuration/sso.json:2`), and none of them handled. The `error` event
  with no listener is an uncaught exception: a stack trace, in a file whose own convention six lines
  earlier is a sentence saying why the server is not starting.
- Identical to finding 1 of `findings/preanalyst-index.md`, in a second subsystem. Two files, one
  defect, and neither of them is the place where it could be fixed once.
- Severity: `breaks-now`
- Smallest generalising change: as for the preanalyst — handle `error`, say the port could not be
  taken, exit 1. Both files want the same six lines, which is an argument for their being one file.

## 2. Shutdown handles the server that has nothing in flight

- `webtools/sso/src/index.js:31-35` — `server.close(() => process.exit(0))`
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the states the server may be in when the signal arrives.** `close` calls back when the
  last connection has ended; nothing here bounds the wait, handles a second signal or forces an
  exit. What actually decides it is the runner, which waits 10 s and sends `SIGKILL`
  (`webtools/sso/webtools_sso.sh:94-104`) — so the grace period is a decision taken in the shell
  script and this file's graceful path only ever runs when it was not needed.
- The sso's own exposure is smaller than the preanalyst's (no request here waits on a model), which
  changes the consequence and not the shape.
- Severity: `stylistic`
- Smallest generalising change: as for `findings/preanalyst-index.md` — decide the deadline here,
  from the configuration, or say in this file that it is the runner's.

## 3. An address to return to that cannot exist, and would be wrong if it did

- `webtools/sso/src/settings.js:48` — `const fallback = settings.allowedNext[0] ?? "/";`
- Shape: **2 — invented value**
- Class: **the return addresses this function may produce.** Everything downstream treats the result
  as an **absolute** address: `serviceOf` takes its origin and `withTicket` does `new URL(next)`
  (`tickets.js:49,60`). `"/"` is neither — `new URL("/")` throws, so the fallback half of this line
  would take down the request that reached it. It is written as a safety net and is the one value
  in the class the rest of the module cannot handle.
- It is unreachable, and that is the interesting part: `allowedNext` comes from `httpUrlList`, which
  goes through `stringList`, which refuses an empty list
  (`webtools/commons/configuration/configuration_client.js:121-128`). So the `??` guards against
  something another module has already made impossible, and nothing here says so — the line reads as
  if the empty case were real and handled, when it is neither.
- Severity: `stylistic`
- Smallest generalising change: drop the fallback and rely on the contract, or state the contract
  here. An invented value that cannot be reached still teaches the next reader that inventing one
  is the way.

## 4. Two addresses are the same address, and the comparison is textual

- `webtools/sso/src/settings.js:50-52` — `next === base || next.startsWith(`${base}/`)`
- Shape: **4 — capability inferred from resemblance**
- Class: **the spellings of one address.** URL equality is not string equality: the same subsystem
  is `http://127.0.0.1:9200`, `http://127.0.0.1:9200/`, `http://127.0.0.1:9200/./x`, and with an
  uppercase host or an explicit default port it is the same origin spelled differently. The check
  admits some of these by accident (the trailing slash passes the `startsWith`) and refuses others,
  and what happens on a refusal is silent: the user is sent to `allowedNext[0]` — a **different
  subsystem** if the list has more than one entry — with only a `console.warn` to say so.
- The configured list itself already holds two spellings of one place (`127.0.0.1:9200` and
  `localhost:9200`, `configuration/sso.json`), which is the class making itself visible: the
  configuration compensates for the comparison by enumerating the spellings the callers happen to
  use. A third spelling from a legitimate caller is treated as an attempt at an open redirect.
- The intent — refusing an address outside our own — is right and is stated (`:44-46`), and
  `httpUrl` strips the trailing slash from each configured base deliberately, which shows the
  problem was seen at the other end.
- Severity: `latent`
- Smallest generalising change: compare origins with `new URL`, so that one address is one address
  and the list holds places rather than strings.

## 5. An error the renderer does not know becomes "the service is unavailable"

- `webtools/sso/src/page.js:37,49` — `ERRORS.includes(error) ? error : "unavailable"`
- Shape: **2 — invented value**
- Class: **the reasons a login page may have to show.** The list has two members, and a third — one
  the server starts passing — is not refused, not logged and not left blank: it is shown to the user
  as an outage, which is a statement about our own system and is false. Nothing anywhere records
  that a text was asked for and not found.
- The guard exists for a good reason (an unchecked key would be an interpolation into a catalogue
  lookup) and today `server.js` passes only the two members (`:225,263,270`). The defect is the
  choice of what to do with the rest: the one branch that says something untrue.
- Severity: `latent`
- Smallest generalising change: refuse the unknown key loudly — a log line, and no error box —
  rather than answering with a different error.

---

## Noted, not raised as findings

- `settings.js:8-42` — the configuration rule kept exactly: every value read from anagraphics, no
  default, no environment variable, and the reason for each field written where the field is. The
  cookie-name comment (`:25-29`) is a class observation of the right kind — cookies ignore the port,
  so on `127.0.0.1` every subsystem shares one jar.
- `index.js:14-20` — `ConfigurationError` explained, everything else re-thrown. As in the
  preanalyst: the distinction most startup files get wrong, got right here.
- `index.js:24-28` — the start line is the runner's contract (`webtools_sso.sh:77` greps for it).
- `page.js:22-32` — `autoescape: true` with its reason, and `noCache: false` justified by the fact
  that templates change only on a deploy. Both are statements about the class of values that reach
  the HTML, not about the values in front of the author.
- `page.js:45,57` — `noindex: true` on both pages.
