# webtools_projects_hub

**The pages a person sees their projects on.** Three tabs: the projects somebody owns, a driver's
links and the projects they supervise, and the projects nobody supervises. Node, with **nunjucks**
for the pages (the only dependency).

**It lists, it hands over documents, and it holds one gate.** The gate is the driver's: they approve
or refuse the analysis, and that is the one point where a route here moves a project. It lives here
because this is the driver's interface — the projects waiting on them are already on this page, the
analysis they judge is already served from it, and the session already says who they are.

Full documentation: `docs/subsystems/projects-hub/README.md` (at the root of the workspace).

## Start and stop

```sh
webtools/projects-hub/webtools_projects_hub.sh --start   # in the background, detached from the terminal
webtools/projects-hub/webtools_projects_hub.sh --stop
```

- PID: `webtools_projects_hub.pid`. Log: `webtools_projects_hub.log` (appended).
- `--stop` stops only the process of the PID file, and only after checking that it is
  `node …/webtools/projects-hub/src/index.js`.
- Debugging in the foreground, from this directory: `npm start` (Ctrl+C to stop it).
- After a `git clone` or a version change: `npm install` (one dependency only, nunjucks).

**Three subsystems must be running**: anagraphics (the projects and the discount codes), the sso (who
is asking) and workspaces (the two documents). Nothing calls this one, so nothing waits for it.

## The tabs (`http://127.0.0.1:9900`)

| Route | Tab | Who |
|---|---|---|
| `GET /` | the projects I own, in three lists | anybody logged in |
| `GET /driver` | the projects I manage, and my links | whoever's session carries a driver |
| `GET /broken` | the projects nobody supervises | a driver at level 2 or above |
| `POST /links` | makes one of a driver's links and shows it | a driver |
| `GET /projects/{id}/documents/{kind}` | the points or the analysis, as a file | see below |
| `POST /projects/{id}/validation` | what approving or refusing would do, and the button that does it | the project's driver |
| `POST /projects/{id}/validation/confirm` | the decision, written on the project | the project's driver |

A tab asked for by somebody it is not for answers **404, not 403** — the same rule the preanalyst
applies to somebody else's project: a thing you may not see does not exist, and a 403 tells you it
does.

`kind` is `proposal` (the points) or `analysis`. The points go to the project's owner, its driver and
level 2; the analysis to its driver and level 2, **and not to the owner** — their tab offers the
points and only the points. Everything else is a 404, one answer for every reason, so the address is
of no use for finding out which project ids exist.

**When each reader is offered them is a separate question**, and it is the page's, not the route's.
The client is offered the points once the driver has **approved** the analysis, never while it is
under review — what they would open before that is a draft nobody stands behind. The driver is
offered them exactly while it is under review, because reviewing it is the work. A refused analysis
is offered to nobody.

## The driver's gate

A project waiting for the driver carries two buttons. Neither decides anything: both go to a
confirmation screen that says what would happen, and for a refusal holds the box the motivation goes
in. The confirmation is a page from this server and not a dialog in the browser — both decisions are
final and nothing undoes them, so what stands between the button and the decision must not be
something a browser can be without.

| Pressed | Step | Result | State |
|---|---|---|---|
| approve | `driver_validation` | `passed` | `CLIENT_VALIDATION` — the client's own validation is the next gate |
| reject | `driver_validation` | `rejected` | `REJECTED`, with the motivation on the step |

**The motivation is obligatory**, and it is checked before anything is written: a refusal with an
empty box writes nothing and comes back with the text still in it. Its length is counted in
characters, not bytes (`limits.rejection_reason_max_chars`).

**Only the project's own driver, and only from `DRIVER_VALIDATION`.** Everything else is the same 404
— a project that is not there, somebody else's, one already decided. Level 2 is not admitted either:
`/broken` exists so that an unsupervised project can be found, and finding one is not deciding about
it.

Nothing new is measured. `gate.decided` and `gate.duration` already existed and `driver_validation`
was already one of the gates: the decision is counted inside the anagraphics client, once, and the
duration is the step the analyst opened at the hand-over being closed here — the time the analysis
spent on a person's desk.

