# Inventory

Run started: 2026-09-25
Branch at start: `preanalyst-chat`
Total units: 72 (66 to audit, 6 skipped groups listed at the bottom)

Computed once. **Never recompute.** Resume at the first `pending` row.

Order: working-tree / today's work first, then subsystem by subsystem
(`preanalyst`, `sso`, `front-gate`, `anagraphics`, `configurator`, `webtools-workspaces`,
`commons`), then `docs/` and `CLAUDE.md`.

| # | unit slug | path(s) | status | note |
|---|-----------|---------|--------|------|
| 1 | preanalyst-analyst | webtools/preanalyst/src/analyst.js | done | |
| 2 | preanalyst-analyst-ai | webtools/preanalyst/src/analyst_ai/webtools_analyst_ai.js, webtools/preanalyst/src/analyst_ai/providers/anthropic.js | done | |
| 3 | preanalyst-analysis-validator | webtools/preanalyst/src/analysis_validator.js | done | |
| 4 | preanalyst-prevalidator-ai | webtools/preanalyst/src/prevalidator_ai/webtools_prevalidator_ai.js, webtools/preanalyst/src/prevalidator_ai/providers/anthropic.js | done | renamed from src/ai/ during the run; module also renamed to webtools_prevalidator_ai.js |
| 5 | preanalyst-settings | webtools/preanalyst/src/settings.js | done | |
| 6 | preanalyst-server | webtools/preanalyst/src/server.js | done | |
| 7 | preanalyst-page | webtools/preanalyst/src/page.js | done | |
| 8 | preanalyst-template-analysis | webtools/preanalyst/templates/analysis.njk | done | |
| 9 | preanalyst-script-analyse | webtools/preanalyst/scripts/analyse.js | done | |
| 10 | configurator-configuration-preanalyst | webtools/configurator/configuration/preanalyst.json | pending | |
| 11 | configurator-secrets-preanalyst | webtools/configurator/secrets/preanalyst.json.example, webtools/configurator/secrets/preanalyst.json | pending | |
| 12 | configurator-policies-analysis | webtools/configurator/policies/analysis-v1.md, webtools/configurator/policies/analysis-validation-v1.md | pending | copies in webtools/preanalyst/policies/ |
| 13 | commons-i18n-locales | webtools/commons/i18n/locales/en.json, webtools/commons/i18n/locales/it.json | pending | copies in each subsystem |
| 14 | preanalyst-tests-ai-analyst | webtools/preanalyst/tests/prevalidator_ai.test.js, webtools/preanalyst/tests/analyst.test.js | pending | ai.test.js renamed to prevalidator_ai.test.js during the run |
| 15 | preanalyst-styles | webtools/preanalyst/public/styles.css | pending | |
| 16 | preanalyst-prevalidator | webtools/preanalyst/src/prevalidator.js, webtools/preanalyst/scripts/prevalidate.js | pending | |
| 17 | preanalyst-anagraphics-client | webtools/preanalyst/src/anagraphics.js | pending | |
| 18 | preanalyst-questions | webtools/preanalyst/src/questions.js | pending | |
| 19 | preanalyst-prespec | webtools/preanalyst/src/prespec.js | pending | |
| 20 | preanalyst-driver-link | webtools/preanalyst/src/driver_link.js | pending | |
| 21 | preanalyst-ambassador-project-driver | webtools/preanalyst/src/ambassador.js, webtools/preanalyst/src/project_driver.js | pending | |
| 22 | preanalyst-workspaces-client | webtools/preanalyst/src/workspaces.js | pending | |
| 23 | preanalyst-rejection-pdf | webtools/preanalyst/src/rejection_pdf.js | pending | |
| 24 | preanalyst-index | webtools/preanalyst/src/index.js | pending | |
| 25 | preanalyst-public-js | webtools/preanalyst/public/analysis.js, gate.js, rejection.js, upload.js | pending | |
| 26 | preanalyst-templates | webtools/preanalyst/templates/*.njk (page, message, login_done, macros/, partials/, fragments/) | pending | |
| 27 | configurator-policy-scope | webtools/configurator/policies/scope-v1.md | pending | copy in webtools/preanalyst/policies/ |
| 28 | preanalyst-tests-rest | webtools/preanalyst/tests/prevalidator.test.js, webtools/preanalyst/tests/server.test.js | pending | |
| 29 | preanalyst-runner | webtools/preanalyst/webtools_preanalyst.sh, webtools/preanalyst/package.json | pending | |
| 30 | sso-server | webtools/sso/src/server.js | pending | |
| 31 | sso-auth | webtools/sso/src/auth.js | pending | |
| 32 | sso-sessions-tickets | webtools/sso/src/sessions.js, webtools/sso/src/tickets.js | pending | |
| 33 | sso-credentials | webtools/sso/src/credentials.js | pending | |
| 34 | sso-anagraphics-client | webtools/sso/src/anagraphics.js | pending | |
| 35 | sso-settings-index-page | webtools/sso/src/settings.js, src/index.js, src/page.js | pending | |
| 36 | sso-templates | webtools/sso/templates/login.njk, webtools/sso/templates/register.njk | pending | |
| 37 | sso-tests | webtools/sso/tests/*.js | pending | |
| 38 | sso-runner | webtools/sso/webtools_sso.sh, package.json, public/styles.css | pending | |
| 39 | front-gate-server | webtools/front-gate/src/server.js | pending | |
| 40 | front-gate-settings-index-page | webtools/front-gate/src/settings.js, src/index.js, src/page.js | pending | |
| 41 | front-gate-templates | webtools/front-gate/templates/*.njk | pending | |
| 42 | front-gate-public | webtools/front-gate/public/js/main.js, webtools/front-gate/public/css/styles.css | pending | |
| 43 | front-gate-runner | webtools/front-gate/webtools_front_gate.sh, package.json | pending | |
| 44 | anagraphics-main | webtools/anagraphics/webtools_anagraphics/main.py | pending | |
| 45 | anagraphics-db | webtools/anagraphics/webtools_anagraphics/db.py | pending | |
| 46 | anagraphics-settings-credentials-errors | webtools/anagraphics/webtools_anagraphics/settings.py, credentials.py, errors.py, __main__.py | pending | |
| 47 | anagraphics-scripts | webtools/anagraphics/scripts/load_configuration.py, seed.py, migrate_pipeline.py, migrate_user_billing.py | pending | |
| 48 | anagraphics-tests | webtools/anagraphics/tests/test_api.py, test_load_configuration.py | pending | |
| 49 | anagraphics-runner | webtools/anagraphics/webtools_anagraphics.sh, pyproject.toml | pending | |
| 50 | configurator-deployers | webtools/configurator/deploy.sh, */deploy.sh | pending | |
| 51 | configurator-start-stop | webtools/configurator/start.sh, webtools/configurator/stop.sh | pending | |
| 52 | configurator-load-configuration | webtools/configurator/load_configuration.sh, webtools/configurator/bootstrap.env | pending | |
| 53 | configurator-configuration-rest | webtools/configurator/configuration/{anagraphics,front-gate,sso,workspaces}.json | pending | |
| 54 | configurator-documents | webtools/configurator/documents/prespec.md.njk | pending | copy in webtools/preanalyst/templates/commons/ |
| 55 | configurator-readme | webtools/configurator/README.md, webtools/configurator/secrets/README.md | pending | |
| 56 | workspaces-server | webtools/webtools-workspaces/src/server.js | pending | |
| 57 | workspaces-store | webtools/webtools-workspaces/src/store.js | pending | |
| 58 | workspaces-settings-index | webtools/webtools-workspaces/src/settings.js, src/index.js | pending | |
| 59 | workspaces-tests | webtools/webtools-workspaces/tests/api.test.js, tests/store.test.js | pending | |
| 60 | workspaces-runner | webtools/webtools-workspaces/webtools_workspaces.sh, package.json, README.md | pending | |
| 61 | commons-configuration-client | webtools/commons/configuration/configuration_client.js | pending | copies in every subsystem |
| 62 | commons-i18n-lib | webtools/commons/i18n/webtools_i18n.js, webtools/commons/i18n/webtools_i18n_check.mjs | pending | copies in every subsystem |
| 63 | commons-sso-client | webtools/commons/sso/sso_client.js, webtools/commons/sso/sso_popup.js | pending | copies in preanalyst |
| 64 | commons-loader | webtools/commons/script/webtools_loader.js | pending | copies in every subsystem public/ |
| 65 | commons-specs | webtools/commons/specs/spec_front_matter.js | pending | copies in preanalyst, workspaces |
| 66 | commons-templates | webtools/commons/templates/base.njk, loader.njk, locale_switch.njk | pending | copies in every subsystem |
| 67 | commons-style | webtools/commons/style/commons.css | pending | copies in every subsystem |
| 68 | docs-preanalyst | docs/subsystems/preanalyst/README.md | pending | |
| 69 | docs-anagraphics | docs/subsystems/anagraphics/README.md | pending | |
| 70 | docs-sso-workspaces | docs/subsystems/sso/README.md, docs/subsystems/workspaces/README.md | pending | |
| 71 | subsystem-readmes | webtools/{preanalyst,sso,front-gate,anagraphics}/README.md | pending | |
| 72 | claude-md | CLAUDE.md | pending | |

## Skipped

| slug | path(s) | reason |
|------|---------|--------|
| generated-copies-commons | webtools/*/src/commons/**, webtools/*/public/{commons.css,webtools_loader.js,sso_popup.js}, webtools/*/templates/commons/**, webtools/front-gate/public/css/commons.css | Generated copies of `webtools/commons/` originals; audited at the original (units 61–67). |
| generated-copies-policies | webtools/preanalyst/policies/*.md | Generated copies of `webtools/configurator/policies/`; audited at the original (units 12, 27). |
| build-artefacts | webtools/anagraphics/**/__pycache__/**, webtools/anagraphics/.pytest_cache/** | Compiled/cache artefacts, not source. |
| lock-and-runtime-files | webtools/anagraphics/uv.lock, webtools/*/*.pid, webtools/anagraphics/webtools_anagraphics.log | Lock file, runtime PID files and a log; excluded by the audit perimeter. |
| os-artefacts | **/.DS_Store | macOS Finder artefacts. |
| gitignore-files | webtools/configurator/secrets/.gitignore | Not behaviour-bearing. |
