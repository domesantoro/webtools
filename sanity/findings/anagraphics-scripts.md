# anagraphics-scripts

Paths: `webtools/anagraphics/scripts/load_configuration.py`,
`webtools/anagraphics/scripts/seed.py`,
`webtools/anagraphics/scripts/migrate_pipeline.py`,
`webtools/anagraphics/scripts/migrate_user_billing.py`
Examined: 2026-09-26

`load_configuration.py` is the code behind one of the strongest paragraphs in `CLAUDE.md` — the
configuration that lives is in Mongo, the files are the seed and the expected shape — and it
implements it carefully: `add_missing` refuses to overturn `null`, `0` or `false` because they are
"values like any other" (`:76-77`), it descends only where both sides have an object, a subsystem
with no file is left where it is and reported as such (`:186-189`), and the two rules (a seed
fills, a secret replaces) are kept in two separate dictionaries precisely so they cannot be
confused (`:98-101`). `migrate_user_billing.py` argues out loud why a credit is born at zero rather
than absent, and why absent would be worse.

The findings are the places where that same standard is not applied: a report that enumerates one
kind of change, a missing directory read as a decision, an argument recognised by one spelling, and
— in the file that says inventing would be worse than not having — one invented value.

---

## 1. A run that changed a secret reports that nothing changed

- `webtools/anagraphics/scripts/load_configuration.py:179-184` —
  `document, added_paths = add_missing(stored, seed)`, then `document = merge(document, secret)`,
  then `if document != stored: collection.replace_one(...)`; only `added_paths` is recorded
- `webtools/anagraphics/scripts/load_configuration.py:198-199` —
  `if not created and not updated_fields and not restored: print("  nothing to add: what is
  running stays as it is")`
- Shape: **5 — only the success path**, in its reporting half
- Class: **the changes a run of this script can make.** There are three: a subsystem created, seed
  fields added, and a secret replaced. The report counts the first two. The third is the one the
  script's own docstring says the mechanism exists for: "an API key is not a value the system
  changes, and that file is the only place anybody writes it — **if you rotate it, the new one must
  be the one that counts**" (`:24-27`).
- Rotate a key in `webtools/configurator/secrets/preanalyst.json` and run it: `add_missing` finds
  nothing missing and returns `added_paths == []`, `merge` puts the new key in, `document !=
  stored` is true, `replace_one` writes it — and the script prints *"nothing to add: what is
  running stays as it is"*. The one sentence the operator reads says the opposite of what happened,
  on the one operation where being sure matters, and there is no second place to check: the key is
  not printed and is not in git.
- Severity: `breaks-now` — reachable with the code and configuration exactly as they stand, on the
  ordinary use of the secrets mechanism. The consequence is bounded: the key does land; the
  operator is told it did not, and will reasonably try again or go looking for a fault that is not
  there.
- Smallest generalising change: `merge` already knows which leaves it replaced — have it return
  them, the way `add_missing` returns `added_paths`, and print them as paths without values
  (`preanalyst: replaced ai.providers.anthropic.api_key`). Failing that, at minimum do not print
  "nothing" when `replace_one` ran.

---

## 2. A secrets folder that is not there is read as "no secrets were asked for"

- `webtools/anagraphics/scripts/load_configuration.py:110` —
  `if secrets is not None and secrets.is_dir():`, with no `else`
- Shape: **5 — only the success path**, with **2 — invented value**: the absence is filled with the
  empty dictionary `keys.get(subsystem, {})` at `:166`
- Class: **the outcomes of being given a secrets path.** There are three, and the caller
  distinguished two of them already by passing the argument or not: not asked for, asked for and
  present, asked for and not there (deleted, renamed, a file rather than a directory, a typo in the
  script that calls this one). The third collapses onto the first, silently, and the run reports
  success.
- Two things follow from it, and the second is the one that matters. On a first load the document
  goes into Mongo without the API key, and the preanalyst then refuses to start with "field
  missing" — loud, if misdirected. On `--reset`, `:175` runs
  `collection.replace_one({"subsystem": …}, merge(seed, {}))`: the stored key is **replaced by the
  seed**, which does not contain it, and the key that existed only in that untracked file and in
  Mongo is gone from both. The script reports "taken back to the file", which is true and is not
  the thing the operator needed to know.
- Severity: `latent` — `webtools/configurator/secrets/.gitignore` is tracked, so the directory
  exists on a fresh clone; reaching it takes the directory being moved, emptied of its `.gitignore`
  or misspelled by the caller.
- Smallest generalising change: if the path was given and is not a directory, refuse — the script
  already refuses for a file that is not valid JSON, for a secret with no matching configuration
  (`:112-115`) and for an empty folder (`:106-107`). This is the same class of mistake and the only
  one that passes.

---

## 3. Every argument except one exact spelling means "write to the database"

- `webtools/anagraphics/scripts/migrate_pipeline.py:29` — `dry_run = "--dry-run" in sys.argv[1:]`
- `webtools/anagraphics/scripts/migrate_user_billing.py:33` — the same line
- Shape: **6 — world narrowed to fit the code**, with **5 — only the success path**
- Class: **the command lines these scripts may be given.** The code recognises one member and maps
  every other member of an infinite class — `--dryrun`, `--dry_run`, `-n`, `--help`, `dry-run`, a
  stray shell glob, a path pasted from the previous command — onto the branch that writes. There is
  no unknown-argument outcome, so there is no way for the script to say it did not understand.
- What that costs is asymmetric in the worst direction: the only thing a wrong spelling can do is
  turn a rehearsal into a live migration of every project or every user in
  `WEBTOOLS_MONGO_DB`, with `$unset: {"state": ""}` in the first case. A migration is exactly the
  kind of program where the rehearsal exists because the operator is not sure, and it is the kind
  that is run once, by hand, possibly against production.
