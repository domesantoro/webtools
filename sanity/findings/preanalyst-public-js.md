# preanalyst-public-js

Paths: `webtools/preanalyst/public/analysis.js`, `gate.js`, `rejection.js`, `upload.js`
Examined: 2026-09-25

The four browser scripts. They are the best-behaved code seen so far on the points this audit cares
about: no HTML composed from strings, no text in the JavaScript, every element that may be missing
tested before use (almost), the failure of every `fetch` caught and turned into one shown message,
`DataTransfer` wrapped because "browsers that do not allow it" exist (`upload.js:86-92`), the
composition input method treated as a real member of the keyboard class (`analysis.js:362-366`), and
a `content-disposition` that may not arrive given a fallback that is named and explained
(`analysis.js:297-304`). Four findings.

---

## 1. `<dialog>` is required by two scripts and tested by the third

- `webtools/preanalyst/public/gate.js:49` (`modal.showModal()`) and
  `webtools/preanalyst/public/upload.js:105`, against
  `webtools/preanalyst/public/rejection.js:19` — `if (!modal || typeof modal.showModal !== "function") return;`
- Shape: **1 — partial-class requirement**
- Class: **the browsers the page is opened in.** `showModal` is a capability only part of that class
  offers; one file in the same directory treats it as optional and the other two as guaranteed. The
  file that tests is the one where the absence is harmless (the modal simply does not open, and the
  header says so, `rejection.js:11-13`); the files that do not test are the ones where it is not.
- In `gate.js` the order makes it worse: `event.preventDefault()` has already run (`:47`) when
  `showModal()` throws. The submission is cancelled, no modal appears, and nothing else on the page
  reacts — the user presses "Send the request" and the page sits there, with no way forward. The
  header's promise for the degraded case — "Without JavaScript the form goes and the server answers
  that an account is needed" (`:29-30`) — is exactly what is lost: JavaScript is present, and it
  swallows the submission.
- In `upload.js` the same call leaves the upload button dead for a logged-out visitor.
- Severity: `latent` — it takes a browser without `<dialog>`, which is a member of the class the page
  is served to but not one that will be seen on the machine this was written on.
- Smallest generalising change: make the three files agree — test the capability once, and when it
  is missing let the submission through to the server, which already answers that an account is
  needed.

## 2. A number that is not there becomes zero, and zero turns is a real state

- `webtools/preanalyst/public/analysis.js:72-74` — `Number(panel.getAttribute("data-chat-turns-left"))`,
  and the same for `data-chat-warn-left` and `data-chat-credit`; also `:232`, `:266-267`, `:285`,
  `Number(result.data.turns_left)` and `Number(result.data.credit)`
- Shape: **2 — invented value**
- Class: **what an attribute or a response field may be.** `Number(null)` — the attribute is not
  there — is `0`; `Number(undefined)` — the field is not in the JSON — is `NaN`; `Number("")` is `0`
  again. All three are the answer "we do not know", and all three come out as a number that the page
  then treats as knowledge:
  - `turnsLeft = 0` hides the writing form and shows the out-of-turns box (`:123-125`): the client is
    told they have no turns left and offered a purchase;
  - `turnsLeft = NaN` does the same, since `NaN > 0` is false, and additionally makes
    `rounds + turnsLeft` print `NaN` in the sentence the catalogues built (`:121`);
  - `warnAtOrBelow = NaN` silently switches the "you are running out" warning off for ever
    (`:134`), with nothing to show that it is gone.
  The page's own header states the principle it breaks here: "the numbers come from the server"
  (`:3-6`) — but when they do not come, it supplies them.
- Severity: `latent` — the attributes are written by our template and the fields by our server, so
  reaching it takes a change to either (a renamed field, a response shape altered, a `<span>`
  dropped).
- Smallest generalising change: read the number and check it is one; if it is not, say so — the page
  already has a place to say that something went wrong — rather than continue with a value that
  means something else.

## 3. One element is used without the guard every other element gets

- `webtools/preanalyst/public/analysis.js:32` (`waiting`), used at `:196` and `:216`, against the
  guard at `:43` and the `if (x)` tests at `:120`, `:125`, `:126`, `:131`, `:136`, `:148-158`,
  `:178-180`, `:185`
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the elements the page may or may not contain.** This file handles that class three ways:
  six elements are required and the script gives up without them; a dozen are optional and tested at
  every use; and `waiting` is neither — it is queried like an optional one and used like a required
  one. If `[data-chat-waiting]` is not in the markup, the first `lock()` throws, which happens on the
  first message sent, after the client's text has already been removed from the field (`:210-213`).
- Severity: `stylistic` — the template does render it today.
- Smallest generalising change: add it to the guard at `:43`, where the elements this script cannot
  work without are already listed.

## 4. The sixth place that says the chat has exactly two roles

- `webtools/preanalyst/public/analysis.js:39-43` (`templates.client`, `templates.system`, both
  required), `:75` (`rounds` counted as `.chat-turn-client` elements), `:107-109`
- Shape: **6 — the world narrowed to fit the code**
- Class: **the roles a chat entry may carry.** After `analyst.js:68`, `analysis_validator.js:99`,
  `page.js:198`, `templates/analysis.njk:60` and `public/styles.css:340`, this is the sixth
  independent encoding of "there are two, and they are these". Here it is doubled: `append` would
  throw on a third role, and the count of turns used is derived from the number of elements carrying
  one particular class — so a third role rendered into the log would also shift the number the page
  shows.
- Severity: `stylistic` — this file only ever appends the two roles it knows, and the page it reads
  is rendered by the same assumption.
- Smallest generalising change: none in this file alone; it follows whatever the server decides.

---

## Noted, not raised as findings

- `webtools/preanalyst/public/rejection.js:22` — `window.location.href = modal.getAttribute("data-home")`.
  A missing attribute navigates to the string `null`, relative to the current page. The attribute is
  written by our template from a configured URL, so it is there; recorded because it is the same
  absence-becomes-a-value shape as finding 2, in its smallest form.
- `webtools/preanalyst/public/upload.js:30-31` — `zone.closest("[data-upload-messages]")` and then
  `.getAttribute` on the result, with no test, although `zone` itself is tested one line earlier
  (`:19-20`). Same shape as finding 3, in the other file.
- `webtools/preanalyst/public/upload.js:168-169` — `texts.errors[code] || texts.failed`: an error
  code with no text falls back to the generic message instead of showing a blank. The class of codes
  the server may send is open, and it is treated as open.
- `webtools/preanalyst/public/analysis.js:215-228` — the failure of a turn puts the client's text
  back into the field ("the only copy of it") and removes the message just shown. The outcome that
  fails is handled as carefully as the one that succeeds; it is worth recording as the example.
- `webtools/preanalyst/public/analysis.js:252-256` — the click handler re-runs the same check the
  disabled button already encodes, "because a click can arrive anyway". The browser's state is
  treated as evidence, not as a guarantee.
