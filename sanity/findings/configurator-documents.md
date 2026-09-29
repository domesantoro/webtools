# configurator-documents

Path: `webtools/configurator/documents/prespec.md.njk`
(generated copy in `webtools/preanalyst/templates/commons/prespec.md.njk`)
Examined: 2026-09-26

Sixty-five lines, of which twenty are a comment at the bottom of the file — at the bottom because
"the file has to begin with `---`: anything before it, an empty line included, and the front matter
is gone" (`:46-47`). It is the only artefact in the repository whose copy-warning placement is
itself explained, and it is the reason `documents_deployer` copies this one with a plain `cp` while
prepending a banner to the policies beside it.

The safety claim the file makes is true, and was checked rather than taken: `:50-51` says the
environment has no autoescape and "the client's text comes in **only** through the `quote`
filter". Reading `webtools/preanalyst/src/prespec.js:96-101` confirms it — `{list}` and `{text}`
are English option labels from `questions.js` (`optionText`, `:90-92`), `{quote}` is the only
branch carrying anything the client typed, and `:52-57` puts every line of it behind `> `. The
front matter's values are `[a-z_]` codes filtered against the form's own options (`:68-74`,
`:132-138`), so no client string can open a YAML key.

Two findings, both about predicates this template evaluates for itself over a class whose members
are decided elsewhere.

---

## 1. The last branch is `else`, so a shape the template does not know renders as a blank line

- `webtools/configurator/documents/prespec.md.njk:22-32` —
  `{% if not field.answer %}Not provided.{% elif field.answer.quote %}…{% elif field.answer.list %}
  …{% else %}{{ field.answer.text }}{% endif %}`
- The producer: `webtools/preanalyst/src/prespec.js:96-101`, `bodyAnswer`, which returns `null`,
  `{list}`, `{text}` or `{quote}` according to `field.kind`
- Shape: **5 — only the success path**, with **2 — invented value**: the absence of a known shape
  is filled with `{{ field.answer.text }}`
- Class: **the answer shapes `bodyAnswer` may return.** Four today, and the template names three of
  them and gives the fourth position to `else`. `field.kind` is decided in `questions.js`, which
  the earlier units of this audit record as the file whose own header says it is meant to be
  rewritten often: a date field, a number, a file name, a scale are all ordinary things to add to a
  pre-analysis form, and each would arrive here as a shape with neither `quote` nor `list`.
- What that produces is not an error. Nunjucks renders an undefined value as the empty string with
  no autoescape and no strict mode, so the document gets `### <the question>` followed by a blank
  line — a question that looks asked and unanswered, in the document the analysis and the price are
  built on, and one that `openPoints()` will **not** have listed as an open point because the
  answer was in fact given. The one reading that is certainly wrong is the one produced.
- The template's own comment states the coupling in the other direction only: "fields the code does
  not send cannot be invented" (`:62-64`). The direction that is not stated is this one — shapes
  the code does send and the template does not know.
- Severity: `latent` — it takes a new kind of question, which is the change this form exists to
  receive.
- Smallest generalising change: make the last branch `{% elif field.answer.text %}` and give the
  real `else` something that says what happened — a line naming the field and the shape — so that
  an unknown member is visible in the document rather than absent from it.

---

## 2. "This field is empty" is computed twice, in two languages, by two different rules

- `webtools/configurator/documents/prespec.md.njk:22` — `{% if not field.answer %}` → the body
  writes `Not provided.`
- `webtools/preanalyst/src/prespec.js:86-88,119` — `isEmpty(value)` → the field goes into
  `open_points` as `"<spec>: not provided."`, rendered by this same template at `:38-44`
- Shape: **6 — world narrowed to fit the code**
- Class: **the values that count as an empty answer.** The document says the same thing in two
  places, and the two places decide it independently: the template asks whether the answer *object*
  is falsy, the code asks whether the *value* is `null` or an empty array. They agree today for one
  reason and one only — `bodyAnswer` happens to return `null` on exactly the inputs `isEmpty`
  accepts — and neither file says that they must.
- The consequence of a divergence is a document that contradicts itself about the thing it exists
  to report. A `bodyAnswer` that returned `{text: ""}` rather than `null` for some future field
  kind (which is what a radio whose option label is empty would produce, since `optionText` is not
  guarded) puts a blank answer in the body and nothing in "Open points": the analysis is then told,
  in the section that lists what it has to ask about, that there is nothing to ask.
- The template is **configuration** — that is the whole reason it lives in
  `webtools/configurator/documents/` — so the two halves of this predicate are not even in the same
  kind of artefact, and one of them can be edited without the other being looked at.
- Severity: `latent`
- Smallest generalising change: decide it once, in the code, and pass the answer: `bodyAnswer`
  already knows, so let it return a shape the template can render without deciding anything —
  `{missing: true}` alongside the other three — and the template stops holding an opinion about
  emptiness.

---

## Noted, not raised as findings

- `:13-14` — "open answers are quoted verbatim, in the client's language ({{ language }})", with
  `language` reaching the model as a bare locale code. Already on the `uncertain` list in
  `summary.md`, naming this file and `webtools/preanalyst/src/prespec.js:123-131`. Not re-raised.
- The client's answer is cut at `form.answer_max_chars` before it reaches here
  (`webtools/preanalyst/src/prespec.js:77`, `breaks-now` 3), and this template renders the truncated
  text inside a blockquote with nothing marking that it was cut. The document gives the reader —
  a model, then a driver — no way to tell a complete answer from a severed one. The defect is
  recorded at the cut; noted here because this file is where its invisibility becomes final.
- `:38` uses `{% if open_points.length %}` while `:22` uses plain truthiness on an object. Two
  idioms for "is there anything here" in one 65-line file. `openPoints()` always returns an array,
  so both are correct.
- `:15-17` — a section with no fields renders its `## title` and nothing under it. `SECTIONS` comes
  from `questions.js` and no section is empty today. The same family as finding 1, one degree less
  reachable.
- `:8` — `{{ item.yaml }}` writes pre-serialised YAML the template cannot check, and the guarantee
  lives in `webtools/preanalyst/src/prespec.js:132-133` ("The codes always come from the form's own
  ([a-z_]), so they are written into the YAML as they are, without quotes"). A partial-class
  property stated at the boundary that produces it, in the file that produces it. Correct, and
  worth recording because this artefact is configuration: whoever edits it is entitled to add a
  variable, and only the code's comment says which variables are safe raw.
- `:45-65` — the whole bottom comment: why it is at the bottom, which renderer owns it, why there
  is no autoescape, where the original is, and the one limit of the arrangement. The best-documented
  boundary in the repository.
- `:19` of `webtools/preanalyst/src/prespec.js` — "The front matter's `webtools:` key is not
  written here: webtools-workspaces stamps it when it stores the file." Two writers of one document
  and each says what it does not write.
