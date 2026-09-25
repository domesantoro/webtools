# preanalyst-prespec

Path: `webtools/preanalyst/src/prespec.js`
Examined: 2026-09-25

Reads the form's answers and renders the pre-specification, the document the whole flow starts from.
The module is careful in the places that usually go wrong — codes that the form could not have sent
are discarded (`:73`), an empty field is written `Not provided.` rather than omitted, the client's
text reaches the markdown only through the `quote` filter, and the groups are resolved generally.
Five findings; two are reachable today, and both are about an input that is larger or freer than the
code expected.

---

## 1. An answer longer than the limit is silently cut, and the form never said there was a limit

- `webtools/preanalyst/src/prespec.js:77` — `answers[field.name] = value ? value.slice(0, maxTextLength) : null`
- Shape: **6 — the world narrowed to fit the code** (with **5**)
- Class: **the answers the form may receive.** `form.answer_max_chars` is 20 000
  (`webtools/configurator/configuration/preanalyst.json:28`) and `form.body_max_bytes` is 524 288
  (`:27`), so a body twenty-five times the per-answer limit is accepted and read. The form itself
  sets **no** `maxlength` on any field — `templates/macros/fields.njk:47-56` renders the textarea and
  the input without one, while the chat box, elsewhere, does set it
  (`templates/analysis.njk:80`). Nothing at the boundary refuses an over-long answer; the code
  quietly makes it fit.
- What happens: a client who pastes what they had already written elsewhere — the most likely way
  for a long answer to exist — loses everything past the limit. No message, no log line, nothing on
  the project. The truncated text *is* the pre-specification: it is stored in the workspace as the
  document the analysis and the price are built on, and the client is never told that what they sent
  and what was filed differ. "Too long" is a real outcome of a real submission, and it is handled by
  changing the input rather than by answering it.
- Note how this compounds: the prevalidator then cuts the rendered document again, at its own
  20 000 characters, on the argument that the answers were already limited here
  (`findings/preanalyst-prevalidator.md`, finding 1).
- Severity: `breaks-now`
- Smallest generalising change: decide at the boundary what an over-long answer is — refuse the
  submission with the message the catalogues already have for a body that is too large, or accept it
  whole — instead of silently rewriting it. If the limit is real, the form should state it, as the
  chat box does.

## 2. A free answer whose text happens to be `unknown` is read as the code `unknown`

- `webtools/preanalyst/src/prespec.js:118` — `else if (value === UNKNOWN)`, where `UNKNOWN` is the
  option **code** `"unknown"` (`:40`)
- Shape: **4 — capability inferred from resemblance**
- Class: **the values an answer may hold.** For a radio, the value is a code from a closed list; for
  a textarea, it is whatever the client typed (`:75-77`). The comparison is written once and applied
  to both: a client who types exactly `unknown` into `pain` or `out_of_scope` has their answer read
  as the closed-question code and the field recorded in the open points as "the client does not
  know", instead of as an answered field.
- Reachable today with no change to anything; the consequence is mild, and in the commonest case —
  someone writing "unknown" because they do not know — it even lands on the right sentence. The
  defect is the reasoning, not the damage: a value from one vocabulary is matched against another
  because the two are spelled the same, and the next code added to that vocabulary (`none`, `other`,
  `paper`) is a word clients also write in free fields.
- Severity: `breaks-now` by reachability; consequence small.
- Smallest generalising change: apply the check only where codes exist — the closed kinds — or,
  better, take it from the option itself (see `findings/preanalyst-questions.md`, finding 2).

## 3. "Never user text in the front matter" is a rule nothing enforces

