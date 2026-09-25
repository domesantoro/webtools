# preanalyst-anagraphics-client

Path: `webtools/preanalyst/src/anagraphics.js`
Examined: 2026-09-25

The HTTP client towards anagraphics. Its header states a real contract — no exceptions towards the
caller, three reasons, error **codes** compared and never prose — and the body keeps it almost
everywhere: the transport failure, the non-JSON body and the 204 are all handled, and the real code
is kept in the log when the caller is told only "unavailable". Three findings, all about the same
thing: classes that anagraphics distinguishes explicitly and this client collapses.

---

## 1. "The project is not there" and "the route is not there" arrive as the same answer

- `webtools/preanalyst/src/anagraphics.js:46-48` — every 404 becomes `reason: "not_found"`
- Shape: **6 — the world narrowed to fit the code**
- Class: **the 404s anagraphics can answer.** It answers two different ones, on purpose and with
  stable codes: a resource that does not exist (`PROJECT_NOT_FOUND`, `DRIVER_NOT_FOUND`, …, raised
  by the endpoints) and `ROUTE_NOT_FOUND`, returned by the framework handler for a path that is not
  a route at all (`webtools/anagraphics/webtools_anagraphics/errors.py:62-66`). The codes exist
  precisely so the two can be told apart; this client puts them on one reason.
- The `code` is passed through (`:47`), and no caller of a `not_found` reads it. What the callers do
  with `not_found` is decide that the thing is absent, and carry on:
  - `webtools/preanalyst/src/ambassador.js:38` — `not_found` → `{ ok: true, uid: null }`: the
    project is created **with no ambassador**, so the referral, and half the fee, is dropped as if
    the invitation had never existed;
  - `webtools/preanalyst/src/project_driver.js:32` and `:38` — `not_found` → `NONE`: the discount
    code and the driver are silently ignored, and the project is priced without them;
  - `webtools/preanalyst/src/server.js:225` — `not_found` → `404 PROJECT_NOT_FOUND` to the client.
- The change that reaches it is one the repository makes routinely: subsystems are deployed and
  restarted one at a time, so preanalyst can be a version ahead of anagraphics and call a route that
  is not there yet. Every call so skewed reports, calmly and successfully, that the driver, the
  discount or the ambassador does not exist — and the projects created meanwhile carry that as
  fact.
- Severity: `latent`
- Smallest generalising change: let `ROUTE_NOT_FOUND` (and `METHOD_NOT_ALLOWED`) be `unavailable`,
  which is what they are — the service cannot answer this question — and keep `not_found` for the
  answer "there is no such thing".

## 2. A list that could not be read and a list that is empty become the same list

- `webtools/preanalyst/src/anagraphics.js:60-64` — `return { ok: true, data: result.data.drivers ?? [] }`
- Shape: **2 — invented value**
- Class: **the successful bodies `GET /drivers` may return.** Anagraphics returns
  `{"drivers": [...]}` (`webtools/anagraphics/webtools_anagraphics/main.py:293-295`). The `?? []`
  covers the case where that key is not there — that is, an absence — and fills it with the value
  that means "there are no drivers", which is a legitimate state of the system and is treated as
  one: `webtools/preanalyst/src/server.js:1024-1028` keeps `driversAvailable` **true**, shows the
  driver box, and resolves the link against an empty list, so a link that names a real driver comes
  back unresolved. The caller is careful to distinguish "the list could not be read" from "the list
  is empty" (`driversAvailable = driversResult.ok`); this line hands it the wrong one of the two.
- Severity: `latent`
- Smallest generalising change: if the field is not there, the answer was not the one contracted —
  `{ ok: false, reason: "unavailable" }`, as for a body that is not JSON.

## 3. The success class has two shapes, and each caller assumes the one it has met

- `webtools/preanalyst/src/anagraphics.js:34` (`{ ok: true, data: null }`, no `status`) against
  `:44` (`{ ok: true, data: payload, status }`)
- Shape: **6 — the world narrowed to fit the code**
- Class: **what `readJson` returns when it succeeds.** The same file declares two members a few
  lines apart, and neither consumer covers both:
  - `listDrivers` (`:63`) dereferences `result.data.drivers`. On the `204` member `data` is `null`
    and that is a `TypeError` — an exception out of the module whose header (`:3-5`) promises that
    it raises none, so it would land on the server's generic handler rather than on the caller's
    failure branch;
  - `status` is read at `webtools/preanalyst/src/server.js:351` to tell a repeated submission
    (`200`) from a new project (`201`). On the `204` member `status` is `undefined`, so the test is
    false and the answer is read as "a project was created".
  No call reaches either combination today — anagraphics returns `204` only from
  `DELETE /projects/{id}` and `DELETE /sessions/{token}`
  (`webtools/anagraphics/webtools_anagraphics/main.py:284,411`), whose callers look only at `ok`.
  The defect is that the shape invites it: the module publishes a union and every reader picks the
  branch it has seen.
- Severity: `stylistic`
- Smallest generalising change: return one shape from `readJson` — `status` always present, `data`
  always what the caller is entitled to expect — so that no reader has to know which of the two it
  was handed.

---

## Noted, not raised as findings

- `webtools/preanalyst/src/anagraphics.js:53-56` — 403 `IP_NOT_ALLOWED`, 405 `METHOD_NOT_ALLOWED`,
  500 and 503 all become `unavailable`. Two of those are permanent — an address missing from the IP
  list, a method the route does not have — and the page will offer "try again later" for as long as
  they last. The collapse is declared in the comment, and the real code is kept in the log, which is
  the honest version of a decision rather than a hidden assumption; recorded, not raised.
- `webtools/preanalyst/src/anagraphics.js:49-52` — mapping 400 and 409 onto one `rejected` is safe
  here because the distinction that matters travels in `code`, and the one caller that needs it
  reads it (`webtools/preanalyst/src/server.js:786`, `NOT_ENOUGH_TURNS`).
- `encodeURIComponent` is used on every interpolated path segment, without exception. Worth saying,
  since the opposite is the usual finding.
