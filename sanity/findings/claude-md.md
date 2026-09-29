# claude-md

Path: `CLAUDE.md`
Examined: 2026-09-26

The document that carries the rule this audit is about, audited against it. One hundred and sixty
lines, and the rule itself — "**MANDATORY, INVIOLABLE: write for the class, never for the
instance**", with its four consequences — is written exactly as a rule should be: it names the
class, says what the defect is, says why the tests cannot catch it ("it passes the tests, because
the tests are drawn from that same instance"), and closes each of the four clauses without
exception or example. Nothing in it is drawn from a particular piece of code.

The paths it points at were all correct on the day of examination, including the two renamed
earlier today (`contesto/02. current_context.md` at `:49`, `structure/design/Sequence.drawio.pdf`
at `:50`).

Three findings, all in the operating rules below it, and all the same shape: a sentence that
describes the repository as it is today standing where a rule about every future state should be.

---

## 1. A rule about Italian is written as an inventory of the Italian that is there

- `CLAUDE.md:72-74` — "**The only Italian in the repository is in the language catalogues**
  (`webtools/commons/i18n/locales/it.json`), because that is the product speaking to its user, not
  the system speaking to itself, and in what is already closed and is kept as it was written —
  `contesto/sessions/`, `contesto/outdated/` and `workbench/`"
- Shape: **6 — world narrowed to fit the code**
- Class: **the states of the repository over time**, and, inside the sentence, **the catalogues of
  languages that gender their reader.** The sentence is wrong about both in the same breath, and in
  two different ways.
  - It is a **claim of fact** where a rule belongs. "The only Italian in the repository is X" can
    be checked at a moment and can be false at the next; "no Italian outside X" is a rule and
    cannot. The difference matters because this sentence is what a reader consults to decide
    whether something they are writing is allowed, and a claim invites them to check whether it is
    still true rather than to obey it. It is in fact false today, by one string, which this audit
    recorded as an observation and not as a finding (`findings/workspaces-tests.md`, the last
    note).
  - The parenthesis names **one file** for a class that has more than one member the rule cares
    about. Italian is named because it is the language that exists; the reason given — "that is the
    product speaking to its user" — holds for every catalogue, and the clause at `:134-138` about
    never gendering the reader says so in as many words: "It holds for **every language that agrees
    this way**". Add `fr.json` or `es.json` and the parenthesis is wrong while the reason is
    unchanged.
- The document already has the general form, twenty lines further down: `:122-123` says "Text
  addressed to the user only in the language catalogues:
  `webtools/commons/i18n/locales/<language>.json`", with the placeholder rather than a file name.
- Severity: `latent`
- Smallest generalising change: "No Italian — and no language other than English — outside the
  language catalogues (`webtools/commons/i18n/locales/<language>.json`) and what is already
  closed…". One sentence, and both the claim and the single member disappear.

---

## 2. The configuration rule names addresses and ports, and does not name the subsystem whose address and port are not configuration

- `CLAUDE.md:95-102` — "**Configuration comes from the configuration subsystem.** Every
  configurable value (**addresses, ports**, IP pools, durations, limits, prices, cookie names…) is
  served by anagraphics (`GET /configuration/{subsystem}`), never written inside the subsystem: no
  constants in the code, no environment variables, and no **default values**. The subsystem reads
  it at startup and, if a field is missing, does not start. Only the bootstrap comes from the
  environment (`webtools/configurator/bootstrap.env`). **This holds for every new piece of work.**"
- The member it does not describe: anagraphics' own listening host and port come from
  `WEBTOOLS_ANAGRAPHICS_URL` — an environment variable — via
  `webtools/anagraphics/webtools_anagraphics/settings.py:63-69,94`, and
  `webtools/configurator/configuration/anagraphics.json` has no `listen` at all, where the other
  five seed documents do
- Shape: **1 — partial-class requirement**, read from the other side: the rule is stated over the
  whole class and holds for five of its six members
- Class: **the subsystems this rule governs.** The exception is real and is defensible — the
  subsystem that serves the configuration cannot read its own listening address from itself — and
  it is written down in two other places: `webtools/configurator/bootstrap.env:8-10` and
  `docs/subsystems/anagraphics/README.md:20`. It is not written down here, in the sentence that
  ends "This holds for every new piece of work".
- What the omission costs is not anagraphics, which already exists. It is the next subsystem that
  has the same shape — a second store, a registry, anything other services must reach before they
  can read anything — whose author will read this rule and find no room in it for the case they are
  in. And it costs the reverse, too: a reader who notices the exception has no way to tell a
  reasoned exception from a violation.
- Severity: `latent`
- Smallest generalising change: one clause — "except a subsystem's own listening address where
  that subsystem is the one serving the configuration, which comes from the bootstrap" — which
  turns an unexplained exception into a stated boundary, and is what the rest of this document does
  everywhere else.

---

## 3. Two properties that a configured value decides are written as facts

- `CLAUDE.md:122-128` — "**Text addressed to the user only in the language catalogues**…
  **The fallback is English.** The language lives in **the shared cookie**…"
- What decides the first: `i18n.fallback_locale`, a configured field read by
  `webtools/commons/i18n/webtools_i18n.js:253`, validated only for being among `i18n.locales`
  (`:254-256`). Set it to `it` in Mongo and the fallback is Italian, with nothing anywhere to
  contradict it.
- What decides the second: `i18n.cookie_name`, which is **three** independent configured fields —
  one each in `preanalyst.json`, `sso.json` and `front-gate.json`, identical today and kept
  identical by nothing (`findings/configurator-configuration-rest.md` 1). The cookie is shared
  because three documents agree, not because anything makes them.
- Shape: **6 — world narrowed to fit the code**
- Class: **the configurations the system may be running under.** Both sentences describe the seed,
  which `webtools/configurator/README.md:26-28` — in this project's own words — says is not the
  value that counts: "The configuration that lives is there, not in the files… What is running may
  diverge, and that is normal." A rules document stating the seed's values as properties of the
  system is describing one member of the class the configuration exists to make variable.
- This is the fourth appearance of the same shape in the audit, after the prevalidation policy
  (`findings/configurator-policy-scope.md`, already in `summary.md`'s recurring patterns as "A
  policy states as fact something a configured value can falsify"),
  `findings/configurator-readme.md` 2, and the configuration seeds themselves. Here it is in the
  document the others are written under.
- Severity: `latent`
- Smallest generalising change: name the field instead of the value — "the fallback is
  `i18n.fallback_locale`, English today", "the language lives in the cookie named by
  `i18n.cookie_name`, which every subsystem must be configured with the same" — the second of
  which also turns an assumed invariant into a stated requirement.

---

## Noted, not raised as findings

- `:56-72` — the rule under audit, and the reason it is worth auditing against: "Recognising the
  path that works and building on it **is** that defect — not a shortcut, not a first version, not
  a pragmatic choice." Every finding in this run is an application of one of the four clauses
  beneath it, and the clauses needed no interpretation to apply.
- `:143-145` — "**Amounts in euro cents**, integers, throughout the project: data, API,
  configuration (`40000` = 400 €). Field names end in `_cents`." One currency, encoded in the
  field names, so a second is not misconfigured but unrepresentable. For a service selling in one
  country it is a scope decision rather than a narrowing, and it is stated explicitly with its
  reason (integers, no floating point), which is what the rule asks of a deliberate restriction.
  Recorded because the encoding in the field names is the strongest form the restriction could
  take.
- `:146-149` — "**Cost estimates: always the worst case** — every conversion lost after the demo,
  so **5 full pipelines per sale**… Unless explicitly asked otherwise." The 5 is a consequence of
  an assumed acceptance rate, frozen as the rule; the rule it stands for is "assume every
  conversion after the demo is lost". Stating the consequence rather than the assumption means the
  number has to be re-derived by hand if the funnel changes shape. The escape clause is what keeps
  it from being raised.
- `:89-91` — "**No generic names** for packages, modules, processes and services: prefix
  `webtools_` (e.g. `webtools_anagraphics`, never `app` or `anagraphics` on its own)."
  `webtools/anagraphics/pyproject.toml:2` is `name = "anagraphics"`. A code defect against this
  rule, noted at `findings/anagraphics-runner.md`; the rule itself is general and correctly
  formed.
- `:139-142` — "**Nothing that opens by itself.** A window, a tab or an action that starts without
  the user having asked for it is a defect, even when it is convenient." The preanalyst resumes a
  form submission automatically after a login, and the reasoning for why that is not a violation is
  written where it happens: "Whoever pressed «Manda la richiesta» had already asked to send it: the
  login was an interruption, not a change of mind"
  (`docs/subsystems/preanalyst/README.md` §6.1), together with the one case excepted from it (the
  autonomous work block appearing). A rule applied to a member that needed judgement, with the
  judgement recorded.
- `:155-160` — "**Maintaining this file**: it is updated at the end of a session, and only if
  genuinely **general** matters have come up. Matters local to a subproject stay in its own
  documentation; progress stays in the checkpoints." A rule about its own class of changes, which
  is precisely what findings 1 and 3 are: sentences describing progress and local state that have
  settled in the general document.
