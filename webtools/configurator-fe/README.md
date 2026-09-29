# configurator-fe — the configuration, to look at

The configuration that **lives** is in Mongo, in the `configuration` collection; the files in
`webtools/configurator/configuration/` are the seed and the expected shape. To see what is actually
running one had to read Mongo by hand, subsystem by subsystem. This is the page that shows it.

**Two pages, and they are two on purpose.** `/` is read: it says what is running, and it is opened
precisely when something has to be checked. `/providers/pricing` is the one that changes something
— the price of what a provider's model consumes, one key — and the forms are there and not in the
middle of a reading. Every other value stays what it was: edit the file, run
`webtools/configurator/load_configuration.sh` (which adds only the missing fields), restart whoever
reads it.

```sh
./webtools_configurator_fe.sh --start     # then http://127.0.0.1:9500
./webtools_configurator_fe.sh --stop
```

The two `pricing.*` fields arrived with the prices: an instance started without them does not start
at all, as with any missing field. `webtools/configurator/load_configuration.sh` brings them in.

It is in `webtools/configurator/start.sh`, last, and in `stop.sh`, first: nothing depends on it and
it needs only anagraphics to be up. It was outside both while it was a page that only read — a page
nobody could reach cost nothing but the look at it. It writes one thing now, and a service that is
not running is a price that cannot be entered. It still starts and stops on its own with the
commands above, for when only it is wanted.

## What `/` shows

**General matters**

| | |
|---|---|
| Bootstrap | the `WEBTOOLS_*` variables **this process** received. They are not configuration: they are what reaches it (`webtools/configurator/bootstrap.env`) |
| Subsystems | one row per document in Mongo: where it listens, how many fields, how many secret |
| Shared values | the leaves that more than one subsystem holds **with the same value**, worked out by comparing the documents. A path held with different values is a divergence, not a shared value, and does not appear |
| Secrets | whether the secrets' folder was read, and what could not be read of it |

**Providers** — one row per **door**: a place where a subsystem asks a model of a provider, with
that model and the price of its tokens **as it is stored**. Nothing on this page writes: the link
goes to the page that does.

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

## `/providers/pricing` — the prices

The page that writes, and the only thing written from this front end.

A **door** is a place where a subsystem asks a model of a provider: an object hanging from a
`providers` branch — `<anything>.providers.<name>` — that names a `model`, wherever in the document
that branch is (`preanalyst.conversation.providers.anthropic`). The list comes out of the documents, so
a door added tomorrow is here without a line being written.

**An object under a `providers` branch that names no model is not a door**, and is on neither page's
list. Nothing is asked of a provider through it, and there is no model whose tokens could have a
price. `providers.anthropic` in metrics is one: it declares which kinds of token that provider
counts, for the measurements metrics accepts — metrics calls no model and has no key. It is read
where its document is read, in its subsystem's section on `/`. Listing it under a heading called
"providers" would say it is a provider in use, which it is not. What it declares is still what the
kinds of token come from, and the page names it there: *declared in `metrics.providers.anthropic`*.

Each door can be given the **price of what its model consumes**: one amount per kind of token, in
hundredths of the currency's unit, per million tokens. `1500` with `USD` is 15.00 dollars per
million. Written into that provider object, in Mongo:

```json
"pricing": {
  "currency": "USD",
  "cents_per_million_tokens": {"input": 1500, "output": 7500, "cache_write": 1875, "cache_read": 150},
  "updated_at": "2026-09-26T10:22:31Z"
}
```

`updated_at` is the date of the last change of the price and the currency, and anagraphics writes
it: it is a record of when the write happened, not a field to fill in.

**Why it is not on `/`.** A page that shows the configuration and a page that changes it are two
different things to be looking at. A form in the middle of a reading is a click away from a write
nobody meant, and it turns a page opened to check something into a page that can alter it. The two
link to each other, and `/` lists the prices it finds — reading them is part of reading the
configuration; writing them is not.

