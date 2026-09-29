# Checkpoint 2026-09-28

## 1. The analyst: designed, not begun

`webtools/analyst/` is still empty and no code was written. The session was spent deciding how the
subsystem is shaped, and the result is `contesto/analyst_considerations.md`, written on the model of
`contesto/decision_engine_considerations.md`: design thinking for something that does not exist yet,
with the alternatives and the reasons kept, so that a decision can be argued with later.

The constraints it starts from: Python; configurable like the other subsystems; it measures; it chews
the pre-analysis and produces a technical/functional analysis and a commercial one — the list of
functional points to be agreed on — when the work is sustainable.

## 2. Four decisions

**The name `analysis` is taken, and what holds it is renamed.** Today *analysis* is the rounds of
questions inside the preanalyst: the state `ANALYSIS`, the step `analysis`, three phases, three
metrics, a gate, two policies, two configuration sections, three source files, six routes, two error
codes and 37 catalogue keys per locale. The new subsystem takes that conversation as raw material, so
the two cannot share the name. The chat is pre-analysis by every test that matters — it lives in the
preanalyst, it speaks to the client, and its own policy forbids it to design, estimate, price or
decide — so it is the current names that are wrong, and they are free to correct now because nothing
has gone past that step in a real environment. It cannot be called *preanalysis*, because that is
already the state a project is born in; the recommended word is **specification**, which is what
those rounds produce. The full inventory of places is in §2 of the document.

**The order of the work is configuration, not code.** Producing the technical analysis and judging
whether the work is sustainable can go in either order, and the order changes what the judgement rests
on: judging afterwards means judging with the work in front of you, judging first means spending
nothing on a project we do not take on. Which is right is a question about real projects and nobody
has seen one, so the analyst does both and the configuration says which. The consequence is that there
are **four doors and not three**: the two sequences cannot share one judge, because "judge this
reading the analysis produced" and "judge this reading what the client said" are given different
material, so they are different questions.

**The analyst only proposes a refusal; the driver decides, in every case.** It never writes
`REJECTED`. The reason is that a gate of this kind is already in place earlier and cheaper — the
prevalidation refuses on scope before the client has spent a conversation — and `REJECTED` is terminal
with no appeal. What goes on the step is the verdict, the score per axis, the weakest axis, the
confidence and the model's own words, which is what the driver needs in order to disagree. Two
consequences: the driver's gate stops being a successor and becomes a **dependency**, since after the
analysis it is the only source of `REJECTED` and today nothing writes it; and the write is simpler,
one destination instead of two.

**The functional points are data, and the document is rendered from them.** Each point is an element
with a stable identifier and its text, kept on the step; the readable document comes from the same
list, so the two cannot disagree. The reason is what happens next to those points: the client
validates the analysis and the demo is later accepted against what was agreed, and both have to work
on single points — somebody has to be able to say "all of it except the third".

## 3. On the crew, written out rather than alluded to

The question of building the analyst as an agentic crew was raised, and it is a fair one here in a way
it was not for the prevalidation: the refusal of 2026-09-23 was about a classification, "a single
typed call", and the analysis produces. What is refused is a **library that runs the loop**. Four
reasons, in §13 of the document: the consumption would pass through its hands, although in the
consumption tier that number is the price the client pays and in autonomous work it is a debit off the
driver's credit; a crew decides for itself how many calls to make, so two projects of the same size
cost different amounts; it wants the model, the key, the roles and the retries configured inside
itself, which spreads a provider's vocabulary wherever it is used and breaks the rule that one file
only may hold it; and what it offers is already here by hand, with the attempts counted by us because
a retry inside a library is invisible — the 137 second turn of 2026-09-25 was one and nothing counted
it. What is **not** being said is "one single call": four specialised doors in a sequence our own code
holds. The refusal is about who holds the loop.

## 4. How the reasoning is to be written

