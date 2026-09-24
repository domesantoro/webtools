# Subsystem `sso`

> Reference documentation for development, maintenance, troubleshooting, bugfixing and metrics.
> Last updated: 2026-09-21 · subsystem version: `0.4.0`.
> Code: `webtools/sso/` (paths relative to the root of the `ftab - webtools/` workspace).

---

## 0. Quick sheet

| Item | Value |
|---|---|
| What it does | Authenticates: **login**, **session state**, **logout**. Three routes for programs, three pages for people |
| Stack | Node 23 · the `node:http` module · **nunjucks** for the pages (the only dependency) |
| Code | `webtools/sso/` |
| Start (background, detached from the terminal) | `webtools/sso/webtools_sso.sh --start` |
| Stop | `webtools/sso/webtools_sso.sh --stop` |
| Process | `…/node …/webtools/sso/src/index.js` |
| PID / Log | `webtools/sso/webtools_sso.pid` / `webtools/sso/webtools_sso.log` |
| Address | `http://127.0.0.1:9300` |
| Depends on | `webtools_anagraphics` on `http://127.0.0.1:9100` (it must be running) |
| Database | None: users, sessions and tickets live in anagraphics |
| Access | Only from the IPs in `access.allowed_ips` of the configuration; the others get a `403` |
| Client for the subsystems | `webtools/commons/sso/`: `sso_client.js` for the server, `sso_popup.js` for the browser. Distributed by `webtools/configurator/sso_deployer/deploy.sh` |
| Tests | `npm test` (47 tests, no server needs to be running) |
| State | Login with username and password, token sessions, login pages. No roles, no permissions, registration not active |

Quick check, with anagraphics and the sso running:
```sh
# from the browser
open "http://127.0.0.1:9300/ui/login?next=http://127.0.0.1:9200/"

# from the command line
curl -s -X POST http://127.0.0.1:9300/login -H 'content-type: application/json' \
  -d '{"username":"driver.prova@example.com","password":"<password>"}'
```

---

## 1. Purpose and role in the system

In the project's flow (`contesto/02. contesto_aggiornato.md`) several subsystems need to know **who is asking**: today `preanalyst`, tomorrow the driver interface and the dashboard. The sso is the single place where that question is answered, and the only place in the system where a password is typed.

### 1.1 Why a cookie is needed, and why a ticket is needed

These two things are the heart of the subsystem. Whoever has them clear understands all the rest.

**The web has no memory.** Every request a browser makes to a server is detached from the previous one: if you have just logged in and ask for another page, the server has no way of knowing it is you. So something is needed that the browser sends back by itself, every time. There are three possibilities: the **cookie** (the server tells the browser "keep this string and always send it back to me", and the browser does so by itself, with no JavaScript); the token **inside the address**, which however ends up in the history, in proxy logs and in links people pass around; the **JavaScript** in the page, which is not here by choice, because the pages arrive ready-made from the server. The cookie is what is left.

**A cookie belongs to one address only.** The sso sits on `127.0.0.1:9300`, the preanalyst on `127.0.0.1:9200`: the sso cannot set a cookie on behalf of the preanalyst. So after the login, how does the preanalyst know who you are?

With a **ticket**: a receipt made to travel in the address, because it is good **once** and for **one minute**.

```text
browser                     sso (9300)              preanalyst (9200)        anagraphics (9100)
   │                           │                          │                        │
   │ 1. "Entra" ──────────────►│                          │                        │
   │ 2. username + password ──►│  verifies ──────────────────────────────────────►│
   │                           │  creates the session ───────────────────────────►│
   │◄─ 3. the sso's cookie ────│  creates the ticket ────────────────────────────►│
   │   + "go back there with the ticket"                  │                        │
   │                           │                          │                        │
   │ 4. GET /?ticket=… ───────────────────────────────────►│                       │
   │                           │◄─ 5. exchange (server to server) ┤                │
   │                           │   the ticket is consumed ───────────────────────►│
   │◄─ 6. the preanalyst's cookie ────────────────────────┤                        │
   │                           │                          │                        │
   │ 7. every request carries the cookie ─────────────────►│ "who is it?" ─►│ sso   │
```

The session token, which lasts hours, **never travels through the address**: only the ticket does, and by the time somebody reads it in a log it has already been consumed.

