# webtools_preanalyst

The **pre-analysis**: the page the client enters the flow from, and the specification rounds in
`/analysis/{id}`. The conversation and the turns live on the project; the analyst opens it with the
first question. The purchase of turns is still fake (§14.3.2 of the documentation).
Node, with **nunjucks** for the pages and **yaml** for the specifications' front matter.

- `POST /submit`: the form creates the project (anagraphics) with its .md pre-specification
  (webtools-workspaces), has it **prevalidated** and sends the browser to `/analysis/{id}` — or to
  `/?rejected={id}` if the request does not pass the gate.
- `POST /analysis/{id}/opening`: the analyst's first question, on a conversation that has not
  begun. It writes it onto the project and spends no turn.
- `POST /analysis/{id}/messages`, `.../turns`, `.../turns/buy`: one turn of the chat, moving turns
  from the user's credit, and the fake purchase.
- `GET /analysis/{id}/project`: the project's record in anagraphics, as a file. It is what the go
  button does until the step after the analysis exists.
- `POST /upload`: a ready-made .md specification, with the `project_id` in the front matter, for a
  project of the user's.
- `GET /projects/{id}/rejection.pdf`: the form data after a refusal.

The **prevalidator** (`src/prevalidator.js`) asks a model whether the request sits inside the
perimeter of the service: six outcomes with their probability, plus the internal `off_domain`
flag. Two outcomes refuse — too big, or something we could not build at any size — one sends the
user back to the form, three pass; the flag says it is software that could be developed but is not
a webtool, and it does not change the flow. The provider is reached through `src/prevalidator_ai/`, a
single door of its own, and is changed from the configuration (`prevalidation.provider`). The criteria live in `policies/`,
copies generated from `configurator/policies/`: they are not edited here.

The key of the **selected** provider is needed in `webtools/configurator/secrets/preanalyst.json`
(outside git): without it, the server does not start. The others are not read, and are not needed.

Trying the prevalidator without going through the form — **it makes a real call, so it costs**:

```sh
set -a; source ../configurator/bootstrap.env; set +a
node scripts/prevalidate.js scripts/examples/ordinary.md
```

Full documentation: `docs/subsystems/preanalyst/README.md` (at the root of the workspace).

## Start and stop

```sh
webtools/preanalyst/webtools_preanalyst.sh --start   # starts it in the background, detached from the terminal
webtools/preanalyst/webtools_preanalyst.sh --stop    # stops it
```

- PID: `webtools_preanalyst.pid`. Log: `webtools_preanalyst.log` (appended).
- `--stop` stops only the process of the PID file, and only after checking that it is
  `node …/webtools/preanalyst/src/index.js`.
- Debugging in the foreground, from this directory: `set -a; source ../configurator/bootstrap.env; set +a; npm start` (Ctrl+C to stop it).
- After a `git clone` or a version change: `npm install`.
- Tests: `npm test` (`node --test`).

**anagraphics, the sso and webtools-workspaces must be running too**.
`webtools/configurator/start.sh` starts them all in the right order.

## The page (`http://127.0.0.1:9200`)

The pre-analysis form (the questions live in `src/questions.js`). The driver box, on the right,
appears **only** if the URL holds `?discount=` or `?driver=`: whoever arrives without one sees
only the form, and the page does not even call anagraphics.

**The driver is not chosen**: either the link brings one, or we assign one. The box is
informative.

A driver can send a client here in two ways: `?discount=<discount code>`, which carries a
discount, or `?driver=<uid>`, which carries **none**. In both cases, if the driver is found, the
choice is locked.

| Case | What happens |
|---|---|
| `?discount=`, valid discount and driver found | The driver's name in the box, a green notice with the percentage |
| `?discount=`, read failed | "It cannot be applied: it has probably expired", and we assign the driver |
| `?discount=`, the discount's driver not found | "It cannot be applied: the driver cannot be found, contact them" |
| `?driver=`, uid found | The driver's name in the box, no notice |
| `?driver=`, uid not found | "This link's driver cannot be found, contact them" |
| `?driver=` or `?discount=`, driver not enabled | "They are not enabled to supervise projects, we cannot go on with them: contact them"; we assign the driver and the discount does not apply |
| Both parameters | `discount` wins; `driver` is ignored and the fact goes in the log |
| The driver list unreachable | `200`: the box says it cannot identify them, and the form stays fillable |
| `?ambassador=<uid>` without the other two, the uid of a driver | An "Invito" box with the name; it disappears if autonomous work is ticked. Unknown uid: no box |

The reads towards anagraphics are made by **this server**, never by the browser: anagraphics only
accepts calls from the IPs of its pool.

## Logging in

The page can be filled in **while logged out**: the account is needed to go on, and it is asked
for there. In the header there is "Entra", or the name of whoever has logged in with "Esci". The
submit button is enabled only for whoever is in; logged out, below it there is the box asking to
log in or register.

The login **opens in a separate window**, on purpose: what has been written in the form is not
saved anywhere, and if the login replaced this page it would be lost. Once the login is done the
window **closes by itself** and this page **refreshes in place** — the header and the box change,
the form is not touched. Without JavaScript it still works, but you go back by hand. After the
login the submission resumes by itself, unless the login has brought up the autonomous work
choice.

"Esci" (`GET /logout`) removes our cookie and sends the browser to the sso, which closes the
session: you log out of every subsystem, not only of this one.

With the sso down the page stays usable and says so: **nothing stops the pre-analysis**.

The whole conversation with the sso lives in `src/commons/sso_client.js`, which is a generated
copy.

## Style and shared parts

- `public/commons.css`, `public/fonts/`, `src/commons/sso_client.js`,
  `src/commons/configuration_client.js`, `public/sso_popup.js` and `templates/commons/base.njk`
  are **generated copies** from the deployer: do not edit them here. Edit the originals in
  `webtools/commons/` and run `webtools/configurator/deploy.sh`.

## Where the HTML is

In `templates/`, not in the code: `page.njk` is the page, `macros/fields.njk` draws the fields
from the data of `src/questions.js`, `partials/driver_box.njk` is the driver box, `analysis.njk`
is the specification-rounds page. `templates/commons/base.njk` is the shared shell, and it is a
generated copy.

`src/page.js` holds no HTML: it prepares the data and nothing else. Escaping is done by nunjucks
by itself, and that is the main reason for the choice: here every value comes from the URL or from
the database.
- `public/styles.css` is this page's **local** style, and is edited by hand.
- `public/assets/mark.svg` is a copy by hand of the front-gate's.

## Configuration

Read at startup from anagraphics (`GET /configuration/preanalyst`); the source is
`webtools/configurator/configuration/preanalyst.json`. No defaults: if anything is missing the
server does not start and the log says which field. Only the variables of
`webtools/configurator/bootstrap.env` come from the environment, and `--start` loads them by
itself. What the fields mean is in the full documentation (§8).

## Tests

```sh
cd webtools/preanalyst
npm test
```

They cover the functions that **decide**: how the prevalidator's answer is read and what is done
with it (`tests/prevalidator.test.js`), which provider is selected and whose configuration is read
(`tests/prevalidator_ai.test.js`), and the counting of the rounds of whoever has been sent back
(`tests/server.test.js`). They do not call the provider, they need no servers running and they
cost nothing. `src/driver_link.js` and the rest are left uncovered: a known hole, not a
choice.
