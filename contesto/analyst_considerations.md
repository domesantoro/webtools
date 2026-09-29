# The analyst — considerations and a design

## Purpose

This document records what was decided about the **analyst**, the subsystem that takes a finished
pre-analysis and turns it into the two things the rest of the flow needs: an analysis for whoever
builds the tool, and a list of functional points for the client to agree to. `webtools/analyst/` is
an empty directory; nothing here has been built yet.

It is written before the code on purpose. The decisions in it were taken in conversation on
2026-09-28, over three sessions of that day, and are recorded with their reasons, so that whoever
writes the subsystem — or asks for it to be changed — can see what the alternative was and why it was
not taken. Where a later decision replaced an earlier one, the earlier one is kept with the reason it
fell, instead of being quietly removed.

The visual reference for the flow is `structure/design/Sequence.drawio.pdf`; the authoritative
description of the pipeline is `contesto/02. current_context.md`.

---

# 1. What the analyst is for

The flow as written has the analysis between the prevalidation and the driver's validation:

> 3. The analysis engine produces the analysis.
> 4. The drivers pooling assigns the project to a driver, who validates the analysis.
> 5. **The user validates the analysis.**
>
> — `contesto/02. current_context.md:80-82`

The analyst is that engine. It runs once per project, after the rounds of questions with the client
have closed, and it is not a page: nobody is waiting in front of it while it works.

**What it receives** is the whole pre-analysis, and nothing else:

- the **pre-specification**, the document the form produced, stored in `webtools-workspaces` and
  read back with `GET /projects/{id}/specs/latest`. Its front matter carries the codes of the closed
  answers and the language the client was writing in; its body carries the open answers, quoted, in
  the client's own words;
- the **transcript of the rounds of questions**, kept on the project's open pipeline step in
  anagraphics as a list of messages, each with the role of whoever said it.

It receives both of them **whole**. No field of this subsystem's configuration caps either one, and
nothing on the way in shortens them. The reason is in §12: the two cuts that exist upstream today are
defects, not measures, and they are removed with this work.

**What it produces** is three things:

1. the **technical and functional analysis** — the document from which the tool is built. Its reader
   is whoever builds, so it is in English and it is precise;
2. the **list of functional points** — the commercial analysis, the list the client agrees to. Its
   reader is the client, in their own language;
3. a **judgement of sustainability**, with a proposal: take the work on, or refuse it.

**The boundary with the preanalyst** is that the preanalyst talks to the client and the analyst does
not. The policy of the rounds of questions says so of itself: "you do not design the tool out loud,
you do not estimate, you do not price, you do not promise, and you do not decide whether the work is
accepted" (`webtools/configurator/policies/preanalysis-v1.md:5-6`). Everything in that list except
the pricing is the analyst's. The pricing is nobody's here; see §11.

---

# 2. The names, and what the rename left behind

The word *analysis* used to name the rounds of questions inside the preanalyst, and the two could not
keep it between them, because the new subsystem takes that conversation as its raw material. The
rename was done on 2026-09-28 and it is finished: those rounds are the **pre-analysis**, and the
engine that conducts them is the **preanalyst**.

| | |
|---|---|
| Pipeline step | `preanalysis` |
| metrics phases | `preanalysis_opening`, `preanalysis_turn`, `preanalysis_validation` |
| metrics, gate, read | `preanalysis.turn/.closed/.validation`, gate `preanalysis`, `GET /metrics/preanalysis` |
| preanalyst routes | `/preanalysis/{id}` and its five sub-routes |
| Error codes | `PREANALYSIS_NOT_OPEN`, `PREANALYSIS_ALREADY_OPENED`, `PREANALYST_UNAVAILABLE` |
| Policies | `preanalysis-v1.md`, `preanalysis-validation-v1.md` |
| Catalogue keys | `preanalyst.preanalysis.*` |
| Configuration | two branches: `preanalysis` (the turns) and `preanalyst` (the two doors) |

