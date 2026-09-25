# Optimisations

Things that **exist and work**, but that could be done better. The things that do not exist yet are
in `contesto/todos.md`.

One entry per point, always with the same structure: how it is now, why it may not be enough, what
there is to weigh up.

---

## 1. The pre-specification's template (`prespec/1`)

_Opened on 2026-09-23. Concerns: the preanalyst — `src/prespec.js`, `templates/prespec.md.njk`._

**How it is now.** The front matter carries `project_id`, `kind: prespec`, `template: prespec/1`,
`language` and, in `answers`, the **codes** alone of the six closed answers (`today`, `users`,
`devices`, `volume`, `personal_data`, `existing_data`). The body is in English: one section for
each section of the form, a `###` for each question; the closed answers with their English text,
the open answers quoted in a blockquote in the client's language, the empty fields written
`Not provided.`. At the bottom, **Open points**: the empty fields and the `unknown` answers. The
skills stay out of the front matter because the list of checkboxes is open and has a free field
next to it, so the code on its own would tell half of the answer.

**Why it may not be enough.** The template has never been read by a real recipient: neither by a
model (the prevalidator, the analysis engine) nor by a driver. What is left to check:

- the body repeats in plain sight what the front matter already has in code;
- the open answers are in one language and the structure in another: whoever reads finds two of
  them in the same document;
- the Open points are a flat list, with no priority and without telling "they did not answer" from
  "they do not know";
- `template: prespec/1` is there, but nobody reads it today to decide how to treat the document.

**To weigh up.** Whether the body in plain sight is really needed or the front matter plus the
questions is enough; whether the open answers are to be translated into English at writing time;
whether the Open points are to be typed; how the template is versioned when it changes
(`prespec/2`) and who checks the version when reading an old document.

---

## 2. The refusal's threshold is a number chosen by hand

_Opened on 2026-09-23. Concerns: the preanalyst — `prevalidation.reject_threshold`._

**How it is now.** A request is refused if `run_out_certain` is the most probable outcome **and**
it passes 0.6. The number was chosen because it seemed reasonable.

**Why it may not be enough.** Nobody has yet seen how the judgements are distributed on real
requests, so whether 0.6 refuses too much or too little is not known. A refusal is final and the
user has no appeal: getting it wrong by excess costs clients, by default it costs whole pipelines.

**To weigh up.** Collecting the first real judgements before touching the threshold; deciding
whether a middle band is needed in which the request is not refused but is reported to the driver;
working out whether the threshold should be one or should depend on the second most probable
outcome.

## 3. The probabilities a model declares are not calibrated

_Opened on 2026-09-23. Concerns: the preanalyst — `src/prevalidator.js`, the `scope-v1` policy._

**How it is now.** The model declares four numbers, they are normalised and treated as a
probability distribution.

**Why it may not be enough.** A model writing `0.8` is not saying that it is right eight times out
of ten: it is a plausible number, not a measured frequency. Until somebody compares those numbers
with the real decisions — the driver's, and the project's final outcome — the confidence is an
impression with a decimal point.

**To weigh up.** Keeping the register of the steps (it is already there: `pipeline.steps`) and
comparing it with what really happened; measuring agreement, errors and the driver's overrides, as
`decision_engine_considerazioni.md` §13 and §9 say; if need be, calibrating the numbers instead of
trusting them.

## 4. The secret sits in plain sight in Mongo and travels over HTTP

_Opened on 2026-09-23. Concerns: the configurator — `secrets/`, anagraphics —
`GET /configuration/…`._

**How it is now.** The AI provider's key sits outside git, but it is merged into the configuration,
written in plain sight in the `configuration` collection and served in plain sight by anagraphics
to whoever asks for it from the pool's IPs.

**Why it may not be enough.** Whoever reads the database reads the key. Whoever gets into the IP
pool reads the key. Today everything runs on one machine and that is the perimeter, but the first
time a subsystem goes onto another machine this choice has to be made again.

**To weigh up.** Whether the configuration should tell the secret fields from the others; whether
anagraphics should serve them only to whoever owns them; whether a real secrets manager is needed
when we leave localhost.

## 5. The prevalidator sits inside the preanalyst

_Opened on 2026-09-23. Concerns: the preanalyst — `src/prevalidator_ai/`, `src/prevalidator.js`._

**How it is now.** The AI module and the prevalidation's policy live inside the preanalyst. The
provider is interchangeable, the subsystem is not.

**Why it may not be enough.** `decision_engine_considerazioni.md` describes a decision engine of
its own, taking every non-deterministic decision of the system with the same interface and the
same register. The next gates — the analysis' validation, the drivers' pooling, a dev failure —
will do the same things again: if each of them rewrites them at home, the register of the decisions
does not exist.

