# commons-sso-client

Paths: `webtools/commons/sso/sso_client.js`, `webtools/commons/sso/sso_popup.js`
(generated copies in `webtools/preanalyst/src/commons/sso_client.js` and
`webtools/preanalyst/public/sso_popup.js`)
Examined: 2026-09-26

Both copies were diffed against the originals on the day of examination and are identical.

Three hundred and thirty-nine lines, of which about a third is the explanation of why the ticket
round trip exists at all (`sso_client.js:10-35`, `sso_popup.js:7-39`) — why a cookie cannot cross
two addresses, why the session token must not travel in a URL, why a popup and not a tab. The
`currentSession` contract at `:121-128` names the distinction the whole design turns on and says
why it matters: "`{ ok: false, reason: "unavailable" }` the sso does not answer: **we do not
know**. The last case is not to be confused with 'not logged in': treating it as a logout would
throw everybody out at every sso failure."

`urlWithoutTicket` (`:174-178`) rebuilds the return address from `settings.publicUrl` rather than
from anything the request claimed, which is the answer to the `Host`-header class that
`summary.md` has twice recorded as `uncertain` against the sso's and the front-gate's servers.

Three findings.

---

## 1. Every answer that is not a 2xx becomes "the sso does not answer"

- `webtools/commons/sso/sso_client.js:66-68` —
  `if (response.ok) return { ok: true, data: payload };` then
  `return { ok: false, reason: "unavailable", code: payload?.error };`
- The three callers that branch on it: `currentSession:134`, `claimTicket:145`,
  `saveSessionLocale:161`, each `if (!result.ok) return result;`
- Shape: **6 — world narrowed to fit the code**, with two facts arriving as one answer
- Class: **the answers the sso can give.** The sso's own header lists a contract with codes —
  `webtools/sso/src/server.js:17-19`, "The JSON routes' errors follow the project's contract:
  correct HTTP status and a stable code" — and it has real ones: `TICKET_MISMATCH` (`auth.js:20`,
  a ticket issued for a different service), `MISSING_TOKEN`, `INVALID_BODY`. Each is a definite
  statement about what happened. All of them arrive here and leave as the single word
  `unavailable`, which in this file's own vocabulary means the opposite: that nothing was learned.
- The `code` is carried alongside, and no caller reads it — the two places in
  `webtools/preanalyst/src/server.js` that read a `.code` (`:241`, `:869`) are reading the
  workspaces client and anagraphics, not this one. So the information survives the boundary and
  dies at the first `if`.
- The member that makes it concrete: `publicUrl` is a configured value
  (`webtools/configurator/configuration/preanalyst.json`), and `claimTicket` sends it as `service`
  (`:143`). Set it to an address the sso did not issue the ticket for and every login returns
  `TICKET_MISMATCH` — a precise, actionable fact — which the client reports to the user as "the
  login service is unavailable". Nothing in the logs of the subsystem says otherwise:
  `:67` prints the status and the code, and the page shows the other word.
- Severity: `latent` — one configuration value edited, or one new error code on the sso's side.
- Smallest generalising change: distinguish the two shapes the same way the file already
  distinguishes them in prose — `reason: "unavailable"` for the network failure and the unreadable
  body (`:55`, `:63`), and `reason: "refused"` with the code for an answer that arrived and said
  no. The callers then have something to branch on, and "we do not know" keeps meaning that.

---

## 2. The session cookie cannot be marked `Secure`, and the value that decides it is in hand

- `webtools/commons/sso/sso_client.js:86-95` —
  `` `${settings.cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=…` ``, with the
  comment "No Secure because there is no HTTPS on localhost: **outside here it must be added**"
- `webtools/commons/sso/sso_client.js:34-35` — `settings.publicUrl`, "its own public address",
  which is exactly the value that says whether the deployment is https
- The same shape in the other cookie writer, with no comment at all:
  `webtools/commons/i18n/webtools_i18n.js:219-221`
- Shape: **6 — world narrowed to fit the code**
- Class: **the deployments this client may run in.** Two: over http, and over https. The first is
  the one in front of the author, and the second is not expressible — not misconfigured, not
  defaulted, simply absent, with a comment instructing a future person to edit a shared file that
  five subsystems copy. It is the same narrowing as
  `findings/configurator-load-configuration.md` 1, where one value has to be both a bind address
  and a dial address because only the single-host case was written for.