**What matters here is what the rename left behind, because it is not what an earlier version of this
document assumed.** That version said the analyst would take over the state `ANALYSIS`, the step
`analysis` and the gate `analysis`, as names freed by the rename. They were not freed: the state was
**deleted**. `PipelineState` (`webtools/anagraphics/webtools_anagraphics/main.py:219-239`) has ten
names and none of them is `ANALYSIS`, and `PipelineStepName` (`:240-249`) has eight and none of them
is `analysis` either.

The reason it was deleted is recorded and it was right at the time: a project is born in
`PREANALYSIS` and stays there through the form, the prevalidation that passes and the rounds of
questions, so a second name would have covered the same stretch of the flow as the first, and the
only thing it distinguished — whether the prevalidation has decided — is already written on the
steps, which is where decisions live.

**So `ANALYSIS` comes back as an addition, and with a meaning it did not have before: the analysis is
being written.** That is a stretch of the flow with edges anybody can point at — it begins when the
client says the conversation is over, and it ends when the proposal is on the step — and no other
name covers it. A project that sits in it is a project on which several model calls are running and
nothing has been decided yet, which is a different fact from every other name in the list.

What the analyst adds to the three closed vocabularies is listed in §10.

---

# 3. The doors

A **door** is one question the system asks a model, and the rules around it are not open to
reinvention here — they are in `CLAUDE.md`, under the second inviolable rule. In short, and only so
that this document can be read on its own: each door owns its contract, written in our words; no two
doors share one; a provider is an adapter and is the only file that may name it, import its SDK or
know its fields, its error codes and what it calls a unit of consumption; what a call consumed is
carried by kind, never summed across kinds and never turned into money; one consumption is reported
once; every outcome is a different word; and the door checks the contract on whatever the adapter
hands over, so an adapter that drifts is caught at the boundary.

The model to follow is already in the repository, and it should be followed rather than improved on:
`webtools/preanalyst/src/preanalyst_ai/contract.js` for the contract, with its five endings —
`complete`, `cut`, `refused`, `unusable`, `no_answer` — its five failures, its constructors and its
`check()`; and `webtools/preanalyst/src/preanalyst_ai/providers/anthropic.js` for the adapter, with
its own retry loop rather than the SDK's, so that the number of attempts is a fact we can report.

The analyst has **three** doors. Two produce and one judges. Each one is a configuration branch of
its own, holding its own provider, its own timeout, its own allowance of attempts and its own policy;
and, under `providers.<name>`, the fields only that provider understands, read only by its adapter,
with its key deep-merged in from the secrets:

| Door | Configuration branch | Policy | Phase |
|---|---|---|---|
| the technical analysis | `analysis.technical` | `analysis-technical-v1` | `analysis_technical` |
| the judge of sustainability | `analysis.judgement` | `analysis-sustainability-v1` | `analysis_sustainability` |
| the functional points | `analysis.points` | `functional-points-v1` | `analysis_points` |

There is no configuration field that chooses in which order they run. The order is fixed, and §4 says
why.

## 3.1 The technical analysis

Its reader is whoever builds the tool: an AI developer under a driver's supervision. It writes in
English, and precision matters more than tone.

What it is sent: the pre-specification and the transcript, as messages carrying their roles — never
flattened into one text with the speaker written inside it. That was a real defect on the sibling
engine: `**Client:**` and `**Preanalyst:**` are ordinary characters the client can type, and with
them they could put words in our engine's mouth. Who spoke is a field of the call, which the client
cannot reach.

What comes back: the analysis itself, plus the model's own notes on what it had to assume. Those
notes are for the driver, and the same rule applies to them as to `missing` and `reason` in the
rounds of questions: they are the model's words about the material, never a sentence the client
dictated through it.

Its policy is a file in `webtools/configurator/policies/`. What it must ask for is, at a minimum,
what the rounds of questions were told to establish: what the tool keeps, what the person does with
it, what they look at, where it starts and stops, and what "it works" means to them. The analysis
turns those into something buildable.

## 3.2 The judge of sustainability

Its reader is us. It is sent the material **and** the technical analysis just produced, and it
answers whether this is a small tool that can be built in one pass.

It exists as a separate door for a reason already written down elsewhere in the repository: nobody is
a fair judge of their own work. The sibling engine says it of itself — "You are here because whoever
asked the questions is not a fair judge of its own work. It has just declared itself finished; your
job is to check that claim against what was actually said"
(`webtools/configurator/policies/preanalysis-validation-v1.md:9-12`).

