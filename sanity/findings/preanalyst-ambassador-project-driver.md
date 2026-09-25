# preanalyst-ambassador-project-driver

Paths: `webtools/preanalyst/src/ambassador.js`, `webtools/preanalyst/src/project_driver.js`
Examined: 2026-09-25

The two modules that decide who brings a project in — the ambassador who invited the client, and the
driver and discount carried by a link — re-read from anagraphics at submission time, because "a
hidden field is not proof". Both submission paths are careful in the way this audit asks for: they
separate "not found" from "anagraphics did not answer", and on the second they refuse the submission
rather than record a project with the invitation quietly missing (`ambassador.js:28-29,38-39`;
`project_driver.js:16-18,32,38`). Three findings, all on the *other* half — the page.

---

## 1. An ambassador who could not be checked and one who does not exist are both `null`, and then the uid is thrown away

- `webtools/preanalyst/src/ambassador.js:20-24` — `resolveAmbassador(params, drivers, ownDriverUid)`
  returns a driver or `null`, with the drivers list as its only source of truth
- Shape: **2 — invented value**, with **6**
- Class: **the answers to "is this uid a driver?".** There are three: yes, no, and we could not find
  out. The signature can express two. The third arises whenever `GET /drivers` failed — the caller
  then does not even call this function and sets `ambassador = null`
  (`webtools/preanalyst/src/server.js:1036-1039`) — or whenever the list came back without that
  driver for a reason other than their absence (see finding 2).
- The consequence is not cosmetic, because the hidden field lives **inside the box**: the template
  renders `<input type="hidden" name="ambassador">` only within the box
  (`templates/partials/ambassador_box.njk:19-21`), and the box is drawn only if the ambassador was
  resolved (`webtools/preanalyst/src/page.js:128-130`). So a `null` here does not merely hide a name:
  it stops the uid reaching `POST /submit`, where `ambassadorOf` — the code that knows how to tell
  "not a driver" from "anagraphics is down" — would have looked it up properly. The project is
  created with no ambassador, half the fee is not owed to anybody, and nothing anywhere records that
  an invitation was presented.
- The same file, twenty lines earlier, states the principle for the other case and applies it: "when
  nothing could be resolved, what arrived is sent back — **if the failure is ours, the user must not
  pay for it**" (`webtools/preanalyst/src/page.js:40-43`), and `hiddenFields` duly carries
  `params.driverUid` through when the driver list could not be read. The ambassador's uid, arriving
  the same way in the same URL, is not.
- Severity: `breaks-now` — anagraphics being unreachable or slow while a page renders needs no
  change to anything, and it is an ordinary event in a system whose subsystems are restarted
  individually.
- Smallest generalising change: carry the ambassador's uid to the submission whenever it arrived,
  independently of whether the box could be drawn, and let `ambassadorOf` — which already handles
  all three answers — be the one place that decides.

## 2. The ambassador is looked for in a list that does not promise to contain them

- `webtools/preanalyst/src/ambassador.js:23` — `drivers.find(…) ?? null`, over the list from
  `GET /drivers`
- Shape: **4 — capability inferred from resemblance**
- Class: **the drivers an ambassador may be.** This module opens by stating its class explicitly:
  "An ambassador is a driver, **enabled or not**" (`:3`) — and rightly, since inviting a client has
  nothing to do with being cleared to supervise projects. It then resolves them out of a list
  assembled for the opposite purpose: the driver box, which exists to choose who will supervise, and
  which treats a non-enabled driver as unusable (`driver_link.js:80,99`).
- Nothing in `GET /drivers` promises either completeness or the inclusion of non-enabled drivers; it
  returns a bare array (`webtools/anagraphics/webtools_anagraphics/main.py:293-295`). Filtering that
  list to the enabled ones is a change somebody is entitled to make, on the strength of its main
  consumer, and it would silently delete precisely the members this module says it serves. The
  pagination case recorded in `findings/preanalyst-driver-link.md` (finding 2) lands here too, and
  by the path of finding 1 above it is unrecoverable: no box, no hidden field, no ambassador.
- Severity: `latent`
- Smallest generalising change: ask the question that has an answer for this class —
  `GET /drivers/{uid}`, which `ambassadorOf` already uses at `:36` — instead of searching a list
  gathered for another purpose.

## 3. The same rule written twice, over two different inputs

- `webtools/preanalyst/src/ambassador.js:20-24` (`params`, i.e. the URL) and `:30-39` (`form`, i.e.
  the hidden fields)
- Shape: **6 — the world narrowed to fit the code**
- Class: **the ways an ambassador can fail to count.** The header lists them once (`:5-12`), and
  they are then implemented twice, from two different sources, with two different sets of checks:
  `resolveAmbassador` does not look at autonomous work at all — the header says "the CSS switches
  the box off", so for the page the rule is enforced by a stylesheet
  (`public/styles.css`, the `:has()` rule) — while `ambassadorOf` re-derives it from the form. A
  rule added or changed in one of the two will not be in the other, and the two disagree in the
  direction that shows a client something the server will then not honour.
- Severity: `stylistic` — the server's half is the one that decides, and it is the complete one.
- Smallest generalising change: express the conditions once, over a value both callers can build,
  and let each read its own source into that value.

---

## Noted, not raised as findings

- `webtools/preanalyst/src/project_driver.js:32,38` — `not_found` → `NONE`, anything else →
  `{ ok: false }` and the submission is refused. This is the shape the audit asks for, and it is the
  direct counter-example to `driver_link.js:57-63`: the same class, read correctly here and
  collapsed there.
- `webtools/preanalyst/src/project_driver.js:39` — `driver.data.enabled !== true`, again the safe
  direction, and consistent with the two sites in `driver_link.js`.
- `webtools/preanalyst/src/ambassador.js:33` repeats the precedence rule by testing the presence of
  the `discount` and `driver` **fields** rather than whether they resolved to anything. It is the
  right reading of "something else already says who brings the project", and it is unreachable
  through the page (the two boxes are mutually exclusive), so a hand-made POST carrying a bogus
  discount plus a real ambassador loses the ambassador. Recorded rather than raised: the precedence
  is declared, and the caller is forging the request.
- `webtools/preanalyst/src/project_driver.js:22` — `NONE` is a shared object returned by reference
  to every caller. Not a class-rule matter; noted so it is on the record.