**The sso's cookie** (step 3) is the *single* part of single sign-on: when the second subsystem sends the same browser here, the sso will recognise it and will not ask for the password again — it will only issue another ticket.

### 1.2 What it does not do

It does not handle roles or permissions (it says who you are, not what you may do), it does not register new users, it does not send email, it has no database.

### 1.3 Relationship with `anagraphics`

Users, credentials, sessions and tickets live in `anagraphics`, which stores and returns them but decides nothing: it does not compare passwords and does not judge expiries. The division holds in both directions — **anagraphics is a store, the sso is the authority**.

---

## 2. Functional choices

| Choice | Reason |
|---|---|
| **One login page only, here** | It is the only place in the system where a password is typed: one to watch, one to change. If every subsystem had its own, it would not be a *single* sign-on but N separate logins. |
| **Sessions live in Mongo, not in memory** | A map inside the process dies at the restart and does not exist for a second process: half the requests would say "not logged in". A session is shared data, and shared data lives in the store. |
| **The ticket instead of the token in the address** | See §1.1. A token that lasts eight hours is not left in the browser's history; a ticket good for one minute and once, yes. |
| **Every subsystem has **its own** cookie** | We do not rely on cookies ignoring the port — which is true, and on `127.0.0.1` would make everything look as if it worked. The day the subsystems sit at different addresses, the ticket round trip already works the same. |
| **Different cookie names between subsystems** | A consequence of the same rule: since the port does not count, on `127.0.0.1` the cookies all end up in the same pile and two with the same name would overwrite each other. The sso uses `webtools_sso`, the preanalyst `webtools_preanalyst`. |
| **`next` only towards allowed addresses** | Whoever sends the browser here also says where to go back to. Without a list, anybody could build `…/ui/login?next=http://fake-site` and use our login page as a springboard. |
| **An opaque token, 32 random bytes** | It holds no information: it cannot be read and cannot be forged. The price is one read on every `GET /session`; the advantage is that the logout takes effect immediately, which a self-contained JWT does not give you. |
| **A fixed expiry from the login, with no extensions** | 8 hours (`session.ttl_seconds`). A predictable rule, and no write on every read. |
| **Every way of not getting in gives the same answer** | Unknown user, deactivated, with no password, wrong password: always `401 INVALID_CREDENTIALS`. Telling them apart would say to whoever is trying whether an address is registered. The real reason stays in the log (§7). |
| **Unknown token: `200 {"logged": false}`, not an error** | "Is this token good?" is a legitimate question, and "no" is an answer. Errors are left for real failures. |
| **With anagraphics down we answer `503`, never `logged: false`** | If the store does not answer we do not know whether the session is good. Saying "not logged in" would throw everybody out at every Mongo failure. |
| **"Esci" logs you out of everything** | It closes the shared session: from that moment no subsystem recognises that token any more. It is what a person expects, and the only way to really get out of a shared computer. |
| **The photograph of the user lives inside the session** | `screen_name` and `driver_uid` are copied into the session at login, so `GET /session` costs a single read. The price: a change of `screen_name` shows up at the next login. The same trade-off as the driver inside the discount codes. |
| **No dependencies** | `node:http` and `node:crypto` are enough. Every extra dependency, in a subsystem that handles passwords, is one more surface to keep an eye on. |

---

## 3. Technological choices

- **Node**, because it is the platform's backbone and the sso is I/O and little else.
- **scrypt** from the standard library: no dependencies for the cryptographic part, and exactly the same computation Python does when the password is set (`docs/subsystems/anagraphics/README.md` §5.5).
- **`crypto.timingSafeEqual`** for the final comparison: how long the answer takes must not say how many bytes of the hash were right.
- **nunjucks** for the pages, with `autoescape: true`. The templates live in `templates/`; the shared shell (`templates/commons/base.njk`) comes from the deployer, like `commons.css`. `trimBlocks` is **off**: on, together with the templates' `{%-`, it would squeeze the page into a few very long lines.

---

## 4. Architecture

### 4.1 File map