- The comment is what keeps this `stylistic` rather than worse: the requirement is stated at the
  boundary, in the file that owns it, which is what the rule asks of a partial-class property. What
  the rule also asks is that the code not be narrowed to make the statement necessary, and here it
  need not be: `settings.publicUrl` is already a parameter of this module and already starts with
  `https:` or it does not.
- Severity: `stylistic`
- Smallest generalising change: `settings.publicUrl.startsWith("https:") ? "; Secure" : ""`. Then
  the comment can say what is true — that the flag follows the address — instead of what somebody
  must remember.

---

## 3. A fragment the page cannot find is skipped, and the page then reports itself up to date

- `webtools/commons/sso/sso_popup.js:109-112` —
  `function replace(selector, html) { var node = document.querySelector(selector); if (node &&
  typeof html === "string") node.innerHTML = html; }`
- `webtools/commons/sso/sso_popup.js:86-92` — every key of `data.fragments` is passed through
  `replace`, and then `markState(data.logged)` and the `webtools:sso-login` event fire
  unconditionally
- Shape: **5 — only the success path**
- Class: **the fragments the server names.** The server decides both the selectors and their
  contents — "the server says which fragments to replace and with what: nothing here knows what
  they contain" (`:82-85`), which is the right division. What the division leaves undefined is what
  it means for a named fragment not to be there, and the code answers by doing nothing and saying
  nothing.
- It is reachable by an ordinary edit on the other side of the boundary: a container's `id` or
  class changed in a template while `webtools/preanalyst/src/page.js` still names the old selector.
  The login then half-works — the header updates, the login gate does not, or the reverse — and
  because `markState` and the event still run, the page marks itself logged in and everything
  waiting on `webtools:sso-login` resumes against a page that was only partly refreshed. The
  `.catch` at `:94-98` is there for the failure that *is* handled ("Nothing is updated and nothing
  is broken: the page stays as it is, and a reload is enough"); this one produces neither state.
- Severity: `latent`
- Smallest generalising change: count the selectors that matched and log the ones that did not —
  this file already uses `console.error` for the two failures it recognises. A fragment the server
  asked for and the page does not have is a mismatch between two files that are deployed together,
  and it should say so.

---

## Noted, not raised as findings

- `webtools/preanalyst/templates/login_done.njk:8-12` — "The text is for the cases where the
  closing does not happen: JavaScript off, a window opened by hand, or something gone wrong. **No
  window should be left speechless.**" This is the answer to the case
  `sso_popup.js:50-64` does not handle: `closeAfterLogin` with no `window.opener` falls through to
  `window.close()`, which a browser refuses on a tab it did not open. Reaching that state is easy
  — middle-clicking the login link produces `auxclick`, not the `click` the handler at `:151`
  listens for, so the browser opens the login in a tab of its own. The member is real, and it is
  handled, at a different boundary, with the reason written there and a catalogue text telling the
  user to go back and reload (`en.json`, `preanalyst.login_done.ok_text`). Recorded as an example
  of the rule applied across two files rather than as a finding.
- `sso_popup.js:156-158` — the `message` listener checks both `event.origin` and `event.data`
  before acting, and `:55` names the recipient origin on the `postMessage` although the two are the
  same origin ("The recipient is declared all the same"). Both directions of a channel constrained
  explicitly.
- `sso_popup.js:35-36` — "HTML is not built here: it comes from the server, rendered by the
  templates. This file holds only addresses and nodes to replace." The `CLAUDE.md` rule about HTML
  in templates, restated at the one place in the browser code where HTML is inserted.
- `sso_popup.js:114-121` — `window.open` must come from a click "because it is the only way to be
  able to close that window from inside afterwards", and `:123-127` leaves the link's real `href`
  to work when the popup is blocked. Two outcomes of asking for a window, both handled.
- `sso_client.js:30-33` — `cookieName` "must differ from the sso's and from the other subsystems',
  because cookies ignore the port and on 127.0.0.1 they all end up in the same pile". A constraint
  across subsystems, written where the value is used and enforced by nothing. It is the same shape
  as `findings/configurator-configuration-rest.md` 1, which is about the cookie that must be the
  **same** everywhere; this is its twin, about the cookies that must all differ. Recorded there.
- `sso_client.js:58-64` — a body that is not JSON is `unavailable` with the status logged, which is
  the correct reading (the sso's contract says every JSON route answers JSON, so anything else
  means something in between answered). It is the one case where `unavailable` is exactly right.
