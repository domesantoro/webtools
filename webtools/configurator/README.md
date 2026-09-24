# configurator — startup and deployers

Here live the programs that **start the system**, the **configuration of every subsystem** and the
programs that **distribute the shared parts** into the subsystems that use them.

## The configuration

Every configurable value of a subsystem (addresses, ports, IP pools, durations, limits, prices,
cookie names…) lives in **one JSON file per subsystem**, in `configuration/`:

| File | Who reads it |
|---|---|
| `configuration/anagraphics.json` | anagraphics, straight from Mongo |
| `configuration/sso.json` | the sso |
| `configuration/workspaces.json` | webtools-workspaces |
| `configuration/preanalyst.json` | the preanalyst |
| `configuration/front-gate.json` | the front-gate |

The files are **structured**: the fields are grouped by subject (`listen`, `access`,
`subsystems_infos`, `session`, `limits`, …), they are not written flat. The `subsystem` field is
not written: the file's name gives it. What the fields mean is in the documentation of the
subsystem that reads them.

`load_configuration.sh` brings them into anagraphics' `configuration` collection, which serves them
with `GET /configuration/{subsystem}`. **The configuration that lives is there, not in the files**:
these are the seed — the values a new environment is born with — and the expected shape, that is,
which fields exist. What is running may diverge, and that is normal.

For this reason the loading adds **only the fields that are missing**: a field that is there is not
touched whatever its value, a field taken out of a file stays in Mongo, a subsystem with no file
any more is not deleted. A new field introduced by a piece of development enters by itself at the
first startup, and nothing that has been changed in service is lost. It says so while it does it:

```
Configuration of 'webtools': 5 subsystems read from configuration/
  preanalyst: added prevalidation.max_underspecified_attempts
```

To go back to the files one has to ask — `./load_configuration.sh --reset [subsystem …]` — and it
is the only way: it deletes those subsystems' changes and takes them back to what the file says. A
new field is to be added to the file **as well**, or the next environment will be born without it.

Nothing is loaded if even a single file is not valid JSON.

Every subsystem reads its configuration **at startup**, and **has no default values**: if the
document is missing, or a field is missing or is of the wrong type, it writes
`webtools_<name> is not starting: …` in the log with the field's path and exits with 1. The Node
subsystems read it with the shared client `commons/configuration/configuration_client.js` (see
below, the `configuration` deployer).

### Bootstrap

`bootstrap.env` holds the only pieces of information that cannot live in the configuration, because
they are what reaches it:

| Variable | What it is for |
|---|---|
| `WEBTOOLS_ANAGRAPHICS_URL` | Where anagraphics is. The others call it here; anagraphics gets its listening host and port out of it |
| `WEBTOOLS_CONFIGURATION_TIMEOUT_MS` | How long to wait while reading the configuration, at startup |
| `WEBTOOLS_MONGO_URI`, `WEBTOOLS_MONGO_DB` | Anagraphics' database, where the configuration lives too |

The control scripts (`webtools_*.sh --start`) and `load_configuration.sh` load it. For starting by
hand in the foreground: `set -a; source webtools/configurator/bootstrap.env; set +a`.

### Changing a value

```sh
$EDITOR webtools/configurator/configuration/sso.json
webtools/configurator/start.sh --restart     # loads the configuration and restarts everything
```

A running service goes on with the configuration read when it started: with no restart a change has
no effect.

## Starting and stopping everything

```sh
webtools/configurator/start.sh             # starts what is not already up
webtools/configurator/start.sh --restart   # stops the ones that are up first, then restarts everything
webtools/configurator/stop.sh              # stops everything, in reverse order
```

`stop.sh` stops every service with its own control script (a PID file and a verified command line,
never by name or by port). A service that is already off is not an error; if one does not stop, it
goes on with the others and at the end the script exits with 1.

Before starting, `start.sh` runs `load_configuration.sh`: if the configuration does not load (for
instance because MongoDB is off) it stops there, starting nothing. The addresses it prints it reads
from `configuration/*.json` and from `bootstrap.env`, it does not keep a copy of its own.

The startup order is `anagraphics` → `sso` → `workspaces` → `preanalyst` → `front-gate`: the first
holds the data, the second authenticates, the third keeps the projects' files, the fourth uses all
three, and the showcase site comes last because it is the front door. On stopping it goes the other
way round, so that nobody is left running talking to a service that is no longer there. If a
service does not start, one stops there: starting the ones after it would only fill the logs with
errors.

**Without `--restart` a service that is already up is not touched**: its script answers "already
running" and things go on. `--restart` is for when the code has been changed and the running
instances are the old ones.

Every service is started and stopped **with its own control script**, which stops only the process
of the PID file after checking its command line. Nothing is searched for by name or by port in
here: other projects run on this machine.


## Distributing the shared parts

The shared parts live in `webtools/commons/` and are the original. What ends up inside the
subsystems are **generated copies**, which are not edited there: the original is edited and the
deployer is run again.

```sh
webtools/configurator/deploy.sh            # every sub-deployer, in the order written in deploy.sh
webtools/configurator/deploy.sh style      # the style only
webtools/configurator/deploy.sh style sso  # only the ones named
```