| File | Responsibility |
|---|---|
| `src/index.js` | Startup: settings, listening, the confirmation line, shutdown on SIGTERM/SIGINT |
| `src/settings.js` | Reads the configuration at startup and turns it into the server's settings; `safeNext()` validates the return address |
| `src/commons/configuration_client.js` | The configuration client: a **generated copy** from the `configuration` deployer |
| `src/server.js` | HTTP: IP pool, routes, cookies, request bodies, static files |
| `src/auth.js` | The operations: `login`, `readSession`, `logout`, `issueTicket`, `exchangeTicket` |
| `src/sessions.js` | The session document: token, dates, expiry |
| `src/tickets.js` | The ticket: how it is built, when it expires, how it is added to the address |
| `src/credentials.js` | Password verification against the `credential` block |
| `src/page.js` | Which data goes to each page. No HTML: it configures nunjucks and calls the templates |
| `templates/login.njk`, `templates/register.njk` | The two pages |
| `templates/commons/base.njk` | The shared shell and header: a **generated copy** from the template deployer |
| `src/anagraphics.js` | HTTP client towards anagraphics |
| `public/` | The local `styles.css`, `assets/mark.svg`; `commons.css` and `fonts/` are **generated copies** from the style deployer |
| `tests/*.test.js` | Tests with `node --test` (§9) |
| `webtools_sso.sh` | Start and stop with a verified PID file |

### 4.2 The path of a login from the pages

```text
GET /ui/login?next=…
  ├─ next outside the allowed addresses → the first allowed one is used, and it goes in the log
  ├─ the sso's cookie present and the session valid
  │     └─ issues the ticket ─────────────────► 303 to next?ticket=…
  └─ otherwise ───────────────────────────────► 200 the page with the form

POST /ui/login  (username, password, next)
  ├─ empty fields ────────────────────────────► 400 the page, with the notice
  ├─ credentials refused ─────────────────────► 401 the page, with the notice
  ├─ anagraphics down ────────────────────────► 503 the page, with the notice
  └─ ok: creates the session, sets the sso's cookie, issues the ticket
        └───────────────────────────────────── ► 303 to next?ticket=…
```

### 4.3 The path of the exchange

```text
POST /tickets/exchange  { ticket, service }     ← the subsystem calls it, not the browser
  ├─ ticket unknown or already used ──────────► 404 TICKET_NOT_FOUND
  ├─ ticket expired ──────────────────────────► 400 TICKET_EXPIRED
  ├─ issued for another subsystem ────────────► 403 TICKET_MISMATCH
  ├─ session closed in the meantime ──────────► 200 { logged: false }
  └─ ────────────────────────────────────────► 200 { logged: true, session }
```

The ticket is deleted by anagraphics **at the moment it is read**, so the second to try gets a 404 even if it arrives a millisecond later.

### 4.4 The path of a session read

```text
GET /session  Authorization: Bearer <token>
  ├─ header missing or malformed ─────────────► 400 MISSING_TOKEN
  ├─ unknown token ───────────────────────────► 200 { logged: false }
  ├─ expiry passed or unreadable ─────────────► 200 { logged: false }
  ├─ anagraphics down ────────────────────────► 503 ANAGRAPHICS_UNAVAILABLE
  └─ ────────────────────────────────────────► 200 { logged: true, session }
```

An expired session is not deleted by the sso: anagraphics' TTL index removes it. A deletion on every read would be a write for nothing.

---

## 5. API reference

Base URL: `http://127.0.0.1:9300`. The JSON responses carry `Cache-Control: no-store`.

### 5.1 Error format (the contract)

The JSON routes follow the project's contract: correct HTTP status and a **stable code**, `{"error": "<CODE>"}`. The pages, on the other hand, speak to people, so they answer with HTML even when something goes wrong.

| Status | `error` | When |
|---|---|---|
| `400` | `INVALID_BODY` | The body of `/login` or `/tickets/exchange` missing, not JSON, or with missing fields |
| `400` | `MISSING_TOKEN` | `Authorization: Bearer <token>` missing on `/session` or `/logout` |
| `400` | `TICKET_EXPIRED` | Ticket presented past the minute |
| `401` | `INVALID_CREDENTIALS` | Login refused, for any of the four reasons (§2) |
| `403` | `IP_NOT_ALLOWED` | The caller's IP outside `access.allowed_ips` |
| `403` | `TICKET_MISMATCH` | A ticket issued for one subsystem, presented by another |
| `404` | `TICKET_NOT_FOUND` | Ticket unknown or already consumed |
| `404` | `ROUTE_NOT_FOUND` | Non-existent URL |
| `405` | `METHOD_NOT_ALLOWED` | Wrong method on an existing route |
| `503` | `ANAGRAPHICS_UNAVAILABLE` | anagraphics unreachable, erroring, or answering unexpectedly |
| `500` | `INTERNAL_ERROR` | Any other unexpected error; the stack is in the log |

