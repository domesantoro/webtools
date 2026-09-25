# Subsystem `preanalyst` (the preanalysis gate)

Full documentation of the **pre-analysis**: the page the client enters the flow from, and the
subsystem that holds the specification rounds. Today it contains:
- the form of questions, which on submission creates the project with its pre-specification;
- the upload of a ready-made specification for an existing project;
- the provenance from a driver's link;
- logging in;
- the **prevalidation** of the scope, the first gate of the flow (§16);
- the analysis page, with the specification rounds (§14.3).

> Last updated: 2026-09-24 · subsystem version: `0.23.0`.

Code: `webtools/preanalyst/`. Short guide: `webtools/preanalyst/README.md`.

---

## 0. Quick sheet

| Item | Value |
|---|---|
| What it does | The pre-analysis page (form, provenance from `discount` or `driver`, logging in), the form submission (§14), the upload of a specification (§14.4), the analysis page |
| Stack | Node 23 · the `node:http` module · **nunjucks** for the pages and the pre-specification · **yaml** for the front matter · **@anthropic-ai/sdk** for the prevalidator · **pdfkit** for the refusal PDF |
| Code | `webtools/preanalyst/` |
| Start (background, detached from the terminal) | `webtools/preanalyst/webtools_preanalyst.sh --start` |
| Stop | `webtools/preanalyst/webtools_preanalyst.sh --stop` |
| Process | `…/node …/webtools/preanalyst/src/index.js` |
| PID / Log | `webtools/preanalyst/webtools_preanalyst.pid` / `webtools/preanalyst/webtools_preanalyst.log` |
| Address | `http://127.0.0.1:9200` |
| Depends on | `webtools_anagraphics` (9100), `webtools_sso` (9300), `webtools-workspaces` (9400) |
| Database | None: it has no state of its own |
| Access | The page is public and can be filled in while logged out. The account is needed to **go on** (§7) |
| Tests | `npm test` (`node --test`): 16 tests (§11) |
| State | Submission, upload and prevalidation connected. The analysis page counts the turns and stores the chat on the project; **fake** are the model's answer and the purchase of turns (§14.3.2) |

Quick check, with the servers running:
```sh
open http://127.0.0.1:9200/
open "http://127.0.0.1:9200/?discount=e8013cf2-34eb-4bc3-8a34-b08fb24a1bf3"
open "http://127.0.0.1:9200/?driver=7633be3d-e701-42ca-9fea-6c6d1bb4b7d1"
```

---

## 1. Purpose and role in the system

In the flow (`contesto/02. contesto_aggiornato.md`,
`struttura/design/Sequence.drawio.pdf`) the client arrives from the showcase site `front-gate` and
enters the **preanalysis ecosystem**: they state their need, on their own with the *self analysis
prompt* or with the form assisted by our AI. `preanalyst` is the front door of that piece.

Of all this, today there is only the first part: **who the reference driver is**. If the client
arrives from a driver's link — with a **discount code** or with the **driver's uid** alone — the
choice is already made and is not touched.

It is not connected to the `front-gate` yet: the showcase site's "Inizia" button does not lead
here.

---

## 2. Functional choices

- **The page is rendered by the server.** The browser receives the HTML already complete: the
  driver box arrives filled in and the discount's state is already decided.
- **The browser never talks to `anagraphics`.** The reads start from this server. Anagraphics only
  accepts calls from known IPs (`access.allowed_ips` of its configuration): if the browser made
  them, it would work while everything sits on the same Mac and would break on the day of the
  first real deploy. On top of that, the drivers' internal data does not end up in a public page.
- **Two ways of arriving from a driver, one effect on the page.** `?discount=` and `?driver=` both
  lock the choice; the first carries a discount, the second does not. The logic is the same, the
  message to the user changes.
- **The driver is not chosen.** Either the link the client arrived with brings one, or we assign
  one: there is no field to fill in and no way of changing it from the page.
- **The driver box is seen only by whoever arrives from a driver's link**, that is, with
  `?discount=` or `?driver=` in the URL. For everybody else there is nothing to say: no box, a
  single column, and not even a call to anagraphics.
- **Nothing stops the pre-analysis.** An expired discount, a vanished driver, an unreachable
  driver list: in every crooked case the form stays there and can be filled in. An optional field
  cannot block a page, so `GET /` **always** answers `200`.
- **What arrives in the URL is not lost.** `discount` and `driver` stay attached to the form as
  hidden fields even when they could not be resolved: if the failure is ours, the user must not
  pay for it with a lost discount.
- **One notice at a time**, above the field, in plain language and with no error codes.
- **Dry texts.** The questions and the notices say what to write and what it is for, and nothing
  else: no motivational tone, no compliments to the client, no advertising of the method. The
  claims can be checked — «ogni cosa che escludi qui è un giro di domande in meno» yes, «la
  domanda più utile di tutte» no. The rule is at the top of `src/questions.js` and in `CLAUDE.md`.

---

## 3. Technological choices

- **Node with `node:http`**, no framework: the routes are few and the server does a handful of
  things — reading a few URLs, rendering templates, serving static files.
- **nunjucks** for the pages and for the pre-specification, with autoescape on for the HTML and
  **off** for the markdown of the pre-specification, which is not HTML (§14.2). The HTML does not
  live in the code: see §4.1 and §2 of `src/page.js`.
- **yaml** for the specifications' front matter, **pdfkit** for the refusal PDF,
  **@anthropic-ai/sdk** for the prevalidator's provider (§16.1).
- **Global `fetch`** (Node ≥ 18) with `AbortSignal.timeout` towards anagraphics, the sso and
  workspaces.

---

## 4. Architecture

### 4.1 File map

```
webtools/preanalyst/
├── package.json       # name webtools_preanalyst, type=module, dependencies: nunjucks, yaml, pdfkit, @anthropic-ai/sdk
├── README.md          # short guide
├── webtools_preanalyst.sh    # CONTROL: --start / --stop (nohup + a verified PID file)
├── webtools_preanalyst.pid   # generated by --start, removed by --stop
├── webtools_preanalyst.log   # generated by --start (appended)
├── src/
│   ├── index.js       # STARTUP: reads the configuration (or exits with 1), listen, the confirmation line, SIGTERM/SIGINT
│   ├── settings.js    # loadSettings(): the `preanalyst` configuration from anagraphics → the server's settings
│   ├── anagraphics.js # HTTP client: drivers, discounts, projects, pipeline steps, users; never exceptions to the caller
│   ├── workspaces.js  # HTTP client towards webtools-workspaces: storeSpec(), latestSpec()
│   ├── prespec.js     # the form's answers → the .md pre-specification (§14.2)
│   ├── prevalidator.js   # THE FIRST GATE: reads the model's answer and decides (§16)
│   ├── rejection_pdf.js  # the PDF of the form data after a refusal (§16.5)
│   ├── driver_link.js    # the states of the provenance: resolveDriverLink(), isResolved()
│   ├── project_driver.js # driver and discount checked again at submission time (§14.5)
│   ├── ambassador.js     # ?ambassador=: resolveAmbassador() for the page, ambassadorOf() for the submission
│   ├── questions.js   # THE QUESTIONS of the form, as data: this is the file to refine
│   ├── page.js        # prepares the page's DATA; the HTML lives in templates/
│   ├── server.js      # routing: the routes of §7
│   ├── prevalidator.js  # the first gate: the six outcomes and the verdict (§16)
│   ├── prevalidator_ai/ # the PREVALIDATOR's AI structure (§16.1)
│   │   ├── webtools_prevalidator_ai.js # its door: loadPrevalidatorAiSettings(), decide()
│   │   └── providers/anthropic.js      # its Anthropic provider, with the official SDK
│   ├── analyst.js       # the analysis chat: the turn (§17)
│   ├── analysis_validator.js # the second judgement on the analysis (§17)
│   ├── analyst_ai/      # the CHAT's AI structure — no file in common with the above
│   │   ├── webtools_analyst_ai.js      # its door: loadAnalystAiSettings(), converse()
│   │   └── providers/anthropic.js      # its own Anthropic provider, its own client
│   └── commons/
│       ├── configuration_client.js # a COPY generated by the deployer: do not edit here
│       ├── sso_client.js   # a COPY generated by the deployer: do not edit here
│       ├── spec_front_matter.js # a COPY generated by the deployer: do not edit here
│       └── i18n/           # a COPY generated by the deployer: the languages engine and the catalogues
├── policies/
│   └── scope-v1.md    # a COPY generated by the deployer: the original is in configurator/policies/
├── templates/
│   ├── page.njk            # the page
│   ├── login_done.njk      # the small page that closes the login window
│   ├── analysis.njk        # the analysis page: the specification rounds
│   ├── message.njk         # a page with a message: the outcomes that went wrong
│   ├── macros/fields.njk   # the fields, drawn from the data of questions.js, holding the answers already given
│   ├── partials/driver_box.njk  # the driver box
│   ├── partials/access.njk # the header and the login modal, as macros
│   ├── partials/driver_work.njk # the autonomous work block
│   ├── partials/ambassador_box.njk # the ambassador box
│   ├── partials/upload_box.njk  # the block for uploading a specification
│   ├── partials/rejection_dialog.njk # the refusal modal (§16.4)
│   ├── fragments/          # the header and the driver column, on their own, for /session-fragment
│   └── commons/            # COPIES generated by the deployer: base.njk, loader.njk, locale_switch.njk
│       └── prespec.md.njk  # the pre-specification (markdown, with no autoescape); the original is in configurator/documents/
├── scripts/
│   ├── prevalidate.js      # tries a policy on a file: it makes a real call, so it costs (§16.8)
│   └── examples/           # five pre-specifications, one per outcome and one for the flag
├── tests/
│   ├── prevalidator.test.js # how the model's answer is read and what is done with it
│   └── server.test.js       # the counting of the rounds of whoever has been sent back
└── public/
    ├── styles.css     # the LOCAL style of these pages
    ├── gate.js        # the submission gate: logged out it opens the login modal, and once the login is done it sends
    ├── analysis.js    # the specification-rounds chat (§14.3)
    ├── upload.js      # the upload of a ready-made specification
    ├── rejection.js   # opens the refusal modal
    ├── sso_popup.js   # a COPY generated by the deployer: do not edit here
    ├── webtools_loader.js # a COPY generated by the deployer: do not edit here
    ├── commons.css    # a COPY generated by the deployer: do not edit here
    ├── fonts/         # a COPY generated by the deployer: do not edit here
    └── assets/
        └── mark.svg   # copied by hand from front-gate/assets/ (the brand is not in the deployer)
```

### 4.2 The path of a request to `/`

0. If the address holds `?ticket=…`, the browser is coming back from the login: the ticket is
   exchanged with the sso, the session cookie is set and the browser is sent back to the same
   address without the ticket (§6.1). Otherwise the cookie is read and the sso is asked who it is.
1. `server.js` accepts only `GET` (the other methods get a `405`).
2. If there is **neither** `discount` nor `driver`, everything is skipped: no box, no call to
   anagraphics, the page is composed with the form alone.
3. Otherwise `listDrivers()` calls `GET /drivers` on anagraphics.
   - If it fails, the box says so and the form stays: the page is `200` all the same.
4. `resolveDriverLink()` looks at the URL parameters and decides the state (§5).
   - With `?discount=<code>` it makes a **second read**, `GET /discounts/{code}`.
   - With `?driver=<uid>` it **reads nothing**: the driver list is already in hand and holds all
     of them, so it is enough to look the uid up in there.
