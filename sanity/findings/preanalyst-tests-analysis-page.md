# preanalyst-tests-analysis-page

Path: `webtools/preanalyst/tests/analysis_page.test.js`
(written 2026-09-25, after `sanity/inventory.md` was computed; row 73)
Examined: 2026-09-26

One hundred and thirty-seven lines, and the decision at the top of the file is the right one and is
argued: "The page is rendered with the **real catalogues and the real template**: it is the
rendering that has to be right, not a copy of it made here" (`:3-5`). Everything the audit has
recorded about assertions drawn from a reimplementation of the thing under test does not apply
here — the template, the macros and the catalogues are the ones that ship.

Two of the seven tests are about the distinction this project cares most about.
`:126-136`, "a step that never got there is not a ready written false by somebody", renders a chat
with `ready` **absent** and asserts the page looks the same as `false` — absent handled as absent,
tested as such. And `:95-97` asserts that the turns used are the client's messages rather than half
the message count, "because the analyst opens the conversation, so its own are one more": an
off-by-one that only exists because one member of the class behaves differently, pinned.

Three findings, all about the boundary the file draws around itself.

---

## 1. The configuration double implements the success path of three of eight accessors, and none of the refusals

- `webtools/preanalyst/tests/analysis_page.test.js:16-29` — "The configuration as the i18n client
  reads it: **the same fields**, out of a plain object", then
  `{ string: (path) => I18N_CONFIGURATION[path], stringList: …, integer: … }`
- The real thing: `webtools/commons/configuration/configuration_client.js:72-146` — `get`,
  `string`, `boolean`, `integer`, `number`, `port`, `stringList`, `httpUrl`, `httpUrlList`, each of
  which **throws** `ConfigurationError` naming the path when the field is missing or of the wrong
  type (`:79-82`)
- Shape: **6 — world narrowed to fit the code**
- Class: **the `Configuration` objects `loadI18n` may be given.** The double is faithful about the
  *values* — the comment says so, and it is true — and says nothing about the behaviour, which is
  the half that matters: the real object's defining property is that it refuses, and the double's
  is that it returns `undefined`.
- Two things follow, and they differ. A new accessor (`boolean`, `httpUrl`) fails loudly, because
  the double has no such method — that is the good half. A **new field** read with one of the three
  it does have returns `undefined` silently: `loadI18n` would build an `I18n` with, say,
  `cookieName: undefined`, `cookie()` would emit `undefined=it; Path=/…`, and these seven tests
  would go on passing, because none of them reads a cookie. The test suite would be green on an
  i18n that cannot set a language.
- What makes it worth recording rather than noting is that `loadI18n` has a real cross-field check
  — the fallback must be among the locales (`webtools_i18n.js:254-256`) — which this double is in
  the perfect position to exercise and does not, and which nothing else in the repository
  exercises either.
- Severity: `latent`
- Smallest generalising change: build the double out of the real class —
  `new Configuration("preanalyst", { i18n: { … } }, "http://…")` — which is one line, gives the
  refusals for free, and makes a missing field fail here instead of in a browser.

---

## 2. "A page that starts needing more will say so by failing" is true of some of what it could need

- `webtools/preanalyst/tests/analysis_page.test.js:5-6` — "The settings are the least the page
  asks for, written out: **a page that starts needing more will say so by failing**."
- `webtools/preanalyst/tests/analysis_page.test.js:33-39` — five settings, one of them nested
  (`analysis: { maxTurns, warnFromTurn }`)
- Shape: **6 — world narrowed to fit the code**
- Class: **the ways a template can use a new setting.** Two. A nested read —
  `settings.upload.maxBytes` — throws on `undefined` and the promise is kept. A scalar read —
  `settings.somethingNew` reaching the template through `src/page.js` — is `undefined`, and
  nunjucks renders `undefined` as the empty string with no autoescape complaint and no strict mode.
  The page renders, the assertions are about other markers, and the test is green for a page that
  is missing a value.
