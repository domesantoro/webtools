# webtools_sso

**Authentication**: login, session state, logout. Three routes for programs and three pages for
people — this is where **the only page in the system in which a password is typed** lives. Node,
with **nunjucks** for the pages (the only dependency).

Full documentation: `docs/subsystems/sso/README.md` (at the root of the workspace).

## Start and stop

```sh
webtools/sso/webtools_sso.sh --start   # starts it in the background, detached from the terminal
webtools/sso/webtools_sso.sh --stop    # stops it
```

- PID: `webtools_sso.pid`. Log: `webtools_sso.log` (appended).
- `--stop` stops only the process of the PID file, and only after checking that it is
  `node …/webtools/sso/src/index.js`.
- Debugging in the foreground, from this directory: `npm start` (Ctrl+C to stop it).
- After a `git clone` or a version change: `npm install` (one dependency only, nunjucks).

**anagraphics must be running too**, where users and sessions live:
```sh
webtools/anagraphics/webtools_anagraphics.sh --start
```

## The routes (`http://127.0.0.1:9300`)

For programs, in JSON:

| Route | What it does | Response |
|---|---|---|
| `POST /login` | `{"username":…,"password":…}` | `201 {"logged":true,"session":{…}}` or `401 INVALID_CREDENTIALS` |
| `GET /session` | `Authorization: Bearer <token>` | `200 {"logged":true,"session":{…}}` or `200 {"logged":false}` |
| `POST /logout` | `Authorization: Bearer <token>` | `200 {"logged":false}`, repeatable |
| `POST /tickets/exchange` | `{"ticket":…,"service":…}` | The session the ticket gives access to |

For people, in HTML: `GET`/`POST /ui/login`, `GET /ui/logout`, `GET /ui/register`.

Errors of the JSON routes: correct HTTP status and a stable code, `{"error":"<CODE>"}`.

## The login round trip, in brief

The browser logs in here, but the cookie the sso sets is good only for **this** address: a cookie
does not cross two different ports. So the sso sends the browser back to the subsystem with a
**ticket** in the address; the subsystem exchanges it server to server (`/tickets/exchange`),
receives the session and sets **its own** cookie. The ticket is good for one minute and once, so it
can sit in an address; the session token, which lasts hours, never travels there.

Whoever comes back here from a second subsystem does not retype the password: the sso's cookie
recognises them and only another ticket is issued. This is the *single* part of single sign-on.

A subsystem does not have to write any of this by hand: there is
`webtools/commons/sso/sso_client.js`, brought in with `webtools/configurator/deploy.sh sso`.

Three things to know before using it:

- **The sessions live in Mongo, not in here.** The sso has no database: it writes them to and
  reads them from anagraphics. Restarting the sso logs nobody out.
- **`logged: false` and `503` are not the same thing.** The first says the session is not good,
  the second that the store does not answer and so we do not know. A `503` must not be treated as
  a logout, or one Mongo failure will log everybody out.
- **A refused login always gives `INVALID_CREDENTIALS`**, whether the user does not exist, is
  deactivated, has no password or got it wrong. Which of the four it is, is in the log.

The session is the same document stored in anagraphics: `token`, `uid`, `username`, `issued_at`,
`expires_at`, `data` (today `screen_name` and `driver_uid`, photographed at login time). It lasts
8 hours from the login and does not extend with use.

## The pages' style

`public/commons.css` and `public/fonts/` are **generated copies** from the deployer: they are not
edited here. Edit `webtools/commons/style/` and run `webtools/configurator/deploy.sh style`. The
same holds for `src/commons/configuration_client.js` (the original is in
`webtools/commons/configuration/`, the `configuration` deployer).
`public/styles.css` is the two pages' local style and is edited by hand.

## Passwords

They are not set from here: they are written in anagraphics, with the command in
`docs/subsystems/anagraphics/README.md` §8.5. Whoever runs it must also close that user's sessions
that are already open: the new password alone does not stop them.

The stored format (scrypt, with the parameters inside the document) is described in
`docs/subsystems/anagraphics/README.md` §5.5. Here it is only verified.

## Configuration

Read at startup from anagraphics (`GET /configuration/sso`); the source is
`webtools/configurator/configuration/sso.json`. No defaults: if anything is missing the server does
not start and the log says which field. Only the variables of
`webtools/configurator/bootstrap.env` come from the environment, and `--start` loads them by
itself. What the fields mean is in the full documentation (§6).

## Tests

```sh
npm test    # 47 tests, no server to start
```

In place of anagraphics there is a fake store, failures included. `tests/credentials.test.js`
holds a hash really produced by Python: it keeps the two scrypt implementations together.