What it returns: a verdict, a score per axis, and a confidence. The house pattern for reading such an
answer is established and should be reused as it stands:

- **the weakest axis decides, not the average** — a good average with one axis on the floor is not a
  pass;
- **an axis missing or out of range makes the whole judgement unusable** — a partial judgement is not
  a judgement;
- **two conditions, not one** — a verdict the model asked for but cannot support with its own numbers
  is not that verdict.

**The criterion itself is not invented here and is not a threshold to be chosen.** It is written
across the project: the system builds small applications, which a developer system can build in one
pass without running out. The prevalidation already reasons about it under that name, and its policy
lists the signals — many roles and permission levels, integration with systems we do not control,
regulated domains, real-time or high-volume requirements, anything that moves money, a scope so
vague that no boundary can be drawn (`webtools/configurator/policies/scope-v1.md:36-51`). The
analyst asks the same question of much better material: a request that has been through the rounds of
questions and an analysis written from it.

**Where the list of axes lives was decided as "the policy file, and not the code as well", and that
decision is wrong.** It fell on 2026-09-28. The code builds the JSON schema the model has to answer
in, and checks that no score is missing or out of range: the shape of the answer belongs to the
code, and it cannot be read out of a markdown file that is configuration and can be redeployed
under a running server. The sibling engine has it the right way round — `AXES` is a constant in
`preanalysis_validator.js:32` and the policy describes each axis in words. What the fallen decision
was guarding against is real: two copies of a list drift apart and nothing notices. What answers
that is a test that reads the policy and asserts it names every axis the code requires. One place
is not the only way to keep two things in step, and it is the wrong one when the two are a schema
and a piece of prose.

**The axes themselves are in doubt, because the question they were invented for already has a
shape.** The judgement asks whether the request runs out. That is the question `scope-v1` asks, and
it answers with a distribution over six named outcomes, a threshold, a `reason` and an `off_domain`
flag — not with a score per axis. §14.3 recorded "which axes" as an open point; it was open because
there was nothing to put on the list, the criterion being written already. Whether the judgement
reuses the shape the prevalidation uses, or needs one of its own because it reads an analysis and
not a form, is the decision to take, and it is taken before this door is written.

A constraint of the constrained output, learned the hard way and recorded in
`webtools/preanalyst/src/prevalidator.js:73-76`: `minimum` and `maximum` are not accepted on a number
in a JSON schema, and neither are `minLength`, `maxLength`, `multipleOf` or a recursive schema.
Ranges are therefore checked in our code after the answer arrives, not declared in the schema.

## 3.3 The functional points

Its reader is the client. That changes everything about how it writes, and the rules are the ones the
rounds of questions already obey, because they are rules about the same person:

- their own language, which is a fact carried on the material — the pre-specification's front matter
  says which — and never guessed from the text;
- no word from our trade: not "record", not "campo", not "entità", not "workflow", not "dashboard";
- **never gendering the reader.** In Italian that means no participle and no adjective that agrees
  with them, and the sentence turned round instead. We do not know who is reading;
- dry and functional. A point says what the person will be able to do. No sentence that celebrates
  the idea, no promise, no date.

What comes back is a **list of elements**, not prose: see §6 for why, and for what an element is.

This door runs on every project, whatever the judgement proposed. §5 says why.

---

# 4. The order: analyse first, then judge

The analysis and the judgement can be imagined in either order, and an earlier version of this
document made the order a configuration field, on the argument that judging first spends nothing on a
project we do not take on.

**That is wrong, and the order is fixed: the analyst writes the technical analysis, then judges
whether to propose taking the work on, and then writes the functional points. All three, every
time.**

The reason is what the judgement is for. The analyst does not refuse anything (§5): what it produces
is a proposal, and the proposal goes to a person who has to be able to disagree with it. Judging
first means arriving at that person with a verdict and nothing to check it against. There is no
analysis to read, no list of what the tool would have to do, nothing to point at while saying "this
part is the one that runs out" — only the material the client wrote, which the person could have read
themselves. A proposal that cannot be examined is not a proposal.

