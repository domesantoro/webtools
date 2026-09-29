# commons-loader

Path: `webtools/commons/script/webtools_loader.js`
(generated copies in `webtools/{preanalyst,sso,front-gate}/public/webtools_loader.js`)
Examined: 2026-09-26

The three copies were diffed against the original on the day of examination and are identical.

Forty-nine lines, half of them comment, and the comments are about the right things: the veil is
raised only if `event.defaultPrevented` is false, because another script may have stopped the
submit — "that is why this script must be loaded **after** the ones that intercept the submit:
handlers are called in the order they were registered" (`:10-15`) — and the browser's
back-forward cache is handled explicitly, because it can hand the page back with the veil still up
(`:19-20`, `:46-48`). Both are members of the class that are easy not to think of, thought of.

The file's one assumption is in the sentence between them, and it is the first finding.

---

## 1. The veil never comes down, on the argument that the page changes anyway

- `webtools/commons/script/webtools_loader.js:17-18` — "The veil does not come down by itself:
  after a submission the page changes **anyway**, and a spinner disappearing while nothing has
  happened would be a lie."
- `webtools/commons/script/webtools_loader.js:28-31,40-43` — `raise()` is called on `submit` and
  there is no path that calls `lower()` except `pageshow` with `persisted` (`:46-48`)
- What it raises: `webtools/commons/style/commons.css:349-350` —
  `.webtools-loader { position: fixed; inset: 0; z-index: 90; … }` with
  `[data-on] { display: grid; }` and no `pointer-events`, so a raised veil covers the whole
  viewport and swallows every click beneath it
- Shape: **6 — world narrowed to fit the code**
- Class: **the submissions that really go.** The comment asserts that all of them end in a page
  change. Most do. The one that does not needs nothing but a user: **pressing Escape, or clicking
  the browser's stop button, cancels the navigation and leaves the page exactly as it was** — veil
  up, "working…" showing, every control underneath unreachable, and nothing in this file able to
  notice, because a cancelled navigation fires no event it listens for.
- The member is not a curiosity, it is the likely one. The form this veil exists for is the
  pre-analysis submission, which runs a prevalidation against a model: it is the one request in the
  product slow enough for a person to give up on. A user who does gets a page that says it is still
  working, for ever, and whose only exit is a reload — on the form they have just spent several
  minutes filling in.
- The comment's reasoning is sound about the case it names and is applied to the whole class: a
  spinner that disappears while nothing has happened would indeed be a lie, and so is a spinner
  that stays up when the request is gone. Both are lies; only one was written for.
- Severity: `breaks-now` — reachable today, with the code, the markup and the stylesheet exactly as
  they stand.
- Smallest generalising change: lower the veil on the events that mean the request is no longer in
  flight — `pagehide` is already the natural partner of the `pageshow` at `:46`, and the `submit`
  handler can set a timer to lower it after the configured request timeout. Either turns "the page
  changes anyway" from an assumption into a case that is handled when it does not.

---

## 2. The forms are enumerated once, over a page that is edited afterwards

- `webtools/commons/script/webtools_loader.js:38-44` —
  `var forms = document.querySelectorAll("form[data-webtools-loader]");` and a listener attached to
  each, at load time
- The page this runs on is edited after load:
  `webtools/commons/sso/sso_popup.js:86-92,109-112` replaces whole fragments with
  `node.innerHTML = html` after a login
- Shape: **6 — world narrowed to fit the code**
- Class: **the forms that carry `data-webtools-loader`.** The attribute is a declaration in the
  markup, and this file reads that declaration once, at the moment the script runs. Any form that
  enters the page later carries the attribute and not the behaviour — a form inside a replaced
  fragment, a form in a modal rendered on demand, a second page state. The two mechanisms are
  deployed together, to the same subsystem, by two deployers, and neither knows about the other.
- It does not bite today: the fragments the preanalyst replaces are the header, the login gate and
  the right-hand column, and the comment at `sso_popup.js:82-85` says the form is deliberately not
  among them ("Replacing too much carries away browser state as well — an already chosen file, for
  instance"). The moment a fragment does contain a marked form, that form submits with no veil and
  nothing anywhere reports it.
- Severity: `latent`
- Smallest generalising change: one delegated listener on `document` that checks
  `event.target.closest("form[data-webtools-loader]")` — the pattern `sso_popup.js:151-154` already
  uses for exactly this reason — so the declaration is read when the event happens rather than when
  the script loads.

---

## Noted, not raised as findings

- `:25-26` — `var veil = document.getElementById("webtools-loader"); if (!veil) return;`. A page
  that does not include `commons/loader.njk` gets nothing, silently and correctly: the markup is
  optional and its absence is an absence, not a default. The same file could have created the
  element and did not.
- `:41` — `if (event.defaultPrevented) return;`, with the ordering requirement it implies written
  out at `:10-15`, naming the other script (`gate.js`) and why handler registration order decides
  it. A dependency between two files that are loaded by a third, stated in the one that depends.
  Nothing enforces the order; `webtools/commons/templates/loader.njk:12-14` says where each comes
  from, and the page's `scripts` block is where it could go wrong.
- `:46-48` — `pageshow` with `persisted`, for the back-forward cache. The one non-obvious way the
  veil can come back up on its own, handled, with the reason.
- `commons/templates/loader.njk:18` — `role="status" aria-live="polite" aria-hidden="true"`, and
  the script keeps `aria-hidden` in step with `data-on` (`:29-30,34-35`). The visual state and the
  announced state changed together rather than one of them only.
- `commons/style/commons.css:355` — `@media (prefers-reduced-motion: reduce)` turns the spinner's
  animation off and keeps the colour that shows it is a spinner. A member of the class of readers
  served rather than assumed away.