**To weigh up.** When it is worth extracting `src/prevalidator_ai/` into a subsystem; whether the second gate is
already the right moment; what stays in the subsystem (the policy) and what leaves it (the
transport).

## 6. The refusal's PDF is in English, and the form empties

_Opened on 2026-09-23. Concerns: the preanalyst — `src/rejection_pdf.js`, §16.5 of the README._

**How it is now.** After a refusal the user goes back to the form's page, which is empty, and the
only way not to lose what they had written is to download the PDF. The PDF is born from the
pre-specification, which has the questions in English: whoever filled the form in in Italian finds
themselves with a document in two languages.

**Why it may not be enough.** The document is for exactly the person who has just received a no: it
is the worst moment to hand them something awkward to read.

**To weigh up.** Whether the PDF should be built from the translated questions instead of from the
pre-specification's markdown; whether the form should come back filled in instead of empty, and at
that point whether the PDF is still needed.

_A note of 2026-09-23._ The form that comes back filled in now exists, but only for the going back
of `underspecified` (§16.6): the answers are passed to the template again and the fields carry them
back with them. After a **refusal** the form stays empty, because one arrives there with a `303`
and those answers are nowhere any more. The missing piece is keeping them — or reading the
pre-specification back from workspaces, where it is already written — not the way of putting them
back into the page.

## 7. The log has no levels

_Opened on 2026-09-23. Concerns: every subsystem — `console.*` in the Node ones, `logging` and
uvicorn in anagraphics._

**How it is now.** Every subsystem writes to its log with what it has to hand: `console.log`,
`console.warn` and `console.error` in the four Node services, the standard library's `logging` plus
uvicorn's access log in anagraphics. In each one's `src/`:

| | `console.error` | `console.warn` | `console.log` |
|---|---|---|---|
| preanalyst | 24 | 6 | 6 |
| sso | 15 | 10 | 2 |
| webtools-workspaces | 2 | 1 | 2 |
| front-gate | 2 | 1 | 1 |

Over today the preanalyst has written **33** lines of its own; anagraphics has written **589**,
almost all of them uvicorn's access log. The bulk of the volume is the part nobody chose.

Seven things, in order of how much they cost:

1. **There is no level, so there is no knob.** `error` against `warn` is the only distinction, and
   they end up in the same file: the verbosity can be neither lowered in service nor raised to
   follow a case. It is also the last piece of configuration that does not sit in the configurator.
2. **The level is chosen by feel.** «login refused: wrong password» is a `warn`, but it is an
   ordinary fact of the system, not a failure; the HTTP clients write `error` even for a `404` the
   caller expects. Whoever reads learns to ignore the `error`s, which is the worst way of having a
   level.
3. **The lines have no time.** The only date is `=== start <date> ===`, which the startup script
   writes. In a file in append a line with no time says little, and there is no rotation.
4. **The prefix means three things.** `[preanalyst]` is the service writing, `[credentials]` the
   module, `[anagraphics]` inside the preanalyst the service **called** — and it is confused with
   anagraphics' log. `[ai]` and `[ai/anthropic]` are two different depths.
5. **Two worlds that do not resemble each other.** The Node ones write to stdout by hand,
   anagraphics uses `logging` and puts uvicorn on top of it, which decides by itself what is
   interesting.
6. **There are personal data in the log.** «login of <email>», «<email> entered», in a file with
   neither rotation nor expiry.
7. **A request cannot be followed.** A submission touches the preanalyst, the sso, anagraphics,
   workspaces and the provider: in the four logs there is nothing tying the lines to each other.

**Why it may not be enough.** The log is the only place where one sees a prevalidation that cost
money, a step written on the pipeline, a project left with no pre-specification. With no levels one
can neither keep quiet when all is well nor speak when it is needed; with no time, a line cannot be
put in line with the others. As long as the subsystems were two and one watched them while they
ran it was fine: now they are five and one calls a provider that charges.

**To weigh up.**

- **Which levels, and the rule for choosing them.** `error | warn | info | debug` is enough; the
  point is when which is used. A proposal to discuss: `error` = the system could not do its work,
  `warn` = it did it in a degraded way, `info` = a fact of the flow we want to be able to
  reconstruct (a project born, a prevalidation, a refusal), `debug` = the technical detail. With
  this rule a refused login is `info`.
- **Where the threshold sits.** In the configuration, per subsystem (`log.level` in
  `configurator/configuration/<subsystem>.json`), like every other configurable datum. Whether it
  is needed per module too is to be seen.
