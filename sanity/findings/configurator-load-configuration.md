# configurator-load-configuration

Paths: `webtools/configurator/load_configuration.sh`, `webtools/configurator/bootstrap.env`
Examined: 2026-09-26

Forty-five lines of shell and seventeen of environment file, and almost all of the first is
comment: the script itself checks one prerequisite, loads the bootstrap and hands everything to
`webtools/anagraphics/scripts/load_configuration.py` — which parses its own arguments properly, so
the delegation is complete rather than partial. That file was judged at unit 47; the two findings
recorded there are not repeated here.

`bootstrap.env` states its own purpose exactly right: "the only pieces of information that are NOT
in the configuration, because they are **what reaches it**". Four variables, and two of them carry
a second meaning that the file does not mention. Those are the two findings; the third is small.

---

## 1. One value is both where anagraphics listens and where everybody dials it

- `webtools/configurator/bootstrap.env:8-10` — "Where anagraphics is. The others call it here;
  anagraphics gets from it the address and the port to listen on."
  `WEBTOOLS_ANAGRAPHICS_URL=http://127.0.0.1:9100`
- The two readers: `webtools/anagraphics/webtools_anagraphics/settings.py:63-69,94` turns it into
  the host and port to **bind**; `webtools/commons/configuration/configuration_client.js:31,44-51`
  turns it into the URL to **fetch**
- Shape: **6 — world narrowed to fit the code**
- Class: **the deployments of anagraphics.** One value can answer both questions only when the
  address a caller dials is also an address the process can usefully bind, which is true of
  `127.0.0.1` and of very little else. Anagraphics on a second machine wants to bind `0.0.0.0` or
  its interface address and be dialled at its hostname; in a container it wants to bind `0.0.0.0`
  and be dialled at the service name; behind any address translation the two are simply different
  strings. None of those is expressible: `0.0.0.0` in this variable makes every subsystem fetch
  `http://0.0.0.0:9100`, and the interface address makes anagraphics deaf on loopback.
- The system already knows the two are different questions and answers them separately for every
  other subsystem. `webtools/configurator/configuration/front-gate.json:2` has
  `"listen": {"host": "127.0.0.1", "port": 9000}` — where it binds — and `:3-7` has
  `"subsystems_infos": {"preanalyst": {"url": "http://127.0.0.1:9200"}}` — where it dials somebody
  else. Five subsystems get the distinction; the sixth is the one all five have to reach.
- This is not an argument that the system should run on more than one host. It is that the shape of
  the configuration makes the other members of the class unrepresentable rather than merely
  unconfigured, and the restriction that follows — everything on one host — is written down
  nowhere. `access.allowed_ips: ["127.0.0.1", "::1"]`
  (`webtools/configurator/configuration/anagraphics.json:3`) implies the same restriction from the
  other side, and also does not state it.
- Severity: `latent`
- Smallest generalising change: two values — a `listen` for anagraphics, in its configuration
  where every other subsystem's lives, and `WEBTOOLS_ANAGRAPHICS_URL` kept for what the name says,
  which is where the others call it. Anagraphics cannot read `listen` from the configuration it
  serves without a bootstrap, so the bootstrap would carry the `listen` and the configuration the
  callers' URL — either way, two questions, two answers.

---

## 2. One timeout variable means two different things to its two kinds of reader

- `webtools/configurator/bootstrap.env:12-13` — "How long to wait for anagraphics while reading the
  configuration, at startup." `WEBTOOLS_CONFIGURATION_TIMEOUT_MS=5000`
- The node reader, for which the comment is true:
  `webtools/commons/configuration/configuration_client.js:51` —
  `signal: AbortSignal.timeout(timeoutMs)` on the `fetch` to anagraphics
- The python reader, for which it is not:
  `webtools/anagraphics/webtools_anagraphics/settings.py:96-101,103` — the same number becomes
  `serverSelectionTimeoutMS` on a `MongoClient`, which is how long pymongo hunts for a **MongoDB**
  server. Anagraphics never waits for anagraphics.