## The client's three lists

Their projects are split by what they ask of the person: what is **moving**, what has **come back**
for want of detail, and what has **stopped**. A project left in pre-analysis is a stopped one — the
form was sent and the conversation abandoned — and it reads as a generic error. A project that was
paid for is active, because it is finished and not broken. A state none of the lists knows shows up
among the active ones, so it is a row somebody reads instead of a project that vanished.

## Entering

A redirect, not a popup:

```text
GET /             no cookie, or the sso says not logged in
                    → 303 <sso>/ui/login?next=<hub>/login-done
GET /login-done   the ticket is exchanged server to server, our cookie is set
                    → 303 /
GET /logout       our cookie goes, then the sso's
```

The preanalyst opens a popup instead, because a half-filled form must not be lost and because it
replaces fragments its templates had already rendered. **Neither holds here**: there is nothing on
these pages to lose, and "updating in place" would mean replacing the whole page. So this subsystem
has no `sso_popup.js` and no `/session-fragment`, and the sso's `/ui/login` gives it single sign-on
for free — whoever logged in at the pre-analysis an hour ago arrives without seeing a form.

**The sso not answering is a 503 page and never a redirect.** Treating "we do not know who this is"
as a logout would throw everybody at a login that is not reachable.

## Three things to know

- **The session is a photograph.** A driver enabled, promoted or switched off while they are logged in
  goes on seeing the tabs of the level they came in with, until the next login. It is the sso's
  documented trade-off, and it matters here because this is the first subsystem in which a level
  decides what a page shows.
- **Which states are owed a driver is this subsystem's rule**, not anagraphics'. It travels to it as a
  query (`?without_driver=true&state=…`): anagraphics applies the filter it is given and decides
  nothing.
- **Level 2 is read here for the first time in the system.** The threshold is
  `MIN_BROKEN_PROJECTS_LEVEL` in `src/projects.js`, in the code and not in the configuration, like the
  `MIN_SUPERVISING_LEVEL` the pool and the preanalyst already apply: an authorisation rule moves under
  review, not by editing a document.

## What is generated and what is written by hand

Generated copies from the deployers, **not edited here**:

| Where | What | Original |
|---|---|---|
| `public/commons.css`, `public/fonts/` | the shared style | `webtools/commons/style/` (`deploy.sh style`) |
| `templates/commons/base.njk`, `locale_switch.njk` | the page shell and the switcher | `webtools/commons/templates/` (`template`) |
| `src/commons/i18n/` | the languages and every catalogue | `webtools/commons/i18n/` (`i18n`) |
| `src/commons/configuration_client.js` | reading our own configuration | `webtools/commons/configuration/` (`configuration`) |
| `src/commons/metrics/` | sending measurements | `webtools/commons/metrics/` (`metrics`) |
| `src/commons/sso_client.js` | talking to the sso | `webtools/commons/sso/` (`sso`) |

`public/styles.css`, `public/assets/mark.svg` and everything in `src/` and `templates/` outside
`commons/` are written by hand.

## Configuration

Read at startup from anagraphics (`GET /configuration/projects-hub`); the seed is
`webtools/configurator/configuration/projects-hub.json`. No defaults: if anything is missing the
server does not start and the log says which field. Only the variables of
`webtools/configurator/bootstrap.env` come from the environment, and `--start` loads them by itself.

The one field worth naming here is `links.discount.min_percentage` / `max_percentage`: how much of the
price a driver may give away with a link. It is configuration because it is a commercial parameter
somebody sets — unlike the level that sees other people's projects, which is a rule and lives in the
code. `limits.rejection_reason_max_chars` is the other limit somebody sets: how long the motivation of
a refusal may be.

## Tests

```sh
npm test    # 126 tests, no server to start
```

Four of the six files run a **real** server of ours on a free port, with anagraphics, the sso and
workspaces answering from three fake servers of their own (`tests/stack.js`). Fake servers and not
fake modules: the access rules run through the three clients — the fetch, the timeout, the 404 that is
an answer rather than a failure — and a client replaced by a function would leave that part of the
path untried.
