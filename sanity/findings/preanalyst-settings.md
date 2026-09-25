# preanalyst-settings

Path: `webtools/preanalyst/src/settings.js`
Examined: 2026-09-25

The startup read of the `preanalyst` configuration. The file does the main thing right and does it
throughout: every value comes from the configuration subsystem, there is not one default, not one
`??`, not one environment variable, and a missing field stops the server rather than being filled
in. Two findings, both about relations between fields rather than about any field on its own.

---

## 1. One of three AI engines occupies the generic top-level name `ai` — RESOLVED during this run

> **Status: fixed while this audit was running.** The prevalidator's AI section has been moved
> from top-level `ai.*` into `prevalidation.*`, and `settings.js:59` now reads
> `loadPrevalidatorAiSettings(configuration, "prevalidation")`. The three engines are symmetrical.
> The finding is kept below as the record of what was found; it is not outstanding.

- `webtools/preanalyst/src/settings.js:59` — `loadPrevalidatorAiSettings(configuration, "ai")`,
  against `:86` and `:96`, which pass `"analyst.conversation"` and `"analyst.validation"`
- Shape: **6 — the world narrowed to fit the code**
- Class: **the AI engines this subsystem configures.** There are three. Two of them are named for
  what they are and sit under the subject they belong to; the third is called `ai` and sits at the
  top level of the configuration document
  (`webtools/configurator/configuration/preanalyst.json`), as a sibling of `prevalidation` rather
  than a part of it — even though the settings object nests it at `prevalidation.ai`.
- The name is a leftover from when there was one engine, and it asserts what was true then: that
  `ai` in this subsystem means one thing. It no longer does. This is the same assertion that the
  `src/ai/` → `src/prevalidator_ai/` rename has just removed from the source tree; the
  configuration still carries it. `CLAUDE.md` also rules out generic names of exactly this kind.
- What breaks: nothing today — this is a name, and the code reads it correctly. What it costs is
  that a fourth engine has no natural place, that the document no longer reads as a list of engines,
  and that the code path and the configuration path disagree (`settings.prevalidation.ai` reading
  from `ai.*`), which is the kind of divergence that makes the next person edit the wrong section.
- Severity: `stylistic` (resolved)
- Smallest generalising change: move the section under `prevalidation`, so that every engine is
  named for the work it does and none of them owns the generic word.

## 2. `warn_from_turn` and `max_turns` are read independently, though only some pairs mean anything

- `webtools/preanalyst/src/settings.js:107` and `:111`, consumed at
  `webtools/preanalyst/src/page.js:217` (`warn_when_left = maxTurns - warnFromTurn`)
- Shape: **6 — the world narrowed to fit the code**
- Class: **the pairs of values `analysis.max_turns` and `analysis.warn_from_turn` may hold.** Each
  is validated alone, `{ min: 1 }`, and nothing relates them. The arithmetic downstream is
  meaningful only when `warn_from_turn` is strictly less than `max_turns`, which is true of the
  pair in front of the author (20 and 30) and of no other restriction anybody imposed.
- What breaks, on an entitled change: raising `warn_from_turn` to or past `max_turns` — a plausible
  edit when tuning how late the warning comes — makes `warn_when_left` zero or negative, and the
  running-out warning simply never appears. The server starts, nothing logs, the page is subtly
  wrong. Setting `warn_from_turn` to 1 produces the behaviour the comment at `:109-111` explicitly
  says is harmful.
- Severity: `latent`
- Smallest generalising change: validate the pair, not the two fields, so a combination that
  cannot mean anything stops the server like any other bad configuration.

---

## Noted, not raised as findings

- `analysis.max_turns` is configuration while the analyst's "we are nearly out" threshold is the
  literal `3` at `webtools/preanalyst/src/analyst.js:96`. Recorded under that unit; it is visible
  from here as the same value being half-configured.
- `:62`, `:89`, `:97` — the three `policy` fields are read as plain strings and nothing checks that
  the named file was deployed. That is the failure recorded against
  `webtools/preanalyst/src/analyst.js:50` and `webtools/preanalyst/src/analysis_validator.js:57`;
  this is the place where it would be cheapest to fix, since these three lines already have the
  names in hand at startup.
