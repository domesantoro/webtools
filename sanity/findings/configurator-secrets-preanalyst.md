# configurator-secrets-preanalyst

Paths: `webtools/configurator/secrets/preanalyst.json.example`,
`webtools/configurator/secrets/preanalyst.json` (read for structure only; no value was read or
recorded)
Examined: 2026-09-25

**Nothing to report against the class rule.**

What was checked:

- The two files have the same structure, and both track the `ai.*` → `prevalidation.*` move made
  during this run. The example is a usable statement of the expected shape, not a stale one.
- Each of the three AI engines carries **its own** `api_key`, at
  `prevalidation.providers.anthropic`, `analyst.conversation.providers.anthropic` and
  `analyst.validation.providers.anthropic`. That is the general case honoured in the configuration:
  the three engines are independent, and nothing forces them to share a key. It is also what makes
  the client-caching finding at
  `webtools/preanalyst/src/prevalidator_ai/providers/anthropic.js:74-89` matter — a second engine
  on that module would get the first one's key, and this file shows the keys are genuinely meant
  to differ.
- The secrets directory is properly closed: `webtools/configurator/secrets/.gitignore` ignores
  everything and re-admits only `.gitignore`, `README.md` and `*.example`. `git check-ignore`
  confirms the real `preanalyst.json` is ignored.
- No key anywhere in `configuration/`, which is the rule.

---

## Noted, not raised as findings

- `webtools/configurator/secrets/.gitignore:1` — the comment is in Italian ("I segreti non vanno in
  git. Restano l'esempio e il README."), against the `CLAUDE.md` rule that everything internal is
  written in English. A different rule from the one this audit enforces, recorded because it was
  read here.
- The example's placeholder values (`sk-ant-the-real-key-of-the-prevalidator`, and the two others)
  name which engine each key belongs to. That is a good example file: it teaches that the three are
  not the same key.
