# configurator-fe — the configuration, to look at

The configuration that **lives** is in Mongo, in the `configuration` collection; the files in
`webtools/configurator/configuration/` are the seed and the expected shape. To see what is actually
running one had to read Mongo by hand, subsystem by subsystem. This is the page that shows it.

**Read-only.** There is no form, no route that writes, and no method other than `GET`. Changing a
value stays what it was: edit the file, run `webtools/configurator/load_configuration.sh` (which
adds only the missing fields), restart whoever reads it.

```sh
./webtools_configurator_fe.sh --start     # then http://127.0.0.1:9500
./webtools_configurator_fe.sh --stop
```

It is not in `webtools/configurator/start.sh`: it is instrumentation for looking at the system, and
it is started and stopped on its own, when it is wanted. It only needs anagraphics to be up.

## What the page shows

**General matters**

| | |
|---|---|
| Bootstrap | the `WEBTOOLS_*` variables **this process** received. They are not configuration: they are what reaches it (`webtools/configurator/bootstrap.env`) |
| Subsystems | one row per document in Mongo: where it listens, how many fields, how many secret |
| Shared values | the leaves that more than one subsystem holds **with the same value**, worked out by comparing the documents. A path held with different values is a divergence, not a shared value, and does not appear |
| Secrets | whether the secrets' folder was read, and what could not be read of it |

**One section per subsystem**, with the whole document as a tree: the branches in the order they are
in the document, the leaves with their value.

The sections are the subsystems that are **in Mongo**, not the ones that have a file: a subsystem
whose seed file has been removed goes on living in the collection, and it is here.

### Reading hints

Beside a value, never in place of it, and only where the project's own naming conventions say what
the number is:

| Field | Shown |
|---|---|
| `…_cents` | the amount in euro — `40000` → `400.00 €` |
| `…_seconds` | the duration — `28800` → `8 h` |
| `…_ms` | the duration, from a second up — `5000` → `5 s` |

A field with none of those endings is shown bare. There is no hint for `port`, for `max_turns` or
for anything else whose unit is not written in its name: inventing one would be reading a number by
what it looks like.

### The secrets

The keys live in `webtools/configurator/secrets/`, outside git, and `load_configuration.sh`
deep-merges them into the document before writing it into Mongo. So they are **in** what this page
reads.

A field is masked — `(secret, 108 characters)` — when its path is one of those files' paths. The
mask comes from **where the field comes from**, not from what it is called: a `client_id` written in
a secrets file is masked, an `api_key` written in `configuration/` is not, because that one is in
git and is not a secret at all. The value is not read: `src/secrets.js` takes the *shape* of those
files, never their contents.

If the folder is not there — a fresh clone, a machine with no keys — nothing is known to be secret
and nothing is masked, and the page says so in as many words, so that an unmasked page is not read
as a page with no secrets in it.

Two more things it points out: a path a secrets file declares and Mongo does not hold (usually
`load_configuration.sh` has not been run since the file was written), and a secrets file whose
subsystem has no configuration at all.

## Where it gets it from

`GET /configuration` on anagraphics, which returns every document in the collection. It is the only
source: **the list of the subsystems that exist is in Mongo**, not here — a list written in this
subsystem's configuration would be a copy going stale, and would hide exactly the subsystem one
comes here to look for.

Mongo is not touched directly: anagraphics is the one that holds the data.

If anagraphics does not answer, the page is produced all the same and says what went wrong. Whoever
opens this page opens it precisely when something is not answering.

## Configuration

Read at startup from anagraphics, `GET /configuration/configurator-fe`. The source is
`webtools/configurator/configuration/configurator-fe.json`. No defaults: if the document, or a
field, is missing, the server writes `webtools_configurator_fe is not starting: …` with the field's
path and exits with 1.

| Field | What it is |
|---|---|
| `listen.host`, `listen.port` | where it listens (9500) |
| `access.allowed_ips` | who is answered. Only the connection's IP counts |
| `subsystems_infos.anagraphics.timeout_ms` | how long to wait for anagraphics when reading |
| `secrets.directory` | the secrets' folder, to know **which paths** are secret. A relative path is resolved from this subsystem's folder |

## The files

| | |
|---|---|
| `src/index.js` | start: reads the configuration, then listens |
| `src/settings.js` | the configuration, checked field by field |
| `src/server.js` | the routes: `GET /` and the files of `public/` |
| `src/anagraphics.js` | `GET /configuration`, with the answer's shape checked at the boundary |
| `src/secrets.js` | which paths come from the secrets' files |
| `src/leaves.js` | what a leaf of a configuration document is — one place, because both of the above need the same answer |
| `src/view.js` | from the documents to what the page shows |
| `src/page.js` | rendering, nunjucks with autoescape on |
| `templates/configuration.njk` | the page |
| `public/styles.css` | the style |
| `src/commons/configuration_client.js` | **generated copy**: the original is `webtools/commons/configuration/`, the deployer is `webtools/configurator/deploy.sh configuration` |

```sh
npm test     # 33 tests: the view, the secrets, the server
```

## Why not the shared shell, and why no catalogues

The pages of the product extend `templates/commons/base.njk` and take every sentence from
`webtools/commons/i18n/locales/`. This page does neither, and it is a deliberate exception:

- it is **internal instrumentation**, read by whoever runs the system, not by a client. Its labels —
  `access.allowed_ips`, `bootstrap`, `secret` — are system terms, and the project writes everything
  internal in English;
- the shared shell asks for the language, the translation and the language switcher, which is the
  machinery of a page of the product. Bringing it in here would mean adding this subsystem to three
  deployers to show a table of fields.

If this page ever stops being instrumentation — if it is ever shown to anybody but whoever runs the
system — that reasoning stops holding and the texts belong in the catalogues.
