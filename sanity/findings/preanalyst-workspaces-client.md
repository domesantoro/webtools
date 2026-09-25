# preanalyst-workspaces-client

Path: `webtools/preanalyst/src/workspaces.js`
Examined: 2026-09-25

Two calls towards webtools-workspaces: store a specification, read the latest one back. The module
declares the same contract as the anagraphics client — no exceptions towards the caller, a `reason`
that says *how* it went wrong — and `storeSpec` keeps it in full. Three findings, all in the second
function or in the gap between the two.

---

## 1. Every 404 is "there is no specification", and the code that would say otherwise is never read

- `webtools/preanalyst/src/workspaces.js:65` — `if (response.status === 404) return { ok: false, reason: "not_found" };`
- Shape: **6 — the world narrowed to fit the code**
- Class: **the 404s workspaces can answer.** It answers two, with distinct stable codes:
  `SPEC_NOT_FOUND`, from the endpoint, when the project has no stored specification
  (`webtools/webtools-workspaces/src/server.js:104`), and `ROUTE_NOT_FOUND`, from the router, when
  the path is not a route at all (`webtools/webtools-workspaces/src/server.js:135`). This function
  does not merely collapse them: it never reads the body, so the code does not even reach the
  return value — unlike `storeSpec`, which carries `code` on every failure (`:43`, `:45`).
- The caller turns it into a page: `webtools/preanalyst/src/server.js:898` answers `404 not_found`,
  telling a client that their project has nothing stored when the truth may be that preanalyst is
  calling a route this version of workspaces does not serve — a version skew between two subsystems
  that are deployed and restarted separately. The rejection PDF is then unobtainable and the reason
  is a sentence about the project.
- Severity: `latent`; the second site of the pattern recorded at
  `findings/preanalyst-anagraphics-client.md`, finding 1.
- Smallest generalising change: read the body on the 404 as `storeSpec` does, keep the code, and let
  "this route does not exist" be `unavailable` — which is what it is.

## 2. The body of the read is taken without the guard the sibling function has

- `webtools/preanalyst/src/workspaces.js:70` — `return { ok: true, data: await response.text() };`,
  against `:32-38`, where the same module wraps the body read in `try`/`catch`
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the ways a response body can end.** `fetch` resolves as soon as the headers are in; the
  body is still arriving, and the same `AbortSignal.timeout` covers it
  (`:58`). A transfer that is cut, or that outlives the timeout, makes `response.text()` reject —
  and the rejection leaves the module as an exception, breaking the promise its own header makes
  ("no exceptions towards the caller", `:3-4`). The caller
  (`webtools/preanalyst/src/server.js:897-899`) has branches for `not_found` and for
  `unavailable` and none for a throw, so it lands on the generic handler: a `500` where the module's
  contract says `503`.
- The two configured values that govern it are both editable by someone entitled to:
  `subsystems_infos.workspaces.timeout_ms` is 5 000
  (`webtools/configurator/configuration/preanalyst.json:15-17`) and a specification may be up to
  `storage.spec_max_bytes` = 10 MB (`webtools/configurator/configuration/workspaces.json:8`) —
  10 MB is what the upload channel allows a client to send. Lowering one or raising the other, on a
  link slower than a loopback, is all it takes.
- Severity: `latent`
- Smallest generalising change: read the body inside the same `try` that the JSON path already uses.

## 3. The two calls read a response by two different sets of rules

- `webtools/preanalyst/src/workspaces.js:12-46` against `:52-71`
- Shape: **6 — the world narrowed to fit the code**
- Class: **the responses workspaces may send.** One function parses the body always and carries
  `code` on every failure; the other never parses and carries none. One distinguishes `rejected`
  (400, 413) from `unavailable`; the other has no `rejected` at all, so a `400 INVALID_PROJECT_ID`
  from `GET …/specs/latest` (`webtools/webtools-workspaces/src/server.js:100`) is reported as the
  service being unavailable, and a `405` is too. Each function handles the statuses its own call
  has been seen to produce, rather than the statuses the service produces.
- Severity: `stylistic` — no caller is wrong today; the shape is the one that goes wrong when a
  third call is added and copies whichever of the two it started from.
- Smallest generalising change: one `readResponse` for the service, as the anagraphics client has,
  with the content type as a parameter.

---

## Noted, not raised as findings

- `:42-45` — 400 and 413 are `rejected`, everything else `unavailable`, and the code is kept. That
  matches what workspaces actually sends: every error there goes through `sendError`, so the body is
  always `{"error": "<CODE>"}`, 413 included
  (`webtools/webtools-workspaces/src/server.js:45-46,52-60`). The enumeration is correct for the
  class as it stands, and it is local to the service it speaks to.
- `:11` — the comment records that the origin is decided by the caller and written by the service
  over whatever the file declares. A property established at the boundary that owns it, stated in
  the place that has to know.
- Both calls `encodeURIComponent` the project id, and the callers validate it beforehand with
  `isProjectId`.