The order also settles what the judge is given, and with it how many doors there are. An earlier
version had **four**, because "judge this, reading the analysis that was written" and "judge this,
reading what the client said" are given different material, so they are different questions and could
not share a contract. With one order there is one of them, and the fourth door disappears together
with the policy it would have needed (`material-sustainability-v1`) and the configuration field that
chose between the two sequences.

**What was given up, said plainly.** On a project that ends in a proposal to refuse, the technical
analysis has been written and paid for, and it may never be used. That is a real cost and it was the
argument for the other order. It is accepted, because the alternative is a refusal nobody downstream
can weigh.

**Every outcome is handled.** A call can end in five ways, and four of them are not an answer we can
use: cut short by our own ceiling, refused by the model, an answer that does not fit what we asked
for, and nothing coming back at all. In the first three the model ran, so what it consumed is real
and is reported. The document that specifies the subsystem says, for each door, what happens in each
of those five cases — and none of them may end with a project silently stuck.

---

# 5. The judgement is a proposal; the drivers subsystem decides

**The analyst never writes `REJECTED`.** Whatever the verdict, the project goes on to the driver's
gate, and the refusal, if there is one, is signed by a person.

The reason is that a gate of this kind is already in place, earlier and cheaper: the prevalidation
refuses on scope before the client has invested a conversation. A second automatic refusal — this one
landing after the client has answered a whole round of questions, with turns they may have paid for —
is not what is missing from the flow, and `REJECTED` is terminal with no appeal.

What the analyst writes on the step is therefore a **proposal**, with everything the driver needs to
disagree with it: the verdict, the score per axis, which axis was weakest, the declared confidence,
and the model's own words on why. Beside it goes the record of the interaction — which provider,
which model, how it ended, how many attempts, whether it fell back, and what it consumed — exactly as
the rounds of questions already record for each of their turns.

**The gate that receives it is a subsystem of its own, and it is built after the analyst.** That was
settled on 2026-09-28 and it is not a gap in this work: `DRIVER_VALIDATION` is a name in the enum
that no code writes, so until that subsystem exists, projects will sit in it with nothing able to
move them on. The analyst's own write is complete without it — one atomic write that appends the step
as decided and sets the state, which anagraphics already does in a single `find_one_and_update`.

**The functional points are written on every project, including one the analyst proposes to
refuse.** An earlier version of this document said the opposite — that a list nobody may ever be
shown is a call not worth paying for — and it fell on 2026-09-28. Two reasons, and the second is the
one that matters.

The driver validates the analysis on **every** project: that is what §5 says of the verdict, and a
proposal to refuse is not a refusal. So the person deciding has the same thing in front of them
either way, and what they are deciding is whether we build this. Handing them a proposal to refuse
with no list, and a proposal to take on with one, means the two are not comparable and the cheaper
outcome is the better documented one.

And the saving was never real in the shape it was claimed: a driver who overrules the proposal needs
the list at that moment, so the call is made anyway, later, by a subsystem that does not exist yet.
A branch whose only purpose is to defer a call until the awkward moment is not a saving, it is a
dependency.

---

# 6. What is stored where

Three kinds of thing come out of a run, and they go to three different places. The separation is not
new: it is the one the flow already uses, and the reason it exists is that the three have different
consequences when one of them is lost.

**The two documents go to `webtools-workspaces`**, where the pre-specification already lives, as new
kinds with versioned templates in `webtools/configurator/documents/` — `analysis/1` and `proposal/1`
alongside `prespec/1`. The origin is `system`, the one workspaces already has for a document the
system wrote.

Which is which was settled on 2026-09-28, because the names do not say it on their own:
**`analysis/1` holds the technical analysis**, and **`proposal/1` holds the functional points**, made
readable. Not the judgement — that is the next paragraph, and it does not become a document at all.
`proposal` is the word for what the client is being offered, which is the list of what they will be
able to do; the verdict and its numbers are addressed to a driver and are read where the rest of a
project's history is read.

What comes with that mechanism and is unfinished — nobody reads the `template:` line to decide how to
treat what they are reading, and nothing says what happens when a template changes — the analyst
inherits rather than solves. It is §14.2.

