# preanalyst-script-analyse

Path: `webtools/preanalyst/scripts/analyse.js`
Examined: 2026-09-25

A command-line probe: one analyst turn against a hand-written pre-specification, on the real
configuration. It is a development tool, and it is judged as one — but it reads the same settings
and calls the same engine as the server, so a wrong assumption here is a wrong assumption about the
system.

---

## 1. The shape of `usage` is named above the provider door, where nothing knows the provider

- `webtools/preanalyst/scripts/analyse.js:54-55`, and the same assumption at
  `webtools/preanalyst/src/server.js:528` and `:550`
- Shape: **3 — behaviour specific to one member decided outside the boundary that deals with that
  member**
- Class: **the providers `analyst.conversation.provider` and `prevalidation.provider` may name.**
  The whole point of `analyst_ai/` and `prevalidator_ai/` is stated in their headers: nothing above
  the door names a provider, and "the shape of a provider's configuration is the provider's own
  business". The field names inside `usage` were never made part of that bargain. They are
  Anthropic's names — `input_tokens`, `output_tokens`, `cache_read_input_tokens`,
  `cache_creation_input_tokens` — and this script reads all four, while `server.js` reads the first
  two, both from above the door.
- The door does not normalise. `converse` and `decide` return whatever the provider built
  (`analyst_ai/webtools_analyst_ai.js:74`, `prevalidator_ai/webtools_prevalidator_ai.js:85`), and a
  provider added tomorrow reads its own configuration fields by design — nothing tells it what to
  call its token counts.
- What breaks, on the change the two doors were built to make cheap: adding a second provider. Its
  usage object will carry whatever that API calls these things, and every reader above the door
  prints `undefined` or logs a cost of `undefined+undefined`. The failure is silent in exactly the
  place the PoC is measuring.
- Severity: `latent`
- Smallest generalising change: make the token counts part of the door's contract — a named shape
  every provider maps its own counters onto — so that above the door there is one vocabulary and
  below it each provider's own.

---

## Noted, not raised as findings

- `:45` — the failure path prints only `input_tokens` and `output_tokens` while the success path at
  `:54-55` prints all four, so a failed turn under-reports what it cost. It is the same omission
  the prevalidator's provider makes structurally
  (`findings/preanalyst-prevalidator-ai.md`, finding 2), here as an inconsistency inside one file.
- `:39` — `language ?? settings.i18n.fallbackLocale` accepts any string from the command line
  without checking it against `i18n.locales`. In a tool whose purpose is to try a policy, being
  able to pass a language the system does not offer is the point, not a defect.
