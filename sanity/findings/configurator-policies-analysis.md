# configurator-policies-analysis

Paths: `webtools/configurator/policies/analysis-v1.md`,
`webtools/configurator/policies/analysis-validation-v1.md`
Generated copies: `webtools/preanalyst/policies/analysis-v1.md`,
`webtools/preanalyst/policies/analysis-validation-v1.md` — verified identical to the originals but
for the deployer's banner, so the copies are current and these findings belong to the originals.
Examined: 2026-09-25

Two policy documents, which `CLAUDE.md` classes as configuration: they say what the system
considers acceptable, the JSON says which one is used. Both are well written for their job — the
validation policy in particular is explicit that it exists because the analyst is not a fair judge
of its own work, and it argues both directions (be willing to say `pass`, be willing to say
`continue`) instead of only the cautious one. The findings are about what the two documents assume
about each other and about the code.

---

## 1. The language is stated twice, by two things that can disagree

- `webtools/configurator/policies/analysis-v1.md` — "**Answer in the language of the
  conversation.** The client writes in their own language and the message you produce is read by
  them" — against `webtools/preanalyst/src/analyst.js:100`, which appends
  `Write your message in this language: ${language}`, where `language` is `ui.locale`
  (`webtools/preanalyst/src/server.js:695`)
- Shape: **6 — the world narrowed to fit the code**
- Class: **the (conversation language, interface locale) pairs a client may present.** The policy
  names one source of truth — what the client is writing in — and the operator note names another:
  the locale, which comes from a cookie or from `Accept-Language`
  (`webtools/commons/i18n/webtools_i18n.js:139-144`). The code assumes the two always agree, which
  is true of the person testing it and of nobody in particular.
- The pair comes apart easily and legitimately: an Italian-speaking client on a browser that
  advertises English, a client who switched the interface to English and writes in Italian, anyone
  whose language is not among `i18n.locales` at all and therefore falls back to `en` while writing
  in their own. In every such case the model receives two instructions that contradict each other
  and there is no rule saying which wins; whichever it picks, some clients are answered in a
  language they did not write in.
- Severity: `latent`
- Smallest generalising change: decide which of the two is authoritative and say so in one place —
  either drop the locale from the operator note and let the policy's rule stand, or drop the rule
  from the policy and let the operator note be the single statement.

## 2. The message ceiling is enforced where it cannot be respected

- `webtools/preanalyst/src/analyst.js:130` (`text.slice(0, messageMaxChars)`, configured 4000)
  against `webtools/configurator/policies/analysis-v1.md`, "What you return", which never mentions
  a length
- Shape: **6 — the world narrowed to fit the code**
- Class: **the messages the model may produce.** The code assumes they are under 4000 characters
  and cuts what is not, with `slice` — mid-word, mid-sentence, without a log. The policy is the one
  place that could make the assumption true, by telling the model the limit, and it does not.
- What breaks: a closing message, or a question with the example the policy explicitly asks for,
  that runs long is delivered to the client with its end missing. The client sees a sentence that
  stops. Nothing records that it happened, so it cannot be noticed except by a client complaining.
  Note that the failure gets *more* likely as the policy is tuned, since every instruction to give
  examples or context lengthens the output.
- Severity: `latent`
- Smallest generalising change: state the ceiling in the policy, so the constraint is expressed
  where it can be met, and treat an over-long message as a fault to record rather than silently
  trim.

## 3. The two policies are written to match each other, and nothing says they must

- `webtools/configurator/policies/analysis-v1.md` ("What the conversation is for", the five things
  the analyst must know) and `webtools/configurator/policies/analysis-validation-v1.md` ("What you
  are looking for", the `completeness` axis, which enumerates four of those five, the fifth being
  the `testability` axis)
- Shape: **6 — the world narrowed to fit the code**
- Class: **the pairs of policies the two engines may be configured with.**
  `analyst.conversation.policy` and `analyst.validation.policy` are two independent strings in the
  configuration. The documents correspond closely — the judge grades exactly what the interviewer
  was told to collect — and nothing anywhere records that correspondence or checks it.
- What breaks, on an entitled change: writing `analysis-v2` that asks for a sixth subject, and
  pointing only the conversation at it, leaves the judge grading `completeness` against a list that
  no longer matches. Conversations would be sent back for things the new policy deliberately
  dropped, or passed while missing something the new policy added. Both failures look like the
  model behaving oddly, not like a configuration mismatch, and the code that reads both
  (`webtools/preanalyst/src/analysis_validator.js`) has no idea the two are related.
- Severity: `latent`
- Smallest generalising change: make the pairing explicit — the validation policy naming which
  conversation policy it grades, checked when the settings are read — so that changing one without
  the other is a configuration error rather than a slow drift.

---

## Noted, not raised as findings

- Both policies correctly require the internal fields (`missing`, `reason`) to be written in
  English whatever the conversation's language, which is the `CLAUDE.md` rule applied to a model's
  output. That is easy to forget and was not forgotten.
- The generated copies in `webtools/preanalyst/policies/` are byte-identical to the originals but
  for the banner, which means the deployer had been run and nothing had been edited in place.
