# ftab — webtools

## Purpose

A small "factory" of **bespoke software for small, concrete problems**: trackers, leaderboards,
little archives, organising tools, replacements for spreadsheets or manual routines.

Guiding principle: **small problems → small solutions**. Defined scope, no endless projects, no
infinite feedback cycles, strong automation of internal work, human effort concentrated on
decisions and exceptions, the client owning their own accounts and environments.

### What a webtool is

**A small tool for one specific need**: somebody has something to get done, it comes back, and the
webtool is what they do it with. The need is their own — their work, their club, their household —
and the tool is built around it instead of being a general product they have to adapt to. When in
doubt, look at **what the person in front of the screen is doing**: if they are getting something of
their own done (preparing, recording, deciding, finding, sorting, sending) it is a webtool; if they
are being informed, entertained or served as a customer, it is not — a showcase site, a game, a shop.

Trackers, leaderboards, archives and spreadsheet replacements are **examples, not the perimeter**: a
request that resembles none of them can perfectly well be a webtool. Three things have nothing to do
with this judgement: **who may use it** (a webtool may be used by the client's customers or members,
and may sit on the open internet with no login: internal use is common, not a requirement), **how it
looks from outside** (it may need to look good: design is part of everything we build) and **how big
it is** (that is a separate question).

## Overview

The client arrives from the showcase site and states their need in a **pre-analysis**. A
**prevalidator** checks that the scope is acceptable, an **analysis engine** produces the analysis,
which is validated first by a **driver** (the human who supervises projects) and then by the client.
An **AI developer** builds it, the driver supervises the α-test, the **demo** is published. The
client accepts or refuses the demo; if they accept, they pay. At every gate a refusal takes the
request to REJECTED.

The price has a guaranteed **standard tier** and a **metered tier**, chosen by the client at the
start, whose price is worked out at the demo from actual consumption plus the driver's share.

Drivers sign up from **Work with us**: only **enabled** ones (after an interview) supervise client
projects; every driver can be an **ambassador** (inviting clients, taking half the fee) and do
**autonomous work** (their own projects, paid with their own tokens plus the fee).

We are in the **PoC** phase: a reduced slice of the pipeline is being built, to measure the real AI
cost of a webtool, how often demos are accepted, and how many turns a pre-analysis really takes.
**The PoC limits the perimeter, not the quality**: same standards as a real system.

The detail — actors, architecture, flow, pricing model, open questions — is in
`contesto/02. contesto_aggiornato.md`, which is the current document (the one in `contesto/outdated/`
is not to be used). The visual reference for the flow is `struttura/design/Sequence.drawio.pdf`.

## General rules

- **MANDATORY, INVIOLABLE: write for the class, never for the instance.**
  What is in front of you is an instance of what the code has to serve. It is evidence about the
  class, never a stand-in for it. Code that holds only for the instance is a defect of the worst
  kind: it passes the tests, because the tests are drawn from that same instance, and it fails on
  the first other instance, which was legitimate all along. Recognising the path that works and
  building on it **is** that defect — not a shortcut, not a first version, not a pragmatic choice.
  Four things follow, and none of them is negotiable.
  - **What only part of the class offers is optional.** The code works without it, and nothing is
    put in its place. Absent is absent, which is not a default.
  - **What holds only for part of the class lives at the boundary that deals with that part**, and
    is established there explicitly. It is never inferred from resemblance.
  - **Every outcome is handled, not only the one that succeeds.** The rest is part of the work, not
    of a later pass.
  - **Never narrow the world to fit the code.** If what you wrote holds only under a restriction
    you imposed, the code is wrong and the world is not.

- **Everything internal is written in English.** Code (identifiers, comments, docstrings),
  commit messages, log lines, API routes and fields, error codes, data, the pre-specification, and
  all documentation — `docs/`, the subsystem `README.md` files, `contesto/`, this file. **The only
  Italian in the repository is in the language catalogues** (`webtools/commons/i18n/locales/it.json`),
  because that is the product speaking to its user, not the system speaking to itself, and in what
  is already closed and is kept as it was written — `contesto/sessions/`, `contesto/outdated/` and
  `workbench/`: a minute of a meeting is not translated. A comment or a log line in Italian is a
  defect like any other. Quoting an Italian text — a catalogue value, a sentence the page shows —
  inside an English document or comment is not a defect: it is the quotation of a product text.
- **The service is called "webtools"** (trademark, titles, copy: «usare webtools»). "webtool" is only
  the common noun for the product: «un webtool», «il webtool viene sviluppato».
- **No generic names** for packages, modules, processes and services: prefix `webtools_`
  (e.g. `webtools_anagraphics`, never `app` or `anagraphics` on its own).
- **Safe start and stop**: PID files with a check on the command line. Never `pkill -f` with generic
  patterns, never stop a process found by its port: other projects run on this machine. Before
  testing, check whether an instance of the user's is already running and leave it alone.
- **API errors**: correct HTTP status and a stable code, `{"error": "<CODE>"}`. Never prose to be
  interpreted.