- Shape: **3 — member logic outside its boundary**
- Class: **the readers of this variable.** There are two kinds and they are measuring two different
  things — an HTTP round trip to a local service, and a driver's topology discovery against a
  database. Nothing says so: the file documents one meaning, and `settings.py` documents the
  variable in its own header (`:8`) as "how long to wait for Mongo when reading the configuration",
  which is the opposite half. Each end is right about itself and neither knows about the other.
- It costs nothing today because 5000 happens to suit both. It costs the next person who tunes it:
  raising it because a subsystem timed out fetching its configuration also lengthens how long
  anagraphics hunts for Mongo before refusing to start; lowering it because a dead Mongo should
  fail fast also shortens every node subsystem's patience with anagraphics. The two are adjusted
  together for ever, and the file gives no hint that they are two.
- Anagraphics also already has a *configured* Mongo timeout for the same client family,
  `mongo.server_selection_timeout_ms: 30000`
  (`webtools/configurator/configuration/anagraphics.json:6`), used by `db.connect`. So the
  repository holds two answers to "how long do we wait for Mongo", 5000 and 30000, and the smaller
  one is the one named after something else.
- Severity: `latent`
- Smallest generalising change: name the two. The bootstrap keeps
  `WEBTOOLS_CONFIGURATION_TIMEOUT_MS` for the HTTP wait it is documented as; anagraphics' bootstrap
  Mongo wait gets a variable of its own, next to `WEBTOOLS_MONGO_URI` and `WEBTOOLS_MONGO_DB`,
  which is where it belongs.

---

## 3. One of the script's two prerequisites is checked and the other is not

- `webtools/configurator/load_configuration.sh:34-37` — `[[ ! -x "$PYTHON" ]]` with a message
  naming the fix, "run 'uv sync' in $ANAGRAPHICS first"
- `webtools/configurator/load_configuration.sh:39-42` — `source "$DIR/bootstrap.env"` with no
  check at all
- Shape: **5 — only the success path**
- Class: **the ways this script can be unable to run.** Two of them, one handled well and one not.
  `set -e` does stop the script on a missing `bootstrap.env`, so nothing worse happens, but what
  the operator sees is bash's own `line 41: …/bootstrap.env: No such file or directory` rather than
  a sentence — and this script is called by `start.sh:76`, which catches the non-zero exit and
  prints "Configuration not loaded: no service started." followed by a hint about **MongoDB**. The
  operator is told to look at a database that is fine.
- Every one of the five subsystem control scripts checks this exact file and says so:
  `webtools/anagraphics/webtools_anagraphics.sh:42-45`, "Startup file missing: $BOOTSTRAP".
- Severity: `stylistic` — nothing runs that should not; the wrong cause is named.
- Smallest generalising change: the four lines the five control scripts already have, before the
  `source`.

---

## Noted, not raised as findings

- `load_configuration.sh:45` — `"$@"` is passed straight through to a program that parses its
  arguments and refuses what it does not understand
  (`webtools/anagraphics/scripts/load_configuration.py:120-136`). Delegation that is complete, as
  against the partial kind recorded at `findings/configurator-deployers.md` 1.
- `load_configuration.sh:44-45` — `cd "$ANAGRAPHICS"` before `python -m scripts.load_configuration`
  is what makes the module importable, since `pyproject.toml` declares `package = false` and
  `pythonpath = ["."]`. An implicit requirement, satisfied explicitly one line before it is needed.
- `load_configuration.sh:9-27` — eighteen lines of comment stating what the script will and will
  not do to what is already in Mongo, including the sentence the whole design rests on ("a field
  removed from a file stays in Mongo, a subsystem that no longer has a file is not deleted") and
  the one operational consequence ("the subsystems read the configuration at startup: after
  changing it, whoever uses it must be restarted"). The behaviour matches; this is the boundary
  stated where it is decided.
- `bootstrap.env:16-17` — `WEBTOOLS_MONGO_URI` and `WEBTOOLS_MONGO_DB` are read by anagraphics and
  by the three scripts in `webtools/anagraphics/scripts/`, all through `settings.mongo_target()`.
  One meaning, one reader family, one place.
- The two findings against `webtools/anagraphics/scripts/load_configuration.py` — the run that
  reports nothing after rotating a key, and the secrets folder that is not there — are recorded at
  `findings/anagraphics-scripts.md` and are reached through this script.