- `webtools/preanalyst/src/prespec.js:5-7` ("the front matter carries **codes** only… Never text
  written by the user: that could not inject YAML keys") and `:131-141`, where the values are
  written raw — `yaml = value`, with the comment "The codes always come from the form's own
  ([a-z_]), so they are written into the YAML as they are, without quotes"
- Shape: **4 — capability inferred from resemblance**, with **6**
- Class: **the fields `FRONT_MATTER_FIELDS` may name.** The property "this value is a code" belongs
  to the field's *kind*, and nothing here checks the kind: it holds only because the six names
  listed at `:37` happen to be the six closed questions. Adding a textarea's name to that list —
  `pain`, say, so the prevalidator can see it, which is an entirely reasonable thing to want — writes
  the client's text, newlines and colons included, straight into the YAML. The document then either
  fails to parse or carries keys the client chose, which is exactly what the header says must never
  happen. The list is edited in one file and the guarantee lives in another.
- Severity: `latent`
- Smallest generalising change: select the front-matter fields by kind (or by the property proposed
  in `findings/preanalyst-questions.md`, finding 1), and quote anything that is not a code — so the
  rule is enforced where the document is written, not maintained by hand in a list of names.

## 4. A missing document template throws instead of failing the way the caller expects

- `webtools/preanalyst/src/prespec.js:47-51` and `:124` — `env.render("commons/prespec.md.njk", …)`
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the states the deployed subsystem may be in.** `templates/commons/prespec.md.njk` is a
  **generated copy**: the original is configuration
  (`webtools/configurator/documents/prespec.md.njk`) and the copy is written by the documents
  deployer (`:22-24`). A deployer that has not run, or has run for some subsystems and not this one,
  leaves the file absent, and `render` throws out of `renderPrespec` into
  `webtools/preanalyst/src/server.js:401`, which has no failure branch for it: the call sits above
  the code that deletes a project left without a pre-specification (`:407-419`), so the project is
  created and then abandoned mid-way, and the client gets the generic handler.
- The same shape as the policy files (`analyst.js:50`, `analysis_validator.js:57`,
  `prevalidator.js:110`): a deployed artefact assumed present because it is present here.
- Severity: `latent`
- Smallest generalising change: as for the policies — check the rendered artefacts exist at startup,
  so that a subsystem that cannot produce its documents does not start.

## 5. The grouped fields lose the "does not know" check

- `webtools/preanalyst/src/prespec.js:105-114` — the `field.group` branch ends in `continue`, so the
  `value === UNKNOWN` test at `:118` is never reached for a field that belongs to a group
- Shape: **6 — the world narrowed to fit the code**
- Class: **the fields a group may contain.** The group logic is otherwise general — any number of
  members, found by name, the point raised only if all are empty. But it was written for the one
  group that exists, whose members are a checkbox and a textarea, neither of which can be
  `unknown`. A group containing a radio with a "does not know" option — the obvious next group, a
  closed question next to its "Other" — silently drops that answer from the open points.
- Severity: `stylistic`
- Smallest generalising change: keep the two questions separate — "is the group empty" and "did this
  member say they do not know" — instead of letting the first one's branch end the iteration.

---

## Noted, not raised as findings

- `:123-131` — `language` is passed into the document as the locale code (`it`), and the template
  prints it to the reader: "open answers are quoted verbatim, in the client's language ({{ language
  }})" (`webtools/configurator/documents/prespec.md.njk:13-14`). This is the third site of the
  assumption already recorded at `webtools/preanalyst/src/analyst.js:100`, and it is recorded in the
  same terms: `uncertain`, because what a given model does with a bare subtag is not something this
  audit asserts. The front matter's `language:` key is a machine field and is fine as a code; the
  sentence in the body is the part addressed to a reader.
- `:89` — `optionText` does `field.options.find(…)[1]` with no branch for "not found". The
  invariant that makes it safe is real (`readAnswers` discards codes that are not options, `:73`,
  and re-reads them at every submission) but it is nowhere stated, and `renderPrespec` is exported.
  Below the bar because no caller can currently break it; recorded because the guarantee is one
  refactor away from being untrue.
- `:44-51` — the markdown environment is built with `autoescape: false` **and** the reason is given,
  and the one path by which client text enters is named. A boundary stated explicitly, which is what
  the rule asks for.
- The `undefined` that a renamed field writes into the YAML at `:136-139` is recorded against the
  declaration site, in `findings/preanalyst-questions.md`, finding 1; not counted twice here.