### 5.2 Routes for programs

| Route | Body / header | Response |
|---|---|---|
| `POST /login` | `{"username","password"}` | `201 {"logged":true,"session":{…}}` · `401` · `400` · `503` |
| `GET /session` | `Authorization: Bearer <token>` | `200 {"logged":true,"session":{…}}` · `200 {"logged":false}` · `400` · `503` |
| `POST /logout` | `Authorization: Bearer <token>` | `200 {"logged":false}`, repeatable · `400` · `503` |
| `POST /tickets/exchange` | `{"ticket","service"}` | `200 {"logged":…,"session"?}` · `400` · `403` · `404` · `503` |
| `POST /session/locale` | `Authorization: Bearer <token>`, `{"locale"}` | `200 {"logged":true,"session":{…}}` · `200 {"logged":false}` · `400 INVALID_LOCALE` · `400` · `503` |

`POST /session/locale` puts the language into the session (`data.locale`) and into the user's profile in anagraphics. Only the languages of `i18n.locales`. The subsystems call it when somebody who has logged in changes language from the switcher (`saveSessionLocale` in `commons/sso/sso_client.js`).

`service` is the address of the subsystem doing the exchange, e.g. `http://127.0.0.1:9200`: it must match the one the ticket was issued for.

Repeated logins open **different sessions**, all valid: closing one does not touch the others.

### 5.3 Pages for people

| Route | What it does |
|---|---|
| `GET /ui/login?next=…` | The page with username and password. If the browser already has the sso's cookie, it asks nothing: it issues the ticket and goes back to `next` |
| `POST /ui/login` | The form above (`username`, `password`, `next`) |
| `GET /ui/logout?next=…` | Closes the shared session, removes the sso's cookie, goes back to `next` |
| `GET /ui/register?next=…` | Registration, which is not active yet: the page says so |
| `POST /locale` | The language switcher in the header (`locale`, `return_to`): it writes the shared `i18n.cookie_name` cookie and returns to the page. If the browser has the sso's cookie, it also saves the language in the session and in the profile |

**The language.** The pages are in the language of the shared `webtools_locale` cookie, or in that of `Accept-Language`, or in English; the texts live in the catalogues `webtools/commons/i18n/locales/`. At login the session's language is the profile's; if the profile has none, it becomes the login page's and is saved in the profile. The login rewrites the language cookie with the session's, so every subsystem sees it.

`next` must start with one of the addresses in `login.allowed_next`, otherwise it is replaced with the first of the list (and the fact goes in the log).

The pages' static files (`commons.css`, `styles.css`, `assets/`, `fonts/`) are served from the root.

### 5.4 The `session` object

It is the same document stored in anagraphics (`docs/subsystems/anagraphics/README.md` §5.6), with no translation:

```json
{
  "token": "T4yS…43 characters…",
  "uid": "8ff93901-673e-44ba-b05b-56011395dcba",
  "username": "dome.santoro@gmail.com",
  "issued_at": "2026-09-21T10:00:00.000Z",
  "expires_at": "2026-09-21T18:00:00.000Z",
  "data": { "screen_name": "Dome", "driver_uid": "7633be3d-e701-42ca-9fea-6c6d1bb4b7d1", "locale": "it" }
}
```

### 5.5 For consumers: use the shared client

A subsystem should write neither the cookie nor the ticket exchange by hand. The shared client has two halves, both distributed by the deployer (§8):

- **`sso_client.js`**, on the server side: `currentSession`, `claimTicket`, `loginUrl`, `logoutUrl`, `registerUrl`, `sessionCookie`, `clearSessionCookie`, `ticketFrom`, `urlWithoutTicket`.
- **`sso_popup.js`**, on the browser side: it opens the login in a window, closes it when it is done and makes the starting page refresh the parts that depend on who has logged in, without reloading it. The subsystem must serve two things: a return page with the `data-sso-login-done` marker (where `next` points) and a `GET /session-fragment` returning those parts already rendered.

