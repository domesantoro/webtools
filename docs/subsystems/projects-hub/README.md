# Subsystem `projects-hub`

> Reference documentation for development, maintenance, troubleshooting, bugfixing and metrics.
> Last updated: 2026-09-30 · subsystem version: `0.3.0`.
> Code: `webtools/projects-hub/` (paths relative to the root of the `ftab - webtools/` workspace).

---

## 0. Quick sheet

| Item | Value |
|---|---|
| What it does | **The driver's and the client's page.** It lists projects, hands over documents, and holds the one gate a person decides at: the driver approves or refuses the analysis |
| Stack | Node 23 · the `node:http` module · **nunjucks** for the pages (the only dependency) |
| Code | `webtools/projects-hub/` |
| Start (background, detached from the terminal) | `webtools/projects-hub/webtools_projects_hub.sh --start` |
| Stop | `webtools/projects-hub/webtools_projects_hub.sh --stop` |
| Process | `…/node …/webtools/projects-hub/src/index.js` |
| PID / Log | `webtools/projects-hub/webtools_projects_hub.pid` / `webtools_projects_hub.log` |
| Address | `http://127.0.0.1:9900` |
| Depends on | `webtools_anagraphics` (`:9100`), `webtools_sso` (`:9300`), `webtools-workspaces` (`:9400`), `webtools_comm_center` (`:9002`) |
| Database | None: the projects live in anagraphics, the documents in workspaces |
| Access | A session. **No pool of IPs**: the session is the gate, as in the preanalyst |
| Cookie | `webtools_projects_hub` |
| Tests | `npm test` (131 tests, no server needs to be running) |
| State | It lists, it downloads, and **it moves a project at one point**: the driver's gate (§2.9) |

Quick check, with the four services running:
```sh
open http://127.0.0.1:9900/
```

---

## 1. Purpose and role in the system

Two things were missing, and they are two sides of one gap: **nobody in this system ever reads the
register back**.

The analyst is finished, and a project that reaches `DRIVER_VALIDATION` stops there — the checkpoint of
2026-09-29 puts the driver's gate as the first thing missing, «the projects sit in `DRIVER_VALIDATION`
and nothing can move them». At the same time a project in `FAILED_NO_DRIVERS` waits for a person to
look by chance (`contesto/todos.md`): the analysis is written, paid for, and there is nobody it was
handed to.

This subsystem is the page three people look at. The client sees the projects they own. Every driver
sees their links, and if they may supervise, the projects they supervise. From level 2 up a person sees
the projects nobody supervises, which is the fault the todo is about, asked of the data for the first
time.

**It is also the driver's gate**, since 0.3.0. Everything else here lists or hands over a document;
the gate is the one place a project moves, and it is here because this is the driver's interface — the
projects waiting on them are already on this page, the analysis they judge is already served from it,
and the session already says who they are. A subsystem of its own would have had to be given all three
again. What the hub adds to the system, besides the pages, is the list the register never had, the
description a project never carried, and the decision that unblocks `DRIVER_VALIDATION`.

### 1.1 What did not exist, and is part of this work

Four things, and the pages could not be written without them.

**A project had no description.** The document carried `project_id`, `owner_uid`, `submission_id`,
`created_at`, `pipeline`, `review`, `billing` and nothing else. A list of UUIDs is not a list a person
reads. It is written now by the analyst's points door (§5 below, and
`docs/subsystems/analyst/README.md`).

**A project has no name, and still has none.** Nothing in the flow decides one. The hub shows a
placeholder and reads `project.name` where it is; the field is **not** added, because a field nobody
writes is a capability invented for the code's convenience.

**There was no way to list projects.** The only route was `GET /projects/{project_id}`.
`GET /projects` is new, with the three filters and the state filter
(`docs/subsystems/anagraphics/README.md` §6).

**There was no way to create a discount code.** They were made by hand in `mongosh`.
`POST /drivers/{uid}/discounts` is new.

---

## 2. Functional choices

### 2.1 A tab that is not yours answers 404, not 403

The same rule the preanalyst already applies to somebody else's project: a thing you may not see does
not exist, and a `403` tells you it does. It holds for the tabs, for the links a driver may not hand
out, and for every document.

### 2.2 Entering is a redirect, not a popup

