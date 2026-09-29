# commons-configuration-client

Path: `webtools/commons/configuration/configuration_client.js`
(generated copies in `webtools/{sso,webtools-workspaces,preanalyst,front-gate,configurator-fe}/src/commons/`)
Examined: 2026-09-26

The five copies were diffed against this original on the day of examination and are byte-identical.

One hundred and forty-seven lines, and the boundary through which five subsystems read every
configured value they have. It is written the way the rule asks in almost every respect: one method
per type, each throwing `ConfigurationError` naming the dotted path and what it expected, so the
message in the log says where to look (`:69-82`); `#fail` distinguishes "missing" from
`found null` (`:80`), which is the difference `CLAUDE.md` insists on; `httpUrl` restricts to
`http:`/`https:` with the reason written out — "a `javascript:` in an href is code run on click"
(`:130-132`); and `number` states in a comment that amounts do **not** come through it, because
those are integers in cents (`:110-111`).

Two findings, and the first is the only one that can change what a subsystem does.

---

## 1. Every list in the system is required to be non-empty, in the one method that reads lists

- `webtools/commons/configuration/configuration_client.js:122-128` —
  `stringList(path)` accepts only `Array.isArray(value) && value.length > 0 && …`, and throws
  "a non-empty list of strings" otherwise
- The callers: `access.allowed_ips` in three subsystems, `i18n.locales` in three,
  `login.allowed_next` in the sso, and `httpUrlList` (`:144-146`), which is built on it
- Shape: **6 — world narrowed to fit the code**
- Class: **the values a configured list may hold.** An empty list is not an absence — it is a
  present value meaning *none*, and this project is unusually clear that the two differ:
  `webtools/anagraphics/scripts/load_configuration.py:76-77` refuses to overwrite `null`, `0` or
  `false` because they are "values like any other", and
  `webtools/anagraphics/tests/test_load_configuration.py:27-37` tests exactly that. The accessor
  that reads lists makes the empty one unsayable, for every field, everywhere.
- At least one field has a meaningful empty value today. `login.allowed_next`
  (`webtools/configurator/configuration/sso.json:18-20`) is the set of addresses a login may return
  to; `[]` means "return to none of them", which is how one turns the redirect off. Set it and the
  sso does not start, with a message saying the list must be non-empty — a refusal to start for a
  configuration that is not wrong.
- The file shows the right shape two methods earlier: `integer(path, { min, max })` (`:104-108`)
  takes the per-field policy as a parameter and defaults to no policy, so a field that must be
  positive says so at its own call site. `stringList` takes no options and decides for every field
  at once.
- Severity: `latent` — one configured value edited, in Mongo or in the seed.
- Smallest generalising change: `stringList(path, { min = 0 } = {})`, with the callers that really
  need a member saying `{ min: 1 }`. `access.allowed_ips` genuinely must not be empty; the accessor
  is not the place that knows it.

---

## 2. The one address that does not go through the file's own address check is the one from the environment

- `webtools/commons/configuration/configuration_client.js:30-40` — `readBootstrap` checks that
  `WEBTOOLS_ANAGRAPHICS_URL` is a non-empty string and strips trailing slashes, and checks nothing
  else about it
- `webtools/commons/configuration/configuration_client.js:133-142` — `httpUrl`, in the same file,
  parses a value with `new URL` and requires `http:` or `https:`, "because these addresses end up
  in an href or in a fetch"
- `webtools/commons/configuration/configuration_client.js:45,49` — `anagraphicsUrl` then goes
  straight into a `fetch`, and `:66,76` keeps it on the `Configuration` object for every later call
  a subsystem makes to anagraphics
- Shape: **6 — world narrowed to fit the code**
- Class: **the strings `WEBTOOLS_ANAGRAPHICS_URL` may hold.** The file states the rule for this
  class — an address that is going into a `fetch` must be http or https — and applies it to the
  values that come from the configuration and not to the one that comes from the environment,
  although it is used for precisely the thing the rule names.
- The consequence is bounded and that is why it is `stylistic`: a value that is not an address
  makes `fetch` throw, the `catch` at `:53-55` turns it into a `ConfigurationError`, and the
  subsystem does not start. What is lost is the message. Instead of "WEBTOOLS_ANAGRAPHICS_URL must
  be an http(s) address, found …", which is what `httpUrl` would have said, the operator gets
  `GET javascript:alert(1)/configuration/sso: TypeError Failed to parse URL` — the same information
  filtered through another library's wording.
- The other reader of this variable does validate it, and strictly:
  `webtools/anagraphics/webtools_anagraphics/settings.py:63-69` requires scheme `http`, a hostname
  and an explicit port, and names the variable in its error. One variable, two readers, two
  standards.
- Severity: `stylistic`
- Smallest generalising change: run the value through the same `new URL` + protocol check before
  returning it — eight lines up from where `httpUrl` already does it.

---

## Noted, not raised as findings

- `:57-65` — `response.json()` is attempted before `response.ok` is consulted, so a `404` carrying
  `{"error": "CONFIGURATION_NOT_FOUND"}` produces a message naming that code (`:64`), and a
  non-JSON error body produces a message naming the status (`:61`). Both outcomes of a failing
  response are handled, and the ordering is what makes the better message possible.
- `:84-90` — `get` walks the dotted path and yields `undefined` as soon as the branch is not an
  object, so `string("a.b")` on a document where `a` is a string reports `a.b … missing`, naming
  the leaf when the branch is the problem. `webtools/anagraphics/webtools_anagraphics/settings.py:54-60`
  has the identical behaviour and the identical message: one diagnostic weakness, implemented twice
  by the two readers of the same documents.
- `:86` — the path is split on `.`, so a configured key containing a dot is unreachable through
  every accessor. The keys are authored in this repository, so the class is ours; recorded because
  it is the mirror image of `findings/anagraphics-db.md` 2, where a name from outside is turned
  into a dotted path.
- Every accessor is required-or-refuse: there is no way to read a field that may legitimately be
  absent. That is not a defect but the project's stated design — `CLAUDE.md`: "The subsystem reads
  it at startup and, if a field is missing, does not start… and no **default values**" — and no
  subsystem calls `get` raw to work around it (checked across all five `settings.js`). It is worth
  recording because the rule under audit also says that what only part of a class offers is
  optional, and in this one area the project has decided, explicitly, that nothing is.
- `:144-146` — `httpUrlList` validates the list and then re-reads each entry by index so that the
  error names `login.allowed_next.0` rather than the whole list. A diagnostic detail that cost a
  line and makes a misconfiguration findable.
- `:36-38` — `Number.isInteger(Number(timeout))` rather than a `.isdigit()`-style test, so
  `"5000.5"` and `"5e3"` are handled as what they are. The equivalent check in
  `webtools/anagraphics/webtools_anagraphics/settings.py:97` uses `str.isdigit()`, which is a
  different vocabulary (noted at `findings/anagraphics-settings-credentials-errors.md`).
- `:66` — the document is wrapped without checking that `body.subsystem` matches the subsystem
  asked for. Anagraphics returns the document it was asked for and the URL is built from the same
  argument, so the two cannot disagree without a defect elsewhere; the accessors would then fail on
  the first unknown path rather than on the mismatch.
