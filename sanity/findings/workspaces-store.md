# workspaces-store

Path: `webtools/webtools-workspaces/src/store.js`
Examined: 2026-09-26

Ninety-nine lines, and the version-allocation routine at `:61-91` is the best piece of concurrency
reasoning in the repository. The temporary file is written with `flag: "wx"` and then `link`ed to
the version's name, so "the final file is born **already complete**" and "two concurrent writes
cannot take the same number" (`:56-60`); the retry loop treats only `EEXIST` as retryable and
rethrows everything else; the ceiling exists so that a runaway becomes an error rather than a spin
(`:20-22`); and `stamp(text, {})` is called *before* `mkdir` because "a refused file must not leave
even the project's directory behind" (`:63-65`). Four outcomes, four decisions, each with its
reason.

`SPEC_FILE = /^spec-v(\d{3,})\.md$/` at `:18` is worth singling out: the `{3,}` means the format
was written for the class of version numbers rather than for the three digits `fileName` currently
produces, so version 1000 is found and sorted correctly. That is the audited rule applied in a
regular expression.

Two findings.

---

## 1. Strict about bytes on the way in, and inventing characters on the way out

- `webtools/webtools-workspaces/src/store.js:98` —
  `text: await readFile(path.join(dir, fileName(version)), "utf8")`
- The other end of the same module's contract:
  `webtools/webtools-workspaces/src/server.js:80-85` —
  `new TextDecoder("utf-8", { fatal: true })`, with the comment "an invalid byte is an error, not a
  character silently replaced", answering `400 NOT_UTF8`
- Shape: **2 — invented value**
- Class: **the files that may be sitting in `<root>/<project_id>/specs/`.** `writeSpec` is not the
  only way one gets there, and the design is what makes that so: the root is a plain directory in
  somebody's home (`~/webtools_data/workspaces`,
  `webtools/configurator/configuration/workspaces.json:7`), named in the startup log
  (`src/index.js:26-27`) so that a person can go and look at it. A driver copying a file in, a
  restore from a backup, a file written by a future tool, a truncated write from a full disk — each
  is an ordinary member, and `readFile(…, "utf8")` turns any byte sequence that is not UTF-8 into
  U+FFFD without a word.
- The two lines contradict each other about the same question. One says a file whose bytes are not
  text is not a specification and must be refused; the other says it is a specification whose
  unreadable parts are the character `�`. The second is the one that decides what the preanalyst
  gets: `server.js:104-110` sends it as `text/markdown; charset=utf-8`, and from there it reaches
  the analysis chat and the rejection PDF (`summary.md`, `breaks-now` 9, is about exactly this
  route: `latestSpec` returning a document nobody in this system wrote).
- Severity: `latent` — it takes a file arriving in the workspace by a route other than `writeSpec`,
  which the design permits, invites and does not prevent.
- Smallest generalising change: read the bytes and decode them with the same `{ fatal: true }` the
  write path uses, and let "this stored file is not text" be an outcome with an answer of its own,
  the way `NOT_UTF8` already is on the way in.

---

## 2. The atomicity rests on hard links, and nothing says the root has to support them

- `webtools/webtools-workspaces/src/store.js:78-85` — `writeFile(temporary, …, { flag: "wx" })`
  then `link(temporary, path.join(dir, fileName(version)))`, with `EEXIST` as the only retryable
  error
- `webtools/webtools-workspaces/src/settings.js:27-35` — `absoluteRoot` establishes that
  `storage.root` is absolute (or `~`-prefixed, expanded here because "JSON does not expand `~`")
  and nothing else
- Shape: **1 — partial-class requirement**
- Class: **the filesystems `storage.root` may sit on.** `storage.root` is a configured string; the
  configuration that lives is in Mongo, so it can be pointed anywhere the process can write. Hard
  links are a capability only part of that class offers: an SMB or some NFS mounts, an exFAT or FAT
  volume on an external disk, and some container overlay configurations do not provide them, and
  `link` then fails with `EPERM`, `ENOSYS` or `EXDEV`. The comment at `:56-60` explains beautifully
  *why* `link` gives the guarantee and never says that the guarantee is conditional.
- To its credit the failure is loud rather than silent — anything but `EEXIST` is rethrown at
  `:85`. What it is not is intelligible: it arrives at `server.js:139` as
  `500 INTERNAL_ERROR` (finding 1 of `findings/workspaces-server.md`), so an operator who has
  pointed the root at a share gets, for every upload, an answer saying the fault is in the code.
- Severity: `stylistic` — the requirement is real and the code is right to have it; what is missing
  is that it is stated where the value that can break it is read. `settings.js` is the boundary
  that deals with `storage.root` and it establishes one of the two properties the store needs.
- Smallest generalising change: say it — a line in `absoluteRoot`'s comment and in
  `webtools/configurator/README.md` that the root must be on a filesystem supporting hard links —
  or establish it at startup, by doing once what `writeSpec` does every time.

---

## Noted, not raised as findings

- `:86-88` — `finally { await unlink(temporary).catch(() => {}); }`. The swallow is right on the
  success path (the content survives under the version's name, so removing the temporary is
  housekeeping) and it is the one discarded outcome in the file: a failed `unlink` leaves
  `.incoming-<uuid>.tmp` in a client's workspace for ever, invisible to `versions()` because
  `SPEC_FILE` does not match it, and unmentioned in any log.
- `:20-22` — `MAX_ATTEMPTS = 20`, a constant in the code where `CLAUDE.md` says configurable values
  come from the configuration subsystem. A different rule. The reason for the ceiling is written
  down and is the right kind of reason.
- `:18,33-34` — `fileName` pads to three digits and `SPEC_FILE` accepts three **or more**, so the
  two agree above 999. They disagree in the other direction: `spec-v0007.md` and `spec-v007.md`
  both parse as version 7, and `latestSpec` would read only the second. Unreachable through
  `writeSpec`, which never pads beyond what `fileName` produces; reachable by the same route as
  finding 1, and with the same answer.
- `:28-31` — `specsDir` re-checks `isProjectId` and throws a bare `Error` if it fails, although
  `server.js:68,101` has already checked. A guard against a future caller that forgets, and
  correctly untyped: reaching it means a caller is broken, which is what `500 INTERNAL_ERROR` says.
- `:24-26` — "The format check is also the defence against paths: an id that passes it contains
  neither `/` nor `..`, so it cannot escape the root." A security property derived from a format
  property, stated where both live, with the derivation written out rather than assumed.
- `:6-8` — "Here things are only stored: that the project exists, and whose it is, is checked by the
  caller." The same boundary the server states at `server.js:8-9`, repeated in the module that
  would otherwise be the natural place to enforce it. Recorded at unit 56.