**The decision goes on the project's pipeline step in anagraphics** — the verdict, the score per
axis, which axis was weakest, the declared confidence and the model's own words on why. It goes in
the one atomic write that also sets the state, pushing the step and setting the state together, so
that there is no moment in which the step is there and the state is still the previous one.

**The functional points go on the step as data**, not only inside the document. Each point is an
element with a stable identifier and its text:

```
  points: [
    { id: "p1", text: "Registri un intervento con data, cliente, chi c'è andato, quanto è durato" },
    { id: "p2", text: "Cerchi gli interventi di un cliente" },
    { id: "p3", text: "Stampi il totale del mese" }
  ]
```

and the readable document is rendered from that same list, so the two cannot disagree. The reason is
what happens next to those points: the client validates the analysis, and later the demo is accepted
or refused against what was agreed. Both of those have to work on single points — somebody has to be
able to say "all of it except the third", and the demo has to be checkable point by point. A list
inside a paragraph cannot carry either.

**The counts and the tokens go to metrics**, and nothing else does. What a project consumed is written
on its own pipeline step in anagraphics as well, in the awaited write, because the money at the demo
is not taken from metrics: a lost measurement is a slightly wrong average for one reader and a wrong
invoice for the other (`contesto/06. metrics.md:35-47`).

---

# 7. Who is told, and how

The analyst's decision is addressed **downstream, to the drivers subsystem**, not to the client. The
client is not told anything by the analyst: nobody has refused their request, the proposal is with a
person, and what they are eventually told is the gate's business and is written with the gate.

That is worth saying because the word "notification" suggests more than exists: **there is no
notification channel in this repository.** No mail, no queue, no webhook, no event bus. Nothing sends
anything to anybody.

What happens today when a gate decides is three things: the step and the state are written in one
atomic write to anagraphics; `gate.decided` and `gate.duration` are measured, once, in the one place
every gate passes through; and whoever is concerned finds out because the page they are on tells
them. The analyst does the first two. The third has no page yet, because the subsystem that would
show it does not exist.

Whether a real channel is built, and when, is not this subsystem's question — but it is not only the
client's problem either: the flow already promises the driver an email in autonomous work when the
tokens run out (`contesto/02. current_context.md:128-130`), and that promise has nothing behind it.

---

# 8. Being Python, and the three things that do not exist on that side yet

The analyst is Python, which makes it the **second** Python subsystem that reads its configuration
over HTTP — anagraphics is the first, and it is also the server that answers. That is not a detail: it
triggers work that was deliberately deferred until a second one existed.

**The configuration client.** `webtools/metrics/webtools_metrics/configuration.py` says it of itself:
it lives in metrics and not in `webtools/commons/` because there was exactly one Python subsystem
reading its configuration over HTTP, and "the day a second one exists, this file is the original to
move to `commons/` with a deployer of its own". The analyst is that second one. Copying it a second
time instead would be the thing the generated-copies rule exists to prevent.

**The metrics client.** There is none in Python. The JavaScript one cannot be copied — the metrics
deployer says so in as many words. A twin has to be written, and what matters about it is not its
shape but its identity, which must survive the translation: it **does not wait**, it **does not
throw**, it **does not retry**, it **does not log unless told to**, and nothing a subsystem does ever
waits for it. A metrics client that can fail a request has made the measurement more important than
the work.

**The HTTP client towards the other subsystems.** There is no shared one, in either language: each
dependency gets a hand-written client, and what is shared is the contract, not the code. The one to
carry over is `readJson()` in `webtools/preanalyst/src/anagraphics.js:1-87`. It raises nothing towards
its caller; every call returns either the data or a reason, and there are three reasons because the
caller has to know *how* it went wrong: `not_found`, `rejected` (the request was wrong, retrying does
not help), `unavailable` (unreachable, timed out, 5xx, 403, broken JSON). Every call through it is
measured once as a `dependency.call`, under a stable word for the operation — never the path, because
a path carries identifiers and identifiers are not dimensions.

