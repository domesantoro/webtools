# sso-runner

Paths: `webtools/sso/webtools_sso.sh`, `webtools/sso/package.json`,
`webtools/sso/public/styles.css`
Examined: 2026-09-25

The start/stop script is **the preanalyst's script with the name changed**: `diff` against
`webtools/preanalyst/webtools_preanalyst.sh` returns nothing but the eight lines that spell
`webtools_sso` instead of `webtools_preanalyst`. Everything praised there holds here — the PID file
trusted only after the command line is checked, never a `pkill`, never a lookup by port, the log
offset taken before the start, the escalation to `SIGKILL` announced — and so does everything found
there. One finding of its own.

---

## 1. One script per subsystem, and no original

- `webtools/sso/webtools_sso.sh`, identical but for its name to
  `webtools/preanalyst/webtools_preanalyst.sh`; `webtools/front-gate/webtools_front_gate.sh`,
  `webtools/anagraphics/webtools_anagraphics.sh` and
  `webtools/webtools-workspaces/webtools_workspaces.sh` are the other members
- Shape: **6 — world narrowed to fit the code**
- Class: **the subsystems that start and stop.** Starting a node subsystem is a property of the
  class — the same PID file, the same command-line check, the same 10 s wait for a confirmation
  line, the same escalation. It is written once per member, which makes every one of them a place
  where the rule can drift, and none of them the place where it is stated.
- The repository already has the answer for exactly this situation and applies it to smaller things:
  `webtools/commons/` holds the original and `webtools/configurator/*_deployer/deploy.sh` writes the
  copies, with "DO NOT EDIT THE COPY INSIDE A SUBSYSTEM" at the top of each one
  (`commons/templates/base.njk:4-6`). A stylesheet and a template get that treatment; the script
  that decides how a process is stopped does not, and it is the one the operating rules in
  `CLAUDE.md` are most explicit about.
- The consequence is already real rather than hypothetical: the three findings recorded against
  `findings/preanalyst-runner.md` — the possibly truncated `ps` output (`:28-30`), the `SIGKILL`
  whose outcome is discarded (`:103-105`), the node version declared in `package.json` and never
  checked (`:17,40-43`) — exist **verbatim** in this file, at the same line numbers, and each of them
  has to be fixed five times. They are not counted again here.
- Severity: `latent`
- Smallest generalising change: one script that takes the subsystem's name, or one original and a
  deployer, so that what is true of every subsystem is written where every subsystem reads it.

---

## Noted, not raised as findings

- The three findings of `findings/preanalyst-runner.md` apply to this file unchanged: `uncertain`
  (whether `ps -p <pid> -o command=` can come back truncated), `latent` (the unchecked `SIGKILL`
  followed by an unconditional `rm -f "$PID_FILE"`), `stylistic` (`engines: node >=20` declared in
  `package.json:8-10`, never established at run time). Recorded there, not re-counted here.
- `package.json` — no `package-lock.json` next to it, unlike the preanalyst's. The only dependency
  is `nunjucks: ^3.2.4`, so the version this subsystem runs with is decided at install time and is
  not recorded anywhere. Not a finding of the audited rule; noted because the preanalyst's lock file
  was what made the equivalent question answerable there.
- `public/styles.css:6-7` — the sso styles `.site-shell` and `.page-main`, which are the **shared**
  layout's own classes (`commons/templates/base.njk:52,70`) and are defined in no shared stylesheet:
  `webtools/preanalyst/public/styles.css:12-13` and
  `webtools/front-gate/public/css/styles.css:6,9` define them too, each differently. The markup
  belongs to the class and its layout is re-decided by every member. The class boundary is
  `webtools/commons/`, so this is recorded against units 66 and 67, not here.
- `public/styles.css:23,30` — the two section comments are in Italian (`campi`, `schermi stretti`),
  against the English rule. Same list as the other units.
- `public/styles.css` is 42 lines and says at the top which file owns the rest and that it is a
  generated copy. A local stylesheet that states its boundary.