5. `renderPage()` composes the HTML and the server answers `200`.

---

## 5. The provenance in the URL

A driver can send a client here in two ways, and they are two different parameters:

| Parameter | What it is | Discount |
|---|---|---|
| `?discount=<code>` | A **discount code**: the `discount_code` UUID of the `discounts` collection | Yes, the code's |
| `?driver=<uid>` | A driver's **uid**: the `uid` UUID of the `drivers` collection | **No**, none |

In both cases, if the driver is found, the choice arrives **already made and locked**. What
changes is the discount downstream and the message to the user.

The possible states are defined in `src/driver_link.js`:

| State | When | What the user sees |
|---|---|---|
| `none` | Neither of the two parameters | No box |
| `discount_applied` | The discount was read **and** its driver exists and is enabled | The driver's **name**, and the green notice with the percentage |
| `discount_expired` | Reading the discount **fails** | "It cannot be applied: in all likelihood it has expired. Go on anyway: we will assign the driver" |
| `discount_driver_missing` | The discount was read, but its `driver.uid` cannot be found | "The driver can no longer be found. Contact them for a new code" |
| `discount_driver_disabled` | The discount was read, but its driver has `enabled` other than `true` | "The driver it is linked to, X, is not enabled to supervise projects, and we cannot go on with them. Contact them". The discount code does **not** travel with the form |
| `driver_applied` | `?driver=` with a uid that exists, driver enabled | The driver's **name**, and nothing else: there is no notice |
| `own_link` | The discount or the link belong to **whoever logged in** | No box: the autonomous work block explains it (§6.3) |
| `driver_unknown` | `?driver=` with a uid that does not exist | "This link's driver can no longer be found. Contact them" |
| `driver_disabled` | `?driver=` with a driver who is not enabled | "This link's driver, X, is not enabled to supervise projects, and we cannot go on with them. Contact them" |

In the `discount_applied` and `driver_applied` states the driver is **recognised**: there is a name
to show and a `uid` travelling with the form as a hidden field. The set is the `RESOLVED` constant
in `driver_link.js`, and the page asks `isResolved()` instead of listing the states by hand. In the
other cases no driver is sent: we assign one after reading the request.

### 5.1 If both parameters arrive

**`discount`** wins, and `driver` is ignored.

It is the only one of the two carrying an economic effect: following `driver` would take away a
discount the user is entitled to, while the opposite, at worst, gives them the discount of the link
they really arrived from. A link with both parameters is almost always a mistake by whoever built
it, though, so the case goes in the log:

```
[preanalyst] link with discount and driver together: discount wins (discount=…, driver=…)
```

### 5.2 `driver_unknown` does not cost an extra read

`?driver=` does not query `GET /drivers/{uid}`: the driver list has already been loaded to fill the
box and holds **all** of them, so the uid is either in there or does not exist. A second read would
give the same answer later.

It follows that `driver_unknown` does not tell "a deleted driver" from "an invented uid": to the
page they are the same thing, and the message is the same.
### 5.3 Why `discount_expired` also covers the technical failure

`discount_expired` fires both on the `404 DISCOUNT_NOT_FOUND` (the code does not exist) and on the
technical failure (anagraphics down, Mongo down, a timeout, a `403`, a `500`). The user is told
"in all likelihood it has expired" in either case.

It is a **deliberate simplification**, explicitly asked for: for whoever is in front of the screen
the outcome does not change, the discount does not apply, and there is no point in explaining that
an internal service is not answering. But the two things **are not the same**, so the difference
stays in the log:

```
[anagraphics] /discounts/xxx: HTTP 404 DISCOUNT_NOT_FOUND     ← a code that does not exist
[anagraphics] /discounts/xxx: TypeError fetch failed          ← the service is unreachable
```

It is to be revisited once the discount has a real economic value: saying "expired" while the
service is down makes whoever was entitled to a valid discount lose it (§13).

### 5.4 The driver's name when they cannot be found

The name shown comes from the **copy duplicated inside the discount** (`driver.screen_name`), not
from the `drivers` collection: if the driver is no longer in the list, that copy is the only thing
left for making the user understand who they must contact. If that is missing too, the notice
limits itself to saying that the driver cannot be found.

### 5.5 How the driver travels

When the driver is recognised, their `uid` is put in an `<input type="hidden" name="driver">`
attached to the form with `form="gate-form"`. There is no visible control to fill in: the box is
informative, the datum travels hidden.

On submission the value **is checked again on the server** (`linkTermsOf()` in
`src/project_driver.js`): a hidden field does not stop anybody from sending whatever they like. The
discount is read again (`GET /discounts/{code}`) and the project's driver becomes the discount's;
the driver is read again (`GET /drivers/{uid}`) and counts only if they exist, are `enabled: true`
and are not the person filling the form in. If it does not count, the driver and the discount fall
together and the system assigns the driver. If anagraphics does not answer, the submission is not
recorded (`503`).

### 5.6 The ambassador (`?ambassador=<uid>`)

The ambassador is a driver who invited the user to use webtools: if the project goes through, half
of the system fee is theirs. The **Invito** box shows their name and the sentence «Ti ha invitato a
usare webtools.», and appears only if:

- there is neither `?discount=` nor `?driver=` in the URL (with either of them, `ambassador` is
  ignored);
- the uid is a driver's, looked up in the list of `GET /drivers` (enabled or not: to invite, being
  registered as a driver is enough);
- whoever logged in is not that driver;
- the autonomous work checkbox is not ticked: ticked, the box disappears
  (`:has(#autonomous-work:checked)`, with no JavaScript).

In every other case, the unreachable driver list included, the box is not there and the page says
nothing. The uid travels in the hidden `ambassador` field.

**On submission it is checked again** (`ambassadorOf()`): the same conditions, with the autonomous
work, the link and one's own uid read from the form and from the session, and the driver looked up
with `GET /drivers/{uid}`. If they exist, their uid goes into `billing.ambassador_uid`; if they do
not, `null`. If anagraphics does not answer the submission is not recorded (`503`), instead of
losing the ambassador.

---

## 6. Access

The pre-analysis is filled in **while logged out too**: whoever arrives from the showcase site has
no account, and we do not ask them to make one in order to answer some questions. The account is
needed at the next step, to go on, and that is where it is asked for.

### 6.1 What the user sees

| Where | Logged out | Logged in |
|---|---|---|
| Header | "Entra", which opens the login **in a separate window** | The person's name and "Esci" |
| "Manda la richiesta" | The form does not go: a **modal** opens, "Per mandare la richiesta serve un account", with "Entra" and "Registrati"; once the login is done the request goes by itself | The form goes |
| "Carica" (an analysis already prepared) | The file does not go: a **modal** opens, "Per caricare un'analisi serve un account"; once the login is done the file goes by itself | The file goes |

No fixed notice in the page: the modal appears only on a click on an action that requires the
account, and the login window opens only from its links. Without JavaScript the form goes anyway
and the server answers that access is needed.

**The login opens in a separate window, and this page never reloads.** If the login replaced the
page, everything written in the form would be lost: there is no draft saved anywhere. Once the
login is done the window **closes by itself** and the starting page **updates in place**: the
header and the driver column change, the modal closes, the form stays exactly as it was.

**After the login the submission starts again by itself** (`public/gate.js`), as the upload of a
file already does. Whoever pressed "Manda la richiesta" had already asked to send it: the login was
an interruption, not a change of mind, and leaving the page still after the modal closes makes it
look as though something broke. Closing the modal without entering cancels the wait: nothing goes
from there any more.

**One exception, and one only**: if the login makes the **autonomous work** block appear — it is
there only for drivers, and before entering we did not know that whoever is filling the form in was
one — the submission does not start, and above the button a notice lights up saying why. It is a
choice that appeared at that moment, and sending would take it out of their hands without their
having seen it. The rest of the right-hand column does not raise the problem: the driver is not
chosen, those boxes are only read.

The notice is already in the page, off (`templates/page.njk`, `[data-autonomous-notice]`):
`gate.js` lights it up and writes no text, which lives in the catalogues
(`preanalyst.page.autonomous_appeared`).

If the sso does not answer, the header and the modal say so and the form stays fillable: **nothing
stops the pre-analysis**, as is already the case for the driver box.

### 6.2 How it works, underneath

The sso round trip is the one described in `docs/subsystems/sso/README.md` §1.1; this subsystem
does not write a line of it by hand, it uses the **generated copies** of the shared client:
`src/commons/sso_client.js` on the server and `public/sso_popup.js` in the browser (the originals
are in `webtools/commons/sso/`, distributed by `webtools/configurator/deploy.sh sso`).

1. On every load of the page, `currentSession()` reads the cookie and asks the sso who it is.
   Three outcomes, and they are three different things: logged in, not logged in, or **we do not
   know** because the sso does not answer. The last one is not treated as a logout.
2. "Entra" opens the sso's login with `window.open()`, with
   `next=<our address>/login-done` — **not** the starting page (§6.4).
3. Once the login is done, the sso sends that window back to `GET /login-done?ticket=…`. The server
   exchanges the ticket from behind (`claimTicket`), sets **its own** cookie and renders a small
   page carrying the `data-sso-login-done` marker.
4. The script sees the marker, notifies the window that opened it with `postMessage` and **closes**
   its own.
5. The starting page receives the message and asks for `GET /session-fragment`: it receives the
   pieces **already rendered by the templates** and puts them in place of the old ones. Nothing is
   reloaded, the form is not touched.
6. The cookie's lifetime is not decided here: it is read from the session's `expires_at`. The
   cookie must not outlive the session it represents.
7. `GET /logout` removes our cookie and sends the browser to the sso's `/ui/logout`, which closes
   the shared session. **"Esci" exits everything**, not just this page.

**Without JavaScript it works all the same**: the links have a real `href`, the login opens in an
ordinary tab and ends on the small `/login-done` page, which says to go back to the pre-analysis
and reload it. What is lost is the automatic closing and the in-place update, not access.

**The HTML of the two pieces is not written in the JavaScript**: the macros of
`templates/partials/access.njk` serve both the page and `/session-fragment`, so the version just
loaded and the updated one cannot diverge. The script moves nodes, it does not compose markup.

### 6.5 Why the return is not to the starting page

Because the `next` is the login window, not the one from before. Sending it to the pre-analysis
would open a **second copy of the form** inside the wrong window, while the real one — the one with
the answers written in it — would stay convinced that nobody had entered. `/login-done` exists to
close the round trip in the right place.

### 6.3 When whoever is filling the form in is a driver

A driver can use the pre-analysis for work of their own. Then two rules hold.

**One's own link does not apply.** If the discount or the uid in the address point to the driver
who logged in, they are ignored: it would be a discount they give themselves. The driver box does
not appear at all, and what says so is the block below — «il link che hai usato è tuo». The hidden
fields do not go: that code does not travel with the request.

The comparison is made on the driver's **uid** (`session.data.driver_uid` against the uid of the
discount's or the link's driver), not on the username: the uid never changes, the username does.

**Other drivers' links stay valid.** That is work they brought in, and the box shows them as
always.

**The "Lavoro autonomo" block** appears below the driver box, and only to whoever is a driver: a
checkbox, «è un lavoro che porto io», and the notice: in autonomous work the driver's share is not
added to the price, it is paid by consumption with the driver's tokens plus the system fee. The
«Vuoi saperne di più?» link opens the front-gate's `lavora-con-noi.html#lavoro-autonomo` section in
a **new tab**, its address being `subsystems_infos.front_gate.url`: in the same tab the driver
would lose the answers already written. With the box ticked, the driver box above **dims** — grey,
less contrast — and the line appears saying that the system will not take into account what is in
there.

