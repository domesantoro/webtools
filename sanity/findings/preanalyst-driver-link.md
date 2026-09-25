# preanalyst-driver-link

Path: `webtools/preanalyst/src/driver_link.js`
Examined: 2026-09-25

Reads the `?discount=` / `?driver=` link and turns it into one of nine named states. The file is
unusually explicit about its class: the nine states are listed in the header, exported as constants,
and the two that count as "recognised" are held in one set (`:51`). It also gets the careful things
right — `enabled !== true` rather than `enabled === false`, so a driver document with no `enabled`
field is not taken for an enabled one; the comparison on `uid` and not on `username`, with the reason
given; both parameters together handled, logged and decided. Two findings.

---

## 1. "We could not read the discount" is shown to the client as "it has expired"

- `webtools/preanalyst/src/driver_link.js:57-63` — `if (!result.ok) return { state: DISCOUNT_EXPIRED, … }`,
  with the comment "Both a non-existent code and a technical failure: for the user the discount
  simply does not apply."
- Shape: **2 — invented value**
- Class: **the ways `findDiscount` can fail.** The client it calls distinguishes them on purpose and
  says so in its own header (`webtools/preanalyst/src/anagraphics.js:7-9`): `not_found` means the
  code is not there, `unavailable` means anagraphics could not answer — timeout, 5xx,
  `DATABASE_UNAVAILABLE`, a body that is not JSON. Both become one state whose name, and whose text,
  assert a fact about the code.
- The text the client reads is an assertion, not a hedge: "This discount code cannot be applied:
  most likely it has expired." (`webtools/commons/i18n/locales/en.json:77`). A client holding a
  perfectly valid code is told it has expired, and invited to go ahead without it; the natural
  reactions — abandon, or go and ask the driver for a new code — are both caused by a statement
  nobody established.
- The window is real but narrow, and worth stating exactly: the box is only drawn when the driver
  list was read successfully (`webtools/preanalyst/src/server.js:1023-1028` — if that call fails
  there is no box at all), so this state needs `GET /drivers` to succeed and `GET /discounts/{code}`
  to fail. Two separate requests, each with its own timeout: a Mongo hiccup, a 503 or a restart
  between them is enough, and no change to code or configuration is needed.
- What is **not** lost is the money: the hidden `discount` field still travels with the form
  (`webtools/preanalyst/src/page.js:47-49`) and the terms are settled again at submission
  (`webtools/preanalyst/src/server.js:329-333`), where `project_driver.js:32` does distinguish
  `not_found` from a failure. So the same class is read two ways in two modules, and only the page
  collapses it.
- Severity: `breaks-now` — reachable as it stands; the damage is a false statement to the client, not
  a lost discount.
- Smallest generalising change: keep the two apart, as the layer below already does — a tenth state,
  or the existing one with a text that says what is true ("we could not check this code now").

## 2. The driver list is assumed to be the whole list, because today it happens to be

- `webtools/preanalyst/src/driver_link.js:92-98` — "No extra read: the driver list has already been
  loaded, and **holds every driver**. If the uid is not in there, it exists nowhere else."; the same
  reliance at `:67`
- Shape: **4 — capability inferred from resemblance**
- Class: **the answers `GET /drivers` may give.** Completeness is a property of the endpoint, and
  the endpoint does not state it: the response is a bare `{"drivers": [...]}`
  (`webtools/anagraphics/webtools_anagraphics/main.py:293-295`) with nothing to say whether it is
  whole. What makes the claim true today is a comment inside another subsystem's data layer — "No
  pagination: there are few drivers" (`webtools/anagraphics/webtools_anagraphics/db.py:183`) — and
  that comment describes a decision taken while the drivers are few, which is the one thing about
  them that is meant to change.
- The day a limit or a page is added — the ordinary response to a list that has grown, made in
  anagraphics, by someone with no reason to open this file — every link belonging to a driver
  outside the first page resolves to `driver_unknown` or `discount_driver_missing`. Both are states
  that mean "this driver no longer exists", both are shown to the client as such, and the project is
  created with a driver assigned by us instead of the one who brought the client in. Nothing fails,
  nothing is logged, and the referral is gone.
- Severity: `latent`
- Smallest generalising change: do not deduce absence from a list — ask the question that has an
  answer (`GET /drivers/{uid}`, which this module already imports and uses at `:152`) when the uid
  is not found in the list, or have the endpoint say that what it returned is everything.

---

## Noted, not raised as findings

- `:148-163` — `driverLinkOfProject` also collapses "the driver is gone" and "anagraphics did not
  answer" into `NONE`, but here it is a declared decision with a reason given (`:145-147`: the
  project is already assigned, and telling the client now would do them no good), and the state it
  falls back to asserts nothing. The difference with finding 1 is precisely that: silence versus a
  claim.
- `:80`, `:99` — `known.enabled !== true`, twice, with the reason in the header (`:31-33`): a driver
  whose `enabled` was never written is not taken for an enabled one. The projection that feeds it
  (`DRIVER_SUMMARY`, `webtools/anagraphics/webtools_anagraphics/db.py:21`) does include `enabled`,
  and would simply omit the key for such a document — which is the case this line is written for.
- `:120-134` — a link carrying both parameters is a real member of the class of links, handled
  explicitly, decided with a reason, and logged because it is probably somebody's mistake. Worth
  keeping as the example of the shape this audit asks for.