- `load_configuration.py:120-136` in the same directory does it right: it parses its arguments, and
  a command line it does not understand is answered with the usage and exit code 1.
- Severity: `breaks-now` — reachable today, with no change to code or configuration: any argument
  that is not the exact string `--dry-run` runs the migration for real.
- Smallest generalising change: parse the arguments the way the neighbouring script does — accept
  `--dry-run`, refuse anything else with the usage line — so that "I did not understand you" is one
  of the outcomes.

---

## 4. The file that refuses to invent the steps invents the state

- `webtools/anagraphics/scripts/migrate_pipeline.py:42` —
  `state = project.get("state") or "PREANALYSIS"`, with the comment "A project without `state`
  should not exist; if there is one, it starts from the beginning."
- Ten lines above it, `:14-15`: "`steps` is born empty: of the projects that already exist we do
  not know which steps they went through, **and inventing them would be worse than not having
  them**."
- Shape: **2 — invented value**
- Class: **the project documents this migration may meet.** The reasoning that produced `steps: []`
  is the rule applied exactly: what we do not know is left absent. Three lines of code later the
  same unknown — where this project actually was — is filled with a value that is not merely made
  up but is the most consequential one available: `PREANALYSIS` is the start of the flow, so a
  project whose `state` was lost is recorded as never having begun. Nothing downstream can tell
  that apart from a project that really is at the beginning, because the whole point of the
  migration is that both end up written the same way.
- "Should not exist" is the instance speaking. The projects this script will meet are the ones that
  predate the `pipeline` object, which is precisely the set nobody has a full account of — that is
  why `steps` is empty.
- Severity: `latent` — it takes a project with no `state` field, which the author believes there is
  none of, and which nothing checks.
- Smallest generalising change: migrate what is there and report what is not — print the ids with
  no `state` and leave them for a person, which is the same answer `steps: []` gives to the same
  question.

---

## 5. Three scripts, three copies of a timeout, and two configured values for the same wait

- `webtools/anagraphics/scripts/load_configuration.py:157`,
  `webtools/anagraphics/scripts/migrate_pipeline.py:32`,
  `webtools/anagraphics/scripts/migrate_user_billing.py:35` — `serverSelectionTimeoutMS=5000`,
  written out in each
- The values that exist for the same question: `WEBTOOLS_CONFIGURATION_TIMEOUT_MS=5000`
  (`webtools/configurator/bootstrap.env:13`), which `settings.py:96-101` uses for exactly this
  parameter on exactly this database; and `mongo.server_selection_timeout_ms: 30000`
  (`webtools/configurator/configuration/anagraphics.json:6`), which `db.connect` uses for the
  running server
- Shape: **2 — invented value**, with **6 — world narrowed to fit the code**
- Class: **the Mongo deployments these scripts may be pointed at.** The URI comes from
  `mongo_target()` (`settings.py:88-90`), so the database can be anywhere; the wait is fixed at the
  number that suits the one on `localhost`. Every one of the three scripts already imports
  `mongo_target` from the module that reads the configured timeout two functions away, and takes
  the URI from it and not the timeout.
- `CLAUDE.md` is explicit that durations are configuration and that there are no default values in
  the code. Beyond that rule, this one has the shape the audit is about: the number is right for
  the member in front of the author, it is written three times so the three can drift, and the
  system already holds two different official answers to the same question.
- Severity: `latent`
- Smallest generalising change: read `WEBTOOLS_CONFIGURATION_TIMEOUT_MS` in the one helper the
  three scripts already share, next to `mongo_target()`.

---

## Noted, not raised as findings

- `seed.py:13-15` — `PROJECTS` seeds a document with a `project_id` and nothing else: no
  `owner_uid`, no `submission_id`, no `pipeline`. It is a real member of the projects collection in
  every environment, and it is a shape no reader of a project can handle —
  `webtools/preanalyst/src/server.js` reads `project.pipeline?.state` and `project.owner_uid` and
  gets `undefined` for both. It is inert today, because an owner of `undefined` matches no session,
  so nothing reaches it. Test data in the live collection is a question about the seed, not a
  departure from the audited rule; noted because the collection's class of documents is wider than
  any reader's.
- `seed.py` has no `--dry-run` and no argument handling at all, where both migrations have one.
  Three scripts that write to whatever `WEBTOOLS_MONGO_DB` names, and a rehearsal offered by two of
  them. The same observation as `findings/front-gate-runner.md` finding 2, one severity lower,
  because the seed is idempotent and additive.
- `load_configuration.py:139-202` — `ConfigurationError` is caught around the arguments and the
  files (`:140-146`) and not around the Mongo work. A database that does not answer ends the script
  with a traceback after some subsystems have been written and before the report is printed. For
  the ordinary run that is recoverable (adding missing fields is idempotent); for `--reset` it
  leaves some subsystems restored and some not, with no record of which.
- `load_configuration.py:24-27` — the secrets always replace, and nothing removes. A key deleted
  from the secrets file stays in Mongo for ever. Rotation is provided for and retirement is not;
  the docstring claims only the first.
- `migrate_user_billing.py:38,46` — the projection asks for `uid` and the update uses
  `user["uid"]`. A user document without `uid` (which the unique index permits for one document)
  raises `KeyError` mid-loop, after some users have been migrated. The same partial-run shape as
  the note above.
- `migrate_user_billing.py:14-19` — the clearest statement in the repository of the difference
  between absent and zero, and of why the field is created rather than left to `$inc`. It is the
  argument finding 4 of this unit fails to apply.
- `load_configuration.py:51-52` — a seed file that contains `subsystem` is refused, because the
  file name is what gives it. One fact, one place, stated.