The preanalyst's integration is the reference example: `docs/subsystems/preanalyst/README.md` §6.

---

## 6. Configuration

The server reads its configuration **at startup** from anagraphics, `GET /configuration/sso`. The source is `webtools/configurator/configuration/sso.json`; `webtools/configurator/load_configuration.sh` loads it into Mongo (`start.sh` already does that). No defaults: if the document, or a field, is missing, or a field is of the wrong type, the server prints `webtools_sso is not starting: …` with the field's path and exits with 1. After a change: `webtools/configurator/start.sh --restart`.

Only `WEBTOOLS_ANAGRAPHICS_URL` and `WEBTOOLS_CONFIGURATION_TIMEOUT_MS` come from the environment, and `--start` loads them from `webtools/configurator/bootstrap.env`. `WEBTOOLS_ANAGRAPHICS_URL` is also the address of anagraphics for every other call.

| Field | Today | Notes |
|---|---|---|
| `listen.host` | `127.0.0.1` | The listening interface |
| `listen.port` | `9300` | — |
| `access.allowed_ips` | `["127.0.0.1", "::1"]` | The connection's IP counts; `::ffff:127.0.0.1` is recognised as `127.0.0.1` |
| `subsystems_infos.anagraphics.timeout_ms` | `5000` | anagraphics waits up to 30 s if Mongo does not answer: here we cut earlier |
| `session.cookie_name` | `webtools_sso` | It must stay different from the subsystems' cookies |
| `session.ttl_seconds` | `28800` (8 hours) | How long a session lasts from the login |
| `ticket.ttl_seconds` | `60` | How long a ticket lasts: the time of a redirect |
| `login.allowed_next` | `["http://127.0.0.1:9200", "http://localhost:9200"]` | Where the browser may be sent back to after the login. http(s) addresses only |
| `limits.body_max_bytes` | `4096` | The largest body accepted by login, ticket exchange and forms |
| `i18n.locales` | `["en", "it"]` | The languages offered: each has its catalogue in `commons/i18n/locales/` |
| `i18n.fallback_locale` | `en` | The fallback language, and the one the keys missing from another are taken from |
| `i18n.cookie_name` | `webtools_locale` | The language cookie, **the same in every subsystem**: that is how they all see it |
| `i18n.cookie_max_age_seconds` | `31536000` (a year) | How long the language choice lasts in the browser |
| `i18n.body_max_bytes` | `1024` | The largest body accepted by `POST /locale` |

**When a subsystem with a login is added** three things are needed: its address in `login.allowed_next`, a cookie name all of its own, and a line in the client's deployer (§8).

---

## 7. Log

One line per event, in the process's log (`webtools_sso.log`).

| Line | Meaning |
|---|---|
| `[sso] login of <username> (uid …)` | Login succeeded |
| `[sso] login refused: unknown user / user deactivated / CREDENTIAL_NOT_SET / wrong password` | The four reasons, told apart **only here** |
| `[sso] session not created for …` | `POST /sessions` failed |
| `[sso] ticket not issued for <service>` | `POST /tickets` failed |
| `[sso] invalid / expired ticket presented by <service>` | Exchange refused |
| `[sso] ticket issued for X, presented by Y` | Another subsystem's ticket |
| `[sso] next outside the allowed addresses, ignored: …` | Somebody tried to make us send the browser elsewhere |
| `[sso] logout with no store: the session stays open until it expires` | Logout with anagraphics down |
| `[sso] request from an IP outside the pool: <ip>` | The IP filter |
| `[anagraphics] …` / `[credentials] …` | Store failures, badly made `credential` blocks |

Passwords and tokens never end up in the log. Usernames do: without them, an access attempt cannot be understood.

---

## 8. Operational commands

```sh
webtools/sso/webtools_sso.sh --start   # starts it in the background
webtools/sso/webtools_sso.sh --stop    # stops it
set -a; source ../configurator/bootstrap.env; set +a; npm start   # in the foreground, for debugging (from webtools/sso/)
npm test                               # the tests
```

