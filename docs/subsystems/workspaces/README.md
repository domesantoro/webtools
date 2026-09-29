# Subsystem `webtools-workspaces`

> Code: `webtools/webtools-workspaces/`. Document current as of 2026-09-29, version 0.3.0.

## 0. Quick sheet

| | |
|---|---|
| Role | Stores a project's files in its workspace: the specifications it receives, and the documents the system writes (§2) |
| Technology | Node ≥ 20, `node:http`, one dependency (`yaml`) |
| Port | **9400** (`listen.port` of the configuration) |
| Configuration | Read at startup from anagraphics (`GET /configuration/workspaces`). No defaults: if it is missing, the server does not start (§4) |
| Start / stop | `webtools/webtools-workspaces/webtools_workspaces.sh --start` / `--stop` |
| PID / Log | `webtools_workspaces.pid` / `webtools_workspaces.log`, in the subsystem's directory |
| Data | Filesystem, under `storage.root` of the configuration (today `~/webtools_data/workspaces`) |
| Who calls it | `webtools_preanalyst`, server to server. The documents' routes were built for `webtools_analyst`, which does not call them yet |
| Tests | `npm test`: 18 tests, no service running |

## 1. Role

**It stores and does not decide.** It writes the files it receives and returns the last one of a
family. It does not check that the project exists, nor whose it is: the caller does that, before
sending the file. It is the same division as anagraphics.

It does not render anything either. A document arrives already written: whoever produces it holds
the template — the preanalyst renders the pre-specification, the analyst renders the analysis and
the proposal — and what arrives here is the `.md`.

Why a service and not a shared directory: when the machines are separated, the disk will belong to
one machine only. On top of that, the defence against manipulated paths lives in one place.

## 2. The files on disk

```text
<storage.root>/
└── <project_id>/
    ├── specs/
    │   ├── spec-v001.md
    │   └── spec-v002.md              ← the last one counts
    └── documents/
        ├── analysis/
        │   └── analysis-v001.md
        └── proposal/
            └── proposal-v001.md
```

**Two families, because two different things are kept.** A specification *arrives* — rendered from
the form, or uploaded by the client — so where it came from and who sent it are part of what is
recorded about it. A document is *produced by us* for that project, one kind per directory: there is
no origin to record, because everything under `documents/` was written by the system, and nobody
uploaded it. The two families have separate routes, separate size limits and separate version
numbers.

- **The kinds of document are a closed list**: `analysis` and `proposal` (`DOCUMENT_KINDS` in
  `src/store.js`). A kind outside it is refused with `INVALID_KIND`, which also keeps a kind out of
  the path: what passes the list contains neither `/` nor `..`, as for the `project_id`.
- **`prespec` is deliberately not a kind.** The pre-specification is a specification and is stored
  by `POST /projects/{id}/specs`. Accepting it here as well would give one kind two places to be,
  with no rule about which of the two counts.
- A project's workspace is born with the first file stored for it.
- `storage.root` sits **outside the repo**: these are the clients' files, not code.
- The `project_id` must be a UUID in canonical lowercase form. The check lives in
  `commons/specs/spec_front_matter.js` (`isProjectId`) and is also the defence against paths: an id
  that passes it contains neither `/` nor `..`.

### 2.1 Versions

Every write is a new version and nothing is overwritten. The numbers are counted **per family**:
the second analysis is `analysis-v002.md` whatever the specifications have reached, because one
sequence shared by three kinds would make the numbers of each jump. The file is born **already complete**: a
temporary one (`.incoming-<uuid>.tmp`) is written and then linked to the version's name with
`link`, which fails if that name already exists. In that case the next number is tried, up to 20
times. As a result:

- two concurrent writes never take the same number;
- whoever reads the last version never finds a half-written file.

The stem of the file name (`spec`, `analysis`, `proposal`) is in the name of every file, so a file
says which family it belongs to even when it is read far from the directory it was written in.

### 2.2 The reserved key `webtools:`