The rest is the ordinary shape of a subsystem here, and it is copied rather than designed: FastAPI and
uv as in anagraphics and metrics; a frozen dataclass of settings built from the configuration
document, with the building kept separate from the reading so that a test needs no server; a control
script `webtools_analyst.sh` that finds its process by the PID file **checked against the command
line** and never by name or by port, because other projects run on this machine; `errors.py` answering
`{"error": "<CODE>"}` with a correct status and a stable code, never prose; registration in
`configurator/start.sh`; a `deploy_analyst()` in each deployer whose artefacts it uses; and
`configurator/configuration/analyst.json` as the seed and the expected shape, with the provider keys
in `configurator/secrets/analyst.json`, outside git.

**The port is 9800.** An earlier version of this document said 9500 "looks free between workspaces at
9400 and metrics at 9600"; it is configurator-fe's. Taken today: 9000 front-gate, 9100 anagraphics,
9200 preanalyst, 9300 sso, 9400 workspaces, 9500 configurator-fe, 9600 metrics, 9700 metrics-fe.

---

# 9. How it is triggered, and how it does not run twice

Several model calls over minutes are not a request anybody waits on. The trigger **answers at once**
and the work goes on; the pipeline advances by what is written in anagraphics, which is where the
state already lives.

That leaves two things to get right.

**A run must be findable after a restart.** Before the first model call, the run is recorded as an
`open` step — `open` being the existing word for a step that has not decided anything. A process that
answers and then dies leaves a record saying a run was begun, instead of a project that looks
untouched.

**A second trigger on the same project must be refused, and the refusal is decided on the project's
state.** Not on the absence of an open step. That distinction is the whole of it, because looking for
an open step is exactly the defect the audit found one step earlier: the pre-analysis page looks for
a step that is still `open`, does not find one, and opens a fresh one with a full allowance of turns,
without ever asking where the project is (`sanity/findings/preanalyst-server.md`). A project that has
already been through a phase has no open step for it — that is what finishing means — so absence
cannot be the test. Here the equivalent would be a second analysis, paid for twice, with two answers
and no rule about which one counts. The state says whether the analysis is the place the project is
at; the step says only whether something is still running.

Where the trigger comes from: today the button at the end of the rounds of questions is an explicit
placeholder that hands back the project's own record, because the step that follows does not exist
(`webtools/preanalyst/src/server.js:1039-1048`). It is the place the real trigger goes.

---

# 10. Additions to the closed vocabularies

Five lists refuse what they do not know, which is why they have to be edited on purpose. Two are in
anagraphics and three in metrics:

- `PipelineState` (`webtools/anagraphics/webtools_anagraphics/main.py:219-239`) needs `ANALYSIS`,
  between `PREANALYSIS` and `DRIVER_VALIDATION`, with the meaning §2 gives it: the analysis is being
  written;
- `PipelineStepName` (`:240-249`) needs `analysis`;
- `SUBSYSTEMS` in `webtools/metrics/webtools_metrics/vocabulary.py:30` does not contain `analyst`,
  and metrics refuses a measurement from a subsystem it has never heard of. Nothing works until that
  line exists;
- `PHASES` (`:36`) needs one name per door, so that what each call consumed can be read apart from
  the others: `analysis_technical`, `analysis_sustainability`, `analysis_points`;
- `GATES` (`:49`) needs `analysis`.

And the decision about which measurement carries the tokens has to be taken here as it was taken
there, and written where it would be undone. `ai.call` carries them; a metric that counts *what the
call was a turn of* carries the count and not the tokens. Whoever reads the consumption adds up
everything that carries tokens and cannot tell one report of a call from two, so the same tokens under
a second name double the cost of the whole system.

---

# 11. What the analyst does not do

**It does not price, and no amount appears in it.** The price is said at the demo, by the driver, and
in the consumption tier it is the project's real consumption plus the driver's share
(`contesto/02. current_context.md:102-110`). The analyst's contribution to that figure is the
consumption it reports, which it reports in tokens by kind. No field of this subsystem ends in
`_cents`, because there is no amount for one to hold.

**It does not decide whether we want to build the thing.** Judging size and feasibility is not judging
desirability, and where that line falls is written nowhere in `contesto/`. Asking a model to apply a
rule that does not exist gives answers at random; the decision not to touch it yet was taken on
2026-09-25 and holds here.