The script is the twin of those of `anagraphics` and `preanalyst`: `nohup`, PID in `webtools_sso.pid`, and a `--stop` that stops **only** the process named by the PID file, after checking its command line. Never by name, never by port: other projects run on this machine. Before testing, check whether an instance of the user's is already running and leave it alone.

The pages' style and the client for the subsystems are distributed with the general deployer:

```sh
webtools/configurator/deploy.sh          # style + sso client
webtools/configurator/deploy.sh sso      # the sso client only
```

Passwords are set from anagraphics (`docs/subsystems/anagraphics/README.md` §8.5).

---

## 9. Tests

`npm test` (that is, `node --test "tests/*.test.js"`): **47 tests** (4 on the configuration client, `tests/configuration.test.js`), with no server to start.

| File | What it covers |
|---|---|
| `tests/api.test.js` | Routes and pages on a real server listening on a free port, with a **fake anagraphics**: the full login→state→logout round trip, multiple sessions, the four refusals, invalid bodies, missing token, expired session, store down, IP pool; and for the pages: the form, a `next` that is not allowed, the full round trip with ticket and cookie, somebody already logged in who does not retype the password, another subsystem's ticket, a wrong password, "esci" that really closes the session, registration not active |
| `tests/tickets.test.js` | The ticket: length and uniqueness, content, expiry, `service`, being added to the address without losing the parameters already there |
| `tests/credentials.test.js` | Password verification, **with a hash really produced by Python**: if the two scrypts stopped computing the same thing, it fails here instead of in a login. Plus the badly made `credential` blocks |
| `tests/sessions.test.js` | Token, session content, expiry including the case of an unreadable date |

The fake store is a map in `tests/api.test.js` and answers like anagraphics, failures included (`broken: true`), tickets included (atomic consumption). The tests also check that the session **ends up in the store** and does not stay inside the sso.

Checked by hand on 2026-09-21, with real anagraphics, sso and preanalyst on temporary ports: the page while logged out, the login from the sso's page, the return with the ticket, the preanalyst's cookie, the page while logged in with the name in the header, "Esci" removing the two cookies and deleting the session from Mongo.

---

## 10. Troubleshooting

| Symptom | Likely cause | Check / remedy |
|---|---|---|
| Every call answers `503 ANAGRAPHICS_UNAVAILABLE` | anagraphics down or on another port | `curl http://127.0.0.1:9100/drivers`; check `WEBTOOLS_ANAGRAPHICS_URL` in `configurator/bootstrap.env`; the log has the `[anagraphics] …` line |
| `401` even with the right password | Password never set, or user `active: false` | The log says which of the two |
| After the login the browser goes back to the wrong place | `next` is not in `login.allowed_next`, so it was replaced | The log has `next outside the allowed addresses`; add the address |
| The return from the login logs nobody in | Ticket expired (more than a minute), already used, or a `service` that does not match | The sso's log says which of the three |
| You log in to one subsystem and out of another | Two subsystems with the **same cookie name**: cookies ignore the port, so they overwrite each other | Give each one its own `session.cookie_name` |
| `400 MISSING_TOKEN` with the token in hand | The header is badly written: it needs `Authorization: Bearer <token>`, with one space | — |
| The pages show with no style | `commons.css` was never copied into `webtools/sso/public/` | `webtools/configurator/deploy.sh style` |
| `template not found: commons/base.njk` | The template deployer was never run | `webtools/configurator/deploy.sh template` |
| `Cannot find package 'nunjucks'` | Dependencies not installed | `npm install` in `webtools/sso/` |
| `npm test` fails only on `credentials.test.js` | The format of the `credential` block changed on one side only | Regenerate the test hash with `webtools_anagraphics/credentials.py` and bring the two implementations back in line |

---

## 11. Known limits and technical debt