The dimming goes neither through JavaScript nor through the server: the CSS reads the checkbox's
state with `:has(#autonomous-work:checked)`. The notice's line is already in the page, hidden.

The other driver's hidden fields **stay in the form** even with the box ticked: the declaration
counts for more than they do, and whoever reads the request will decide. Taking them out of the
form would mean losing the information that that link was there.

### 6.4 The cookie's name

Our cookie is called `webtools_preanalyst`, the sso's `webtools_sso`. They must be different:
cookies **ignore the port**, so on `127.0.0.1` they all end up in the same heap and two cookies
with the same name would overwrite each other. It is a mistake that on this machine would look
like "I enter in one place and I am logged out of another".

---

## 7. Routes

| Route | Response |
|---|---|
| `GET /` | The page. Always `200`: no failure of anagraphics or of the sso stops it |
| `GET /login-done?ticket=…` | The return from the login, inside the login window: it exchanges the ticket, sets the cookie and renders the small page that closes by itself. Always `200`, even when the ticket is no good |
| `GET /session-fragment` | `200` JSON `{logged, header, gate, aside}`: the pieces of the page already rendered, for the browser that updates without reloading. It accepts the same `?discount=`, `?driver=` and `?ambassador=` as the page, because the right-hand column depends on them |
| `GET /logout` | `303` towards the sso's `/ui/logout`, removing our cookie |
| `POST /submit` | The form's submission (§14.1): `303` towards `/analysis/{id}`, or a message page with `400`/`401`/`413`/`503` |
| `GET /analysis/{id}` | The analysis page, only for the project's owner. Otherwise `401` (logged out) or `404` (non-existent or somebody else's) |
| `POST /analysis/{id}/opening` | The analyst's first question, on a conversation that has not begun (§14.3). It writes it onto the step and spends no turn; `409 ANALYSIS_ALREADY_OPENED` if the conversation is already there |
| `POST /analysis/{id}/messages` | A turn of the chat: the two messages and the turn taken off (§14.3.1). A JSON API with stable codes |
| `POST /analysis/{id}/turns` | Moves turns from the user's credit to the project (§14.3.1) |
| `POST /analysis/{id}/turns/buy` | **A fake purchase**: it gives the user credit (§14.3.2) |
| `GET /analysis/{id}/project` | The project's record in anagraphics, as a file (§14.3). A placeholder: it is what the go button does until the step after the analysis exists |
| `POST /upload` | A specification already prepared (§14.4): a JSON API with stable codes |
| `POST /locale` | The language switcher in the header (`locale`, `return_to`): it writes the shared cookie and returns to the page (`303`). For whoever has entered it also saves the language in the session and in the profile, through the sso. `400 INVALID_LOCALE`, `413 BODY_TOO_LARGE` |
| `GET /<file>` | A file of `public/` with its content-type; `404` if it does not exist |
| Other methods | `405` |
| An unexpected error | `500`, with the stack in the log |

Static paths are normalised and checked: a path that would leave `public/`
(`/../package.json`) gets a `404`/`403`, not the file.

The pages' errors do **not** have a stable code in JSON: they are pages for a browser. The
exception is `POST /upload`, which answers the page's JavaScript and follows the contract of codes.

---

## 8. Configuration

The server reads its configuration **at startup** from anagraphics, `GET /configuration/preanalyst`. The source is `webtools/configurator/configuration/preanalyst.json`; `webtools/configurator/load_configuration.sh` loads it into Mongo (`start.sh` already does that). No defaults: if the document is missing, or a field is, or a field is of the wrong type, the server writes `webtools_preanalyst is not starting: …` with the field's path and exits with 1. After a change: `webtools/configurator/start.sh --restart`.

Only `WEBTOOLS_ANAGRAPHICS_URL` and `WEBTOOLS_CONFIGURATION_TIMEOUT_MS` come from the environment, and `--start` loads them from `webtools/configurator/bootstrap.env`. `WEBTOOLS_ANAGRAPHICS_URL` is also anagraphics' address for every other call.

| Field | Today | What it is for |
|---|---|---|
| `listen.host` | `127.0.0.1` | The listening interface |
| `listen.port` | `9200` | The port. `9100` is anagraphics' |
| `public_url` | `http://127.0.0.1:9200` | Our address as seen from outside: the browser comes back to it after the login, and it is what we declare to the sso when exchanging the ticket |
| `subsystems_infos.anagraphics.timeout_ms` | `5000` | The cut-off of the calls towards anagraphics |
| `subsystems_infos.sso.url` | `http://127.0.0.1:9300` | Where the sso is |
| `subsystems_infos.sso.timeout_ms` | `5000` | The cut-off of the calls towards the sso |
| `subsystems_infos.workspaces.url` | `http://127.0.0.1:9400` | Where webtools-workspaces is |
| `subsystems_infos.workspaces.timeout_ms` | `5000` | The cut-off of the calls towards workspaces |
| `subsystems_infos.front_gate.url` | `http://127.0.0.1:9000` | The showcase site: the autonomous work block points to its `lavora-con-noi.html` page. `http`/`https` only: it ends up in an `href` |
| `session.cookie_name` | `webtools_preanalyst` | **Our** session cookie. It must stay different from the sso's |
| `form.body_max_bytes` | `524288` | The largest form submission accepted |
| `form.answer_max_chars` | `20000` | Beyond that, an open answer is truncated |
| `upload.max_bytes` | `10485760` | The largest specification that can be uploaded |
| `upload.accept` | `.md` | What the browser's file chooser proposes. It is not a check |
| `prevalidation.provider` | `anthropic` | Which model provider the prevalidator uses (§16.1) |
| `prevalidation.timeout_ms` | `20000` | The cut-off of the call to the provider |
| `prevalidation.providers.anthropic.model` | `claude-haiku-4-5` | The prevalidation's model |
| `prevalidation.providers.anthropic.max_tokens` | `512` | The ceiling of the answer, thinking included |
| `prevalidation.providers.anthropic.effort` | (absent) | How much the model may think, on the models that have the notion. Left out, nothing is sent |
| `prevalidation.providers.anthropic.api_key` | (a secret) | Its key, which lives in `configurator/secrets/preanalyst.json`, outside git |
| `prevalidation.policy` | `scope-v1` | Which policy judges the request (§16.2) |
| `prevalidation.reject_threshold` | `0.6` | Above this probability of `run_out_certain` the request is refused |
| `prevalidation.max_underspecified_attempts` | `100` | How many times the same request can come back for lack of detail. Beyond that, it is refused (§16.6) |
| `prevalidation.spec_max_chars` | `20000` | How much pre-specification is sent to the model |
| `prevalidation.rejection_reason_in_pdf` | `false` | Whether the extended reason for the refusal ends up in the PDF for whoever is not a driver too (§16.5) |
| `analysis.max_turns` | `30` | How many turns of the chat are included. A turn is a question and its answer. Once they are over, the field for writing disappears (§14.3) |
| `analysis.warn_from_turn` | `20` | From this turn on the page warns that they are about to run out. Before that it says nothing |
| `i18n.locales` | `["en", "it"]` | The languages offered: each has its catalogue in `commons/i18n/locales/` |
| `i18n.fallback_locale` | `en` | The fallback language, and the one the keys missing from another are taken from |
| `i18n.cookie_name` | `webtools_locale` | The language cookie, **the same in every subsystem** |
| `i18n.cookie_max_age_seconds` | `31536000` (a year) | How long the choice of language lasts in the browser |
| `i18n.body_max_bytes` | `1024` | The largest body accepted by `POST /locale` |

The timeout is **shorter** than the 30 s anagraphics waits for Mongo: if Mongo is down, the user
sees the page in 5 seconds instead of sitting still for half a minute.

---

## 9. Operating commands

### 9.1 Start and stop
```sh
webtools/preanalyst/webtools_preanalyst.sh --start
webtools/preanalyst/webtools_preanalyst.sh --stop
```
- `--start` does nothing if the server is already up, and waits up to 10 s for the confirmation
  line `webtools_preanalyst listening on …`. If the process dies, it prints the last lines of the
  log.
- `--stop` stops **only** the process of the PID file, and only after checking with `ps` that that
  PID really is `node …/src/index.js`. Never by name, never by port.
- Debugging in the foreground, from the project's directory: `set -a; source ../configurator/bootstrap.env; set +a; npm start` (Ctrl+C to stop it).

anagraphics, the sso and workspaces need to be up too: `webtools/configurator/start.sh` starts them
all in the right order.

### 9.2 Style and shared clients
Some files of this subsystem are **generated copies** and are not edited here:
`public/commons.css` (plus `public/fonts/`), `src/commons/sso_client.js`, `public/sso_popup.js`,
`src/commons/spec_front_matter.js` and `templates/commons/base.njk`. The originals in
`webtools/commons/` are edited and the deployer is run again:

```sh
webtools/configurator/deploy.sh          # style + the sso's client
webtools/configurator/deploy.sh style    # the style only
webtools/configurator/deploy.sh sso      # the sso's client only
webtools/configurator/deploy.sh specs    # the front matter module only
```

The **local** style is `public/styles.css`, and that is edited by hand.

---

## 10. The page's style

- From `commons.css`: the font, the colour tokens, `.container`, `.site-header`, `.brand*`,
  `.card`, `.card-head`, `.eyebrow`, `.reveal`, the fields (`.field`, `.field-label`,
  `.field-hint`, `.required`, `.input`) and the `.notice` notices in the two variants `notice-ok`
  (sage green) and `notice-warn` (note yellow).
- From `public/styles.css`, only things belonging to this page: the `.gate*` layout, the form's
  sections, the `.choice*` choices, the right-hand column, the driver and upload blocks.
- A locked dropdown can be seen: a dimmed background, no shadow, no arrow, a `not-allowed` cursor.

---

## 11. Tests

`npm test` (`node --test tests/*.test.js`), **21 tests**, no server up and no call to the provider:

| File | What it covers |
|---|---|
| `tests/prevalidator.test.js` | How the model's answer is read (`normalize`), the refusal on two conditions and two outcomes (`rejects`) and the verdict with the ceiling on the rounds (`verdict`) |
| `tests/prevalidator_ai.test.js` | Which provider the prevalidator selects and whose configuration is read (`loadPrevalidatorAiSettings`): an unknown provider stops the server, a provider that is not selected is not read |
| `tests/analyst.test.js` | The chat's AI: the two engines read their own part and nothing else, how the conversation is assembled, and how the validator's answer is read |
| `tests/server.test.js` | The counting of the rounds already made, read from the pipeline's steps |

They are the functions that **decide**: the ones that can go wrong silently. The call to the
provider is not tested — it costs and it is not repeatable. `driver_link.js` stays uncovered and is
the next candidate.

Checked by hand on 2026-09-20, with the two servers up:

| Case | Outcome |
|---|---|
| `/` with no parameter | `200`, no driver box, a single-column form, and no call to anagraphics |
| `?discount=e8013cf2-…` | `200`, a green notice, `<select disabled>`, a hidden field with Dome's `uid` |
| `?discount=does-not-exist` | `200`, the "in all likelihood expired" notice, the dropdown free |
| A discount whose driver is not in the list (temporary data, deleted afterwards) | `200`, the "the driver cannot be found" notice, with the name from the duplicated copy |
| `?driver=7633be3d-…` | `200`, the name "Dome" in the box, no notice, a hidden field with their `uid` |
| `?driver=00000000-…` | `200`, the "this link's driver cannot be found" notice, with the uid in plain sight |
| `?discount=…&driver=…` together | `200`, the discount wins, and in the log the line reporting the malformed link |
| anagraphics unreachable after startup (switched off while preanalyst is up) | `200`, the form there, the box with the "we cannot tell you who the driver is" notice, and `TypeError fetch failed` in the log |
| The same, but with `?discount=…&driver=…` in the link | `200`, the two values stay as hidden fields and the notice says the link is not lost |
| `/commons.css`, `/styles.css`, `/fonts/inter.woff2`, `/assets/mark.svg` | `200` with the right content-type |
| `/../package.json` | `404` |

---

## 12. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| The box with "we cannot tell you who the driver is" | anagraphics is off | `webtools/anagraphics/webtools_anagraphics.sh --start` |
| The same, but anagraphics is on | anagraphics' `access.allowed_ips` does not hold this server's IP, or Mongo is down | The log: `HTTP 403 IP_NOT_ALLOWED` or `HTTP 503 DATABASE_UNAVAILABLE` |
| An empty dropdown, with no notices | No driver in the database | `uv run python -m scripts.seed` in `webtools/anagraphics/` |
| Every discount comes out "expired" | anagraphics answers but does not find the codes | `mongosh webtools --eval 'db.discounts.find({}, {_id:0}).toArray()'` |
| A page with no style or font | The deployer was never run after creating `public/` | `webtools/configurator/style_deployer/deploy.sh` |
| `--start` says "already running" but nothing answers | A PID recycled by another process | The check on `ps` rules it out: look at the log |
| `EADDRINUSE` in the log | Port 9200 taken by something else | Change `listen.port` (and `public_url`) in `configurator/configuration/preanalyst.json`, plus the addresses pointing here in the other files (`sso.json`, `front-gate.json`); then `start.sh --restart` |

---

## 13. Known limits and technical debt

- The tests cover the functions that decide, not the routes: the round trip from the browser is
  tried by hand (§11).
- The page that comes back for lack of detail is the answer to a `POST`: reloading it asks the
  browser to **send the form again**, and with it to make another prevalidation, which costs
  (§16.7).
- The ceiling on the rounds is counted on the project's `underspecified` steps, so it holds per
  project and not per user: whoever starts again from scratch with a new submission starts again
  from zero rounds too.
- If the submission fails after the project has been created and the deletion fails too, the
  project is left **with no pre-specification**. It happens only if anagraphics falls over at that
  precise moment, and in the log there is the line `PROJECT LEFT WITHOUT A PRE-SPECIFICATION`.
- A submission that does not pass the server's checks (which can only happen by going around the
  browser's) ends up on a message page: the answers can be recovered only with "back".
- In the analysis page the model's answer and the purchase of turns are still fake (§14.3.2).
- **What is written in the form is not saved anywhere**: if the page is closed, it is lost. The
  login opens in a new tab for exactly this reason (§6.1). A draft on the server would be the real
  solution, and it has not been done.
- If the browser **blocks windows**, the login opens in an ordinary tab and ends on the small
  `/login-done` page: from there one goes back by hand, as without JavaScript.
- The browser's script has no automatic tests: the round trip was tried by hand.
- The logout depends on the sso: if it is down, our cookie is removed anyway and the page goes back
  to logged out, but the shared session stays open until it expires.
- `discount_expired` does not tell "expired" from "the service is down" (§5.3).
- `driver_unknown` does not tell "a deleted driver" from "an invented uid" (§5.2).
- Neither of the two parameters is validated as a UUID: a crooked value ends up in a read that
  finds nothing (`discount`) or in a search that finds nothing (`driver`), which is the right
  outcome, but for the wrong reason.
- No server-side validation of the chosen driver: it will be needed when there is a submission
  (§5.5).
- No cache: every load reads the drivers from anagraphics again. That is fine as long as the
  drivers are few and the visits are too.
- `node_modules/` is not managed by any script: after a clone or a version change `npm install` is
  needed by hand.
- No rate limiting, TLS, `/health` or metrics. The session cookie has no `Secure`, because on
  localhost there is no HTTPS.
- No management as a service (launchd): it does not restart by itself, and the log grows with no
  rotation.
- `public/assets/mark.svg` is a hand-made copy of the front-gate's: if the brand changes, it has to
  be copied again. The deployer distributes the style only.
- It is not connected to the `front-gate`.

---

## 14. The form's submission and the specifications

### 14.1 `POST /submit`

The form is sent to `/submit` as `application/x-www-form-urlencoded`. In order:

1. access is needed: logged out `401`, with the sso down `503`;
2. `submission_id` must be a UUID, generated when the page was rendered;
3. the answers are cleaned up (`readAnswers` in `src/prespec.js`): unforeseen codes are discarded,
   texts are trimmed and cut to `form.answer_max_chars` characters (today 20,000); `need` is
   mandatory;
4. `POST /projects` on anagraphics with `owner_uid`, `submission_id`, `review` and `billing`
   (§14.5): the driver and the discounts are data of the **project**, not of the pre-specification;
5. the pre-specification is rendered and goes to workspaces with `X-Spec-Origin: system`;
6. `303` towards `/analysis/{project_id}`. The `303` means that reloading the analysis page does
   not send the form again.

Two safeguards:
- **a repeated submission**: the same `submission_id` makes anagraphics answer `200` with the
  project already born. In that case the pre-specification is not written again and one goes
  straight to the analysis page;
- **a pre-specification not written**: if workspaces does not answer, the project is deleted
  (`DELETE /projects/{id}`) and the user sees that the request was not recorded.

The submit button sits inside the access gate (`partials/access.njk`): it is enabled only for
whoever has entered, and after a login in the separate window the browser receives it enabled
together with the rest of the fragment. The form no longer has `novalidate`: the browser checks the
mandatory fields, and the server checks them again.

### 14.2 The pre-specification

The template is `templates/commons/prespec.md.njk`, rendered by `src/prespec.js` with a nunjucks
environment **with no autoescape**: it is markdown, and escaping the HTML would turn the client's
`&` and `<` into entities.

The template is a **generated copy**: the pre-specification's shape is configuration, so the
original lives in `webtools/configurator/documents/prespec.md.njk` and
`configurator/documents_deployer/deploy.sh` distributes it. The copy is not edited. The document's
shape can be changed, but fields `src/prespec.js` does not pass **cannot** be invented.

- **Front matter**: `project_id`, `kind: prespec`, `template: prespec/1`, `language` (the page's
  language, e.g. `it`), and in `answers` the **codes** of the closed answers (`today`, `users`,
  `devices`, `volume`, `personal_data`, `existing_data`). A program reads them without interpreting
  anything. Never text written by the user, so no injected YAML keys.
- **The skills do not go in the front matter.** The list of checkboxes is open and has a free field
  next to it: a code on its own would tell half of the answer.
- **The body is in English**, section by section, with the question and the closed answer in plain
  sight.
- **The open answers stay textual**, in the client's language, inside a blockquote: a `## title`
  written by the client stays text and does not become a section.
- Empty fields are written `Not provided.`.
- **Open points**: the empty fields and the `unknown` answers. The skills and their "Other" count as
  a single answer (`group` in `questions.js`) and are missing only if both are.
- No name, email, discount or driver: the document goes to an AI provider.
- The `webtools:` key (the origin, the version, who, when) is stamped by workspaces on saving.

The English labels live in `questions.js` (`spec`), and the options are
`[code, text for the pre-specification]`. The texts for the client (questions, explanations,
examples, answers) live in the language catalogues, under `preanalyst.questions.*`. The codes are
in English and do not change when the text is rewritten.

`language` in the front matter is the language of the page the submission set off from: it is the
one the client wrote the open answers in.

### 14.3 The analysis page

`GET /analysis/{id}`: only whoever owns the project sees it (`owner_uid` equal to the session's
`uid`). A non-existent project, or somebody else's, answers `404` with the same message.

One arrives here when the prevalidation does **not** refuse (§16). A refused request goes instead
to `/?rejected={id}`, with the refusal modal (§16.4).

The **specification rounds** live here: a message is written, the answer is waited for, and on it
goes. The chat and the turns are on the project and the server counts them (§14.3.1).

**The analyst speaks first.** There is no greeting written in the page. Whoever lands here has just
answered a form and has nothing to say yet: a chat that opens with a salute and an empty field is a
chat nobody knows how to begin. With an empty conversation the browser calls
`POST /analysis/{id}/opening`, the analyst reads the pre-specification and asks the **first real
question**, and that question is written onto the step like any other message — so a reload prints
it without anything special, and pays nothing. It does **not** spend a turn: a turn is a question
and its answer, and here nobody has answered anything. What it costs is one call to the model, once
per analysis.

If the conversation has begun in the meantime — two pages of the same project open together — the
route answers `409 ANALYSIS_ALREADY_OPENED` and the page reloads: its view of the conversation was
older than the conversation. The same check is made again **after** the model has answered and
before writing, so two openings can never both land: two first questions in one conversation would
be two different conversations.

- `templates/analysis.njk`: the header, the conversation's register, the wait, the field, and
  **two `<template>`** with the markup of a message. The browser clones the model and fills
  `.chat-text` with `textContent`: the HTML is not composed with strings, and the text is written
  by the user.
- `public/analysis.js`: the behaviour only — one message at a time, the field that locks until the
  answer has arrived, Enter that sends and Shift+Enter that goes to a new line, the field that
  grows with what it holds.
- The texts live in the catalogues under `preanalyst.analysis.*`. The register the analyst writes
  in is not there but in its policy (§14.3.3): professional and not formal, the client given the
  tu, never a word that genders them, everything explained and nothing implied
  (`webtools/configurator/policies/analysis-v1.md`).
- The message's limit is `form.answer_max_chars`, the same as the form's answers: a message is an
  answer like any other.

**The summary**, in the right-hand column. It shows what was decided when the request set off —
the **driver**, the **discount**, the **ambassador**, the **autonomous work** — and only what is
there is shown: with none of all this, a line is left saying that we assign the driver. It is not
read again from the address, which here carries no parameters: it sits on the project, and
`projectSummary()` in `src/server.js` reads it back from there with `driverLinkOfProject()`,
exactly as the form does when it comes back (§16.6). In autonomous work the driver is whoever is
looking, and is not shown as though they were somebody else: the autonomous work line says so. It
is read and not touched: these conditions are not changed here.

Below the summary there are two buttons: «Scarica la conversazione», which has **no effect for
now**, and «Va bene così, procediamo!». The download is above, because it is the one that can be
wanted while writing; the go is the end of the round.

**The go is born off and lights up in two cases**: when the analysis has been judged complete
(§14.3.3), or when the turns have run out. Those are the two ways out of the conversation — while
there are still questions to answer it is not a choice to put in front of anybody, and the box of
the exhausted turns names it as the road that is not buying more. If turns come back and the
analysis is not complete, it goes off again.

**What it does is a placeholder**: `GET /analysis/{id}/project` gives back the project's record in
anagraphics as it is at that moment, and the browser saves it as
`webtools-project-{id}.json`. The step that follows the analysis does not exist yet, and a button
that answers nothing reads as broken; when the real move arrives, that is what goes in its place.
What comes out is the document anagraphics returns, not a shape invented by the preanalyst: whoever
reads the file is reading the project.