In the front matter of every saved file the service writes the reserved key. **What it holds
depends on the family**, because the two have different things to record.

A specification:

```yaml
webtools:
  origin: third_party        # system | third_party
  version: 2
  received_at: 2026-09-21T15:39:01.466Z
  uploaded_by: 8ff93901-673e-44ba-b05b-56011395dcba
```

A document:

```yaml
webtools:
  version: 2
  written_at: 2026-09-29T09:12:44.108Z
```

The key is **always** rewritten, and whatever the file declared in there is discarded. For a
specification `origin` is decided by the caller, according to the channel the file arrived through:
- `system`: the pre-specification generated by the form;
- `third_party`: an uploaded file.

An uploaded file declaring `origin: system` is saved as `third_party`. The rest of the front matter
and the body stay as they are.

A document has **neither an origin nor an uploader**, and neither is missing by omission. Under
`documents/` there is only one origin, so a field repeating it on every file of every kind would
say nothing; and there is no person to name — a run of the analyst has no session behind it, and an
identifier put there to fill the field would be invented. What the document is, and which template
it was written against, are in its own front matter, written by whoever rendered it (`kind:`,
`template:`).

A file with no front matter is given one holding the reserved key alone. A broken front matter
(invalid YAML, or not a map) is refused **before** the disk is touched: not even the project's
directory is left behind.

## 3. API

For programs only. Errors: correct HTTP status and a stable code, `{"error": "<CODE>"}`.

### 3.1 `POST /projects/{project_id}/specs`

Body: the `.md` as it is. Required headers:
- `X-Spec-Origin: system | third_party`;
- `X-Uploaded-By: <uid>`.

| Outcome | Status | Body |
|---|---|---|
| Saved | `201` | `{"project_id": …, "version": N}` |
| Invalid id | `400` | `INVALID_PROJECT_ID` |
| Origin missing or unknown | `400` | `INVALID_ORIGIN` |
| `X-Uploaded-By` missing | `400` | `MISSING_UPLOADER` |
| Empty body | `400` | `EMPTY_SPEC` |
| Not UTF-8 | `400` | `NOT_UTF8` |
| Broken front matter | `400` | `INVALID_FRONT_MATTER` |
| Over `storage.spec_max_bytes` | `413` | `SPEC_TOO_LARGE` (we answer first, then close) |

### 3.2 `GET /projects/{project_id}/specs/latest`

The last version, `text/markdown`, with the `X-Spec-Version` header. If the project has no
specifications, `404 SPEC_NOT_FOUND`. The later steps need it.

### 3.3 `POST /projects/{project_id}/documents/{kind}`

Body: the `.md`, already rendered. **No headers**: nothing arrives here from outside, so there is no
origin to declare and no person to name. `kind` is `analysis` or `proposal`.

| Outcome | Status | Body |
|---|---|---|
| Saved | `201` | `{"project_id": …, "kind": …, "version": N}` |
| Invalid id | `400` | `INVALID_PROJECT_ID` |
| Kind outside the closed list (including `prespec`) | `400` | `INVALID_KIND` |
| Empty body | `400` | `EMPTY_DOCUMENT` |
| Not UTF-8 | `400` | `NOT_UTF8` |
| Broken front matter | `400` | `INVALID_FRONT_MATTER` |
| Over `storage.document_max_bytes` | `413` | `DOCUMENT_TOO_LARGE` (we answer first, then close) |

### 3.4 `GET /projects/{project_id}/documents/{kind}/latest`

The last version of that kind, `text/markdown`, with the `X-Document-Version` header. If the project
has no document of that kind, `404 DOCUMENT_NOT_FOUND`; if the kind does not exist,
`400 INVALID_KIND`.

### 3.5 Shared

`403 IP_NOT_ALLOWED` outside the pool, `404 ROUTE_NOT_FOUND`, `405 METHOD_NOT_ALLOWED`,
`500 INTERNAL_ERROR`.

## 4. Configuration

