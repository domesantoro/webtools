# front-gate-server

Path: `webtools/front-gate/src/server.js`
Examined: 2026-09-25

115 lines: a page from a template, a file from `public/`, and the language switcher. The smallest
server in the repository, and the containment check on the static path is done properly — the
normalised path is joined and then tested against the directory it must stay inside, with the
trailing separator that makes `startsWith` sound. Four findings.

---

## 1. The file that stops being readable takes the process with it

- `webtools/front-gate/src/server.js:72` — `createReadStream(file).pipe(response);`, with no
  `error` handler on the stream
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the outcomes of opening a file that `stat` has just described.** `stat` succeeding says
  the entry was there a moment ago, not that the bytes can be read: the open can fail with `EACCES`,
  the file can be replaced or removed between the two calls, and the read itself can fail. A
  `ReadStream` reports all of this by emitting `error`, and an `error` with no listener is an
  uncaught exception — the process ends. The handler's `try/catch` cannot help: the failure arrives
  after `writeHead` has already sent the status and the headers (`:68-71`), asynchronously, outside
  the call stack the `catch` covers.
- The gap between the two calls is not theoretical here: `public/` is written by the deployers
  (`webtools/configurator/style_deployer/deploy.sh` and the others copy `commons.css`, the loader
  and the fonts into exactly this directory), and a deploy is a thing somebody is entitled to do
  while the site is up. One request timed badly against a `cp` takes the site down until the runner
  is used.
- The same eight lines, with the same omission, are at
  `webtools/preanalyst/src/server.js:1237-1240`.
- Severity: `latent`
- Smallest generalising change: handle the stream's `error` — log it, and destroy the response
  rather than leaving a half-sent page — as the same file already does for `stat`.

## 2. The types of file the site may hold are enumerated, and the rest are offered as downloads

- `webtools/front-gate/src/server.js:27-32,69` — `CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream"`
- Shape: **1 — partial-class requirement**
- Class: **the files `public/` may contain.** Four extensions are named — `.css`, `.js`, `.svg`,
  `.woff2` — and they are exactly the four that are in there today (6 css, 9 js, 3 svg, 12 woff2
  across the three subsystems that serve files). A `.png`, a `.webp`, a `favicon.ico`, a `.json`, a
  `.pdf`: each of them is a legitimate thing to put in a showcase site's `public/`, and each is
  answered `application/octet-stream`, which browsers do not render but offer to save. The failure
  is silent, it happens for the visitor and not for whoever added the file, and the fallback reads
  as a considered default rather than as "we do not know".
- The same map, with the same four members, is written out three times:
  `webtools/sso/src/server.js:42-47` and `webtools/preanalyst/src/server.js:62-67`. A fifth type
  added to one of them is missing from the other two.
- Severity: `latent`
- Smallest generalising change: one shared table in `webtools/commons/`, and a file whose type is
  not known refused as a defect of the deploy rather than served as bytes.

## 3. The address is built from the `Host` header, before anything is guarded

- `webtools/front-gate/src/server.js:92` — `new URL(request.url, `http://${request.headers.host ?? "localhost"}`)`,
  one line **above** the `try` that wraps the whole handler
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the values `Host` may arrive with.** `new URL` throws on an authority it cannot parse.
  Thrown there, inside an `async` handler and outside its `try`, the exception becomes a rejected
  promise nobody awaits: the process ends, and the site is down until somebody restarts it. The
  `catch` two lines below exists precisely to turn a failure into a 500, and this one line sits
  outside it for no reason that the code gives.
- The same line is at `webtools/sso/src/server.js:365`, where it is already recorded as
  `uncertain`.
- Severity: `uncertain` — what would need to be known, and what is not asserted here: whether Node's
  HTTP parser can deliver a request whose `Host` header `new URL` refuses. The defect stands whatever
  the answer is (the line belongs inside the `try`); only its reachability depends on it.
- Also worth noting on its own: `?? "localhost"` invents an authority for a request that did not
  send one. Only `url.pathname` is used afterwards, so nothing today depends on the invented value —
  but it is an absence filled with a plausible-looking string rather than handled.

## 4. A lookup table that is safe because every key happens to start with a slash

- `webtools/front-gate/src/server.js:107` — `const template = PAGES[pathname];`, against
  `webtools/front-gate/src/page.js:21-30`
- Shape: **4 — capability inferred from resemblance**
- Class: **the strings that reach the lookup.** `PAGES` is a plain object literal, so it inherits
  `Object.prototype`: `PAGES["constructor"]`, `PAGES["toString"]`, `PAGES["__proto__"]` all answer
  with something truthy that is not a template, and `template` is tested for truth and then handed
  to `env.render`. What keeps a request from reaching them is that `url.pathname` always begins with
  `/` and every key in the table does too — a property of the URL class, established nowhere, doing
  the work of a containment check.
- Severity: `stylistic` — the code is correct for the class as it stands; the shape is the one that
  goes wrong the moment a lookup like this is built from a value that is not a path.
- Smallest generalising change: `Object.hasOwn(PAGES, pathname)`, or a `Map`, or
  `Object.create(null)` — any of them makes the table's keys the whole class of keys.

---

## Noted, not raised as findings

- `:52-58` — the containment check is the right shape: normalise, join, then verify the result is
  under `PUBLIC_DIR`, which ends in a separator (`:25`, `new URL("../public/")`) so a sibling
  directory called `public-something` cannot pass. The comment states the intent, and an escape is
  answered 404 rather than 403, which tells the caller nothing.
- `:100-106` — `decodeURIComponent` wrapped, with the reason ("an invalid `%`… no file can be called
  that"). A failure of the input treated as an outcome, not as an impossibility.
- `:97-99` — `HEAD` is admitted with `GET`, and the body written for it is discarded by Node's own
  `ServerResponse`. Correct, and it rests on a behaviour of the runtime that nothing in the file
  mentions.
- `:110-113` — `if (!response.headersSent)` before the 500. The one place where the two outcomes of
  a failed handler are distinguished; finding 1 is the case it cannot reach.