**The turns.** A turn is a question and its answer, and it is counted **when the answer has
arrived**: a message that has not been answered is not a turn spent. Two numbers, in the
configuration:

| | | |
|---|---|---|
| `analysis.max_turns` | `30` | how many turns are included |
| `analysis.warn_from_turn` | `20` | from where it warns that they are about to run out |

- The counter is in the summary, below the conditions: `0 di 5`. The **used** are the rounds
  already made, the **total** is the used plus the remaining — not `max_turns`, which with bought
  turns is no longer the total of anything.
- When few are left, a **small** notice appears below the field with how many they are, and the
  number is updated at every turn. The threshold in the configuration is stated from the other end
  ("from the twentieth of the thirty"), but what holds with bought turns too is **how many are
  left**: the page warns below `max_turns - warn_from_turn`. Before that it says nothing: a
  counter that alarms from the first message makes people write less, which is the opposite of
  what is needed here.
- At `max_turns` the field for writing **is removed** — not switched off: it is not a pause — and
  in its place a box appears proposing to buy more turns, with a button that for now does nothing.
  The box says two other things besides the proposal, and both at length, because whoever reads
  them does not already know what is being talked about:
  - **it is not compulsory**: the request can go on with what has already been written, and from
    that moment «Va bene così, procediamo!» is active — the text says so;
  - **the download is for going on alone**: one gets a file with all the questions and answers of
    the chat, gives it to any AI assistant (the names are written out: ChatGPT, Claude) to settle
    the description without using up turns, and when it is ready uploads it from the pre-analysis
    page, in the «Analisi già pronta» box (§14.4).

  **To be checked when the download really exists**: `POST /upload` demands the `project_id` in the
  front matter, so the downloaded file must carry it, or that round breaks at the last step.

The numbers that change sit in marked `<span>`s (`[data-chat-used]`, `[data-chat-total]`,
`[data-chat-left]`, `[data-chat-credit-value]`) put there by the catalogue with `t_html`: the
JavaScript writes a number inside them and does not compose sentences, which stay where they
belong.

### 14.3.1 Where the chat and the turns live

**On the project, not in the browser.** When the prevalidation passes, an `analysis` step is opened
with `result: "open"` (§16.3), and its `data` are the conversation and the turns that are left:

```json
{ "step": "analysis", "result": "open",
  "data": { "turns_left": 5,
            "chat": [ { "role": "client", "text": "…", "at": "…" },
                      { "role": "system", "text": "…", "at": "…" } ] } }
```

`open` means a step that has begun and has not yet decided anything: while it is so its data are
updated (anagraphics' `PATCH`, §6.20 of its documentation), and the closed steps stay untouchable.
The step is also opened when the page is opened if it is not there: the projects born before this
code sit in `ANALYSIS` without one, and without one neither writing nor counting would be possible.

**The server counts the turn.** The browser sends the message and updates itself with the numbers
the server returns: reloading the page loses nothing, and whoever opens two tabs does not have two
different counts. Three routes, all with the contract of the project's APIs (an HTTP status plus a
stable code):

| Route | What it does | Its own errors |
|---|---|---|
| `POST /analysis/{id}/opening` | the first question: it writes it onto the step, **without** touching `turns_left` | `409 ANALYSIS_ALREADY_OPENED` |
| `POST /analysis/{id}/messages` | a turn: it writes the two messages and takes `turns_left` down, in **a single write** — the two messages and the turn spent are the same thing seen from two sides | `400 EMPTY_MESSAGE`, `409 NO_TURNS_LEFT` |
| `POST /analysis/{id}/turns` | moves turns from the user's credit to the project | `400 INVALID_TURNS`, `409 NOT_ENOUGH_TURNS` |
| `POST /analysis/{id}/turns/buy` | **a fake purchase** (see below) | — |
| `GET /analysis/{id}/project` | the project's record as anagraphics returns it, `content-disposition: attachment` | — |

All five: `401 NOT_LOGGED`, `404 PROJECT_NOT_FOUND` (for somebody else's project too, so that the
address is of no use for discovering which ids exist), `409 ANALYSIS_NOT_OPEN`.

**The credit sits on the user**, in `billing.turns_credit` (§5.5 of anagraphics). When the
project's turns run out, a few can be moved onto the project from the box: first the credit is
taken down, then the turns are credited. The order is not accidental — the credit is the part that
must not be able to be spent twice, and anagraphics checks it inside the write. If the second step
does not succeed, **the credit is given back**, or the user would have paid for nothing; if the
giving back fails too, a line of log is left saying so in plain words.

In the box, the credit and the purchase are **never there together**: with credit the field for
moving it is shown and the purchase is hidden, with no credit the field is off and the purchase is
shown.

**If the turns come back, the field comes back.** The composer is hidden, not destroyed: adding
turns from the credit or buying some puts the page back as it was, and «Va bene così, procediamo!»
goes off again. It is not an end, it is an interruption.

### 14.3.2 The mock still standing

It is in `contesto/todos.md` because it is to be dismantled, not fixed:

- **The purchase**: `POST .../turns/buy` makes nobody buy anything, it gives 10 turns to the credit
  (`FAKE_PURCHASE_TURNS` in `src/server.js`). It is only there to try the round of the exhausted
  turns from beginning to end. The payment engine will go in its place.

The answer is no longer one of them: it comes from the analyst (§14.3.3 and `src/analyst.js`), with
its own provider, its own policy and its own cost, written onto the step with the turn.

Without JavaScript the header, the conversation as it stands, the field and the summary are left,
but nothing is sent — and on a conversation that has not begun there is nothing to read yet, since
the first question is asked for by the browser.

### 14.3.3 When the analysis is complete

Who says so is not one engine but two: the analyst (`src/analyst.js`) **proposes** `ready` when it
believes the questions are over, and `src/analysis_validator.js` — another policy, another model —
decides whether that is true. Nobody is a fair judge of their own work, and the check runs once per
analysis, not once per message.

Four ways it can go, and all four are handled:

| The analyst | The validator | What is recorded |
|---|---|---|
| does not propose to close | is not asked | `ready: false` |
| proposes to close | `pass` | `ready: true` |
| proposes to close | `continue` | the analyst is sent back with what is still missing, its closing message is never shown, and `ready: false` — the second answer of that turn was judged by nobody |
| proposes to close | the judgement did not arrive | `ready: false`: the conversation does not close on a claim nobody checked, and the analyst will propose again next turn |

`ready` sits on the open step beside `turns_left`, so a reload finds it again, and `POST
.../messages` returns it to the page along with the answer.

**What the page does with it.** A notice appears between the conversation and the field
(`preanalyst.analysis.ready`), and «Va bene così, procediamo!» lights up. The field does **not** go
away: whoever has turns left goes on writing if there is something to add. It is the verdict of the
last turn and nothing more — a later turn that reopens the questions takes the notice away and puts
the button back off. The page is born with the notice already on when the step says so, because the
server decides what is shown and a reload must not lose where the conversation got to.

### 14.4 `POST /upload`

A specification already prepared: an `.md` with the `project_id` in the front matter.

```markdown
---
project_id: 1f251606-bdba-40c4-bbee-bfedc6e57f70
---
# …
```

| Case | Response |
|---|---|
| Valid, the user's project | `201 {"received":true,"name":…,"project_id":…,"version":N}` |
| Logged out | `401 NOT_LOGGED` |
| With no `X-File-Name` | `400 MISSING_FILE_NAME` |
| An empty body | `400 EMPTY_FILE` |
| Beyond `upload.max_bytes` | `413 FILE_TOO_LARGE` |
| Not UTF-8 (a PDF, a Word) | `400 NOT_UTF8` |
| Broken front matter | `400 INVALID_FRONT_MATTER` |
| With no `project_id` | `400 MISSING_PROJECT_ID` |
| A `project_id` that is not a UUID | `400 INVALID_PROJECT_ID` |
| A non-existent project **or another user's** | `404 PROJECT_NOT_FOUND` (the same answer: which ids exist is not discovered) |
| The sso, anagraphics or workspaces down | `503 SSO_UNAVAILABLE` / `ANAGRAPHICS_UNAVAILABLE` / `WORKSPACES_UNAVAILABLE` |

In every error case **the file is not kept**. If it is valid it goes to workspaces with
`X-Spec-Origin: third_party`: the origin is decided by the channel, and an uploaded file declaring
`origin: system` is saved as `third_party`.

### 14.5 The project's `review` and `billing`

`projectTerms()` in `src/server.js`, with the driver, the discount and the ambassador already
checked again (§5.5, §5.6):

| Case | `review` | `billing` |
|---|---|---|
| No link | `{driver_uid: null, preset: false}` (the system will assign one) | no discount; `ambassador_uid` if there was a valid ambassador (§5.6) |
| An enabled driver's link (`?driver=` or `?discount=`) | the link's driver, `preset: true` | the link's `discount_code`, if there was one |
| The link of a driver who is not enabled, does not exist, or is oneself | `{driver_uid: null, preset: false}` | no discount |
| Autonomous work (only if whoever submits is a driver) | the driver themselves, `preset: true` | `autonomous_work: true`, `discount_code: null`, `ambassador_uid: null` |

The link's discount code and the autonomous work **exclude each other**. One's own link never
arrives here: the page does not emit the hidden fields when the link belongs to the driver filling
it in. An `autonomous_work` sent by somebody who is not a driver is ignored.

---

## 15. Next steps

1. Tests of `driver_link.js` and of `prespec.js` with `node --test`.
2. The analysis chat, in the `/analysis/{id}` page: what happens after a prevalidation that passes
   is still to be specified.
3. Connecting the `front-gate`'s "Inizia" button to this page.
4. Deciding what the discount code really does: who issues it, what it applies to, when it
   expires. Today `discounts` has a percentage nobody uses, and "expired" is a message with no date
   behind it.
5. Deciding whether the `?driver=` link must leave a trace downstream: today it chooses the driver
   and that is all, but it is also the only way of knowing that a project comes from them without
   going through a discount.

---

## 16. The prevalidation

The **first gate** of the flow: the pre-specification just written passes through a model, which
says whether the request sits inside the service's perimeter. If it does not, the request goes to
REJECTED and the user finds out at once.

The gate has a third exit besides passing and refusing: a request that says **too little** to be
judged goes back to the user, who rewrites it (§16.6). It is not a refusal and it does not use the
project up: it is one more round.

### 16.1 The AI module

`src/prevalidator_ai/` is the prevalidator's door towards the model providers, and the rest of the
subsystem does not know which one is behind it. The name says whose door it is: the chat has its
own, `src/analyst_ai/`, and the two share no file — a directory called `ai/` would have suggested
there is one AI in the subsystem, and there is not.

```
src/prevalidator_ai/webtools_prevalidator_ai.js  loadPrevalidatorAiSettings(configuration, base), decide(ai, { … })
src/prevalidator_ai/providers/anthropic.js  the Anthropic provider
```

`decide()` follows the other clients' contract — `{ ok: true, data }` or `{ ok: false, reason }` —
with `reason` among `unavailable` (the provider does not answer), `rejected` (it answered, but not
with something usable) and `unknown_provider`. In `data`: `output`, `model` and `usage`, the tokens
consumed.

