# Checkpoint 2026-09-29

The analyst is finished, and a run has been done on real material from end to end. The session
started from the handover note of the night before, which the usage limit had cut short.

## 1. Five pieces, in the order they were built

**workspaces keeps two families of file.** The mechanism was already there — a versioned directory,
the front matter stamped, the atomic write with `link` — and `specs` was cabled into three places:
the two routes, the directory and file names, and the error codes. Now there are two families over
one mechanism: `specs/spec-vNNN.md` as before, and `documents/<kind>/<kind>-vNNN.md` for what the
system writes. `POST /projects/{id}/documents/{kind}` and `GET .../latest`, versions counted **per
family**, a size limit of its own, and `document.written` in the vocabulary.

The kinds are a closed list in code (`analysis`, `proposal`), beside `ORIGINS`, which was already in
that shape: a genre is a vocabulary, not a setting, since a new one needs a template and code that
produces it. **`prespec` is deliberately not one of them** — the pre-specification is a specification
and has its own route, and accepting it here as well would give one kind two places to be.

A document's reserved key carries `version` and `written_at`, and **neither an origin nor an
uploader**: under `documents/` there is only one origin, and no person uploads anything — a run of the
analyst has no session behind it, and an identifier put there to fill the field would be invented.

**The documents are rendered by the analyst**, with Jinja2, from the models in
`configurator/documents/` (`analysis.md.j2`, `proposal.md.j2`). The deployer comment that said
workspaces renders them was a sentence a previous session of mine had written, and it is corrected.
The analysis carries **no title of ours**, because the policy says the model's answer is the
document, whole; the proposal is a table with the identifier in each row.

**The catalogues gained a Python side.** `webtools/commons/i18n/webtools_i18n.py`, beside the
JavaScript one, over the same `locales/`. It is not a port: the JS module answers a *page's*
questions — which language this request is in, how to escape a value into HTML, what the switcher
offers, how to write an amount in euro — and a document has none of those, and its language is a fact
carried on the material. So it reads two configuration fields and knows nothing about
`i18n.cookie_name`. The catalogue check now reads `.py` and `.j2` too, and skips `tests` — a test
that checks what happens to a key nobody wrote has to name a key nobody wrote.

**The run**, in `webtools_analyst/run.py`: the pre-specification from workspaces and the rounds of
questions from the project's **last** `preanalysis` step, the three doors, the two documents, the
step with the decision, the driver from the pool, the comm-center told. Four clients written by hand
(`anagraphics`, `workspaces`, `drivers_pool`, `comm_center`), each with the same contract — the data
or a reason, never an exception — and every call measured as a `dependency.call`.

**The trigger**: `POST /projects/{project_id}/analysis` → `202`, and in the preanalyst
`POST /preanalysis/{id}/analysis`, which is what the go button does now. The download button, which
was in the markup doing nothing, took over the project record it used to hand out.

## 2. Four decisions, and who took them

**The documents are rendered by whoever produces them, and the fixed words come from the
catalogues.** Both were asked and answered rather than derived. The second one costs the Python i18n
client, and it is the reason there is one.

**Genres in the path, `/specs` untouched.** Two mechanisms for the same thing, one being a special
case of the other — accepted on purpose, against no migration of 27 directories and no change to the
preanalyst.

**A failed run ends in `FAILED`, and a project nobody can be given to in `FAILED_NO_DRIVERS`.** My
proposal had been to send a failed run back to `PREANALYSIS` so it could be triggered again; it was
refused. Two states were added to `PipelineState`. The handover writes a **second** step, because the
first says the analysis passed and the second says the handover did not: two facts, two rows, and the
project no longer sits in `DRIVER_VALIDATION` looking as though a person were reading it.

**The levels on the axes are the driver's business**, not something to tune in the policy (said at
the end of the session, about the 54 points of the real run).

## 3. The lesson of the session

Asked how the open step should be closed, I built three variants — a new route in anagraphics,
changing the existing one, or leaving two steps — and put them in front of the user twice, the second
time in plainer Italian. The answer was that they were incomprehensible and that I should **adopt the
standard strategy: some other subsystem will have faced this already.**

It had. `webtools/preanalyst/src/server.js`, where the chat's step is opened, says in a comment that
it is «an `open` step, one that has not decided anything yet and that grows; it will be closed by
another step when the rounds of questions end». The convention existed, it was in use, and the step
that closes that one is the analyst's. No route was added and nothing in anagraphics was changed.

