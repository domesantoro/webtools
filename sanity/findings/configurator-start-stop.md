# configurator-start-stop

Paths: `webtools/configurator/start.sh`, `webtools/configurator/stop.sh`
Examined: 2026-09-26

Two short scripts that are unusually careful about the things `CLAUDE.md` is explicit about: every
service is started and stopped **through its own control script**, nothing is looked up by name or
by port, a service already running is left alone and said so, and `start.sh:111-112` carries a
comment explaining why `(( restart )) && stop_all` would have been a bug under `set -e`. `stop.sh`
handles the whole class of outcomes: a service already down is not an error, a service that will
not stop is collected and the script exits 1 naming it.

One boundary is worth recording before the findings, because it is the rule applied rather than
broken. `webtools/configurator-fe/` is a running node subsystem with its own control script and
its own configuration seed, and it is in neither list — deliberately, and it is written down:
"it is read-only — it changes nothing — and it is **started on its own, not by `start.sh`**"
(`webtools/configurator/README.md:78-83`). A member left out of a set, with the reason stated
where the set is described.

---

## 1. "Stop everything" exists twice, derived in one place and copied in the other

- `webtools/configurator/start.sh:38-44` — `SERVICES`, five entries, in startup order
- `webtools/configurator/start.sh:84-95` — `stop_all()` walks that same array **backwards**
  (`for (( i = ${#SERVICES[@]} - 1; i >= 0; i-- ))`), so the shutdown order is derived from the
  startup order and cannot disagree with it
- `webtools/configurator/stop.sh:22-28` — a second `SERVICES`, the same five, written out in the
  reverse order by hand
- Shape: **6 — world narrowed to fit the code**
- Class: **the services of the system.** There is one such set, and the repository states it twice.
  `start.sh` treats the reverse order as a *consequence* of the forward order, which is exactly
  right and is argued at `:7-11`; `stop.sh` treats it as a second fact. A sixth service added to
  `start.sh` and not to `stop.sh` is then started by one command and left running by the other,
  while `stop.sh` prints "System stopped."
- The duplication is not only of the list. The two procedures disagree about outcomes, and each is
  defensible on its own: `stop.sh:32-45` collects the failures, carries on, and exits 1 naming
  them; `start.sh:84-95` has no such collection, so under `set -e` the first control script that
  returns non-zero ends `start.sh --restart` before a single service has been started, with the
  ones already stopped left down. The same request — stop everything — has two answers depending
  on which file the operator typed.
- Severity: `latent` — the two lists agree today, member for member, and reaching the divergence
  takes adding or removing a service, which is what these files exist for.
- Smallest generalising change: one list, in one file, sourced by both; `stop.sh` then walks it
  backwards the way `stop_all` already does, and one of the two failure policies is chosen on
  purpose.

---

## 2. The address shown is read from the seed, for a value the project says lives in Mongo

- `webtools/configurator/start.sh:63-70` — `address()`; for anything but anagraphics it runs
  `python3 -c 'import json …' "$DIR/configuration/$1.json"` and prints
  `http://<listen.host>:<listen.port>`
- `webtools/configurator/start.sh:61-62` — the comment above it: "A service's address, only to be
  shown: **it is read from where it really lives**, so there is no second copy of it here."
- `webtools/configurator/start.sh:26-29` — the header of the same file, thirty lines earlier: "the
  configuration that lives is in Mongo and the files are the seed … **A value changed in operation
  survives every restart**"
- Shape: **4 — capability inferred from resemblance**
- Class: **the values `listen.host` and `listen.port` may have at the moment the service starts.**
  The file's value is one member of that class — the one a new environment is born with. The
  running value is whatever is in the `configuration` collection, and the whole of
  `load_configuration.sh` exists to guarantee that a field already in Mongo is never overwritten by
  the file. The address function reads the one copy the system is documented never to trust, and
  the comment above it says it is reading the place the value really lives.
- What goes wrong is small and lands exactly where it is least welcome: `start.sh` ends with a
  summary of five `name: address` lines (`:120-122`), which is the list an operator reads off the
  terminal and pastes into a browser. Raise `listen.port` for the preanalyst in Mongo — the
  ordinary operation this project provides for — and the service starts on the new port while the
  summary prints the old one. Nothing warns; the address is simply wrong.
- Severity: `latent` — it takes a configuration value edited in Mongo, which the protocol counts as
  a change somebody is entitled to make.
- Smallest generalising change: read the address the same way the subsystems do —
  `GET /configuration/{subsystem}` on anagraphics, which is already up by the time the others are
  started — or drop the address from the summary rather than print one that may be false. The
  `?` fallback at `:69` shows the script already knows how to say it does not know.

---

## 3. A path is split on the character used as the separator, in the one of the two files that has a helper for it

- `webtools/configurator/start.sh:59` — `field() { cut -d: -f"$1" <<< "$2"; }`, used at
  `:89-90,101-102,121` to pull the name and the script out of `name:/absolute/path`
- `webtools/configurator/stop.sh:34-35` — the same data, split as `${entry%%:*}` and `${entry#*:}`,
  which take the first colon and the rest
- Shape: **6 — world narrowed to fit the code**
- Class: **the paths the repository may sit at.** A colon is a legal character in a POSIX path, and
  `WEBTOOLS` is computed from wherever the checkout happens to be (`start.sh:32-33`). `cut -f2`
  returns the second field, so the moment any directory above `webtools/` contains a colon,
  `field 2` hands `start_all` a truncated path and the script fails with "no such file" on a
  control script that is there. `field 1` is safe; `field 2` is the one that is wrong, and it is
  the one that names the program to run.
- The correct idiom is not somewhere else to be found: it is in the sibling file, for the same
  array, four lines into the loop.
- Severity: `latent` — it takes a checkout under a path containing a colon.
- Smallest generalising change: use `stop.sh`'s two parameter expansions, or stop encoding two
  values in one string — two parallel arrays, or a function per service.

---

## Noted, not raised as findings

- `start.sh:104-106` — "If a service does not start we stop here: starting the ones after it, which
  depend on it, would only multiply the errors in the logs." The decision is right and is argued.
  What it leaves out is any statement of what is now running: `set -e` ends the script at the
  failing member, the ones before it are up, and the summary at `:118-122` is never reached. The
  operator is left with a half-started system and the last control script's message. A second
  outcome that is decided but not reported.
- `start.sh:72-80` — a `load_configuration.sh` that fails stops everything with a clear message,
  before any service is touched. The right order for the one dependency the whole system has.
- `start.sh:78` — `brew services start mongodb-community` is macOS-specific advice written into the
  message. A hint, not a decision; noted only because it is the one place a platform is assumed.
- `stop.sh:30` — `(( $# == 0 )) || { echo "Usage: $0" >&2; exit 2; }`, and `start.sh:46-57` does
  the same for its one optional flag. Both refuse a command line they do not understand, which is
  the outcome missing from `webtools/configurator/deploy.sh` (finding 1 of
  `findings/configurator-deployers.md`) and from the two migration scripts.
- `start.sh:35-37` — "The name is also that of the file in `configuration/` (anagraphics aside: its
  address is in `bootstrap.env`)." One name doing two jobs, with the exception named. It holds:
  `workspaces` is the configuration file's stem even though the directory is `webtools-workspaces`.
- `webtools/configurator/configuration/` holds **six** seed files, including
  `configurator-fe.json`. Row 53 of `sanity/inventory.md` names four. The inventory is not
  recomputed by this audit; recorded so the gap is on the record, alongside the missing
  `configurator-fe` unit noted at `findings/configurator-deployers.md`.