- **Shared parts**: the original lives in `webtools/commons/`, and inside the subsystems there are
  **generated copies** made by the deployers (`webtools/configurator/deploy.sh`). A copy is not
  edited where it sits: the original is edited and the deployer is run again.
- **Configuration comes from the configuration subsystem.** Every configurable value (addresses,
  ports, IP pools, durations, limits, prices, cookie names…) is served by anagraphics
  (`GET /configuration/{subsystem}`), never written inside the subsystem: no constants in the code,
  no environment variables, and no **default values**. The subsystem reads it at startup and, if a
  field is missing, does not start. Only the bootstrap comes from the environment
  (`webtools/configurator/bootstrap.env`). This holds for every new piece of work.
- **The configuration that lives is in Mongo**, in the `configuration` collection. The files in
  `webtools/configurator/configuration/<subsystem>.json` are the **seed** — the values a new
  environment is born with — and the **expected shape**: they say which fields exist. What is running
  may diverge from the file, and that is normal: a limit raised in operation, or a threshold
  corrected, stays where it is. `load_configuration.sh` adds **only the missing fields** and deletes
  nothing, so a new field arrives by itself at the next startup without carrying away what has been
  changed. Taking a subsystem back to the file has to be asked for:
  `./load_configuration.sh --reset [subsystem]`. A new field is always added to the file as well, or
  the next environment will be born without it.
- **Structured configuration, not flat.** Configuration files are organised into nested JSON objects
  by subject (`listen`, `access`, `subsystems_infos`, `session`, `limits`, …) whenever that makes the
  configuration more readable and more orderly: that is the choice to prefer.
- **What is not JSON belongs in the configurator too.** An artefact that says *what the system
  considers acceptable* or *what shape the documents it produces have* is configuration, even when it
  is a `.md` or a `.njk`: it lives in `webtools/configurator/` (`policies/`, `documents/`) and the
  subsystems get **generated copies** from a deployer. The JSON configuration says *which* one is
  used; the file says *what* it asks for. A prompt, a rubric, the model of a document are not code
  and do not live inside the subsystem.
- **Keys and credentials live in `webtools/configurator/secrets/`**, outside git, and
  `load_configuration.sh` deep-merges them onto the configuration: the subsystem reads one
  configuration and does not know that part of it was secret. Never a key in `configuration/`, which
  is in git.
- **HTML in templates, never inside the code**: pages are written in `.njk` files rendered with
  nunjucks, with autoescape on. Composing HTML from strings in JavaScript makes escaping a matter of
  the writer's memory, and the values almost always come from outside.
- **Text addressed to the user only in the language catalogues**:
  `webtools/commons/i18n/locales/<language>.json`, English keys grouped by area, never text in the
  templates or in the code and never local catalogues. Keys and values only, no per-language
  templates. The fallback is English. The language lives in the shared cookie (and, for whoever has
  logged in, in the session and the profile), never in the URL.
- **Text addressed to the user: dry and functional.** A sentence says what to do, what something is
  for, or what happens. No motivational tone, no sentences celebrating the client or our method, no
  advertising language. If a sentence can be removed without losing information, it is removed. A
  claim is made only if it can be checked: «ogni cosa che escludi è un giro di domande in meno» can
  be checked, «la domanda più utile di tutte» cannot. **No unrequested text**: an extra sentence is
  added if it helps the reader, never as filler, and it must not assume where the user came from —
  the same page is reached by different routes.
- **Never gender the reader.** In Italian that means no participle and no adjective that agrees
  with them — «sei sicuro», «sei pronto», «registrato» — and the sentence is turned round instead:
  «ti serve», «hai bisogno», «se vuoi». It holds for every language that agrees this way, and in
  both places the user is spoken to: the catalogues, and what a model is told to write for them
  (the policies). We do not know who is reading, and guessing wrong is worse than any clumsy
  sentence written to avoid it.
- **Nothing that opens by itself.** A window, a tab or an action that starts without the user having
  asked for it is a defect, even when it is convenient: first say what is about to happen, then wait
  to be asked.
- **Amounts in euro cents**, integers, throughout the project: data, API, configuration
  (`40000` = 400 €). Field names end in `_cents`. Conversion to euro happens only for display.
- **Cost estimates: always the worst case** — every conversion lost after the demo, so 5 full
  pipelines per sale, and hours counted across every project in the funnel, not only the sales.
  Unless explicitly asked otherwise.

## How we work

- Work proceeds by **specific requests**. No working on one's own initiative, no large unrequested
  plans, no changes beyond what was asked.
- When the user says **"stop"** or "fermo", stop immediately.
- **Short, concrete answers.** One session per subject, to keep the context small.
- Decisions and the state at the end of the day are recorded in `contesto/sessions/`. There is **one
  checkpoint per day**, not one per session: if the day's file already exists, the next session
  **appends** to it at closing time, without rewriting or deleting what is there.
- **Maintaining this file**: it is updated at the end of a session, and only if genuinely **general**
  matters have come up. Matters local to a subproject stay in its own documentation; progress stays
  in the checkpoints.