**A provider's configuration is the provider's own business.** `<section>.providers` is a map whose keys
the configuration decides, so it is not read by enumerating it: `loadPrevalidatorAiSettings()` reads
`<section>.provider` and `<section>.timeout_ms`, and asks the selected provider to read its own
fields through
its `readConfiguration()`. Two consequences. **Only the selected provider must be complete**: an
environment that uses one does not carry the keys of the others, and does not refuse to start for
want of a key it would never spend. And **what a provider needs is not known upstream**, so the
second one may ask for different fields from the first — `decide(ai, …)` hands it back exactly
`{ provider, timeoutMs, configuration }`, its own section and nothing else of the subsystem.

A provider that does not exist **stops the server at startup**, like any other wrong field,
with a message naming the ones that do. It used to start and fail on the first client's
prevalidation with `unknown_provider`, which is a configuration mistake discovered by whoever is
least able to fix it. The `unknown_provider` reason stays in the contract as a net.

Adding a provider — Jev, for instance — is a file in `providers/` exporting `NAME`,
`readConfiguration()` and `decide()`, one line in the `PROVIDERS` registry, and the value of
the section's `provider` in the configuration: the prevalidator is not touched. The registry is an allowlist
and not a directory listing — the configuration chooses among the providers that exist, it does not
name a module to load. It is Phase 1-2 of the strategy in
`contesto/decision_engine_considerazioni.md` §25.

The Anthropic provider uses the official SDK, not `fetch` by hand, and does three things to keep
the spending low and the predictability high:

- **a constrained output** with `output_config.format` and a JSON schema: the model cannot answer
  in prose (§10 of the document on the decision engine, typed outputs);
- **no thinking**, a low `max_tokens`: it is a classification, not a conversation;
- the policy in the `system` with `cache_control`: it never changes, and from the second call on it
  costs less.

With `claude-haiku-4-5` a prevalidation costs **a few thousandths of a euro**. The tokens consumed
are kept on the pipeline's step (§16.3): the cost is worked out from there, and it is the measure
the PoC is after.

### 16.2 The policy and the six outcomes

The criteria are not in the code: they are in `policies/scope-v1.md`, a **generated copy** of the
original in `webtools/configurator/policies/`. The configuration says which policy is used
(`prevalidation.policy`), the file says what it asks. The copy carries at its head an HTML comment
put there by the deployer, which `src/prevalidator.js` strips before sending it to the model.

The model returns a probability for each of six outcomes, plus a reason:

| Outcome | What it says | Where it leads |
|---|---|---|
| `non_sequitur` | It is not something this pipeline can build, at any size | a refusal |
| `run_out_certain` | It is software, but it does not fit: outside the perimeter, and no reasonable reading brings it back inside | a refusal |
| `run_out_likely` | It probably does not fit: parts that are too big, or wide unknowns | it passes |
| `underspecified` | It cannot be said: the request has said too little to be put anywhere | it goes back |
| `safe` | It fits: ordinary work for this service | it passes |
| `ultrasafe` | It fits easily: small, clear, bounded | it passes |

Four outcomes sit on the **axis of size**. The other two do not, for opposite reasons:

- `underspecified` says that the request cannot be put on that axis, because it has said too
  little. It is not a middle ground between big and small, and that is why it leads not to a
  refusal but to one more round (§16.6). The policy bounds it on purpose: **the answers that are
  missing are not an underspecified request**. That something is missing from the form is normal —
  the empty fields end up in the pre-specification's «Open points» and the analysis chat will ask
  for them. `underspecified` is about what the client **has said**, not about what the form did
  not collect.

  **Length has nothing to do with it**, in either direction. The policy says so by name because
  the first of its signals used to be «it is one line long», which was wrong: one line can be a
  whole request — *«una pagina dove i miei clienti prenotano un tavolo, e io vedo le prenotazioni
  del giorno»* says what the tool does, who opens it and what comes out of it — and pages of text
  can say nothing usable, if they tell a situation and never get to the work the tool has to do.
  There is one question only: **does the request say what the tool has to do?** Not how it is
  written, not how long it is.
- `non_sequitur` says that the request does not sit on that axis as a matter of principle, because
  there is no software to measure: a logo, some texts, an opinion on what product to buy, a piece
  of consultancy, work on physical machines. The **developer could not build it at any size**, so
  it is refused like a request that does not fit. The question the policy makes one ask is one
  only: could a developer write this thing as a web application, as big as one likes? If the
  answer is yes, this is not the outcome.

**Emptiness is `underspecified`, not `non_sequitur`.** It is the rule of precedence between the
two, and the policy now writes it out by name. `non_sequitur` needs **something said** that cannot
be built: a logo, an opinion, a repair. An empty form, a single letter, a line of nonsense say
nothing — there is not even the logo to refuse — and so they are `underspecified`. Emptiness is not
the proof that the request is not serious: it is the absence of proof.

The reason the rule matters is that the two outcomes **do not cost the same**: `underspecified`
sends the request back to the client with what they had written inside it, `non_sequitur` refuses
it for ever and with no appeal. When one cannot even tell what has been asked for, the outcome that
asks again is chosen. The endless round is not a risk:
`prevalidation.max_underspecified_attempts` exists for that (§16.6).

The six probabilities are **normalised** after the reading: the model declares six numbers and they
almost never add up to one, and refusing a good answer over an arithmetic error would be a waste.
The outcome is the most probable one; on a tie the first of the list wins, that is, the most
cautious.

**The refusal has two conditions, not one**: the most probable outcome must be `run_out_certain` or
`non_sequitur` *and* it must pass `prevalidation.reject_threshold` (today 0.6). A `run_out_certain`
at 35%, although the highest of the six, is not a certainty of anything. The threshold is the same
for both: whoever refuses does so on the same conditions.

**Why `non_sequitur` is an outcome and not a flag.** What was missing was a place in the
distribution for the request that is not software. Without it, faced with a logo the model put
**every probability at zero** — «none of these outcomes applies» — and a distribution adding up to
zero gives no outcome: the step ended `failed` and the request went on. The case the prevalidator
recognised best was the only one it could not record. Now it has its outcome, and the policy
explicitly forbids the distribution of zeros.

#### The `off_domain` flag

It stays, and it is a different thing from the outcomes. The outcomes say how big the request is
and whether there is any software in it; the flag says **whether that software is a webtool**.

It is raised for a request that could be developed — the developer would write it, at some size —
but that is not a tool for a specific need. There is one criterion only: **nobody opens it to get
something of their own done**. The value lies in being seen, read, played or sold: a showcase site,
a game, a shop or a portal that is itself the product, a plugin inside somebody else's product, a
library for developers, a script that runs by itself.

Three things do **not** put a request out of domain, and the policy says so explicitly because the
model kept falling for it:

- **who can use it.** A webtool can be used by the client's customers, members, suppliers or
  guests, and it can sit on the internet with no login. «Public», «external users», «it is not for
  internal use» are not reasons: internal use is a frequent characteristic of these tools, not a
  requirement;
- **what it looks like outside.** A webtool may need to come out beautiful, to carry the client's
  name, to stand comparison with somebody else's. Design is part of everything we build;
- **how big it is.** Size is the distribution's business, not the flag's.

In doubt, the policy makes one look at **what the person in front of the screen is doing**: if they
are getting something of their own done — preparing, recording, deciding, searching, ordering,
sending — it is a webtool, whoever they are; if they are being informed, entertained or served as a
customer, it is not.

The flag is **independent of size** — a small showcase site is `ultrasafe` *and* out of domain —
and it decides nothing on its own: it does not refuse, it does not stop anything, it does not
change where the user goes. It appears in no text shown to the client: it is an internal datum,
which will reach the driver when there is a driver area. Its reason lives in `off_domain.reason`,
separate from `reason`, which talks about size.

With `non_sequitur` the flag adds nothing, because there is no software to place: it stays false,
and the why is in `reason`.

