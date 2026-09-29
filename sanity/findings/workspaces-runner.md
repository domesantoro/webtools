# workspaces-runner

Paths: `webtools/webtools-workspaces/webtools_workspaces.sh`,
`webtools/webtools-workspaces/package.json`, `webtools/webtools-workspaces/README.md`
Examined: 2026-09-26

The control script is the fourth copy: `diff` against `webtools/sso/webtools_sso.sh` returns the
eight lines that spell `webtools_workspaces`, and nothing else. Finding 1 of
`findings/sso-runner.md` (one script per subsystem and no original) and the three inherited from
`findings/preanalyst-runner.md` hold here word for word and are not counted again.

The README is the best of the subsystem READMEs on the one point `webtools/configurator/README.md`
asks for: `:19-23` names both generated copies, the deployer that writes each, and the original to
edit instead. `package.json` has a `test` script and a lock file beside it, which the sso has
neither of.

One finding, and one small one.

---

## 1. A shared module's dependency is declared by each recipient and by nothing where the module lives

- `webtools/commons/specs/spec_front_matter.js:18` — `import YAML from "yaml";`
- `webtools/commons/` contains seven directories of shared code and **no manifest**: no
  `package.json`, no statement anywhere of what any of it needs
- `webtools/configurator/specs_deployer/deploy.sh:11-26` — copies the file into
  `webtools/preanalyst/src/commons/` and `webtools/webtools-workspaces/src/commons/`, and carries
  nothing else
- The two hand-made answers: `webtools/webtools-workspaces/package.json:15-17` — `"yaml":
  "^2.9.1"`; `webtools/preanalyst/package.json` — `"yaml": "^2.9.1"`, the same range, arrived at
  separately
- Shape: **3 — member logic outside its boundary**
- Class: **the subsystems that receive `spec_front_matter.js`.** What the module needs in order to
  run is a property of the module. It is decided twice, in two `package.json` files belonging to
  two other packages, and the place that would be the boundary — `webtools/commons/specs/` — says
  nothing. The deployer, which is the only party that knows a copy is being made, copies the import
  and not the thing imported.
- It works today only because both recipients happen to agree, and the procedure that adds a third
  will not tell anybody: `webtools/configurator/README.md:226-230`, "Adding a project that receives
  a shared part", lists the new deploy function, its call, the table and the subsystem's
  documentation — four steps, none of them the dependency. A third recipient gets a file whose
  first executable line is `import YAML from "yaml"`, and in an ES module that is
  `ERR_MODULE_NOT_FOUND` at load: the subsystem does not start at all, with a message naming
  `yaml` and a file in `src/commons/` that the subsystem's author never wrote.
- The quieter half is version drift. `^2.9.1` is a range, resolved separately in two lockfiles, so
  the module can be written against a `yaml` the other recipient does not have — and the original
  is not in either lockfile's world, so nothing says which version it was written against.
- Severity: `latent` — it takes a third recipient, or a range resolved differently in the two
  lockfiles, both of which are ordinary.
- Smallest generalising change: say it where the module is. A `package.json` in `webtools/commons/`
  (or a line in each shared module's header, which the repository already uses for the "do not edit
  the copy" warning) naming what that module needs, and a line in the deployers' documented
  procedure telling the person adding a recipient to check it.

---

## 2. The README states the port two lines from where it says the port comes from Mongo

- `webtools/webtools-workspaces/README.md:11` — `./webtools_workspaces.sh --start # **port 9400**,
  in the background`
- `webtools/webtools-workspaces/README.md:25-27` — "The configuration (`listen`,
  `access.allowed_ips`, `storage.root`, `storage.spec_max_bytes`) is read at startup from
  anagraphics (`GET /configuration/workspaces`); the source is
  `webtools/configurator/configuration/workspaces.json`."
- Shape: **6 — world narrowed to fit the code**
- Class: **the values `listen.port` may hold.** The second paragraph names the class correctly, and
  says which document is the seed and which service serves the value that counts. The first
  sentence writes down the member the author's machine was running. The same document holds both.
- It is small, and it is the same shape as `findings/configurator-readme.md` 2 and
  `findings/configurator-start-stop.md` 2: the three places that print or write an address all
  reach for the seed, in a repository whose central operating rule is that the seed is not the
  value.
- Severity: `stylistic`
- Smallest generalising change: "in the background, on the port in its configuration" — or print
  it, since the server already does (`src/index.js:25-28`).

---

## Noted, not raised as findings

- Finding 1 of `findings/sso-runner.md` and the three of `findings/preanalyst-runner.md` apply
  unchanged: the fifth-of-five copied script, the possibly truncated `ps` output, the unchecked
  `SIGKILL`, and `engines: {"node": ">=20"}` (`package.json:8-10`) declared and never established
  at run time.
- `README.md:3-5` — "It stores and does not decide: that the project exists, and whose it is, is
  checked by the caller", the same boundary as `src/server.js:8-9` and `src/store.js:6-8`. Three
  statements of one requirement on callers, in the three places a caller's author might look.
- `package.json:13` — `"test": "node --test \"tests/*.test.js\""`, quoted so node expands the
  glob. `webtools/preanalyst/package.json:12` has the same command **unquoted**, so the shell
  expands it there and the command fails on a shell that errors when a glob matches nothing. Two
  spellings of one command across the class of node subsystems; the preanalyst's is unit 29.
- `README.md:7` — "Full documentation: `docs/subsystems/workspaces/README.md`". Judged at unit 70.
- `README.md:10` — "`npm install` # the first time, and after a version change", and
  `package-lock.json` is present. What runs is pinned and recorded, unlike the sso's.