- The sentence is the whole justification for writing the minimal settings by hand instead of using
  the real `loadSettings`, so it is load-bearing: if it holds, the minimal object is a feature; if
  it holds for half the cases, the minimal object is a place for a setting to go missing quietly.
  It is the same shape as `findings/workspaces-tests.md` 1, where the server is tested on a
  hand-built settings object and the real one is joined to it by nothing.
- Severity: `latent`
- Smallest generalising change: say what is true — "a page that starts reading a new branch of the
  settings will fail here; a new scalar will not" — or render with nunjucks'
  `throwOnUndefined`, which makes the sentence true for the whole class and would also close
  `findings/commons-templates.md` 2.

---

## 3. An assertion written to accept either language stops asserting which one it got

- `webtools/preanalyst/tests/analysis_page.test.js:110` —
  `assert.match(html, /Va bene così|This is fine/);`
- `webtools/preanalyst/tests/analysis_page.test.js:31` — `ui` is built from a request with no
  headers (`{ headers: {} }`) and no cookie, so `localeOf` falls through to
  `this.fallbackLocale`, which `I18N_CONFIGURATION` sets to `"en"`: the language is **not**
  ambiguous, it is `en` by construction
- Shape: **6 — world narrowed to fit the code**
- Class: **the catalogue texts the page may render.** The alternation admits two members where the
  test's own setup determines one. What it buys is that the assertion keeps passing if the language
  changes; what it costs is that it no longer asserts that the page is in the language the settings
  asked for — a fallback silently becoming Italian, which `findings/claude-md.md` 3 shows is a
  configured value away, would leave this test green.
- It is the mirror of the `uncertain` already on the list for `webtools/sso/tests/i18n.test.js:50-51`,
  where an assertion on `Intl.NumberFormat`'s exact output had to be patched with `\s` to survive a
  difference between builds. Both are assertions loosened until they stop depending on the thing
  that varies; here the thing does not vary.
- Severity: `stylistic`
- Smallest generalising change: assert the English text, since English is what the configuration in
  this file selects — or, if the point is that *some* notice appears, assert the marker rather than
  a sentence, which the six other tests already do.

---

## Noted, not raised as findings

- `:53-58` — `chatLog` extracts the `<ol class="chat-log">` before looking for messages, "because
  the `<template>`s at the bottom of the page carry the same markup, and they are models to clone,
  not messages". A duplicate-markup hazard identified and handled. `hidden()` two functions below
  (`:61-65`) takes the **first** tag carrying the marker anywhere in the document and does not do
  the same; it is correct today because none of the four markers it is used with appears inside a
  `<template>`, and it would read the template's copy on the day one does.
- `:64` — `/ hidden(?![-\w])/`, with a negative lookahead so that `hidden-something` is not read as
  the `hidden` attribute, and a leading space so that `data-hidden` is not either. The two ways
  that check could be wrong, both closed.
- `:119-124` — three of the four combinations of `ready` and `turnsLeft` are exercised for the go
  button; `{ ready: true, turnsLeft: 0 }` — the analysis judged complete *and* the turns exhausted,
  which is the state where both reasons to enable it are true at once — is not among them.
- `:40-41` — `access` and `terms` are the minimum too (`logged: true`, `driverLink: {state:
  "none"}`, no ambassador, no autonomous work), so none of the seven tests renders the page for a
  project that arrived from a driver's link. The summary column of the analysis page
  (`docs/subsystems/preanalyst/README.md` §14.3) is the part that varies with those, and it is
  covered by nothing here. A coverage observation, of the same kind as
  `findings/preanalyst-tests-rest.md`.
- The file exists and is named by neither `docs/subsystems/preanalyst/README.md` §4.1 nor §11 nor
  `webtools/preanalyst/README.md`'s Tests section — recorded at `findings/docs-preanalyst.md` 1 and
  `findings/subsystem-readmes.md` 3.
