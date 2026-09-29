# configurator-configuration-rest

Paths: `webtools/configurator/configuration/anagraphics.json`,
`webtools/configurator/configuration/front-gate.json`,
`webtools/configurator/configuration/sso.json`,
`webtools/configurator/configuration/workspaces.json`
(and `webtools/configurator/configuration/configurator-fe.json`, which exists and is named by no
row of the inventory — examined here rather than left unlooked-at)
Examined: 2026-09-26

Five seed documents, 82 lines in all, and they do the structured-not-flat thing `CLAUDE.md` asks
for: `listen`, `access`, `subsystems_infos`, `session`, `ticket`, `login`, `limits`, `storage`,
`i18n`, each a named branch rather than a flat key. They also say things by omission and get it
right: `front-gate.json` is the only one without `access.allowed_ips`, which is correct for the
subsystem that faces the open internet, and `anagraphics.json` is the only one without `listen`,
which follows from its address living in `bootstrap.env` (recorded at
`findings/configurator-load-configuration.md` 1).

Two findings, both of the same kind: a fact that belongs to the system as a whole is written once
per subsystem, so the system can be configured into a state where its parts disagree about it.

---

## 1. The shared language cookie, and the list of languages, are decided five times

- `webtools/configurator/configuration/front-gate.json:13-19`,
  `webtools/configurator/configuration/sso.json:24-30`, and
  `webtools/configurator/configuration/preanalyst.json` — three `i18n` blocks, identical field for
  field and value for value:
  `{"body_max_bytes": 1024, "cookie_max_age_seconds": 31536000, "cookie_name": "webtools_locale",
  "fallback_locale": "en", "locales": ["en", "it"]}`
- Shape: **3 — member logic outside its boundary**, with **6 — world narrowed to fit the code**
- Class: **the facts that belong to the system rather than to a subsystem.** Two of these five
  fields are of that kind and are stated three times each.
  - `cookie_name` is the name of the **shared** cookie. `CLAUDE.md` says so: "The language lives in
    the shared cookie (and, for whoever has logged in, in the session and the profile), never in
    the URL." A cookie is shared because two parties name it the same way; here the name is a
    per-subsystem configuration field, so "shared" is a property that holds as long as three
    documents in Mongo agree, and nothing makes them agree.
  - `locales` and `fallback_locale` are the languages the product has, and the catalogues behind
    them are distributed as **one set to all three subsystems** by
    `webtools/configurator/i18n_deployer/deploy.sh:21-22`, which copies `locales/` from scratch
    precisely so that the three cannot diverge. The files are kept in step by a deployer; the list
    naming them is not kept in step by anything.
- Reachable with a change somebody is entitled to make, and quiet when it happens: edit
  `i18n.cookie_name` for the sso alone in Mongo, and a user who picks Italian on the login page
  gets a cookie the preanalyst does not read — the choice simply does not travel, with no error
  anywhere. Add a locale to the preanalyst's `locales` and not to the front-gate's, and the
  language switcher offers different languages on different pages of one site.
- `cookie_max_age_seconds` and `body_max_bytes` are arguably per-subsystem and are not the
  complaint.
- Severity: `latent`
- Smallest generalising change: put what is common where it is common. There is no shared
  configuration document today —
  `webtools/anagraphics/scripts/load_configuration.py:104-105` makes one document per file — so
  either a `commons.json` seed that every subsystem reads alongside its own, or the three shared
  fields move into the one place the catalogues already live and are served from there. Either
  way, one statement, not three.

---

## 2. Where the preanalyst is, is written four times, and twice in the same list

- `webtools/configurator/configuration/sso.json:18-20` —
  `"login": {"allowed_next": ["http://127.0.0.1:9200", "http://localhost:9200"]}`
- `webtools/configurator/configuration/front-gate.json:3-7` —
  `"subsystems_infos": {"preanalyst": {"url": "http://127.0.0.1:9200"}}`
- `webtools/configurator/configuration/preanalyst.json` — the same host and port again, as its own
  `listen`
- Shape: **4 — capability inferred from resemblance**
- Class: **the addresses at which one subsystem may be reached.** The tell is inside the value: two
  entries for one destination, differing only in whether the host is spelled `127.0.0.1` or
  `localhost`. That is a list of *spellings*, not of destinations, which means the question the sso
  is answering after a login — "is this `next` the preanalyst?" — is answered by string comparison
  against however many spellings somebody remembered. `http://[::1]:9200` is the same place and is
  not in the list; so is the machine's own hostname, which is what a second developer on the same
  LAN would type.
- And the address itself is a fact about the preanalyst that three documents repeat. Change
  `listen.port` in the preanalyst's configuration in Mongo — the operation this project treats as
  normal — and the preanalyst moves, the front-gate's link to it breaks, and the sso starts
  refusing the `next` after every login, while `webtools/configurator/start.sh:120-122` prints the
  new port because it reads the seed file (recorded at `findings/configurator-start-stop.md` 2).
  Three failures, three places to edit, no error naming the cause.
- Severity: `latent` — one configuration value edited in Mongo.
- Smallest generalising change: state a subsystem's address once and let the others refer to it.
  `subsystems_infos` is already the named branch for "where somebody else is"; `allowed_next`
  becomes the set of subsystems allowed to receive a login rather than a set of strings, and the
  comparison becomes one between addresses rather than between spellings.

---

## Noted, not raised as findings

- `front-gate.json` has no `access.allowed_ips`, where the other four do. That is the correct
  answer for the one subsystem on the open internet, and it is an absence rather than an empty
  list — absent is absent. It is not stated anywhere in the file that the omission is deliberate;
  the subsystem's own settings module is where that boundary would be established, and that was
  judged at unit 40.
- `workspaces.json:7` — `"root": "~/webtools_data/workspaces"`, a `~` in a JSON value that nothing
  in JSON or in `fs` expands. `webtools/webtools-workspaces/src/settings.js:27-35` expands it
  explicitly, says in a comment why ("JSON does not expand `~`: it is done here, because the root
  sits in the home of…"), and refuses a value that is neither absolute nor `~`-prefixed. A
  partial-class property handled at the boundary that deals with it, with the other outcome
  refused rather than guessed. The opposite of the defect being hunted.
- `sso.json:8` and `configurator-fe.json:8` — `subsystems_infos.anagraphics.timeout_ms: 5000`, a
  third and fourth appearance of the number 5000 for "how long to wait", after
  `bootstrap.env:13` and the three literals in `webtools/anagraphics/scripts/`. These two are a
  genuinely different wait (a running call to anagraphics, not a startup read) and are configured
  where they are used, which is right; the coincidence of value is noted only because
  `findings/anagraphics-scripts.md` 5 and `findings/configurator-load-configuration.md` 2 are about
  the other appearances.
- `front-gate.json:8-12` — `screen_infos.pricing.standard_price_cents: 40000`, in cents as
  `CLAUDE.md` requires, and stated in exactly one document: `preanalyst.json` carries no price. The
  fact that has the most obvious reason to be duplicated is the one that is not.
- `configurator-fe.json:11-13` — `"secrets": {"directory": "../configurator/secrets"}`, a relative
  path in a configuration document, whose meaning depends on what the process's working directory
  is when it resolves it. `configurator-fe` has no row in the inventory and is not audited here
  beyond noting the value.
- Row 53 of `sanity/inventory.md` names four files; the directory holds six
  (`preanalyst.json` is unit 10, `configurator-fe.json` is in no row). The inventory is not
  recomputed by this audit; `configurator-fe.json` was read here so that it is not left unexamined,
  and the gap is on the record here and at `findings/configurator-deployers.md`.