The general form went into CLAUDE.md: before designing variants, look for how the system already
solves that problem, and adopt it.

## 4. The run on real material

The pre-specification of `webtools/preanalyst/scripts/examples/ordinary.md` — the coach of an amateur
volleyball team who wants to stop keeping attendance in a notebook — on a project created for the
occasion, `8bf6975d-7eef-4900-ac14-fa668d18c219`, which is still in the development database with its
two documents on disk.

Three minutes and twenty-one seconds. Verdict `take_on`, which is also what the model asked for;
weakest axis `surface` at 0.60, confidence 0.80. A technical analysis of 22 KB with the data model in
tables, 20 declared assumptions, and 54 functional points in Italian. The driver was assigned at the
first attempt and the comm-center wrote the notice in its log.

**What it cost: $0.4603.** 14 123 input, 14 270 output, 5 271 cache written, 0 read, at the prices of
Claude Opus 5 ($5 / $25 / $6.25 for a five-minute cache write, per million). The output is 77% of the
bill. The tokens on the step and the tokens in metrics agree exactly, which is the check that matters:
the money at the demo is not taken from metrics.

**The cache returned nothing, and the reason is structural.** `cache_read` is zero in all three
doors, because each door makes **one** call per project: inside a run there is no second read. Those
5 271 tokens were paid at 6.25 instead of 5.00 — half a cent on one project. The cache pays off
**between** projects, when two runs fall within five minutes of each other, which is a question about
traffic and not about code.

**The first five points of 54 are a login system**: entering with an email and a password, changing
it, creating and deactivating another coach's access. The client asked to replace a notebook and said
there are fourteen players and two coaches. The judge noticed — `surface` is the weakest axis of the
five — and where the levels on those axes should sit is the driver's, which is §2 above.

## 5. Where it stands

Everything green: analyst 159, anagraphics 90, preanalyst 62, workspaces 18, metrics 37, sso 55,
drivers-pool 8, comm-center 10, and the catalogue check at 0.

The analyst is documented for the first time: `webtools/analyst/README.md` and
`docs/subsystems/analyst/README.md` (the doors and their contracts, the documents, what is measured
and why only `ai.call` carries the tokens, the configuration, the run, the known limits).

What is not there:

- **the driver's gate**, a subsystem of its own: projects sit in `DRIVER_VALIDATION` with nothing able
  to move them on, which is what "the gate comes after" means;
- **a notification channel**: there is none in the repository, and the comm-center writes the notice
  in its log;
- **the sanity-checker** (`contesto/todos.md`): a project in `FAILED_NO_DRIVERS` now says so, but
  nobody asks. The check that finds it is a query on one state rather than a reconstruction from the
  steps;
- **two triggers in the same instant**: the state is read and then written, and between those two
  moments a second trigger can pass. Milliseconds against a run of minutes, and what it would cost is
  a second analysis paid twice;
- **`webtools/metrics/` is entirely untracked in git** (`?? webtools/metrics/`), so the vocabulary
  lines added by this work are in no commit.

---

# Checkpoint 2026-09-29, second session

The analysis the analyst produced was read, judged useless to whoever builds, and the policy behind
it was rewritten. The test was then run for real, from the form to the two documents, six times
before it came out.

## 6. Why the first analysis was not one

The document on the volleyball register (`8bf6975d`) described the tool. Five headings — what it
keeps, what the person does, what they look at, where it starts and stops, when it works — and those
are the same five the rounds of questions were told to establish, so the analysis could only be the
client's answers rearranged. What a developer needs on top of them was asked for nowhere: rates named
and never defined, the same rule stated in three places and disagreeing by the third, one outcome per
action and never a refusal, nothing on two people at once.

## 7. The policy, in three passes

The rewriting went wrong twice before it went right, and both mistakes are worth keeping.

**First pass: the taxonomy as the table of contents.** Sections called rules, states, transitions,
checks. That is a requirements specification, and a specification is read; whoever builds is told.

**Second pass: the instance as the model.** The spine became the screens, because the register in
front of me had screens. A webtool need not have any — one prepares a quotation, one checks a batch of
files before they go, one draws a tournament — and «write for the class, never for the instance» was
being broken in the policy itself. The spine is the doing: each thing somebody does with the tool,
told whole, including every way it does not work. Where the doing happens is named because this tool
has it.