**It does not talk to the client.** If something is missing, that is a finding for the driver, not a
question to ask. The conversation is over and its turns are spent.

**It does not shorten what it was given.** See §1 and §12.

---

# 12. What the audit found, and what is repaired with this work

Four findings of the audit meet this subsystem. Two of them are repaired together with it, because
they are about its own input and about the rule it would otherwise copy; one belongs to the gate that
comes after; one goes live the day this gate writes its first step.

**Repaired with this work.**

1. **The pre-specification is cut in silence, in two places.** `webtools/preanalyst/src/prespec.js`
   cuts an open answer at `form.answer_max_chars` while reading the form, and
   `webtools/preanalyst/src/prevalidator.js` cuts the whole rendered document again at
   `prevalidation.spec_max_chars` before the model call, on the argument that the answers were
   already limited. The form declares no limit on any field, and the body it accepts is twenty-five
   times the per-answer limit, so pasting a text written elsewhere loses everything past the ceiling
   with no message, no log line and nothing on the project. That document is what the analysis and,
   in the consumption tier, the price are built on. Neither ceiling was ever decided: the first was a
   constant invented in the code, which then became a configuration field and took on the appearance
   of a decision. Both cuts go. The second-level ceiling and its configuration field disappear
   altogether; at the form, an over-long answer makes the submission fail with a message that names
   the field, instead of being quietly rewritten.
2. **A phase is judged begun by the absence of an open step.** `webtools/preanalyst/src/server.js`
   opens a pre-analysis step whenever it does not find one that is `open`, without looking at the
   project's state, so a project already refused gets one by editing a URL, and a finished
   conversation will hand out its turns again at every reload once the analyst closes it. The rule is
   corrected there, and §9 keeps the analyst from repeating it.

**Not repaired here.**

3. **The rejection readers are hardcoded to the first gate.** Both the reason lookup and the case
   lookup filter for `step === "prevalidation"` (`webtools/preanalyst/src/server.js:1176` and
   `:1336`), so a refusal written by any other gate would show the client no reason at all. The
   analyst writes no refusals (§5), so this is the driver's gate's to fix, with the copy that goes
   with it.
4. **Closing an open step is a convention, not a write.** When this gate appends the analysis step as
   decided, a late update aimed at the still-open record finds it and takes it, and the register of
   decisions ends up with a step that is both decided and open
   (`sanity/findings/anagraphics-db.md:36-44`, which says in as many words that it takes the second
   gate being built — this is that gate).

---

# 13. On a crew, and what exactly is being refused

The question was raised of building the analyst as an agentic crew. It is a fair question here in a
way it was not for the prevalidation: the refusal recorded on 2026-09-23 was about a **classification**
— "a single typed call" — and the analysis is a phase that produces.

What is refused is a **library that runs the loop**: CrewAI, LangGraph, AutoGen and their kind, where
agents are declared with a role and a goal, and the library decides who speaks, when and how many
times, handles the failed attempts, builds the messages and reads what was consumed. Four reasons,
each of which stands on its own.

**Who keeps the count of what is consumed.** Every call comes back with how many tokens it used, by
kind: in, out, written to cache, read from cache. Here that number is not a statistic. In the
consumption tier it **is the price** — what the client pays is the measured consumption plus the
driver's share. In autonomous work it is a debit — tokens come off the driver's credit at every step,
and when they run out the pipeline stops. So it has to reach us whole, attributed to the project, with
the kinds kept apart, because adding a token of one kind to a token of another invents a rate nobody
decided. If a library makes the calls, the number passes through its hands: we get what it chose to
expose, in its words, and only if it exposes it. The day a provider reports a new kind of token, we
keep counting as before, nothing breaks, and the figure is quietly wrong. It is a figure somebody pays.

**How many calls get made.** A crew decides for itself how many rounds to do; that is the point of
one. Two projects of the same size can cost four calls or eleven. Again: not a nuisance for the
averages — the invoice.

**Where the provider's name ends up written.** The rule is that exactly one file in the system knows
that a given provider exists: its field names, its error codes, its reasons for stopping, its unit of
consumption. What that buys is concrete — changing provider is rewriting that file. A crew library
wants the model, the key, the roles and the retries configured inside itself, and those words then
spread wherever it is used: the configuration, the logs, the tests. This is not a preference being
expressed; it is the rule written as inviolable, and adopting the library breaks it.