- **No limit on login attempts**: no rate limiting, no lockout after N failures, no delay.
- **An unknown user answers faster** than one with a wrong password, because scrypt is not even run: by measuring the times one can work out whether an address is registered. It is fixed by computing a fake hash anyway.
- **No TLS**: passwords, cookies and tickets travel in the clear on the loopback. Outside this machine that is not acceptable, and `Secure` must be added to the cookies.
- **No authentication between services**: whoever is in the IP pool can read the hashes from anagraphics, create sessions for any `uid` and declare any `service` at the exchange. The check on `service` stops mistakes, not an attack.
- **No CSRF protection on the login form**: today the possible damage is logging somebody in with an account the attacker already knows. It must be added when the pages become reachable from outside.
- **No roles and no permissions**: the sso says who you are, not what you may do.
- **No registration, no password recovery, no password expiry.**
- **No session extension with use**: at 8 hours you log in again.
- **Logout with anagraphics down**: the cookies are removed, but the session stays alive until it expires. It is in the log, it is not hidden.
- **There is one IP pool** for both the program routes and the pages, which are meant for people's browsers instead: the day the pages leave localhost, the two lists must be separated.
- **No endpoint for closing all of a user's sessions**: anagraphics has one (`DELETE /sessions?uid=…`), the sso does not expose it.
- **No `/health`, no metrics**, a log with no rotation, no automatic start after a reboot of the Mac.
- `node_modules/` is not managed by any script: after a clone or a version change, `npm install` is needed by hand.

---

## 12. How to extend (a checklist)

**Adding a subsystem with a login**
1. Its address in `login.allowed_next` (§6).
2. A cookie name all of its own (§2).
3. A function in `webtools/configurator/sso_deployer/deploy.sh` that copies `sso_client.js` to it.
4. In its server: `currentSession` on every page, a return route (`/login-done`) that does `claimTicket` and sets the cookie, a `GET /session-fragment` for refreshing without a reload, and a logout route that removes the cookie and sends the browser to `/ui/logout`.
5. In its pages: `sso_popup.js`, the `data-sso-login` markers on the links and `data-sso-header` / `data-sso-gate` on the containers to refresh.

**Adding a piece of data to the session**
It goes inside `data`, in `buildSession` (`src/sessions.js`). No change to anagraphics is needed: `data` is free. Remember that it is a photograph taken at login time (§2).

**Adding a route**
A function in `src/auth.js` returning `{ok:true, status, body}` or `{ok:false, status, code}`, an entry in the `ROUTES` map of `src/server.js`, a new error code documented in §5.1, a test in `tests/api.test.js` including the "store down" case.

**Changing the password algorithm**
The format is in the document, not in the code (`params`). The new algorithm is added to `src/credentials.js` **keeping** the old one, `webtools_anagraphics/credentials.py` is changed to generate the new one, and the passwords are converted at the first successful login or reset.

---

## 13. Changelog

| Date | Version | Change |
|---|---|---|
| 2026-09-22 | 0.5.0 | **Languages.** Pages keyed from the shared catalogues (`commons/i18n`), a language switcher and `POST /locale`. The language in the session (`data.locale`) and in the profile: at login the profile wins, and the language cookie is rewritten. New route `POST /session/locale` and code `INVALID_LOCALE`. Configuration: the `i18n` section. Tests from 35 to 47. |
| 2026-09-21 | 0.4.0 | **Configuration from the configuration subsystem.** At startup `GET /configuration/sso` is read from anagraphics (shared client `commons/configuration/configuration_client.js`); gone are all the environment variables and all the defaults, except the `WEBTOOLS_*` bootstrap. Without configuration the server does not start. The request body limit (previously the `MAX_BODY_BYTES` constant) becomes `limits.body_max_bytes`. Tests from 31 to 35. |
| 2026-09-21 | 0.3.0 | The HTML leaves the JavaScript: pages in `templates/*.njk` rendered with **nunjucks** (autoescape), the shared shell in `commons/templates/base.njk` distributed by the new `template_deployer`. Corrected the stylesheet paths, which were relative and under `/ui/` pointed at non-existent files. The subsystem's first npm dependency. |
| 2026-09-21 | 0.2.0 | The pages: `GET/POST /ui/login`, `GET /ui/logout`, `GET /ui/register`. The sso's cookie, single-use tickets (`POST /tickets/exchange`) and `ALLOWED_NEXT` so as not to act as a springboard. The shared client `commons/sso/sso_client.js` and its deployer. The pages' style from `commons.css`. Tests from 17 to 31. |
| 2026-09-21 | 0.1.0 | Creation: `POST /login`, `GET /session`, `POST /logout`. Persistent sessions in `anagraphics`, an opaque 32-byte token, scrypt passwords verified here and stored there. An IP pool on localhost. 17 tests with `node --test`. |