**Third pass: what it is built with was nobody's to invent.** The document now decides in two parts —
what the tool does, and what it is made of down to the file tree, the store and how it is run. The
first run of it chose Python, Flask, Debian, Caddy and systemd for a workshop's quote sheet: a
defensible answer to a question that was not the model's to answer. With what the tools are built with
we decide once, or every project arrives in a different language and the demo, the repository and the
driver's supervision fragment.

## 8. Stack preferences: configuration, not policy, and not code

`analysis.technical.stack_preferences` in `configurator/configuration/analyst.json`: a mapping from a
kind of tool to the entries that describe it. Today one kind, `web`, holding Node 22 LTS, Express 5,
server-rendered Nunjucks, no client framework, SQLite through `node:sqlite`, `node:test`.

It is beside the policy and not inside it because a policy is a file somebody writes and this is a
value somebody sets. It reaches the model as a new word of the door's contract — `preferences` — and
**where it goes in the request is the adapter's**, which puts it in a second system block with its own
`cache_control`. Neither the door nor the adapter names `web` or any entry: both walk whatever came,
so a kind added tomorrow costs a line of JSON and no line of Python. Empty means nothing is preferred
and nothing travels: an empty preference and a preference nobody expressed are the same fact.

The policy says what to do with them: where a kind covers the tool, those solutions are written down;
departing from one needs a sentence saying what in the need makes it not work, and convenience, taste
and what would be nicer are named as not being that; where no kind covers it, the choice is the
model's and it says why. The run that followed took the stack as it stood and gave reasons only for
the two things the preferences did not cover — PDFKit, because the client carries away a file and not
a printable page, and a hosted machine rather than the workshop PC, because he shows old quotes from
his phone.

## 9. What the six runs cost, and what they taught

The material was made on purpose unlike the register: a metalworker who prices gates from his own
price list and sends a PDF. Prevalidation `safe` 0.72; five turns; the validator closed the
conversation by itself.

| Run | How it ended |
|---|---|
| 1 | `cut` at exactly 32000 output tokens — `max_tokens` was still the old ceiling, because the raise had been written to a field nobody reads |
| 2 | `no_answer`/`unreachable`, three attempts: the provider stopped accepting the key |
| 3 | technical door complete, then `401` on the judgement door: its key had a character too many |
| 4 | passed. 60 points, `take_on`, weakest axis `surface` |
| 5 | `400`: the replacement key was not scoped to a workspace |
| 6 | passed with the preferences in force. 59 points, `analysis/2`, `proposal/2` |

Measured, with run 6: prevalidation 0.006, pre-analysis 0.360, analysis 1.677 — **2.04 $ for a project
up to the validated analysis**, of which the technical door alone is 71%. Worst case, five pipelines a
sale, that is about 10 $ of tokens per sale before development. A further 1.98 $ went on runs 1 and 3,
whose output was paid for and thrown away.

Two facts the runs settled: 128000 is the model's output ceiling, not a choice; and raising it without
raising `timeout_ms` (600000, tuned for a 32k document) buys three paid timeouts instead of one
answer. Every door is now at 2400000.

## 10. What this leaves open

- **A failed run cannot be relaunched.** `run.py` starts only from `PREANALYSIS` and answers
  `ANALYSIS_ALREADY_STARTED` to anything else. When the fault is ours — a low ceiling, a key, the
  provider — the client has spent the conversation and the project is dead, recoverable only by editing
  the pipeline in Mongo by hand, which is what was done five times today.
- **The documents are written only after all three doors pass** (`run.py:181`). Run 3 generated a
  complete analysis, paid for it, and left nothing behind.
- **Nothing is logged between `run begun` and the closing line**, so a run of twelve minutes is
  indistinguishable from a hung one until it ends.
- **The analysis is long**, 778 lines for this tool, and part of that length is the material: the five
  client turns were written by an assistant playing a client and are denser than a real client's. The
  policy should be judged again on poorer material before deciding it asks for too much.
- The test ran in English throughout — the pre-specification was rendered `language: en` because the
  session had no locale — so the points and the proposal are in English. Correct behaviour, wrong
  client: an Italian run needs the locale set before the form is submitted.