**What would be gained in exchange.** A crew offers specialised roles, a sequence, retries, typed
output, an orchestrator. All of it is already here, written by hand, and already taken through a real
defect: one engine proposes, a second with its own policy judges, each with its own model, key and
threshold, and the attempts are counted by us because a retry inside a library is invisible — the 137
second turn of 2026-09-25 was one, against a 120 second timeout, and nothing counted it. The trade
would be to give up the ledger and the one-file rule in order to obtain what we have.

Where a crew would genuinely be different is an agent choosing its own next move — read a file, call a
tool, ask again. That earns its place when the information needed is not known in advance. Here it is
known: the pre-specification and the transcript, all of it in hand before the first call. There is
nothing to go and fetch.

**What is not being said is "one single call."** Several specialised calls in sequence, each with its
own policy and its own reader, is the shape chosen — three doors, and the sequence held by our own
code. The refusal is about who holds the loop, not about how many calls there are. Splitting them is
what makes it possible to say that the analysis and the points are written for different readers, and
that whoever judges is not whoever produced.

---

# 14. Open points

1. **Whether a real notification channel is built, and by whom** (§7), given that both the client and
   the driver are promised things that nothing can send.
2. **How the document templates are versioned**, and who checks a document's version when reading an
   old one. Inherited from `prespec/1`, where it is unanswered as well: `template: prespec/1` is
   written on every document and **nobody reads it** to decide how to treat what they are reading
   (`contesto/optimisations.md:32`), and there is no answer to what happens when a template changes
   and a document written against the old one is opened. The analyst does not inherit this question
   so much as multiply it: it adds `analysis/1` and `proposal/1`, so there are three kinds instead of
   one, and the two it adds are read by people — the driver reads the analysis, the client reads the
   points — where the pre-specification is read by a model. Recorded as open on 2026-09-28 and not
   solved here.
3. **What shape the sustainability judgement's answer takes.** Not "which axes". The criterion is
   `scope-v1`'s and is written down (§3.2); where the list lives was settled the wrong way round and
   is corrected there. What is open is whether the judgement answers in the shape the prevalidation
   already uses — a distribution over the six outcomes, a threshold, a `reason`, a flag — or in one
   of its own.
4. **What happens to a project no driver can be assigned to.** The analyst asks the drivers' pool
   and, when the pool answers with somebody who no longer exists, asks again, up to a configured
   number of attempts. When those run out — or when nobody is enabled at all — the project is left
   maimed: the analysis is written and paid for, the state says a person is looking at it, and no
   person is. Nothing in the system notices, because nothing reads the register of the steps back to
   ask whether anything has stopped. Recorded on 2026-09-28, together with what answers it: a
   `sanity-checker`, a pool of scripts run on a schedule, one per fault
   (`contesto/todos.md`). Whether the analyst should also do something at the moment it gives up —
   leave the state where it was, write a step saying it could not hand the project over — is part of
   the same question and is not decided here.
5. **Whether the decision belongs in a decision engine.** `contesto/optimisations.md:91-106` names this
   gate as the moment to extract one, and `webtools/decision-maker/` is a reserved empty directory. The
   position taken here is **not yet**: the door rule already gives the independence a decision engine
   promises, extracting it now means designing an interface for a single caller, and what makes one
   worth having — a register of the decisions — is already had by writing every judgement on the
   pipeline step. This is a position, not a closed question.

## Decisions that were open and are now taken

- **How much of the driver's gate has to exist** — none of it. It is a subsystem of its own, built
  after the analyst, and projects will sit in `DRIVER_VALIDATION` until it is (§5).
- **Whether the functional points are written on a proposal to refuse** — yes, on every project.
  The earlier answer was no, and it fell on 2026-09-28: the driver validates every analysis, so
  withholding the list on one of the two outcomes makes the two incomparable in front of the person
  deciding (§5).
- **In which order the analysis and the judgement run** — analysis first. The order is not
  configurable, and there are three doors, not four (§4).