**The perimeter is not taught by examples.** The policy's first version said only that webtools
builds «tracker, classifiche, piccoli archivi, strumenti di organizzazione, sostituti di fogli
Excel» — the context document's list — and the model did the only thing it could: it generalised
from the examples. Out of it came a definition that is not ours («webtools are internal tools for
tracking and organising»), with two consequences — a showcase site ended up in
`non_sequitur` instead of out of domain, and aesthetic care was counted as a scope risk. Now the
policy gives the **criterion** first — a small tool for a specific need, something somebody has to
do and that comes round again — and only afterwards the examples, saying that they illustrate and
do not bound. Checked on five cases: a request that resembles none of the examples (a tool that
prepares an electrician's quotes) is recognised as `safe` and inside the domain.

### 16.3 Where the outcome ends up

On the project, as a step of the pipeline (anagraphics' `POST /projects/{id}/pipeline/steps`):

```
pipeline: {
  state: "ANALYSIS" | "REJECTED" | "UNDERSPECIFIED" | "PREVALIDATION",
  steps: [
    { step: "prevalidation", result: "passed" | "rejected" | "underspecified" | "failed",
      decided_at,
      data: { outcome, distribution, off_domain, reason, policy, provider, model,
              usage: { input_tokens, output_tokens } } }
  ]
}
```

Four possible outcomes for the step:

| Case | `result` | `pipeline.state` | Where the user goes |
|---|---|---|---|
| It passes | `passed` | `ANALYSIS` | `/analysis/{id}` |
| Refused | `rejected` | `REJECTED` | `/?rejected={id}`, with the modal |
| It says too little | `underspecified` | `UNDERSPECIFIED` | the form, filled in as it was (§16.6) |
| The check did not succeed | `failed` | `PREVALIDATION` | `/analysis/{id}` |

`result` says how the step went, `state` where it takes the pipeline: two different things, and the
gate decides the second. The `underspecified` step **is counted**: it is the only place where the
number of rounds already made exists (§16.6).

**If the check does not succeed the project stays.** A provider down, an answer outside the schema,
a wrong key: the step is marked `failed` and things go on. A valid request is not thrown away
because a check did not work — unlike the pre-specification, which if it is not written leaves
nothing to start from. The error's line is left in the log.

**An attempt that went wrong costs all the same**, and the `failed` step records it: if the model
answered — truncated, outside the schema, with an unusable distribution — those tokens were paid
for, and `data` carries `{error, usage, model}` instead of `error` alone. A cost that is written
nowhere is not measured, and the real cost is what the PoC has to know. The only case with no
`usage` is the provider that did not answer at all: nothing was spent there.

### 16.4 The refusal modal

`GET /?rejected={id}` renders the form's page with the modal open. The parameter counts **only** if
the project exists, belongs to whoever is looking and really is refused: otherwise it is ignored
and the page is the usual one. That way the address cannot be used to make a refusal appear to
somebody else, nor to discover which projects exist.

The modal has **a single button**, «ok», which leads to the front-gate's home page: the form is not
used any more, so there is nothing else to do from here. The PDF is a **link** inside the text, not
an action on a par with leaving.

The text is not one: there are **three**, and they say three different things. `rejectionCase()` in
`src/server.js` reads the outcome from the project's last `prevalidation` step and chooses.

| Case | When | What it says |
|---|---|---|
| `out_of_scope` | `run_out_certain` | webtools is in all likelihood not the right tool for that need |
| `not_software` | `non_sequitur` | webtools builds only small software, to be used in a browser, and produces nothing else — with three examples: a graphic moodboard, texts or translations, a professional opinion |
| `not_recognised` | the rest: the `underspecified` that ran out of rounds | the analysis tool cannot decipher the request |

Why there are three and not one. «We are not the right tool» is true for a request that has been
**understood** and is too big for us; on a `non_sequitur` it would make one believe that it had
been read and set aside on the merits, when on the merits there was no software to read; and on a
request that after many rounds was never understood it would say something nobody was able to
check.

`not_software` is the only one talking about the service instead of about the request: it says
what webtools builds and names a few examples of what it does not build. It is for whoever asked
for a logo or for a piece of consultancy and would otherwise not know what they had run into — it
is not the model's judgement, which stays ours and the driver's.

None of the three names the estimated size or the domain, and none changes according to the
configuration or to who is looking. The texts live in the catalogues under
`preanalyst.rejection.<case>.title` and `.lead`.

The modal opens on load (`public/rejection.js`) because it is the answer to the submission the user
has just made: one arrives there only from `/submit`'s `303`. On closing — «ok», Esc, a click
outside — one goes to the front-gate's home page. Without JavaScript the modal stays closed: a
known limit (§13).

### 16.5 The PDF

`GET /projects/{id}/rejection.pdf`, reserved for the owner of a refused project. It reads the
pre-specification from workspaces (`GET /projects/{id}/specs/latest`) and lays it out with pdfkit:
it is the document that was really produced, not a reconstruction.

It is needed because on going back to the page **the form is empty**, and what the user had written
would be lost.

The refusal's **extended reason** (`reason` plus `off_domain.reason`, if there is one) ends up in
the PDF in two cases only: if `prevalidation.rejection_reason_in_pdf` is `true`, or if whoever
downloads it is a driver (`session.data.driver_uid`). Outside these two cases the document does not
even name it.

The questions in the PDF stay **in English**, because that is how the pre-specification is written.

### 16.6 Going back

When the outcome is `underspecified` the request is **not** refused: the project stays, it goes to
`UNDERSPECIFIED` and the user sees the form again with everything they had written inside it, plus
a notice at the top saying that a few more details are needed.

The round, step by step:

1. `POST /submit` → the prevalidation → the `underspecified` outcome;
2. the step is appended to the pipeline (`result: "underspecified"`, `state: "UNDERSPECIFIED"`);
3. the page is rendered **in answer to the POST**, with the answers already inside and a hidden
   `project_id` field;
4. the user corrects it and sends it again; the `project_id` makes it start again from the same
   project, and the pre-specification is kept as a **new version** of the same project (v2, v3, …);
5. the new pre-specification is prevalidated again, and from here one leaves through one of the
   other doors.

**Why the page is rendered instead of redirecting.** A `303` towards the home page would bring back
an empty form: asking for a few more details and handing back a blank sheet is an invitation nobody
can accept, and what the user had written would be lost. The price is the limit of §16.7.

**The hidden field's `project_id` is not trusted.** It is checked again on anagraphics: the project
must exist, must belong to **whoever is sending the form** and must be sitting in `UNDERSPECIFIED`.
Any old id does not allow somebody else's project to be rewritten, nor a project already refused to
be revived; if the check does not pass, the submission counts as a new submission and the project
is born from scratch.

**The rounds are counted**, and the number is kept nowhere: the `underspecified` steps in the
project's pipeline are counted, which is the only register where that number exists. Above
`prevalidation.max_underspecified_attempts` nothing more is asked and the request is refused:
going on sending back somebody who has already rewritten so many times is not an invitation, it is
a wall. The ceiling holds **only** for `underspecified`: a request that becomes clear in the
meantime passes, whatever the number of rounds already made.

**The page stays the page**, the right-hand column included: the driver box, the ambassador's, the
autonomous work block for a driver and the upload of a specification already prepared. Whoever sees
the form again must find it as it was, or it looks as though something broke.

The address' parameters are not here — it is the answer to a `POST` — but they are not needed: what
they carried was recorded on the project at the first submission, and it is read back from there.
`driverLinkOfProject()` in `src/driver_link.js` rebuilds the link from the project —
`review.driver_uid` with `preset`, plus `billing.discount_code` for the percentage — and
`billing.ambassador_uid` gives the invitation box back. The states are only the recognised ones: a
driver who in the meantime can no longer be found or has been disabled is not a problem for
whoever is writing, and the project is already assigned.

What changes is that the boxes **are read and not touched**, because the economic conditions were
decided at the first submission and this round does not read them again:

- no hidden field travels with the form — neither `driver`, nor `discount`, nor `ambassador`;
- the «this driver will be ignored» notice does not appear: there is nothing left to ignore;
- the autonomous work checkbox shows what the project recorded (`billing.autonomous_work`) and is
  `disabled`, with a line saying that the choice has been made. A checkbox that moves without its
  moving being of any use is worse than one that is still;
- in autonomous work the driver box is not shown, as at the first submission, where what dims it is
  the checkbox's CSS.

### 16.7 A limit: reloading the page sends the form again

The page of the going back is the answer to a `POST`, so reloading it (F5) asks the browser to send
the form again, and with it to make another prevalidation — which costs. The case is known and
accepted: the alternative is losing the answers, or keeping them somewhere to read them back after
a redirect, which at the moment is not worth the expense. The project stays one in any case: it is
the hidden `project_id` field that holds it together, and the rounds stay counted.

### 16.8 Trying it by hand

```sh
cd webtools/preanalyst
set -a; source ../configurator/bootstrap.env; set +a
node scripts/prevalidate.js scripts/examples/ordinary.md
```

It prints the distribution, the outcome, the verdict, the flag, the reason and the tokens
consumed. **It makes a real call**, so it costs. In `scripts/examples/` there are five
pre-specifications, one per outcome:

| File | What should come out of it |
|---|---|
| `too-big.md` | `run_out_certain` — 40 points of sale, three levels of permissions, SAP, couriers, invoices |
| `ordinary.md` | `safe` — the attendances at a volleyball team's training sessions |
| `non-sequitur.md` | `non_sequitur` — a logo, the site's texts, an opinion on what management software to buy, the PCs to repair |
| `out-of-domain.md` | `ultrasafe` **and the `off_domain` flag** — a farm holiday's website: small, feasible software, but nobody opens it to get something of their own done |
| `vague.md` | `underspecified` — «qualcosa per il magazzino», without ever saying what it has to do |

The verdict is the one the server would take **at the first round**: there is no project here, so
there are no rounds already made to count, and `vague.md` comes out as `UNDERSPECIFIED` and not as
a refusal.

The two that resemble each other are `non-sequitur.md` and `out-of-domain.md`, and it is on
purpose: they are the border between the outcome that refuses and the flag that decides nothing.
In the first, nothing is left to build once what we do not do has been taken away; in the second
the software is there, it is even easy, and the judgement on the size has to be given in full — it
is the flag that says it is not one of ours.

**All five are generated by the real code**, not written by hand: a filled-in form goes through
`readAnswers()` and `renderPrespec()`, which is exactly what `/submit` does. So they have the front
matter with the codes the form really sends, the complete body with the questions in English and
the «Open points» section — which is a signal the prevalidator reads. An example written by hand
tests the policy on a text *similar* to a pre-specification; these test it on the document the
system produces. The script that generated them is not kept: they are remade from `prespec.js`
when the questions change.

---

## 17. Changelog

| Date | Version | Change |
|---|---|---|
| 2026-09-25 | 0.25.0 | **The analyst speaks first** (§14.3). The fixed greeting goes out of `templates/analysis.njk` and out of the catalogues (`preanalyst.analysis.opening`): with an empty conversation the browser calls the new `POST /analysis/{id}/opening`, which has the analyst read the pre-specification and ask the first real question, writes it onto the step and spends **no turn**; `409 ANALYSIS_ALREADY_OPENED` covers two pages opened together, checked again after the model has answered and before writing. `conversationOf` and `ask` accept a turn with no client message. The turns used are counted as the client's messages and no longer as half of them, which the opening would have made false. **The analyst's policy is rewritten**: who is on the other side (a person not of the trade, with little confidence with computers), the register (professional and not formal, the tu, never a word that genders the client), clarity (no jargon, nothing implied, always an example) and the aim — one subject per turn, carrying concrete points, to reach the end in as few turns as possible. **Both policies** gain what is an instruction to the model and what is not, and that `missing` and `reason` are its own words. **The validator receives a conversation**, not a flattened document: `dossierOf` becomes `materialOf` and returns messages with their roles, so `**Analyst:**` typed by the client is just text. Italian catalogue: out the forms that gender the reader. |
| 2026-09-25 | 0.24.0 | **The analysis says when it is complete** (§14.3.3). `POST .../messages` answers with `ready` as well — the verdict of that turn, which is stored on the step and so survives a reload. When it is true the page shows a notice between the conversation and the field (`preanalyst.analysis.ready`) and the go button lights up; the notice and the button follow the verdict, so a later turn that reopens the questions puts them back. A send-back from the validator now forces `ready: false`: the second answer of that turn was not judged by anybody, and `ready` is what the page acts on. **The go button does something**: `GET /analysis/{id}/project` hands over the project's record in anagraphics as a file. It is a placeholder until the step after the analysis exists. |
| 2026-09-24 | 0.23.0 | **The chat and the turns sit on the project** (§14.3.1), no longer in the browser. When the prevalidation passes, an `analysis` step is opened with `result: "open"` and `{turns_left, chat}` inside it; it is also opened when the page is opened if it is missing, for the projects born before. **The server counts the turn**: three new routes — `POST /analysis/{id}/messages` (the two messages and the turn taken off in a single write), `POST .../turns` (moves turns from the user's credit, with a refund if crediting the project does not succeed) and `POST .../turns/buy` (a fake purchase). Reloading the page no longer loses anything. The user's **credit** sits in `billing.turns_credit` on anagraphics: in the box of the exhausted turns, with credit the field for moving it is shown and the purchase is hidden, with no credit the field is off and the purchase is shown. If the turns come back, the field for writing comes back and the go goes off again. The counter shows the used and the total (used + remaining), not `max_turns`, which with bought turns is no longer the total of anything. It requires anagraphics 0.10.0. |
| 2026-09-24 | 0.22.0 | **The summary and the turns** in the analysis page (§14.3). The page goes to two columns: the conversation and, next to it, a box that reads back from the project what was decided at submission time — the driver, the discount, the ambassador, the autonomous work — showing only what is there (`projectSummary()` in `src/server.js`, with `driverLinkOfProject()`). In the box, the **turn counter** and two buttons with no effect: «Scarica la conversazione» above and «Va bene così, procediamo!» `disabled`. **A turn is a question and its answer**, counted when the answer arrives. From `analysis.warn_from_turn` a small notice appears below the field with how many are left; at `analysis.max_turns` the field **is removed** and in its place comes a box proposing to buy more — with the button that for now does nothing — and saying that it is not compulsory and that by downloading the conversation, the chat included, one can go on alone with one's own AI agent. New configuration: `analysis.max_turns` (30) and `analysis.warn_from_turn` (20); there was no limit on the turns before. The count lives in the browser only: when the turns are real it will go on the pipeline's steps, like the `underspecified` rounds. |
| 2026-09-24 | 0.21.0 | **An almost empty form is no longer refused.** A request with «a» inside it came back `non_sequitur` at 95% and ended up in REJECTED, final and with no appeal: the policy listed «an empty form» among the cases of `non_sequitur` and did not say which outcome won when the request says nothing. Now `scope-v1` writes the **precedence** out: `non_sequitur` requires something said that cannot be built, emptiness is `underspecified`, and between the two the one that asks again is chosen, because they do not cost the same (§16.2). **A revision of `underspecified`**: out goes the signal of length — «it is one line long» meant nothing, one line can be a whole request and pages of text can say none of it. One question is left: does the request say what the tool has to do? **The refusal modal has three texts** (§16.4): `out_of_scope` for `run_out_certain` («we are in all likelihood not the right tool»), `not_software` for `non_sequitur` — the only one talking about the service instead of about the request: webtools builds only small software, to be used in a browser, and not a moodboard, texts or an opinion — and `not_recognised` for the `underspecified` that ran out of rounds («the analysis tool cannot decipher your request»). A single text on a `non_sequitur` would make one believe that the request had been read and set aside on the merits. `rejectionCase()` in `src/server.js` reads the outcome from the last step. **After the login the submission starts again by itself** (`public/gate.js`, §6.1), like the upload: before, the modal closed and the page stayed still saying nothing. It does not start again if the login made the **autonomous work** choice appear, and in that case a notice lights up above the button. Checked: the same pre-specification that had been refused now gives `underspecified` at 1.00, and the five examples of `scripts/examples/` hold their outcome. |
| 2026-09-24 | 0.20.0 | **The analysis page is no longer empty** (§14.3): the specification rounds, one message at a time. It is a **graphic mock** and it says so in the page — the answers are fake, the browser picks them at random from `preanalyst.analysis.mock.replies.*` and they arrive after a random wait; the provider is not called, nothing is written, and on reloading nothing is left. It is there to look at the interaction before deciding who leads the rounds, where the turns end up and what closes them. New `public/analysis.js` and the `.chat-*` style; `templates/analysis.njk` carries the markup of a message in two `<template>`s, which the browser clones filling `.chat-text` with `textContent`. The texts are in the catalogues (`preanalyst.analysis.*`). No new field in the configuration: the message's limit is `form.answer_max_chars`. |
| 2026-09-23 | 0.19.0 | **`non_sequitur`**, the prevalidation's sixth outcome (§16.2): what the pipeline could not build at any size — a logo, some texts, an opinion, a piece of consultancy, work on physical machines — is refused like a request that is too big, with the same threshold. It comes from the case seen in testing: with no place in the distribution for what is not software, the model raised `off_domain` and zeroed every probability, and the step ended `failed`. The policy now forbids the distribution of zeros. The **`off_domain` flag stays** and takes its precise meaning: software that could be developed but is not a webtool, independent of size and with no effect on the flow (§16.2). **The policy teaches the perimeter with a criterion instead of with a list**: a webtool is a small tool for a specific need, something somebody has to do and that comes round again; the examples illustrate and do not bound. Before, the model generalised from the context document's list and got «internal tools for tracking» out of it, sending a showcase site to `non_sequitur` and counting aesthetic care as a scope risk. Three things that do not put a request out of domain are now written out by name: who can use the tool, what it looks like outside, how big it is. **The tokens of an attempt that went wrong are no longer lost**: if the model answered, `usage` and `model` end up on the `failed` step together with the error (§16.3). The examples of `scripts/examples/` are regenerated from the real code (`readAnswers` + `renderPrespec`), no longer written by hand, and become five: `fuori-dominio.md` — the old one — takes the name `non-sequitur.md`, which is the outcome it deserves, and the freed name goes to a new example for the **flag**, a farm holiday's website, which passes as `ultrasafe` with `off_domain` raised (§16.8). Tests from 14 to 16. |
| 2026-09-23 | 0.18.0 | **Going back** (§16.6). The prevalidation's fifth outcome, `underspecified`: a request that says too little to be judged is not refused, it goes back to the form filled in as it was, with a notice at the top and the project in `UNDERSPECIFIED`. The `project_id` travels in a hidden field and is checked again on anagraphics (the owner and the state); the rounds are counted on the pipeline's steps and above `prevalidation.max_underspecified_attempts` the request is refused. `verdict()` in `src/prevalidator.js` decides between the three outcomes; anagraphics accepts the new state and the new `result`. The texts are in the catalogues (`preanalyst.underspecified.*`), the notice is `.form-notice`, the form's fields carry the answer already given back with them. New configuration: `prevalidation.max_underspecified_attempts`. Tests from 6 to 14. |
| 2026-09-23 | 0.17.0 | **The prevalidation** (§16), the flow's first gate. A new AI module `src/ai/` (a single interface plus the Anthropic provider with the official SDK, the output constrained to a JSON schema), `src/prevalidator.js` with the `scope-v1` policy that arrives from the configurator, four outcomes with their probability and the internal `off_domain` flag. The outcome is appended to the project's **pipeline** in anagraphics; if the check does not succeed the project stays. A refusal → `/?rejected={id}` with the one-button modal and the link to the PDF of the form's data (`GET /projects/{id}/rejection.pdf`, pdfkit; the extended reason only to the drivers or if the configuration says so). A **shared loader** on the submission (`commons/script/webtools_loader.js` + `commons/templates/loader.njk`, a new script_deployer). The pre-specification's template becomes a generated copy: the original is in `configurator/documents/`. New configuration: `ai`, `prevalidation`; the provider's key lives in the secrets (`configurator/secrets/`, outside git). The subsystem's first tests: 6. |
| 2026-09-22 | 0.16.0 | **Languages.** All the texts of the page, of the questions, of the messages and of `upload.js` in the shared catalogues (`commons/i18n/locales/`, the `preanalyst.*` keys); `questions.js` keeps only the structure and the English texts of the pre-specification, and the options become `[code, text for the pre-specification]`. The sections' ids in English. The language switcher and `POST /locale`, which for whoever has entered saves the language in the session and in the profile. The pre-specification's `language` = the page's language. Configuration: the `i18n` section. |
| 2026-09-22 | 0.15.0 | Alignment with the "Lavora con noi" page. **The driver and the discount are checked again at submission time** (`src/project_driver.js`): they count only with a driver who exists, is enabled and is not the person filling the form in; the discount carries its driver. The ambassador box: «Ti ha invitato a usare webtools.». The autonomous work notice: by consumption with the tokens, plus the system fee; the link leads to `#lavoro-autonomo`. |
| 2026-09-22 | 0.14.0 | **Enabled drivers**: with `?driver=` or `?discount=` the driver found must have `enabled: true`. New `driver_disabled` and `discount_driver_disabled` states: the user reads that with that driver one does not go on and that they are to be contacted; we assign the project, and the discount of a driver who is not enabled does not travel with the form. The ambassador does not require being enabled. |
| 2026-09-22 | 0.13.0 | **The ambassador** (§5.6): `?ambassador=<a driver's uid>` shows the "Invito" box if there are no driver links and no autonomous work; at submission time the uid, checked again with `GET /drivers/{uid}`, goes into `billing.ambassador_uid`. New `src/ambassador.js`, `partials/ambassador_box.njk`, `findDriver()` in `anagraphics.js`. |
| 2026-09-22 | 0.12.0 | **Out goes the discount on the autonomous work's fee**: from the page, from the configuration (`billing.autonomous_fee_discount_percent`) and from the project's `billing`. The "Lavoro autonomo" block says that there is no driver's share and that it is paid by consumption plus the system fee, with the «Vuoi saperne di più?» link to the front-gate's "Lavora con noi" page, in a new tab (with no wording announcing it). New configuration: `subsystems_infos.front_gate.url`. |
| 2026-09-21 | 0.11.0 | **Configuration from the configuration subsystem.** At startup `GET /configuration/preanalyst` is read from anagraphics (the shared client `commons/configuration/configuration_client.js`, a copy in `src/commons/`); out go all the environment variables and all the defaults, except the `WEBTOOLS_*` bootstrap. With no configuration the server does not start. The cut-off of the open answers (before, the `MAX_TEXT_LENGTH` constant in `prespec.js`) becomes `form.answer_max_chars`. |
| 2026-09-21 | 0.10.0 | **The submission is connected** (§14). `POST /submit` creates the project in anagraphics, writes the pre-specification in webtools-workspaces and sends to `/analysis/{id}`, an empty page reserved for the owner. `submission_id` against double submissions; the driver and the discounts in the project, in `review` and `billing`; the project is deleted if the pre-specification is not written. `POST /upload` accepts only an `.md` with `project_id` in the front matter, checks the project and the owner and keeps it as `third_party`. The options' codes in English (`mobile`, `unknown`, …) with English labels for the pre-specification. The submit button sits in the access gate and is enabled by the login. A new `yaml` dependency. `referral.js` renamed **`driver_link.js`** (`resolveDriverLink`, `withoutOwnLink`): it reads a driver's link for the box, and is not to be confused with the project's data. |
| 2026-09-21 | 0.9.0 | The rules for the driver filling the form in: their own discount or link is ignored (the `own_link` state in `referral.js`), other drivers' stay valid; the **Lavoro autonomo** block below the driver box, with the 20% discount on the fee, which dims the box with `:has()` and shows the notice. The right-hand column becomes an updatable container (`data-sso-aside`), included in the fragment. |
| 2026-09-21 | 0.8.0 | The login opens in a **window** that closes by itself: `GET /login-done` closes the round trip, `GET /session-fragment` returns the two pieces rendered by the templates and the browser replaces them in place (`public/sso_popup.js`). The subsystem's first line of browser-side JavaScript. No more return of the ticket to the starting page, which opened a second copy of the form in the wrong window. |
| 2026-09-21 | 0.7.0 | The HTML leaves the JavaScript: `templates/page.njk`, `macros/fields.njk`, `partials/driver_box.njk` rendered with **nunjucks** (autoescape), the shared shell from `commons/templates/base.njk`. `src/page.js` prepares the data only. The subsystem's first npm dependency. |
| 2026-09-21 | 0.6.0 | Access: the state in the header, the "an account is needed to go on" box below the button, `GET /logout`, the return from the login with `?ticket=` and the `webtools_preanalyst` cookie. All the dialogue with the sso goes through `src/commons/sso_client.js`, a copy generated by the new deployer. The page stays usable while logged out and with the sso off too. |
| 2026-09-20 | 0.1.0 | Creation: a single page rendered by the server, the drivers' dropdown read from anagraphics, four states of the discount code, static files, the `--start`/`--stop` script with a verified PID, `deploy_preanalyst` in the style's deployer. |
| 2026-09-21 | 0.5.1 | Out goes the "this link does not carry any discount" notice: it was useless and misleading, it made one think that another link ought to have carried one. With `?driver=` the box shows the name only. |
| 2026-09-21 | 0.5.0 | Out goes the driver's dropdown and every reference to the possibility of changing them. The box shows the driver's name when the link carries it, otherwise it says why not; the `uid` travels as a hidden field. `isLocked()` becomes `isResolved()`. |
| 2026-09-21 | 0.4.0 | The driver box appears **only** with `?discount=` or `?driver=` in the URL. Without them, the page is single-column and does not call anagraphics. |
| 2026-09-20 | 0.3.0 | The page splits in two: the main block with the text and the pre-analysis form (the questions in `src/questions.js`, 5 sections and 14 fields), the autonomous driver box on the right, attached to the form with `form="gate-form"`. The choice of the driver is declared **optional** in the texts. `GET /` always answers `200`: if the drivers' list does not arrive, the form stays and the URL's parameters travel as hidden fields. |
| 2026-09-20 | 0.2.0 | The `?driver=<uid>` parameter added, with the same logic as `?discount=` but with no discount. `discount.js` becomes `referral.js`, with six states in place of four; if both parameters arrive, `discount` wins. |