```text
GET /             no cookie, or the sso says not logged in
                    → 303 <sso>/ui/login?next=<hub>/login-done
GET /login-done   claimTicket server to server, set-cookie for the life of the session
                    → 303 /
GET /logout       our cookie goes → 303 <sso>/ui/logout?next=<hub>/
```

The preanalyst does not redirect: it renders a `401` page and opens the login in a popup, because a
half-filled form must not be lost, and because it then replaces the fragments its templates had
already rendered. **Neither reason holds here.** There is nothing on these pages to lose, and
"updating in place" would mean replacing the whole page, which is a reload written by hand. So this
subsystem needs neither `sso_popup.js` nor a `/session-fragment`, and the sso's `/ui/login` gives it
single sign-on for free: whoever logged in at the preanalyst an hour ago arrives here without seeing a
form.

`{ok: false}` from the sso — it did not answer — is the third outcome and is **not** a redirect. It
renders the message page at `503`. Treating "we do not know" as a logout would throw everybody at a
login that is not reachable, which is the loop `currentSession` is commented against.

**What it does not carry across the login**: whoever asked for `/driver` or `/broken` while logged out
comes back to `/`. The round trip goes through one address (`/login-done`) and returns to the first
tab; carrying the asked-for path across it is not done today.

### 2.2.1 The client's page is three lists

They ask three different things of the person, so they are three lists and not one, in this
order: what is **moving**, what has **come back to them** for want of detail, and what has
**stopped**. `forOwner` in `src/projects.js` partitions them.

**A project left in `PREANALYSIS` is among the stopped ones**, and its state reads as a generic
error. The form was sent and the conversation abandoned; from this page there is nothing to do
about it, so it does not belong among the ones something is happening to. Those are the
majority of a long-lived account's projects, and keeping them out of the way is most of what
makes the page readable.

**`PAID` is among the active ones.** A project that was paid for is finished, not stopped: a
success is not a fault, and filing it under the failures would say it was one.

The partition is written as «what the two named lists do not claim is moving», so a state added
to the pipeline tomorrow appears among the active ones — a row somebody reads — instead of
falling out of all three and disappearing from their page.

Somebody with no projects at all gets **one sentence**, not three empty headings: three lists
that happen to be empty and an account with nothing in it are different facts.

### 2.2.2 When the client is offered the list of functionalities

The client is offered it **once the driver has approved the analysis**, and not while it is
under review: what they would open before that is a draft nobody stands behind yet. The driver
is offered it exactly *while* it is under review, because reviewing it is the work.

So the same file, on the same project, is offered to one reader and not to the other — and that
is why this is a rule of the **page** (`offersDocuments` in `src/page.js`) and not of the
download route, which answers the different question of who may have it at all. A client who
kept the address is still served the file; what changes is what they are offered.

The approval is what makes that visible: it puts the project in `CLIENT_VALIDATION`, which is
the first state of `APPROVED_BY_DRIVER_STATES`. **A refused analysis is offered to nobody** —
`REJECTED` is not in that list either, and the client is not shown the functionalities of a tool
that is not going to be built.

The label is the reader's own, like the state: the client reads «the functionalities of your
system», the driver «download the points» — the same file, and «your system» would be a
sentence about a system that is not the driver's.

### 2.3 Two maps of states, because there are two readers

The two readers ask two different questions — «what is happening to my project» and «what is there for
me to do» — so `DRIVER_VALIDATION` is "being reviewed" for one and "waiting for you" for the other.

- `projects_hub.state.client.<STATE>`: `FAILED` and `FAILED_NO_DRIVERS` say the same thing, because the
  difference between them is ours and not the client's.
- `projects_hub.state.driver.<STATE>`: thirteen states, thirteen sentences. The difference is exactly
  the driver's work.

Each state also carries a **tone** — `moving`, `waiting`, `done`, `stopped` — which is what the
row looks like before it is read: somebody opens these pages to find out whether anything is
waiting for them, and that answer has to arrive before a single row has been read. The tone is
per reader for the same reason the sentence is: `DRIVER_VALIDATION` is `waiting` for the driver,
whose work it is, and `moving` for the client, who has nothing to do about it. A state the map
does not know is `moving`, so a state added tomorrow does not turn a client's page red by
accident.

**Amber asks, vermilion reports.** A project waiting for the person is something they can act
on, and amber is what a page uses to ask; one that stopped or was refused is an outcome they can
do nothing about from here, and that is what the strongest colour on the palette is for. The
other way round — an error in amber and a request for detail in vermilion — reads as an alarm
where there is a task and a note where there is a fault.