Said by the user during the session, after an explanation that was none: the argument is to be
**written out, not alluded to** — every step in plain sentences, with what it rests on said rather
than implied. A `file:line` reference is where a claim can be checked, never the argument itself.
Shorthand and trade vocabulary used as a shortcut make an explanation sound technical while saying
less. And the design is talked through first and produced afterwards, not the other way round.

## 5. Where it stands, and what comes first

Nothing is built. The first question to answer before anything is written is not in the analyst at
all: **how much of the driver's gate has to exist**, because the analyst hands it every project and
`REJECTED` can now come only from there. `DRIVER_VALIDATION` is a name in the enum that no code
writes.

Four things the audit already found will go live with this gate, and they are listed in §12 of the
document: closing an open step is a convention rather than a write (and `anagraphics-db.md:36-44` says
it takes the second gate being built — this is that gate); a finished conversation reopens and hands
out its turns again; the rejection readers are hardcoded to the first gate, so a refusal written
anywhere else shows the client no reason; and the pre-specification, this subsystem's own input, is
silently truncated.

Being Python also calls in work that was deliberately deferred: `metrics`' configuration client says
in its own header that the day a second Python subsystem reads its configuration over HTTP it becomes
the original to move into `commons/` with a deployer, and the analyst is that second one. There is no
Python metrics client at all, and the JavaScript one cannot be copied.

Six open points are recorded in §14 of the document, including the position taken on the decision
engine: **not yet**, because the door rule already gives the independence it promises and a register
of decisions is already had by writing every judgement on the step.

---

# Second session of 2026-09-28: the driver's gate settled, and the rename done

## 6. The driver's gate is a subsystem of its own, and it comes after the analyst

This was the question §14.1 said to answer before building anything, and the answer is that the
gate is **not** part of this work: it is a subsystem of its own, built after the analyst.

The consequence accepted with it is that projects will sit in `DRIVER_VALIDATION` with nothing able
to move them on. That is not a hole in the analyst; it is what "the gate comes after" means, and the
analyst's own write is complete without it — one atomic write that appends the step as decided and
sets the state, which anagraphics already does in a single `find_one_and_update`.

The one thing that had to be settled with it is the trigger of the functional points. §5 recommends
that the points are not written when the proposal is to refuse, and that the driver's acceptance is
what triggers that door: if the gate does not exist at all, a project taken on over a proposal to
refuse would have no points and nothing would ever write them. The position taken is that §5 stands
and the **analyst exposes that door as a route of its own**, which the driver's gate calls when it
exists and a hand-run script calls until then. The trigger stays where §5 puts it, in the gate, and
the branch has code from the start.

## 7. Step 1 done: the rounds of questions are the pre-analysis

The rename was done on its own, as it was meant to be, and everything it touches is green:
anagraphics 84, metrics 31, preanalyst 50, metrics-fe 88, sso 55, workspaces 13, configurator-fe 74.

**It took three passes, and the first two were wrong.** The first followed §2 of
`contesto/analyst_considerations.md` to the letter: the word *specification* everywhere, and the
configuration's `analysis.*` and `analyst.*` collapsed into a single `specification.*` branch,
because §2's table sends all four of its names there. The user rejected both. §2 is a document a
previous session of mine wrote, it is not a decision he took, and merging two configuration branches
is a change of shape that had to be put in front of him in one line before being written, not
explained afterwards. That is the lesson of the session, and it is worth more than the rename:
**a structural decision is asked about, never derived from a document I wrote myself.**

**What the names are.** The thing is the **pre-analysis**; the engine is the **preanalyst**.

