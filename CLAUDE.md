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

The detail — actors, architecture, flow, pricing model, open questions — is in
`contesto/02. current_context.md`, which is the current document (the one in `contesto/outdated/`
is not to be used). The visual reference for the flow is `structure/design/Sequence.drawio.pdf`.

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

- **MANDATORY, INVIOLABLE: the system talks to an AI only through a contract, and is never
  tied to one provider.**
  A **door** is one question the system asks a model. Every door owns a contract of its own — what
  it sends and what comes back, in our words — and **contracts are not shared between doors**: two
  doors may run on different providers, with different keys, different models and different
  consumption, and each has to be able to change without the others being disentangled first. Two
  contracts looking alike is the price of that independence, and it is paid on purpose.
  - **A provider is an adapter.** It receives the request in the contract's words, speaks whatever
    language its API speaks, and answers in the contract's words. It is the **only** file that may
    name that provider, import its SDK, or know its fields, its roles, its error codes, its reasons
    for stopping and what it calls a unit of consumption.
  - **Nothing above an adapter may contain a provider's vocabulary.** Not the callers, not the logs,
    not the tests, not the scripts, not the metrics, not what we store on a project. Passing a
    provider's own object through "because only two fields of it are read" is the same defect as
    importing its SDK upstairs, and it is slower to notice and worse to undo.
  - **What it consumed is counted, never converted.** The kinds of consumption are named by the
    adapter — one provider counts input and output, another a cache it writes and a cache it reads,
    another reasoning or images — and no list of those names exists in code anywhere outside an
    adapter. Above it they are carried and added up under the names they arrived with, and nothing
    turns them into money: what a unit is worth is not the system's to say, and a figure in a
    currency would be a claim about a price nobody configured. For the same reason kinds are never
    added to one another: a token of one kind and a token of another are not the same thing, and a
    sum of the two is a rate between them that nobody decided.
  - **One consumption is reported once.** What a call consumed is carried by **one** measurement, and
    the same tokens under a second name are the same tokens counted twice: whoever adds up the
    consumption adds up everything that carries tokens, and cannot tell one report of a call from two.
    A call may well be measured by more than one metric — what it cost, and what it was a turn of —
    and then only one of them carries the tokens, while the others carry the count. Which one is a
    decision, and it is written where it would be undone.
  - **Every outcome belongs to the contract, and different outcomes are different words.** An answer
    cut short, an answer refused, an answer that does not fit, and nothing coming back at all are
    four facts; why nothing came back is a fifth question. Collapsing them into one is how a system
    stops knowing what happens to it — and in each of the first three the model ran, so what it
    consumed is real and is reported.
  - **The door checks the contract** on whatever the adapter hands over, so an adapter that drifts is
    caught at the boundary instead of three files downstream, where it shows up only as a number
    that quietly stays at zero.

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
- **What is built is measured, and the vocabulary is extended to say so.** A piece of work that
  produces a fact somebody will want to know later — how big the thing it made was, how many of
  something it found, how it decided, how long it took — measures it, and the name goes into
  `webtools/metrics/webtools_metrics/vocabulary.py` as part of that same work. The vocabulary is a
  closed list so that a typo cannot invent a counter nobody reads; it is **not** a list of what
  deserves measuring, and "the vocabulary does not have it" is the reason to add a line, never the
  reason not to measure. Finding what is worth measuring is part of building the thing, not a pass
  afterwards: whoever writes the code is the only one who knows which of its numbers will be asked
  for, and by the time somebody asks, the occasion to record it has gone.

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
- **A reason is written out, not alluded to.** Short means without padding; it does not mean
  compressed. Every step of an argument is stated in plain sentences, including the one that seems
  obvious, and what a claim rests on is said rather than left to be worked out. A `file:line`
  reference is where a claim can be **checked**; on its own it is not the argument, and a paragraph
  built out of references says nothing. Trade vocabulary used as shorthand — a term standing in for
  the sentence it replaced — makes an explanation sound technical while carrying less: it is a defect
  like any other, and it costs a round of questions to undo. One reason per paragraph, each ending
  where it could be disagreed with on its own terms. This holds for what is said to the user and for
  what is written in `contesto/` and in the documentation.
- **The design is discussed before it is produced.** A document, a plan or a piece of code written
  before the decision has been talked through is work done in the wrong order, even when the thinking
  behind it is right.
- **Before designing variants, look for how the system already solves that problem.** A question that
  feels new has usually been answered once already, somewhere in the subsystems, and the answer is
  the convention the rest of the code runs on. Finding it is the work; three invented alternatives
  put in front of somebody are not a design discussion, they are the discussion not having been
  prepared. Changing strategy is a decision of its own, and it needs a reason of its own — that the
  existing one was looked at and does not hold here.
- Decisions and the state at the end of the day are recorded in `contesto/sessions/`. There is **one
  checkpoint per day**, not one per session: if the day's file already exists, the next session
  **appends** to it at closing time, without rewriting or deleting what is there.
- **Maintaining this file**: it is updated at the end of a session, and only if genuinely **general**
  matters have come up. Matters local to a subproject stay in its own documentation; progress stays
  in the checkpoints.
