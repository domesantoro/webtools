# configurator-readme

Paths: `webtools/configurator/README.md`, `webtools/configurator/secrets/README.md`
Examined: 2026-09-26

Two hundred and fifty-five lines, and they are where the project's most important operating rule is
written most clearly: "**The configuration that lives is there, not in the files**: these are the
seed — the values a new environment is born with — and the expected shape, that is, which fields
exist. What is running may diverge, and that is normal" (`:26-28`). Everything that follows from it
— only the missing fields are added, a field taken out of a file stays in Mongo, a subsystem with
no file is not deleted, `--reset` is the only way back and you have to ask for it — is stated
correctly and matches the code.

The sub-deployer table at `:140-147` was checked row by row against the eight scripts and every
destination in it is right, including the two exceptions (front-gate receives only
`locale_switch.njk`; anagraphics and the sso each receive nothing from the deployer that would be
circular). `:207-220` states the reason the deployers enumerate their targets by hand, which is the
audited rule in its own words: "not everybody receives everything".

Two findings, both of the same kind: a sentence written from the environment in front of the
author, in the document that exists to say what the environment may be.

---

## 1. A guarantee about `deploy.sh` that the script does not give

- `webtools/configurator/README.md:134` — "A name that does not exist exits with code 2 and prints
  the list of the ones available."
- `webtools/configurator/deploy.sh:50-65` — that happens only when **no** requested name matches.
  `./deploy.sh style templates` runs the style deployer, prints "Deploy done (1 sub-deployers)."
  and exits 0.
- Shape: **6 — world narrowed to fit the code**
- Class: **the argument lists the sentence is about.** The sentence is written as a property of
  "a name that does not exist", which is a property of one name; the script's behaviour is a
  property of the whole list. For the member where the two differ — some names known, some not —
  the sentence is false, and it is false in the direction that matters: it promises a refusal where
  there is a silent partial success.
- What makes this worth recording as a finding rather than as a typo is that the sentence is the
  reason the code defect is invisible. An operator who has read this README has a written guarantee
  that the command refuses what it does not understand, so a "Deploy done" line is exactly what
  they expect to see, and they do not go and check whether `templates/commons/` changed.
- The code-side entry is counted once, as `breaks-now` 17 in `summary.md`
  (`findings/configurator-deployers.md` 1); what is counted here is the written guarantee.
- Severity: `latent` — the README is wrong today about a reachable case; the harm is realised
  through the script, and that is already counted.
- Smallest generalising change: either fix the script, which makes the sentence true, or write what
  the script does — "names that do not exist are ignored; if none matches, it exits with code 2".
  A sentence describing one member of a class should say which member.

---

## 2. Twice, the document that states the Mongo rule then writes as fact something Mongo can falsify

- `webtools/configurator/README.md:103-104` — "The addresses it prints it reads from
  `configuration/*.json` and from `bootstrap.env`, **it does not keep a copy of its own**." The
  files are the seed. Reading them *is* reading a copy — the one copy the same document says at
  `:26-28` may have diverged from what is running. `webtools/configurator/start.sh:61-62` makes the
  same claim in the same words and is recorded at `findings/configurator-start-stop.md` 2; here it
  is repeated as documentation, so both the code and the explanation of the code state it.
- `webtools/configurator/README.md:159-160` — "The language chosen lives in the `i18n.cookie_name`
  cookie, **shared by every subsystem**." There is no shared `i18n.cookie_name`: there are three
  independent fields of that name, in `preanalyst.json`, `sso.json` and `front-gate.json`, which
  hold the same string today and are kept equal by nothing
  (`findings/configurator-configuration-rest.md` 1). The sentence asserts a system-wide invariant
  that the shape of the configuration cannot enforce.
- Shape: **6 — world narrowed to fit the code**
- Class: **the states the configuration in Mongo may be in.** This README is the place where that
  class is defined, at `:26-28`, and both sentences are written as though the class had one member
  — the one where Mongo matches the files and the three `i18n` blocks match each other, which is
  the state of the machine the author was sitting at.
- The cost of the second is the larger one, because it is a claim a reader will build on: the next
  subsystem that needs the language will be written to read "the shared cookie", and will read
  whatever its own configuration document happens to say the shared cookie is called.
- Severity: `latent` — a configuration value edited in Mongo, which the protocol counts as a change
  somebody is entitled to make.
- Smallest generalising change: for the first, say what is printed and where it comes from ("the
  addresses come from the seed files; a value changed in Mongo is not reflected"). For the second,
  either move the shared fields somewhere shared and then the sentence becomes true, or write that
  every subsystem must be configured with the same cookie name — which turns an assumed invariant
  into a stated requirement.

---

## Noted, not raised as findings

- `:35-38` — the sample output reads "Configuration of 'webtools': **5** subsystems read from
  `configuration/`", and `configuration/` holds six files, the sixth being
  `configurator-fe.json`, which the table at `:13-18` of this same README lists. A sample that was
  true when it was written and cannot be produced now. Small, and exactly the shape of the rule:
  written from the instance in front of the author.
- `:46-48` — "Every subsystem reads its configuration at startup, and **has no default values**".
  One site in the repository contradicts it, `webtools/sso/src/settings.js:48`
  (`settings.allowedNext[0] ?? "/"`), already recorded at
  `findings/sso-settings-index-page.md`. The claim is otherwise borne out.
- `:149-151` — "In the same way anagraphics does not receive the configuration's client: it is the
  one serving it. **The shared templates it does receive**, because its pages use the same shell
  too." The nearest antecedent of "it" is anagraphics, which receives no templates and renders no
  pages; the sentence is true only if "it" means the sso, two sentences earlier. An ambiguity, in a
  paragraph whose whole job is to say who receives what.
- `:197-199` — "The policies' copies carry at their head an HTML comment with the «do not edit
  here» warning: whoever sends them to a model strips the leading comments." Accurate, and checked
  at both ends (`documents_deployer/deploy.sh:27-35`,
  `webtools/preanalyst/src/analyst.js:52`). The paragraph says nothing about `prespec.md.njk`,
  whose copy carries the same warning at the **bottom** for a reason written into that file
  (`:46-47`); a reader of this README would not know the two are handled differently.
- `:226-230`, "Adding a project that receives a shared part" — a stated procedure for a class of
  change, which is what documentation is for. It covers the deployer, the table and the subsystem's
  own documentation. It does not mention that a new *service* also has to be added to two more
  hand-written lists, `start.sh:38-44` and `stop.sh:22-28`
  (`findings/configurator-start-stop.md` 1) — though the section's title scopes it to receiving a
  shared part, so this is a gap in coverage rather than an error.
- `:181` — "Only the folder's `README.md` and the `*.example` files stay in git."
  `webtools/configurator/secrets/.gitignore` is also in git, which is what makes the rule work.
- `secrets/README.md:12-15` — the example path, `prevalidation.providers.anthropic.api_key`, is
  correct and matches `secrets/preanalyst.json.example` and the `prevalidation` branch of
  `configuration/preanalyst.json`. The equivalent sentence in
  `webtools/anagraphics/scripts/load_configuration.py:60-61` still says
  `ai.providers.anthropic.api_key`, the path used before the rename recorded in `summary.md` under
  "Resolved while this audit was running". A stale comment in the script, noted here because the
  two documents are the same statement and only one was updated.
- `secrets/README.md` — 25 lines that say what the folder is, why it exists, what deep-merging
  means, what is in git and what has to be re-run afterwards. Nothing to report.