- **A shared module** (`commons/log/`, a copy generated by the deployer like the sso's client and
  the configuration's) or a library: one more dependency against a format somebody else maintains.
- **The line's format**: the time, the level, the subsystem, the module, the message. Text for a
  person or JSON for a program — today a human being reads the log with `tail -f`, but it is the
  choice that is not changed afterwards.
- **What the prefix does**: one name only, with one meaning only. The service called goes in the
  message, not in the prefix.
- **Uvicorn's access log**: switching it off and writing the lines that count ourselves, or keeping
  it and accepting that it is the bulk of the volume.
- **Emails and names**: whether they stay in plain sight, whether they become the `uid`, or whether
  they stay only at `debug`.
- **A request identifier** travelling from one subsystem to another, and whether it is worth it now
  or when the subsystems are more.
- **The file's rotation**, which is already in every subsystem's known limits: if the log is
  touched, that is decided too.

## 8. The policy's cache does not switch on

_Opened on 2026-09-23. Concerns: the preanalyst — `src/prevalidator_ai/providers/anthropic.js`, §16.1 of the
README._

**How it is now.** Every prevalidation sends the provider two things: the **policy**, which is
always the same word for word (~1300 tokens), and the client's **pre-specification**, which changes
every time (~600 tokens). The provider offers a discount for a situation like this: the piece that
does not change is marked — it is the `cache_control` that is in the code — and it keeps it aside,
so that from the second call on that piece costs a tenth instead of the whole.

The discount has a threshold, though: the marked piece must be **at least 4096 tokens** long for
the provider to take the trouble of keeping it. The threshold depends on the model — 512 tokens on
the newest models, 1024 on Sonnet 5, 4096 on Haiku 4.5, which is the one we use. The policy is
**too short, and the cache never switches on.**

How short, measured with `count_tokens` (which costs nothing):

| | Tokens |
|---|---:|
| The `scope-v1` policy of the morning | ~1300 |
| The `scope-v1` policy after `non_sequitur` and the webtool criterion | 3051 |
| The `scope-v1` policy after the precedence between emptiness and `non_sequitur` (2026-09-24) | **3541** |
| The cache's threshold on `claude-haiku-4-5` | 4096 |
| **What is missing** | **555** |

There is no error: the marker is accepted and ignored silently. It is seen only by looking at the
answer's counters, which do indeed say zero:

```
"cache_creation_input_tokens": 0, "cache_read_input_tokens": 0
```

So the policy pays for itself in full at every prevalidation: it is about **70% of the input
tokens**. The README's sentence «from the second call on it costs less» is false today, and has
been corrected.

**Why it may not be enough.** In money, today, it is little: the policy costs about 0.13 cents of a
dollar per prevalidation, and with the cache on it would cost a tenth of that — a saving of a
little more than a dollar every thousand prevalidations. The reason it is worth keeping track of is
not today's figure but the fact that **it grows with everything**: with the number of
prevalidations, with the policy's length, and above all with the gates that come after, where the
instructions will be longer than a page and the model dearer than Haiku. The same trap will come up
again there, and there it will weigh.

**To weigh up.**

- **If we stay on Haiku, the policy is to be extended.** It is the operative conclusion: ~555
  tokens are missing — there were ~1045, and the revision of 24 September has already covered half
  of them without that being its purpose — and below that threshold every line written is paid for
  in full at every prevalidation, while above it is paid a tenth from the second on. The extra text
  would not be filler: the policy still has a good deal to say — more cases compared like the ones
  that settled the border of `off_domain`, examples of requests judged with their distribution, the
  signals of a size that is growing. They are the things that make it more precise, and that are
  not written today so as not to lengthen it. The sum turns over: **it is worth writing them**.
- If the model is changed instead, the threshold drops by itself (1024 on Sonnet 5, 512 on the
  newest) but the price per token goes up: the complete sum has to be compared, not only the
  discount.
- A measurement before deciding: the policy stands at **3541** tokens, and the client's document
  adds between 400 and 900. Every prevalidation costs about 0.5 cents of a dollar, against the 0.45
  of the 23rd and the 0.33 of the morning of the 23rd — **the policy that grows is paid for at
  every call**, and it is the same sum that makes passing the threshold worthwhile instead of
  stopping just below it.
- Whether the right place for the marker is still the `system`, when the gates are more than one
  and share pieces of instructions.
- What to keep: today only `input_tokens` and `output_tokens` are saved on the pipeline's step. The
  day the cache works, the real cost is no longer worked out from those two numbers —
  `cache_creation_input_tokens` and `cache_read_input_tokens` are needed too, which are paid at
  different rates (one and a half times the full price on writing, a tenth on reading).
