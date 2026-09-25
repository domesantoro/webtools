# preanalyst-analyst

Path: `webtools/preanalyst/src/analyst.js`
Examined: 2026-09-25

The engine that carries the analysis conversation. It reads a policy file by the name the
configuration gives, builds the message list, calls `analyst_ai/converse`, and reads the
structured answer back. Three findings; the module is otherwise disciplined (no defaults, the
`usage` returned with failures too, the `ready` claim explicitly not trusted).

---

## 1. Every chat role that is not `client` becomes `assistant`

- `webtools/preanalyst/src/analyst.js:68`
- Shape: **6 — the world narrowed to fit the code** (with a touch of 1)
- Class: **the roles a stored chat entry may carry.** The code assumes the class has exactly two
  members and that one of them is `client`: `entry.role === "client" ? "user" : "assistant"`.
- Today the writer pushes exactly `client` and `system`
  (`webtools/preanalyst/src/server.js:743-751`), so the mapping is correct as things stand. But
  the chat is an open document in anagraphics, and a third role is a change somebody is entitled
  to make — a driver note, a validator remark, a system notice about turns bought, an imported
  transcript. Any such entry silently arrives at the model as *the model's own previous words*.
  That is worse than an error: the model treats a third party's text as its own commitment and
  builds on it.
- Severity: `latent`
- Smallest generalising change: map the role explicitly per known member and drop (or refuse) an
  entry whose role is not one the analyst knows how to present.

## 2. A policy name that has no file throws instead of failing the documented way

- `webtools/preanalyst/src/analyst.js:48-55` (thrown from `readFile`, line 50), against the
  contract stated at `webtools/preanalyst/src/analyst.js:17-19`
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the values `analyst.conversation.policy` may hold.** It is a configured field, read
  from Mongo at startup; the code assumes every value it can hold names a file that the policies
  deployer has actually put in `webtools/preanalyst/policies/`.
- The documented contract is `{ ok: false, reason: "unavailable" | "rejected" | "unknown_provider" }`.
  A policy renamed, a new policy version configured before the deployer has run, or a deployer that
  ran for some subsystems and not this one, all produce an exception out of `ask`, not that
  contract. What breaks: the caller's failure branch
  (`webtools/preanalyst/src/server.js:698-701`, which expects `{ok:false}` and answers
  `ANALYST_UNAVAILABLE`) is bypassed and the request lands on the generic handler at
  `webtools/preanalyst/src/server.js:1202`. The change that reaches it — editing the `policy`
  field in the running configuration — is exactly the kind of change the configuration subsystem
  exists to allow.
- Severity: `latent`
- Smallest generalising change: check the configured policy files exist when the settings are read
  at startup, so that an unusable name stops the subsystem rather than one request.

## 3. The language reaches the model as a locale code, not as a language

- `webtools/preanalyst/src/analyst.js:100` (`Write your message in this language: ${language}.`),
  fed from `ui.locale` at `webtools/preanalyst/src/server.js:695`
- Shape: **4 — capability inferred from resemblance**
- Class: **the locales `i18n.locales` may contain.** `localeOf`
  (`webtools/commons/i18n/webtools_i18n.js:139-144`) returns one of the configured codes, e.g.
  `it`, and the analyst hands that code to the model as if it were the name of a language. Nothing
  establishes that any given model resolves any given code; the assumption rides on the codes
  currently configured being two familiar ones.
- `i18n.locales` is a configured list: adding a locale is a change somebody is entitled to make,
  and it is made in the configuration, far from this file. A code the model misreads produces a
  reply in the wrong language for a client who cannot read it — and the failure is silent, because
  the schema is still satisfied.
- Severity: `latent` — and partly `uncertain`: I have not established which codes the configured
  model actually resolves, and guessing that would be the same defect. What would settle it: the
  model's documented behaviour on bare language subtags, or a declared language name per locale.
- Smallest generalising change: carry the language's own name alongside its code (the catalogues
  are the natural place) and put the name in the operator note.

---

## Noted, not raised as findings

- `webtools/preanalyst/src/analyst.js:96` — the literal `3` in `turnsLeft <= 3` is a constant in
  code tuned to the current turn budget, where `CLAUDE.md` asks for configuration. It is a rule
  breach of a different rule, not a class-vs-instance defect, and is recorded here only so it is
  not lost.
- `webtools/preanalyst/src/analyst.js:131` — `Array.isArray(output.missing) ? … : []` substitutes
  an empty array for a field the schema declares required. It is a narrow coercion of a value the
  provider is contracted to supply, not an invented value standing in for a real absence; borderline
  shape 2, left below the bar.