| | |
|---|---|
| Pipeline state | `ANALYSIS` **disappears** (see below) |
| Pipeline step | `preanalysis` |
| metrics phases | `preanalysis_opening`, `preanalysis_turn`, `preanalysis_validation` |
| metrics, gate, read | `preanalysis.turn/.closed/.validation`, gate `preanalysis`, `GET /metrics/preanalysis` |
| preanalyst routes | `/preanalysis/{id}` and its five sub-routes |
| Error codes | `PREANALYSIS_NOT_OPEN`, `PREANALYSIS_ALREADY_OPENED`, `PREANALYST_UNAVAILABLE` |
| Policies | `preanalysis-v1.md`, `preanalysis-validation-v1.md` |
| Catalogue keys | `preanalyst.preanalysis.*` (37, per locale) |
| Source files | `src/preanalyst.js`, `src/preanalyst_ai/`, `src/preanalysis_validator.js`, `templates/preanalysis.njk`, `public/preanalysis.js`, `scripts/preanalyse.js` |
| Contract role | `preanalyst` |
| Configuration | **two** branches: `preanalysis` (the turns) and `preanalyst` (the two doors) |

## 8. The one state, and why there is not a second

`ANALYSIS` is gone and nothing took its place. A project is born in `PREANALYSIS` and stays there
through the form, the prevalidation that passes, and the rounds of questions that follow.

The reason, in the user's words: there is no concrete state a project could be in before the rounds
of questions. A second name would have covered the same stretch of the flow as the first, and the
only thing it distinguished — whether the prevalidation has decided — is already written on the
steps, which is where decisions live. So `PipelineState` has ten names instead of eleven.

## 9. The two configuration branches, and why two

`preanalysis` holds how many rounds there are and when the page starts saying they are running out.
`preanalyst` holds the two doors towards a model: the engine that conducts the conversation and the
engine that judges whether it is finished, each with its own provider, model, timeout, attempts,
policy and key. Two subjects, two branches — which is what was there before the rename, under the
wrong names.

The secrets follow the same paths (`preanalyst.conversation`, `preanalyst.validation`), and the
subsystem reads one configuration without knowing that part of it was secret.

## 10. There *was* something in the database to migrate

§2 says there is nothing, because no project has gone past that step in a real environment. True of
a real environment and false of this machine: the development database held **8 projects in
`ANALYSIS`, 5 of them with an `analysis` step**, and the preanalyst's configuration with both old
branches. A project left in `ANALYSIS` could take no further step, because the list is closed and
the next write would be validated against names that no longer contain it.

`webtools/anagraphics/scripts/migrate_preanalysis_rename.py` does it, idempotent and with a dry run,
documented in §8.11 of the anagraphics documentation, run here: 12 projects in `PREANALYSIS`
afterwards, 5 steps renamed, one configuration document.

The configuration part **moves** the values rather than reseeding them, and that is the part worth
remembering. `load_configuration.sh --reset preanalyst` would have been the quick way and it would
have destroyed what was running: Mongo held `max_turns: 5` against the file's `30`, and two
`pricing` blocks configurator-fe wrote on 2026-09-26 that exist in no seed. Loading adds only what is
missing, so on its own it would have left the document carrying both shapes. After the migration
`load_configuration.sh` reports "nothing to add".

## 11. Two things for whoever picks this up

**The port 9500 is not free.** §8 of the design says it "looks free between workspaces at 9400 and
metrics at 9600"; it is configurator-fe's. metrics-fe is on 9700.

**The client-facing word is still «analisi».** The 37 catalogue **keys** moved; the values did not.
`preanalyst.preanalysis.title` still reads "Analisi", and the driver box still says the driver
"validates the analysis" — which, after this work, is true of the new subsystem's document. Whether
the product should call the rounds of questions something else in front of the client is a copy
decision, and it has not been taken.

## 12. A mistake to record

To undo a JSON reformatting I ran `git checkout` on
`webtools/configurator/configuration/preanalyst.json`, which discarded uncommitted work in that file
— three `max_attempts`, `subsystems_infos.metrics` and `metrics.log_failures`, none of them in the
commit. It was recovered from the file's contents read earlier in the session and verified line by
line. This working tree carries a great deal that is not committed: **no `git checkout`, no
`git reset --hard`, no blanket revert on it.**