A name that does not exist exits with code 2 and prints the list of the ones available.

## The sub-deployers

| Name | Script | What it distributes | To whom |
|---|---|---|---|
| `style` | `style_deployer/deploy.sh` | `commons/style/commons.css` and `commons/style/fonts/` | front-gate, preanalyst, sso |
| `template` | `template_deployer/deploy.sh` | `commons/templates/*.njk`: the pages' shared shell, the language switcher, the loader | preanalyst, sso; front-gate only `locale_switch.njk` |
| `script` | `script_deployer/deploy.sh` | `commons/script/*.js`, the shared **browser** JavaScript (today the loader) | preanalyst, sso, front-gate (in `public/`) |
| `documents` | `documents_deployer/deploy.sh` | `configurator/documents/*.njk` and `configurator/policies/*.md`: the shape of the documents the system produces and the criteria of the decisions | preanalyst (in `templates/commons/` and `policies/`) |
| `i18n` | `i18n_deployer/deploy.sh` | `commons/i18n/webtools_i18n.js` and **all** the `commons/i18n/locales/*.json` catalogues | preanalyst, sso, front-gate (in `src/commons/i18n/`) |
| `sso` | `sso_deployer/deploy.sh` | `commons/sso/sso_client.js` (the server) and `commons/sso/sso_popup.js` (the browser) | preanalyst |
| `specs` | `specs_deployer/deploy.sh` | `commons/specs/spec_front_matter.js`, the specifications' front matter | preanalyst, webtools-workspaces (in `src/commons/`) |
| `configuration` | `configuration_deployer/deploy.sh` | `commons/configuration/configuration_client.js`, the configuration's client | sso, webtools-workspaces, preanalyst, front-gate (in `src/commons/`) |

The sso does **not** receive the sso's client: it is the service, not a consumer of it. In the same
way anagraphics does not receive the configuration's client: it is the one serving it. The shared
templates it does receive, because its pages use the same shell too.

The templates arrive in `templates/commons/` and are extended with
`{% extends "commons/base.njk" %}`.

All the pages' texts, of every subsystem, live in the catalogues of `commons/i18n/locales/` (one
file per language, English keys split by area): it is the only place where one translates or adds
a language. A key missing from one language is taken from the fallback language
(`i18n.fallback_locale`, English). The language chosen lives in the `i18n.cookie_name` cookie,
shared by every subsystem.
To check that every key used exists, and to see what is left to translate:
`node webtools/commons/i18n/webtools_i18n_check.mjs`.

## The secrets

The API keys are configuration like everything else, but `configuration/` is in git. So they live
in **`secrets/`**, which is not in git: one file per subsystem, with the same name and the same
nested shape as the configuration file.

`load_configuration.sh` **deep-merges** them onto the configuration file before writing the
document into Mongo: the secret's keys sit beside the configuration's without deleting the
neighbouring branches, and the subsystem reads a single configuration from
`GET /configuration/{subsystem}` without knowing that a piece of it was secret.

```sh
cd webtools/configurator/secrets
cp preanalyst.json.example preanalyst.json    # then the real value goes in
cd .. && ./load_configuration.sh && ./start.sh --restart
```

Only the folder's `README.md` and the `*.example` files stay in git.

## The documents and the policies

Two things that look like code and are not:

- **`documents/`** — the **shape** of the documents the system produces: today `prespec.md.njk`,
  the pre-specification's template;
- **`policies/`** — the criteria of the decisions, that is, what a model is asked and by what rules
  it answers: today `scope-v1.md`, the prevalidation's policy.

They say what the system considers acceptable and what its documents look like: they are
configuration, so they live here, and generated copies go into the subsystems (the `documents`
deployer). **Which** policy is used is said by the subsystem's configuration
(`prevalidation.policy`), not by the deployer.

The policies' copies carry at their head an HTML comment with the «do not edit here» warning:
whoever sends them to a model strips the leading comments, so the warning does not end up in the
prompt.

One limit of `prespec.md.njk`: it is coupled to `preanalyst/src/prespec.js`, which passes it the
variables. The document's shape can be changed, but fields the code does not send cannot be
invented.

## How they are made

Every sub-deployer has **one function per project**, with the destinations written out in full:

```sh
deploy_preanalyst() {
  local public="$WEBTOOLS/preanalyst/public"
  echo "→ preanalyst"
  cp "$SOURCE/commons.css" "$public/commons.css"
  ...
}
```

No loops over a list of folders: the projects' structure differs from project to project (one is a
static site, the others are Node servers) and not everybody receives everything. Writing the
destinations one by one costs three lines and reads without having to guess anything.

The general deployer does not know what the sub-deployers do: it only knows which ones exist and in
what order they run. To add one, the folder with its `deploy.sh` is created and an entry is added
to the `DEPLOYERS` list in `deploy.sh`.

## Adding a project that receives a shared part

A new function in the right sub-deployer, plus its call at the bottom of the script. Then the table
above and the subsystem's documentation are to be updated, which must say which of its files are
generated copies.
