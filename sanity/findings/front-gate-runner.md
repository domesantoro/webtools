# front-gate-runner

Paths: `webtools/front-gate/webtools_front_gate.sh`, `webtools/front-gate/package.json`
Examined: 2026-09-26

The start/stop script is the same script as the other four: `diff` against
`webtools/sso/webtools_sso.sh` returns the eight lines that spell `webtools_front_gate` instead of
`webtools_sso`, and nothing else. The finding about that — one copy per subsystem and no original —
is recorded at `findings/sso-runner.md` and is not counted again here, nor are the three inherited
from `findings/preanalyst-runner.md`.

What is this unit's own is the other half of the start: the script decides a subsystem has started
by reading a sentence printed by a file it does not own, and this member of the class is the one
with no tests to run.

---

## 1. The start is agreed on a sentence, and the agreement is written nowhere

- `webtools/front-gate/webtools_front_gate.sh:77` — `grep -q "webtools_front_gate listening on"`
  against the log, matched by `src/index.js:25`, which prints
  `webtools_front_gate listening on http://${host}:${port}`
- Shape: **4 — capability inferred from resemblance**, with **6 — world narrowed to fit the code**
- Class: **the subsystems that start.** "It is up" is a property every member has to be able to
  state, and the protocol for stating it is a line of English prose that has to be spelled the same
  way in two files per member — ten files in all. Nothing establishes the agreement: the script
  does not ask the server what its confirmation looks like, the server does not know it is being
  read, and no test puts the two together. The script recognises the path it has seen work.
- The other end of it is already in the code: the server binds a host and a port
  (`src/index.js:23`), and being up is a thing that can be **asked** — a connection to
  `settings.host:settings.port`, which is exactly what the caller wants to know and does not depend
  on any wording. The wording was picked because it was there in the log.
- What goes wrong is not hypothetical wording drift alone: the log is opened in append mode and the
  offset is taken before the start (`:60`), so the match is confined to this run, but any change to
  the sentence — a translation, a rename, a "listening at" — makes `--start` return 1 with
  "has not confirmed the start within 10 s" for a server that is serving. The PID file is left in
  place, so the process stays up while the operator is told it did not start.
- Severity: `latent` — it takes an edit to one of the two lines, which is a change somebody is
  entitled to make in either file without ever seeing the other.
- Smallest generalising change: have the script wait for the port to accept a connection, or make
  the confirmation line a value the script and the server both read from one place, instead of two
  spellings that happen to agree.

---

## 2. The one node subsystem with no `test` script, in a class that is looped over

- `webtools/front-gate/package.json:11-13` — `"scripts": { "start": "node src/index.js" }`, with no
  `"test"`; and no `tests/` directory in `webtools/front-gate/`
- Shape: **1 — partial-class requirement**, read from the other side: what four members of the
  class offer, the fifth does not, and nothing says so
- Class: **the node subsystems.** `preanalyst`, `sso`, `webtools-workspaces` and `configurator-fe`
  all declare `"test": "node --test \"tests/*.test.js\""` and hold a `tests/` directory;
  `front-gate` declares neither. Anything that walks the subsystems and runs their tests — a script,
  a CI step, a person doing the round before a commit — meets `npm error Missing script: "test"` on
  this member and has to be told about it by hand.
- The honest reading of the rule is that a member without tests is a member without tests — absent
  is absent — and what is missing is the statement of it. Four members make the fifth look like an
  oversight rather than a decision, and there is nothing in the subsystem that says which it is.
- Severity: `stylistic` — this is a statement about the shape of the class, not a defect in code
  that runs. It is the same kind of observation as the coverage one at
  `findings/preanalyst-tests-rest.md`.
- Smallest generalising change: either a `tests/` directory with the pages' round of assertions —
  the render of every route in `PAGES` and the links between them are ordinary things to assert —
  or a `"test"` script that succeeds and says there are none, so that the loop over the class does
  not break on the member.

---

## Noted, not raised as findings

- `package.json:4` — `"description": "The showcase site: it serves the static pages of public/."`
  is no longer true: the pages are rendered from `templates/*.njk` by `src/page.js`, and `public/`
  holds the stylesheet, the fonts and the loader. A stale description, in the one file another
  program reads to learn what this is.
- `webtools_front_gate.sh:83-84` — the timeout branch returns 1 and leaves both the process and the
  PID file alone. That is defensible (the operator is told to look at the log, and a later `--stop`
  still finds it), and it is the branch the finding above walks into.
- `package.json:8-10` — `"engines": { "node": ">=20" }`, never established at run time. Recorded at
  `findings/preanalyst-runner.md`; true here word for word.
- `webtools_front_gate.log` and `webtools_front_gate.pid` are in the working tree beside the script.
  Runtime files, excluded from the audit perimeter by the inventory.
