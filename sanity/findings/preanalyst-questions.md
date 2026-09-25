# preanalyst-questions

Path: `webtools/preanalyst/src/questions.js`
Examined: 2026-09-25

The pre-analysis questions as data: sections, field names, kinds, option codes and the English texts
for the pre-specification. The file states its own purpose at the top — it is "made to be **rewritten
often**", and "adding, removing or reordering a question is done here". That claim is the standard
this unit is measured against: a data file that invites rewriting must carry everything a rewrite
has to know. Two findings, both of the same kind — a property of a question that lives in the reader
instead of in the question.

---

## 1. Which answers reach the machine-readable front matter is decided elsewhere, by a hand-written list of names

- `webtools/preanalyst/src/questions.js` (the whole of `SECTIONS`) against
  `webtools/preanalyst/src/prespec.js:37` —
  `const FRONT_MATTER_FIELDS = ["today", "users", "devices", "volume", "personal_data", "existing_data"]`
- Shape: **3 — member logic outside its boundary**
- Class: **the questions this file may contain.** Whether a question's answer is machine-readable —
  i.e. goes into the YAML front matter that the prevalidator reads without interpreting anything
  (`webtools/preanalyst/src/prespec.js:5-7`) — is a property of the question. It is decided in
  another module, by repeating six of the nine field names.
- Both directions fail silently, and both are exactly what this file invites:
  - **a question added here** — a new radio or checkbox, the normal way to add something the
    prevalidator should read — does not appear in the front matter at all. Nothing says so;
  - **a question renamed here** leaves a name in `FRONT_MATTER_FIELDS` that no longer matches any
    field. `renderPrespec` then reads `answers[name]`, gets `undefined`, and the chain at
    `webtools/preanalyst/src/prespec.js:136-141` — `Array.isArray` false, `value !== null` true —
    writes the literal string `undefined` into the YAML: `today: undefined`. A document goes to the
    model with a front-matter value that stands for nothing, and is read as a value.
  The one exception the current list encodes — `skills` is closed but deliberately left out, because
  "the list of checkboxes is open and sits next to a free field, so a code on its own would tell
  half the answer" (`webtools/preanalyst/src/prespec.js:34-36`) — is precisely a property *of that
  question*, stated away from it.
- Severity: `latent`
- Smallest generalising change: declare it on the field here (`front_matter: true`, or the absence
  of it), and let `prespec.js` select on the property rather than on a list of names it keeps in
  step by hand.

## 2. "The client does not know" is recognised from the option's code spelling

- `webtools/preanalyst/src/questions.js:166` (`["unknown", "The client does not know"]`) and `:177`
  (`["unknown", "The client does not know"]`), against `webtools/preanalyst/src/prespec.js:40`
  (`const UNKNOWN = "unknown"`) and `:118` (`else if (value === UNKNOWN)`)
- Shape: **4 — capability inferred from resemblance**, with **3**
- Class: **the options a closed question may offer.** That an option means "I do not know" — and
  therefore that the answer becomes an open point, i.e. something the analysis chat must ask about
  (`webtools/preanalyst/src/prespec.js:13-15`) — is a property of the option. It is not declared:
  it is deduced from the option's code being spelled `unknown`.
- Two of the four radio questions happen to spell it that way. A question added here with a
  "do not know" option coded `dont_know`, `unclear`, `to_be_checked` — or in any other of the forms
  that read naturally next to the answers around them — produces no open point, so the analysis
  never asks about it and nothing anywhere says a question went unanswered. The author making that
  edit is working in the file that tells them this is where questions are added.
- Severity: `latent`
- Smallest generalising change: mark the option — a third element in the pair, or a `unknown: true`
  flag — so that the property is established where the option is defined, and `prespec.js` reads it
  instead of matching a string.

---

## Noted, not raised as findings

- `:28` declares five kinds, `"textarea" | "text" | "email" | "radio" | "checkbox"`, and only three
  are instantiated. The readers serve all five: `templates/macros/fields.njk:52` renders
  `type="{{ field.kind }}"` for anything that is not a textarea or a choice, and
  `webtools/preanalyst/src/page.js:261` and `webtools/preanalyst/src/prespec.js:67-77` branch on the
  choice kinds and treat the rest as text. A declared class larger than the instances, and served
  whole — the opposite of what this audit hunts.
- `group` (`:37-39`, `:106`, `:135`) is handled generally in
  `webtools/preanalyst/src/prespec.js:105-114`: the members are found by the group's name and the
  point is raised only if **all** of them are empty, with no assumption that a group has exactly
  two members or that one of them is the free field. Correct for the class.
- The option codes are English and stable by design (`:32-35`), separately from the texts shown to
  the client, which live in the catalogues. That is the boundary drawn in the right place.