**The colour carries the tone and the words carry the meaning.** The badge holds the sentence,
so a reader who cannot tell the four colours apart loses the glance and not the information.

### 2.4 Which states are owed a driver is this subsystem's rule

A driver reaches a project at one of two moments: from a link at birth (`review.preset: true`), or from
the analyst's handover once the analysis is written. So a project in `PREANALYSIS`, `PREVALIDATION`,
`UNDERSPECIFIED` or `ANALYSIS` with no driver **is not broken** — it has not got there yet, and that is
the ordinary case. `REJECTED` is out as well: a refusal is closed, and nobody is owed to a refusal.

The list is `STATES_OWED_A_DRIVER` in `src/projects.js`, and it travels to anagraphics as a query:
anagraphics applies the filter it is given and decides nothing — the same division by which it stores
`review.preset` without applying the rule that sets it.

### 2.5 A failure's reason comes off the last step

There is no `reason` field on a project. A failure is written into the `data` of the step that failed,
by whoever failed: the analyst's `_failed()` writes `data.failed_at` ∈ `broken | no_specification |
technical | judgement | points | documents`, and a handover that found nobody writes a second step of
its own with `failed_at: "handover"`. So **the last step is the one that says why** — which is what
makes the list's projection enough (`pipeline.steps` sliced to the last one), and why a row shows the
reason when there is one and not always.

A reason this subsystem has no sentence for is shown as the word itself: a reason added to the pipeline
tomorrow appears as a fact before it appears as a sentence, rather than disappearing.

### 2.6 Whether the documents exist

Three ways of knowing, in `hasDocuments` (`src/projects.js`). The direct one: the step that closes the
analysis carries what was stored (`data.documents`). The state answers instead when the last step is a
later one, through the list of states only the analysis gate leads to (`FAILED_NO_DRIVERS` is in it
because that is what the state says of itself: the work was done, what is missing is a person).

The third is the driver's gate, and it is the case 0.2.0 said would be revisited the day that gate was
written. A project refused there is `REJECTED` with the refusal as its last step: the state says
nothing, because `REJECTED` is reached from either side of the analysis, and the step carries no
`documents` because the analyst already said where they are and a second copy would be a second answer.
What the step does say is that this gate decided — **and this gate is only reached once both documents
are stored**, so a step of it is the proof.

No page offers them on a refused project (§2.2.2), and a refused project is in none of the driver's
lists either. The question is answered truthfully all the same, because what is asked here is whether
the documents exist and not whether somebody is being offered them: that is the page's question, and it
is asked elsewhere.

### 2.7 The links are made with a POST

Both buttons send `POST /links`, which renders the tab again with the link shown. Not an address with
the percentage in it: **the address ends up in the browser's history and in whatever log sits in front
of us, and this address is a thing that pays somebody**. The same reason the sso's session token
travels as a ticket and not as a parameter.

A percentage that already has a code **reuses it and writes nothing**: a driver ends up with at most
one code per percentage, and a link already handed out goes on working.

A link with a discount carries the code and **not** the driver: in the preanalyst `discount` wins over
`driver` when both arrive, so a second parameter would be one nothing reads — and the code already says
whose it is.

### 2.8 Level 2, read for the first time

`MIN_BROKEN_PROJECTS_LEVEL = 2`, in the code (`src/projects.js`), beside the precedent it copies:
`MIN_SUPERVISING_LEVEL = 1` is in the code in both places that apply it
(`webtools/drivers-pool/webtools_drivers_pool/main.py`, `webtools/preanalyst/src/driver_link.js`), with
the reason written there. The day the threshold moves, it moves under review and not by editing a
document. Why the discount range is configuration and this is not: §6.

---

### 2.9 The driver's gate

The one place in this subsystem where a project moves. Two buttons on a row that is waiting, a
confirmation, and a step.

**Two routes, and only the second decides anything.** `POST /projects/{id}/validation` says what is
about to happen and asks; `POST /projects/{id}/validation/confirm` writes the step. Both are `POST`: a
confirmation screen reachable with a `GET` would be an address sitting in the history and in whatever
log is in front of us, saying which project somebody was about to refuse — the same reason the links
are made with a `POST` (§2.7).

**The confirmation is a page from this server and not a dialog in the browser.** Both decisions are
final — an approval hands the analysis to the client, a refusal closes the request, and there is no
route anywhere that undoes either — so what stands between the button and the decision must not be
something a browser can be without. There was no confirmation convention anywhere in this repository
before this, and this is the one it establishes. It costs nothing here: there is no JavaScript in this
subsystem at all, and the refusal needs a box to type in, which is a page either way.

**What each decision is**, in `src/validation.js`:

| Pressed | Step | Result | State | Carries |
|---|---|---|---|---|
| approve | `driver_validation` | `passed` | `CLIENT_VALIDATION` | `driver_uid` |
| reject | `driver_validation` | `rejected` | `REJECTED` | `driver_uid`, `reason` |

Approving sends the project **to the client and not to the developer**: the flow puts the client's own
validation between the two (`contesto/02. current_context.md`, step 5), and `CLIENT_VALIDATION` is
already the first state in which the client may be shown the list of functionalities (§2.2.2). Nothing
is triggered by it today, because the gate that asks the client does not exist: what approving does is
move the project and say so.

**A refusal is said to the client** — `analysis-refused` at the comm-center, with the sentence the
driver wrote. The driver is at the screen and sees their own decision land; the person whose request
has just been closed is not, and the motivation is the whole of what they are owed at this gate. The
client is read from anagraphics with `GET /users?uid=…`, because the project keeps `owner_uid` and no
copy of the person.

**An approval says nothing to anybody.** It moves the project to a gate the client has nowhere to
act at, and a message asking somebody to do something that cannot be done yet is worse than none.

**Telling cannot undo deciding.** A project with no owner on it, an account no longer there,
anagraphics or the comm-center not answering: each of them leaves the step written, the state
`REJECTED` and the driver answered, and says in the log that nobody was told. Rolling a person's
decision back because a message did not leave would be the worse of the two.

**The motivation is the driver's obligation, and it is checked before anything is written.** A refusal
with an empty box writes nothing: what comes back is the same screen with what is missing said on it
and the text still in the box — a page that threw the sentence away would make the driver type it again
to be told the same thing. Two things can be wrong with it and they are two different facts, so they
are two sentences: there is nothing there, or there is more than `limits.rejection_reason_max_chars` of
it. The length is counted in **characters and not in bytes**, because the limit is about a sentence
somebody has to read: the same sentence in two languages would otherwise be two different lengths.

**The sentence stays on the project and is shown to nobody else.** It is the driver's judgement, as the
model's reason already was: the client's refusal page says the analysis was written and whoever read it
decided not to go on, and no more (`preanalyst.rejection.after_review`, §5).

**Who may decide**: the project's own driver, and only while the project is in `DRIVER_VALIDATION`.
Everything else — a project that is not there, one that is somebody else's, one that has already been
through this gate — is the same 404, because telling them apart would tell somebody which project ids
exist and what state they are in. The level that sees other people's projects is **not** admitted:
`/broken` exists so that a project nobody supervises can be found, and finding one is not deciding
about it. An administrator who wants to decide takes the project first, which is a route that does not
exist yet.

**The state is what is read, never the steps.** The analyst opens a `driver_validation` step when it
hands the project over, but a project handed over before that step existed is waiting on a driver just
the same, and a gate that read the steps would refuse to decide about it.

**What is measured is already in the vocabulary, and nothing new was added.** `addPipelineStep`
(`src/anagraphics.js`) sends `gate.decided` with `{gate: "driver_validation", outcome}` for every step
it manages to write, and `gate.duration` when that step closes an open one — which here is the step the
analyst opened, so the duration is the time an analysis spent on a person's desk. Nothing is counted in
the route: a step anagraphics refused is not a decision the project carries, and it is not counted at
all.

**`gate.decided` goes out with no `reason` on it.** That dimension holds the *name* of a refusal, from
a list somebody can act on (`non_sequitur`, `run_out_certain`). What a driver writes is a sentence, and
a dimension holding it would open a bucket for every refusal there has ever been.

**After deciding, the row is gone from both lists**: approved it is `CLIENT_VALIDATION`, refused it is
`REJECTED`, and neither is a state this page has a list for (§10). So the tab says what was decided in a
sentence of its own rather than letting a row disappear in silence.

---

## 3. Technological choices

Node 23, `node:http`, nunjucks — the stack of every page subsystem here. The preanalyst and the sso are
the two references.

**HTML lives in templates, never in the code.** With autoescaping on, every value that ends up in the
page is cleaned by itself; composing HTML from strings makes escaping a matter of the writer's memory,
and here almost everything comes from outside — a description written by a model, a name written by a
person.

**Port 9900**, the next free one in the 9x00 family (9000 front-gate, 9100 anagraphics, 9200
preanalyst, 9300 sso, 9400 workspaces, 9500 configurator-fe, 9600 metrics, 9700 metrics-fe, 9800
analyst).

**Cookie `webtools_projects_hub`.** It must differ from every other: cookies ignore the port, so on
`127.0.0.1` they all end up in the same pile and two with one name overwrite each other.

**No pool of IPs.** The session is the gate, as in the preanalyst. `configurator-fe` and `metrics-fe`
have one because they have no login at all.

---

## 4. Architecture

```
webtools/projects-hub/
  webtools_projects_hub.sh        --start | --stop, the twin of the other control scripts
  src/index.js                    settings → createServer → listen → the "listening on" line
  src/settings.js                 all the configuration, read once, no defaults
  src/server.js                   node:http, the chain of routes, ROUTE_LABELS, countRequest
  src/page.js                     the nunjucks env and one function per page. HTML only here
  src/anagraphics.js              projects, discounts. Every call an answer, never a throw
  src/workspaces.js               the two documents
  src/projects.js                 pure: the lists, the partitions, why a run stopped
  src/validation.js               pure: the driver's gate — the two decisions, who may take them
  src/links.js                    the three links, and the code for a percentage
  src/commons/                    GENERATED: configuration_client.js, sso_client.js,
                                  metrics/webtools_metrics_client.js, i18n/
  templates/commons/base.njk      the shell, GENERATED, and locale_switch.njk
  templates/{owned,driver,broken,message,validation}.njk
  templates/partials/{nav,project_row,project_group,links,link_made}.njk
  public/styles.css               commons.css, fonts/ and assets/ beside it
  tests/*.test.js                 node --test, with tests/stack.js as the harness
```

### 4.1 Who is asking

`whoIsAsking` in `src/server.js` turns `currentSession` into three outcomes — a page, a login, or "we
do not know" — and `visitor` answers for the two that are not a page. The driver comes out of
`session.data.driver`, which the sso puts there at login: `null` for whoever is not a driver, and
otherwise `{driver_uid, level}` exactly as the user document holds it.

**The photograph ages.** A driver enabled, promoted or switched off while they are logged in goes on
seeing the tabs of the level they came in with, until the next login. It is the sso's documented
trade-off, and it is worth naming because this is the first subsystem in which a level decides what a
page shows.

`tabsFor` builds the list of tabs once, and it is given both to the navigation and to the routes: a tab
in the header that answered 404 would be worse than no tab.

### 4.2 In what capacity a document is handed over

`capacityOver` reads the project once (`GET /projects/{id}`) and compares `owner_uid` and
`review.driver.uid`. Three capacities, and **the order they are checked in is not an accident**: a
driver reading a project of their own is its driver and not an administrator, and a client who happens
to be a driver is its owner. The narrowest true answer is taken, because that word is what
`document.served` is later read by — an administrator going through the wreckage and a driver starting
work are the two readings the number exists to tell apart.

A project that is not there answers like one that is nobody's, and the route turns both into the same
404.

---

## 5. What this work changed elsewhere

| Subsystem | What |
|---|---|
| anagraphics | `GET /projects` (three exclusive filters, repeatable `state`, the last step only), `PUT /projects/{id}/description`, `POST /drivers/{uid}/discounts`; three indexes on `projects` |
| analyst | the points door writes the project's **description** too, and `points.written` carries `described`; at the hand-over it opens the `driver_validation` step (0.3.0) |
| preanalyst | a fourth refusal case, `after_review`, for a request refused at the driver's gate: `rejectionCase` asks **which gate refused** before asking the prevalidator's verdict (0.3.0) |
| metrics | `projects.listed`, `driver_link.issued`, `document.served`; `projects-hub` among the subsystems |
| sso | `login.allowed_next` gains `http://127.0.0.1:9900` and its `localhost` twin |
| configurator | the seed, a line in `start.sh` and `stop.sh`, and a function in six sub-deployers |
| commons | the `projects_hub` group in the catalogues; `projects-hub` in `webtools_i18n_check.mjs` |

**Why the preanalyst had to change.** Before this gate, a project in `REJECTED` had always been
refused by the prevalidator, and the sentence the client reads was chosen from that verdict alone. A
project refused at the driver's gate has a prevalidation that *passed*, so that reading fell through to
«we did not recognise the request» — which is the one thing that request is not: it was understood,
judged worth analysing, analysed and paid for. The case is now decided by the gate that refused, and
the prevalidator's verdict is asked only when that gate is the prevalidator's.

**The description is written where the analysis succeeds**, so a project that failed at the technical
door never has one — and those are exactly the projects in the two lists of stopped ones. Those rows
show the placeholder, the state and the reason, and no description. That is correct: there is nothing
to describe about a tool that was never analysed, and a sentence invented from the pre-specification
would be the hub claiming to know something the system does not.

---

## 6. Configuration

Read **at startup** from anagraphics, `GET /configuration/projects-hub`. The seed is
`webtools/configurator/configuration/projects-hub.json`. No defaults: if the document, or a field, is
missing, or a field is of the wrong type, the server prints `webtools_projects_hub is not starting: …`
with the field's path and exits with 1. After a change:
`webtools/configurator/start.sh --restart`.

Only `WEBTOOLS_ANAGRAPHICS_URL` and `WEBTOOLS_CONFIGURATION_TIMEOUT_MS` come from the environment, and
`--start` loads them from `webtools/configurator/bootstrap.env`.

| Field | Today | Notes |
|---|---|---|
| `listen.host` | `127.0.0.1` | The listening interface |
| `listen.port` | `9900` | — |
| `public_url` | `http://127.0.0.1:9900` | Our address as seen from outside: the login comes back to it, and it is what we declare to the sso when exchanging a ticket |
| `subsystems_infos.metrics.url` / `.timeout_ms` | `:9600` / `2000` | Where the measurements go. Nothing waits for it |
| `subsystems_infos.anagraphics.timeout_ms` | `5000` | No `url`: that comes from the bootstrap, as everywhere else |
| `subsystems_infos.sso.url` / `.timeout_ms` | `:9300` / `5000` | Asked on **every** page: who is looking at it |
| `subsystems_infos.workspaces.url` / `.timeout_ms` | `:9400` / `5000` | The two documents |
| `subsystems_infos.preanalyst.url` | `:9200` | Where a driver's links point. Only the address: nothing is asked of it |
| `subsystems_infos.comm_center.url` / `.timeout_ms` | `:9002` / `5000` | Where what has to be said to a person is handed over: the client, when a driver closes their request |
| `session.cookie_name` | `webtools_projects_hub` | Must differ from every other cookie |
| `links.discount.min_percentage` | `1` | The smallest discount a driver may put on a link |
| `links.discount.max_percentage` | `5` | The largest. A `min` above the `max` stops the server: a range that is not one offers nothing |
| `limits.body_max_bytes` | `8192` | The largest body accepted by a form. It is not a few hundred bytes because one of the forms carries prose: the motivation of a refusal |
| `limits.rejection_reason_max_chars` | `2000` | How long that motivation may be, in **characters**: it is a limit on a sentence somebody has to read, not on what a request weighs |
| `i18n.*` | as in every page subsystem | Languages, fallback, the shared language cookie |
| `metrics.log_failures` | `false` | Whether a measurement that could not be sent is logged |

**Why the discount range is configuration and the level threshold is not.** They answer different
questions. `min/max_percentage` is how much money a driver may give away — a commercial parameter
somebody tunes, and `contesto/02. current_context.md` kept it open as «is there a ceiling?», to which
this work answers 5. `MIN_BROKEN_PROJECTS_LEVEL` is who may see other people's unsupervised projects —
an authorisation rule, and that kind of rule this repository already keeps in the code, saying why.

---

## 7. Log

One line per event, in `webtools_projects_hub.log`. English, plain sentences. No token, no cookie.

| Line | Meaning |
|---|---|
| `[projects-hub] logged in: <username>` | The round trip closed and the cookie was set |
| `[projects-hub] ambassador link for <driver uid>` | An ambassador's link was handed out |
| `[projects-hub] driver link for <driver uid>` | A driver's link, with no discount |
| `[projects-hub] discount code <code> created at <n>%` | A code was written |
| `[projects-hub] discount code <code> reused at <n>%` | A code already there was handed out again |
| `[projects-hub] <kind> of <project_id> to <username> as <capacity>` | A document was served |
| `[projects-hub] driver_validation of <project_id>: passed\|rejected by <username>` | The driver's gate decided, and the step is on the project |
| `[projects-hub] driver_validation of <project_id> not recorded: <reason>` | Anagraphics did not take the step. **Nothing was written**: the project is as it was and the driver can decide again |
| `[projects-hub] <project_id> refused and no owner on it: nobody to tell` | The request is closed and the project carries no `owner_uid` |
| `[projects-hub] <project_id> refused and the client could not be read: <reason>` | Anagraphics did not answer with the person. The refusal stands |
| `[projects-hub] <project_id> refused and the client not told: <reason>` | The comm-center did not take it. The refusal stands |
| `[projects-hub] /broken asked for by a driver at level <n>` | A tab refused |
| `[projects-hub] invalid ticket on the way back from the login` | Somebody arrived at `/login-done` with a ticket that is not one |
| `[projects-hub] language not saved in the session: the sso does not answer` | The cookie changed anyway |
| `[anagraphics] …` / `[workspaces] …` / `[sso-client] …` | Every failure of the three dependencies |

---

## 8. Operational commands

```sh
webtools/projects-hub/webtools_projects_hub.sh --start
webtools/projects-hub/webtools_projects_hub.sh --stop
set -a; source ../configurator/bootstrap.env; set +a; npm start   # in the foreground, from webtools/projects-hub/
npm test
```

The script is the twin of the others: `nohup`, PID in the file, and a `--stop` that stops **only** the
process named by the PID file, after checking its command line. Never by name, never by port: other
projects run on this machine. Before testing, check whether an instance of the user's is already
running and leave it alone.

The generated copies come from the general deployer:

```sh
webtools/configurator/deploy.sh                       # everything
webtools/configurator/deploy.sh style template i18n   # only what this subsystem takes
```

---

## 9. Tests

`npm test` (`node --test tests/*.test.js`): **126 tests**, with no server to start.

| File | What it is about |
|---|---|
| `tests/projects.test.js` | The pure partition: which state ends in which list, a project of the driver's in `DEVELOPMENT` that is in neither, the reason read from a last step that has one and from one that has not, whether the documents exist |
| `tests/links.test.js` | The three shapes of link; a percentage that already has a code is reused and writes nothing; one outside the configured range is refused; `discount` and not `driver` in a link with a discount |
| `tests/access.test.js` | A non-driver gets 404 on `/driver`, a driver at level 1 gets 404 on `/broken`, the owner is refused the analysis and given the points, and the three outcomes of a session get three different answers — **the sso not answering is a 503 page and never a 303** |
| `tests/server.test.js` | The whole round trip through `/login-done`, every tab rendered, the two downloads, `POST /links` for both kinds, `/logout`, the language change |
| `tests/validation.test.js` | The driver's gate: who is offered the buttons and who is not, the four ways of being a 404, the confirmation that decides nothing, a refusal with an empty box and one past the limit — both writing nothing — the step each decision leaves, and the two measurements including the one a project handed over before the gate existed does **not** report |
| `tests/measurements.test.js` | The whole `dims` of every new metric, and that a list of zero still sends `amounts.projects: 0` |
| `tests/stack.js` | The harness: a real server of ours, with the three dependencies as fake **servers** |

The tests tell rows apart by their **description** and not by the project id: an id is only ever
on the page inside a document's address, and a project with no document to offer carries none.

Plus `node webtools/commons/i18n/webtools_i18n_check.mjs`, which must exit 0.

---

## 10. Known limits and technical debt

- **A decided project is in none of the driver's lists.** Approved it is `CLIENT_VALIDATION`, refused
  it is `REJECTED`, and this page has a list for neither: the lists that would hold them belong to the
  gates that do not exist yet, and a third list now would be a page built for work nothing can do. The
  tab says what was decided instead (§2.9).
- **Two decisions in the same instant.** The state is read and then written, and between those two
  moments a second request can pass: anagraphics appends a step without checking the state it is in.
  The same window the analyst documents for its own trigger. Here what it would cost is two
  `driver_validation` steps on one project, the second one's state winning — which needs the same
  driver pressing both buttons at once, or a form posted twice by hand.
- **Nothing undoes a decision.** An approval and a refusal are both final, which is why there is a
  confirmation and why it says so. A refusal taken by mistake is repaired in Mongo by hand.
- **No name anywhere.** Nothing in the flow decides a project's name, so every row shows the
  placeholder. The field is not born until something writes it.
- **No pagination.** `GET /projects` answers with everything, as `GET /drivers` does. The list of
  orphans is the one that can grow without a bound anybody chose.
- **The session is a photograph** (§4.1): a level changed while somebody is logged in takes effect at
  the next login.
- **The asked-for tab is not carried across the login** (§2.2): whoever is sent to the sso comes back to
  `/`.
- **Nothing questions the register on a cadence.** The broken tab makes the fault visible to whoever
  opens it; the `sanity-checker` of `contesto/todos.md` is what would make it visible to whoever has
  not.

---

## 11. How to extend (a checklist)

A new tab: a route in the chain, a label in `ROUTE_LABELS`, an entry in `tabsFor` if it is not for
everybody, a template, a function in `src/page.js`, keys under `projects_hub.` in **both** catalogues,
and a `projects.listed` value in the vocabulary if it shows a list.

A new state of the pipeline: a sentence in `projects_hub.state.client.` **and** in
`projects_hub.state.driver.`, and a decision about whether it is owed a driver
(`STATES_OWED_A_DRIVER`) and whether the documents exist by then (`STATES_AFTER_ANALYSIS`). Both are in
`src/projects.js`, next to each other, with the reasons written there.

A new decision at a gate: the pipeline's words for it in `DECISIONS` (`src/validation.js`), a
confirmation sentence under `projects_hub.driver.validation.` in **both** catalogues, and a button on
the row. The vocabulary needs nothing — `gate.decided`'s `outcome` is the list anagraphics already
stores a step's result from — and neither does the counting, which happens inside `addPipelineStep`.

A new kind of document: a line in `DOCUMENT_KINDS` in `src/server.js` saying who may have it, and a
label in the catalogues. The vocabulary needs nothing: `document.served`'s `kind` is open, because
which kinds exist belongs to workspaces.

---

## 12. Changelog

### 0.3.0 — 2026-09-30
**The driver's gate** (§2.9). Two buttons on a project waiting for a decision, a confirmation screen
rendered by this server, and a `driver_validation` step: approved the project goes to
`CLIENT_VALIDATION`, refused to `REJECTED` with the motivation the driver had to write kept on the
step. `POST /projects/{id}/validation` and `POST /projects/{id}/validation/confirm`, both of them the
project's own driver's and only while it is in `DRIVER_VALIDATION`; everything else is a 404.
`src/validation.js` and `templates/validation.njk` are new, and so is `addPipelineStep` in
`src/anagraphics.js`, which brings `gate.decided` and `gate.duration` with it — no metric was added to
the vocabulary, because both were already there and `driver_validation` was already a gate. Beside it:
the analyst now opens that step at the hand-over, so the wait on a driver's desk is measured, and the
preanalyst gained the `after_review` refusal case, because a request refused here would otherwise have
been told it was not recognised (§5). Configuration: `limits.rejection_reason_max_chars`, and
`body_max_bytes` from 4096 to 8192. Tests from 103 to 126.

### 0.2.0 — 2026-09-30
The pages reworked after the first look at them. The client's projects split into three lists —
active, came back, stopped (§2.2.1) — with a project left in pre-analysis reading as a generic
error and sitting among the stopped ones. The list of functionalities is offered to the client
only once the driver has approved, and never while the analysis is under review (§2.2.2); the
label is the reader's own. The driver's tab becomes two columns, with the projects on the left
and **one box per link** on the right, each showing the link it generated. Every state carries a
tone, so a row that is waiting for somebody is told apart before it is read. Wording: «Come
driver» → «Progetti in gestione», «Aspettano te» → «I progetti che gestisci», «Fai il link» →
«Genera link», «quota» → «fee di sistema», and the driver link's sentence rewritten.
`projects.listed`'s `owned` becomes `owned_active`, `owned_returned` and `owned_stopped`, so a
reading that spans today adds up a name that no longer exists and three that did not yet. Tests
from 92 to 103.

### 0.1.0 — 2026-09-30
First version. Three tabs, the two downloads, a driver's links. Together with it: `GET /projects`,
`PUT /projects/{id}/description` and `POST /drivers/{uid}/discounts` in anagraphics; the description
written by the analyst's points door; `projects.listed`, `driver_link.issued` and `document.served` in
the vocabulary, and `described` on `points.written`.