**One amount per kind, and the kinds come from the provider.** Two kinds of token are not the same
thing — input and output do not cost the same — and one amount for both would be a rate between
them that nobody decided. So the form asks for one amount per kind, and the kinds are the ones the
provider declares in `token_kinds`, wherever in the configuration that declaration is. There is no
list of kinds in this subsystem.

**Where it is written, and where it is not.** The price of the same model asked by two doors is two
prices: each door has its own provider object, and they can differ. Nothing here makes them agree —
they are next to each other under the provider's name, which is where a divergence is read.

Three cases where a door is shown and no price is asked for, and each says which one it is:

| | |
|---|---|
| No `token_kinds` for that provider anywhere | We do not know what to ask an amount for |
| `token_kinds` declared differently in two places | Same: a disagreement is not a set of kinds to choose from |
| The `pricing` comes from `secrets/` | What is written into Mongo would be replaced at the next `load_configuration.sh` |

**The amounts and the currency.** An amount left empty is a kind that is not priced: it is left out
of what is written, and no amount is put in its place. A form with every amount empty writes
nothing — removing a price is another thing to do, and this page does not do it. The currency is
chosen from `pricing.currencies` in this subsystem's configuration, with nothing selected until one
is: there is no default currency. A currency already stored that is not among them is offered all
the same, marked `(stored)`, so that redisplaying the form does not change it in silence.

**A kind that is stored and is no longer declared** is still a field of the form, marked `not
declared`. The write replaces the price whole: a kind left out of the form would be dropped from
what is stored, and dropping a price nobody asked to drop is not a form filling itself in.

**The route.** `POST /providers/pricing`, the only one that writes, which sends anagraphics
`PUT /configuration/{subsystem}/pricing` (§6.22 of its documentation). Anagraphics is the one that
checks the path names a provider object — the document is there, not here — and writes the
`pricing` key and nothing else. The answer is a redirect back to this same page, which says what
happened next to the form it happened to: so a reload re-reads the configuration instead of writing
the same price again under a new date.

The seed files carry no prices. A new environment is born without them, which is what it is: nobody
has said what a token costs yet.

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
| `pricing.currencies` | the currencies a price may be written in, in the order the dropdown offers them |
| `pricing.body_max_bytes` | the ceiling of the one body this server reads, the form that writes a price |

## The files

| | |
|---|---|
| `src/index.js` | start: reads the configuration, then listens |
| `src/settings.js` | the configuration, checked field by field |
| `src/server.js` | the routes: `GET /`, `GET`/`POST /providers/pricing`, and the files of `public/` |
| `src/anagraphics.js` | `GET /configuration` and `PUT /configuration/{subsystem}/pricing`, with the answers' shape checked at the boundary |
| `src/providers.js` | the provider objects, their kinds of token and their prices: what both pages show and what the second refuses to ask |
| `src/pricing_form.js` | the form that writes a price, read at the boundary |
| `src/secrets.js` | which paths come from the secrets' files |
| `src/leaves.js` | what a leaf of a configuration document is — one place, because both of the above need the same answer |
| `src/view.js` | from the documents to what the pages show: `buildView` for `/`, `buildPricingView` for the prices |
| `src/page.js` | rendering, nunjucks with autoescape on |
| `templates/layout.njk` | the shell both pages share: the head, the bar at the top, the frame |
| `templates/value.njk` | the macro that prints one value, used by both |
| `templates/configuration.njk` | `/`: the configuration, read |
| `templates/pricing.njk` | `/providers/pricing`: the prices, written |
| `public/styles.css` | the style |
| `src/commons/configuration_client.js` | **generated copy**: the original is `webtools/commons/configuration/`, the deployer is `webtools/configurator/deploy.sh configuration` |

```sh
npm test     # 74 tests: the view, the secrets, the server, the providers and the form
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
