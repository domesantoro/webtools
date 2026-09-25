# configurator-policy-scope

Path: `webtools/configurator/policies/scope-v1.md`
Generated copy: `webtools/preanalyst/policies/scope-v1.md` — verified identical to the original but
for the deployer's three-line banner, so the copy is current and these findings belong to the
original.
Examined: 2026-09-25

The prevalidation policy, which `CLAUDE.md` classes as configuration: it says what the system
considers acceptable, and the JSON says which policy is used. It is the most careful document in the
repository on the subject of this very audit — "**This is a list of examples, not the perimeter.**
Do not decide by resemblance" (`:26-29`), "Saying nothing is not the same as asking for something we
cannot build" (`:117-121`), "Emptiness is not evidence… it is the absence of evidence" (`:125-127`),
and a flag whose three forbidden reasons are named one by one (`:190-199`). Three findings, all of
the same kind: the document tells the model things about the system that only the current
configuration makes true.

---

## 1. The refusal threshold is written in two places, and only one of them is configuration

- `webtools/configurator/policies/scope-v1.md:78-80` — "Reserve `run_out_certain` and
  `non_sequitur` **above 0.6** for requests you would refuse in front of the client" — against
  `webtools/configurator/configuration/preanalyst.json:44`, `"reject_threshold": 0.6`, read at
  `webtools/preanalyst/src/settings.js:64` and applied at
  `webtools/preanalyst/src/prevalidator.js:151-153`
- Shape: **6 — the world narrowed to fit the code**
- Class: **the values `prevalidation.reject_threshold` may hold.** It is a configured number with a
  declared range of 0 to 1, and `CLAUDE.md` says in as many words that what runs may diverge from
  the seed file — "a limit raised in operation, or a threshold corrected, stays where it is". This
  document hard-codes today's value into the instructions the model calibrates against.
- Raise the threshold to 0.8 to refuse less readily, and the model goes on placing its mass at the
  0.6 line it was told about: requests it meant to refuse "in front of the client" now pass. Lower
  it to 0.4 and the opposite. Nothing anywhere reports the disagreement, and the change that causes
  it is the exact change the configuration subsystem exists to make — made in Mongo, by an operator,
  who has no reason to open a policy file to see whether a number is repeated inside the prose.
- Severity: `latent`
- Smallest generalising change: say the rule without the number ("reserve the highest confidence
  for requests you would refuse in front of the client"), or let the policy be rendered with the
  configured threshold substituted, so the two cannot disagree.

## 2. The policy tells the model what `underspecified` costs, and the configuration can make that untrue

- `webtools/configurator/policies/scope-v1.md:123-127` — "`underspecified` sends the request back to
  the client with what they wrote still in it, and they try again. `non_sequitur` refuses it for
  good, with no appeal… **When you cannot even tell what is being asked for, choose the outcome that
  asks again.**" — and `:174-176`, "the client is asked again, and nothing is closed"; against
  `webtools/preanalyst/src/prevalidator.js:161-165`, where `underspecified` becomes `rejected` once
  `attempts >= maxAttempts`
- Shape: **1 — partial-class requirement** (a promise that holds only for part of the class)
- Class: **the rounds a request may be on.** The consequence the model is told about — nothing is
  closed, the client tries again — is true of every attempt except the last, and the model is asked
  to choose between two outcomes *precisely on the strength of what they cost*. On the last attempt
  the cheap answer and the final one are the same answer, and the document says the opposite.
- `prevalidation.max_underspecified_attempts` is `100` today
  (`webtools/configurator/configuration/preanalyst.json:45`), which is why nobody has met this: 100
  reads like "switched off". It is a configured integer, and the PoC exists to find out how many
  rounds a pre-analysis really takes; setting it to 2 or 3 is the natural outcome of that
  measurement, and it is made in Mongo, far from this paragraph.
- Severity: `latent`
- Smallest generalising change: do not describe the consequence in absolute terms — the model does
  not need it to choose honestly — or make the number part of the operator note, where the round
  being the last one can be said.

## 3. "It never reaches the client" is true only while a configured flag is false

- `webtools/configurator/policies/scope-v1.md:180` ("Separate from the distribution, and
  **internal**: it never reaches the client"), `:231-232` ("it is recorded for us and for the
  driver") and `:240-241` ("It is read by us and by the driver, never by the client as it is
  written here") — against `webtools/preanalyst/src/server.js:902` and `:914-923`
- Shape: **6 — the world narrowed to fit the code**
- Class: **the values `prevalidation.rejection_reason_in_pdf` may hold.** With it `true`, the
  rejection PDF the **client** downloads carries `reason` and, when the flag is up,
  `off_domain.reason` as well — `rejectionReasonOf` joins the two
  (`webtools/preanalyst/src/server.js:918-923`). It is `false` today
  (`webtools/configurator/configuration/preanalyst.json:47`), which is the only thing making the
  policy's three promises true.
- The promises are not decorative: they are what licenses the model to write plainly. A text written
  for us and for the driver — "the client has not understood what they are asking for", "this is a
  vanity project, nobody would use it" — is a different text from one written for the client, and
  the model was told which it was writing. Turning the flag on, which is a decision about how much
  to tell a refused client and an entirely reasonable one to take, publishes prose composed on the
  opposite understanding.
- Severity: `latent`
- Smallest generalising change: make the two agree at the boundary that knows — either the flag can
  only ever publish `reason` (never `off_domain.reason`) and the policy says so, or the policy stops
  promising and asks for a text fit for the client to read.

---

## Noted, not raised as findings

- The document is handed to the model as the whole document, minus the deployer's banner, which
  `webtools/preanalyst/src/prevalidator.js:111-113` strips on purpose. The banner is ours and does
  not belong in the prompt; the reason is written where it is done.
- The pre-specification the model judges may be **truncated** before it arrives
  (`findings/preanalyst-prevalidator.md`, finding 1), and nothing in this policy tells the model
  that what it is reading may be cut. The instruction "when you cannot even tell what is being asked
  for, choose the outcome that asks again" then sends the client back to write more of what they had
  already written. Recorded here as a consequence of that finding rather than counted again.
- `:74-76` — "A distribution of zeros is not an answer, and it is discarded" states, inside the
  policy, what the code does with it (`webtools/preanalyst/src/prevalidator.js:181-190`). The two
  artefacts agree about a failure case, which is rare and worth keeping.