The server reads its configuration **at startup** from anagraphics,
`GET /configuration/workspaces`. The source is `webtools/configurator/configuration/workspaces.json`;
`webtools/configurator/load_configuration.sh` loads it into Mongo (`start.sh` already does that). No
defaults: if the document or a field is missing, the server prints
`webtools_workspaces is not starting: …` with the field's path and exits with 1. After a change:
`webtools/configurator/start.sh --restart`.

Only `WEBTOOLS_ANAGRAPHICS_URL` and `WEBTOOLS_CONFIGURATION_TIMEOUT_MS` come from the environment,
and `--start` loads them from `webtools/configurator/bootstrap.env`. Debugging in the foreground:
`set -a; source ../configurator/bootstrap.env; set +a; npm start`.

| Field | Today | |
|---|---|---|
| `listen.host` | `127.0.0.1` | |
| `listen.port` | `9400` | |
| `access.allowed_ips` | `["127.0.0.1", "::1"]` | The pool: an exact comparison on the connection's IP |
| `storage.root` | `~/webtools_data/workspaces` | Absolute, or starting with `~/` (expanded in the home of whoever starts the server) |
| `storage.spec_max_bytes` | `10485760` (10 MB) | A file that arrives from outside |
| `storage.document_max_bytes` | `10485760` (10 MB) | The same figure as the specifications, and a field of its own rather than one limit read twice: the two families have different provenances, so one of the two can be moved without the other |

## 5. Files

```text
webtools/webtools-workspaces/
├── package.json
├── webtools_workspaces.sh     # --start / --stop, PID with a verified command line
├── src/
│   ├── index.js               # startup: reads the configuration, or exits with 1
│   ├── settings.js            # the `workspaces` configuration from anagraphics → the server's settings
│   ├── server.js              # routes and error codes
│   ├── store.js               # the filesystem: the two families, versions, atomic write, reading
│   └── commons/               # GENERATED COPIES from the deployers: not edited here
│       ├── configuration_client.js   # from configurator/configuration_deployer
│       └── spec_front_matter.js      # from configurator/specs_deployer
└── tests/
    ├── store.test.js          # front matter, versions, stamp, concurrency, the kinds
    └── api.test.js            # the routes, on a temporary root
```

After a clone, `npm install` is needed in this directory.

## 6. Known limits

- **Authentication between services**: there is only the IP pool, as for anagraphics and the sso.
- **No deletion**: versions pile up. Even a project deleted from anagraphics leaves its workspace
  behind, if it had one.
- **No list of versions** and no reading of a particular version: today only the last one is needed.
- **Nobody reads `template:`.** Every document declares which template it was written against, and
  no reader uses it to decide how to treat what it is reading. What happens when a template changes
  and a document written against the old one is opened has no answer
  (`contesto/analyst_considerations.md` §14.2).
- **No backup** of the root.

## 7. Changelog

| Date | Version | Change |
|---|---|---|
| 2026-09-29 | 0.3.0 | **The documents the system writes.** `POST /projects/{id}/documents/{kind}` and `GET /projects/{id}/documents/{kind}/latest`, with the kinds closed to `analysis` and `proposal`, a version sequence and a size limit of their own (`storage.document_max_bytes`), and a reserved key with no origin and no uploader. The specifications' routes are untouched: no migration, and the preanalyst was not modified. New metric `document.written`. 18 tests. |
| 2026-09-21 | 0.2.0 | **Configuration from the configuration subsystem.** At startup `GET /configuration/workspaces` is read from anagraphics (shared client `commons/configuration/configuration_client.js`); gone are `HOST`, `PORT`, `ALLOWED_IPS`, `WORKSPACES_ROOT`, `SPEC_MAX_BYTES` and their defaults. Without configuration the server does not start. |
| 2026-09-21 | 0.1.0 | Creation: `POST /projects/{id}/specs` and `GET /projects/{id}/specs/latest`, versions with atomic writes, the reserved `webtools:` key in the front matter, 13 tests. |
