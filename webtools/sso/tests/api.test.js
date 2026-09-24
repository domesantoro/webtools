// The routes, tested end to end but without anagraphics running: in its place
// there is a fake store that answers as it would, failures included.

import assert from "node:assert/strict";
import { after, test } from "node:test";

import { Configuration } from "../src/commons/configuration_client.js";
import { loadI18n } from "../src/commons/i18n/webtools_i18n.js";
import { createServer } from "../src/server.js";

const USER = {
  uid: "8ff93901-673e-44ba-b05b-56011395dcba",
  username: "dome.santoro@gmail.com",
  screen_name: "Dome",
  active: true,
  driver_uid: "7633be3d-e701-42ca-9fea-6c6d1bb4b7d1",
};
const PASSWORD = "password-di-prova";
const CREDENTIAL = {
  algorithm: "scrypt",
  params: { n: 16384, r: 8, p: 1, dklen: 32 },
  salt: "x9hENw++DZNaSJcQ7+Gqpw==",
  hash: "sCBbG78hlwM7ZyWSi0vmMQwsURojukn7s99GhDhm51M=",
};

const NEXT = "http://127.0.0.1:9200/";
const SETTINGS = {
  allowedIps: ["127.0.0.1", "::1"],
  sessionTtlSeconds: 3600,
  ticketTtlSeconds: 60,
  cookieName: "webtools_sso",
  allowedNext: ["http://127.0.0.1:9200"],
  bodyMaxBytes: 4096,
  i18n: loadI18n(
    new Configuration(
      "sso",
      {
        i18n: {
          locales: ["en", "it"],
          fallback_locale: "en",
          cookie_name: "webtools_locale",
          cookie_max_age_seconds: 31536000,
          body_max_bytes: 1024,
        },
      },
      "http://127.0.0.1:9100"
    )
  ),
};

const notFound = (code) => ({ ok: false, reason: "not_found", code });
const down = { ok: false, reason: "unavailable" };

// Fake store: users in one map, sessions in another. `broken` switches everything
// off, as if anagraphics were not answering.
function fakeAnagraphics({ users: iniziali = [{ user: USER, credential: CREDENTIAL }], broken = false } = {}) {
  // Copies: a language saved in a profile in one test must not leak into the next.
  const users = iniziali.map((entry) => ({ ...entry, user: { ...entry.user } }));
  const sessions = new Map();
  const tickets = new Map();
  const find = (username) => users.find((entry) => entry.user.username === username);

  return {
    users,
    sessions,
    tickets,
    async setUserLocale(settings, username, locale) {
      if (broken) return down;
      const entry = find(username);
      if (!entry) return notFound("USER_NOT_FOUND");
      entry.user.locale = locale;
      return { ok: true, data: entry.user };
    },
    async setSessionLocale(settings, token, locale) {
      if (broken) return down;
      const session = sessions.get(token);
      if (!session) return notFound("SESSION_NOT_FOUND");
      session.data = { ...session.data, locale };
      return { ok: true, data: session };
    },
    async findUser(settings, username) {
      if (broken) return down;
      const entry = find(username);
      return entry ? { ok: true, data: entry.user } : notFound("USER_NOT_FOUND");
    },
    async findUserCredential(settings, username) {
      if (broken) return down;
      const entry = find(username);
      if (!entry) return notFound("USER_NOT_FOUND");
      if (!entry.credential) return notFound("CREDENTIAL_NOT_SET");
      return { ok: true, data: { username, credential: entry.credential } };
    },
    async createSession(settings, session) {
      if (broken) return down;
      if (sessions.has(session.token)) return { ok: false, reason: "conflict" };
      sessions.set(session.token, session);
      return { ok: true, data: session };
    },
    async findSession(settings, token) {
      if (broken) return down;
      const session = sessions.get(token);
      return session ? { ok: true, data: session } : notFound("SESSION_NOT_FOUND");
    },
    async deleteSession(settings, token) {
      if (broken) return down;
      return sessions.delete(token) ? { ok: true, data: null } : notFound("SESSION_NOT_FOUND");
    },
    async createTicket(settings, ticket) {
      if (broken) return down;
      if (tickets.has(ticket.ticket)) return { ok: false, reason: "conflict" };
      tickets.set(ticket.ticket, ticket);
      return { ok: true, data: ticket };
    },
    // Like anagraphics: it reads and deletes together, so the second to come along
    // finds nothing.
    async consumeTicket(settings, ticket) {
      if (broken) return down;
      const conservato = tickets.get(ticket);
      if (!conservato) return notFound("TICKET_NOT_FOUND");
      tickets.delete(ticket);
      return { ok: true, data: conservato };
    },
  };
}

const servers = [];

// Starts the sso on a free port and returns how to call it.
async function start(client, settings = SETTINGS) {
  const server = createServer(settings, client);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    login: (body) =>
      fetch(`${base}/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    session: (token) =>
      fetch(`${base}/session`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
    logout: (token) =>
      fetch(`${base}/logout`, {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
    raw: (path, options) => fetch(`${base}${path}`, options),
    // The pages: the browser does not follow redirects by itself, here we look at them.
    page: (path, cookie) =>
      fetch(`${base}${path}`, {
        redirect: "manual",
        headers: cookie ? { cookie } : {},
      }),
    loginForm: (campi, cookie) =>
      fetch(`${base}/ui/login`, {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          ...(cookie ? { cookie } : {}),
        },
        body: new URLSearchParams(campi).toString(),
      }),
    exchange: (body) =>
      fetch(`${base}/tickets/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
  };
}

// The cookie value to send back, as a browser would.
function cookieFrom(response, name = "webtools_sso") {
  const header = response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`${name}=([^;]*)`).exec(header);
  return match ? `${name}=${match[1]}` : null;
}

after(() => {
  for (const server of servers) server.close();
});

test("login, state, logout: the full round trip", async () => {
  const archive = fakeAnagraphics();
  const sso = await start(archive);

  const loggedIn = await sso.login({ username: USER.username, password: PASSWORD });
  assert.equal(loggedIn.status, 201);
  const { logged, session } = await loggedIn.json();
  assert.equal(logged, true);
  assert.equal(session.uid, USER.uid);
  assert.equal(session.username, USER.username);
  assert.equal(session.data.screen_name, "Dome");
  assert.ok(session.token);
  // The session ended up in the store, it did not stay inside the sso.
  assert.equal(archive.sessions.has(session.token), true);

  const status = await sso.session(session.token);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { logged: true, session });

  const loggedOut = await sso.logout(session.token);
  assert.equal(loggedOut.status, 200);
  assert.deepEqual(await loggedOut.json(), { logged: false });
  assert.equal(archive.sessions.has(session.token), false);

  const after = await sso.session(session.token);
  assert.equal(after.status, 200);
  assert.deepEqual(await after.json(), { logged: false });
});

test("a second session of the same user does not touch the first", async () => {
  const sso = await start(fakeAnagraphics());
  const credentials = { username: USER.username, password: PASSWORD };
  const first = (await (await sso.login(credentials)).json()).session;
  const second = (await (await sso.login(credentials)).json()).session;

  assert.notEqual(first.token, second.token);
  await sso.logout(first.token);
  assert.equal((await (await sso.session(second.token)).json()).logged, true);
});

test("every way of not getting in answers the same thing", async () => {
  const archive = fakeAnagraphics({
    users: [
      { user: USER, credential: CREDENTIAL },
      { user: { ...USER, username: "without@example.com" }, credential: null },
      { user: { ...USER, username: "spento@example.com", active: false }, credential: CREDENTIAL },
    ],
  });
  const sso = await start(archive);

  const tentativi = [
    { username: USER.username, password: "sbagliata" },
    { username: "unknown@example.com", password: PASSWORD },
    { username: "without@example.com", password: PASSWORD },
    { username: "spento@example.com", password: PASSWORD },
  ];
  for (const tentativo of tentativi) {
    const response = await sso.login(tentativo);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "INVALID_CREDENTIALS" });
  }
  assert.equal(archive.sessions.size, 0);
});

test("login with an invalid body", async () => {
  const sso = await start(fakeAnagraphics());
  const corpi = [
    {},
    { username: USER.username },
    { username: USER.username, password: "" },
    { username: 42, password: PASSWORD },
    "not json",
    "[]",
  ];
  for (const corpo of corpi) {
    const response = await sso.login(corpo);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "INVALID_BODY" });
  }
});

test("with no token neither the state nor the logout can be asked for", async () => {
  const sso = await start(fakeAnagraphics());
  for (const response of [await sso.session(null), await sso.logout(null)]) {
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "MISSING_TOKEN" });
  }
});

test("unknown token: not logged in, and the logout stays repeatable", async () => {
  const sso = await start(fakeAnagraphics());
  const status = await sso.session("token-that-does-not-exist");
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { logged: false });

  const loggedOut = await sso.logout("token-that-does-not-exist");
  assert.equal(loggedOut.status, 200);
  assert.deepEqual(await loggedOut.json(), { logged: false });
});

test("an expired session is not logged in", async () => {
  const archive = fakeAnagraphics();
  // Negative TTL: the session is born already expired.
  const sso = await start(archive, { ...SETTINGS, sessionTtlSeconds: -1 });
  const { session } = await (await sso.login({ username: USER.username, password: PASSWORD })).json();

  const status = await sso.session(session.token);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { logged: false });
  // It was not deleted by the sso: anagraphics' TTL index removes it.
  assert.equal(archive.sessions.has(session.token), true);
});

test("with anagraphics down nobody gets in, and nobody is told they are out", async () => {
  const sso = await start(fakeAnagraphics({ broken: true }));

  for (const response of [
    await sso.login({ username: USER.username, password: PASSWORD }),
    // Here is the point: answering { logged: false } would log everybody out at
    // every Mongo failure. We do not know, and we say so.
    await sso.session("un-token-qualsiasi"),
    await sso.logout("un-token-qualsiasi"),
  ]) {
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "ANAGRAPHICS_UNAVAILABLE" });
  }
});

test("routes and methods", async () => {
  const sso = await start(fakeAnagraphics());

  const unknown = await sso.raw("/nope");
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: "ROUTE_NOT_FOUND" });

  const metodoSbagliato = await sso.raw("/login");
  assert.equal(metodoSbagliato.status, 405);
  assert.deepEqual(await metodoSbagliato.json(), { error: "METHOD_NOT_ALLOWED" });
});

/* ----------------------------------------------- le pagine e i biglietti */

test("the login page shows the form, and remembers where to go back to", async () => {
  const sso = await start(fakeAnagraphics());
  const response = await sso.page(`/ui/login?next=${encodeURIComponent(NEXT)}`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(html, /name="username"/);
  assert.match(html, /type="password"/);
  assert.match(html, /name="next" value="http:\/\/127\.0\.0\.1:9200\/"/);
});

test("a next outside the allowed addresses is not used", async () => {
  const sso = await start(fakeAnagraphics());
  const response = await sso.page("/ui/login?next=http://sito-finto.example/ruba");
  const html = await response.text();

  // In its place there is the first allowed address: the login page cannot become
  // the springboard for sending people wherever.
  assert.doesNotMatch(html, /sito-finto/);
  assert.match(html, /name="next" value="http:\/\/127\.0\.0\.1:9200"/);
});

test("the full login round trip from the pages", async () => {
  const archive = fakeAnagraphics();
  const sso = await start(archive);

  const entrato = await sso.loginForm({
    username: USER.username,
    password: PASSWORD,
    next: NEXT,
  });

  // We go back to the subsystem, with the ticket in the address…
  assert.equal(entrato.status, 303);
  const location = new URL(entrato.headers.get("location"));
  assert.equal(location.origin, "http://127.0.0.1:9200");
  const ticket = location.searchParams.get("ticket");
  assert.ok(ticket);

  // …and the sso's cookie, which is what keeps the next subsystem from asking for
  // the password. The token never appears in the address.
  const cookie = cookieFrom(entrato);
  assert.ok(cookie);
  assert.doesNotMatch(location.search, /token/);
  const setCookie = entrato.headers.getSetCookie()[0];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);

  // The exchange, server to server: the subsystem receives the session.
  const exchanged = await sso.exchange({ ticket, service: "http://127.0.0.1:9200" });
  assert.equal(exchanged.status, 200);
  const body = await exchanged.json();
  assert.equal(body.logged, true);
  assert.equal(body.session.username, USER.username);

  // The ticket is good once.
  const ripetuto = await sso.exchange({ ticket, service: "http://127.0.0.1:9200" });
  assert.equal(ripetuto.status, 404);
  assert.deepEqual(await ripetuto.json(), { error: "TICKET_NOT_FOUND" });
});

test("whoever is already in does not retype the password", async () => {
  const archive = fakeAnagraphics();
  const sso = await start(archive);
  const cookie = cookieFrom(
    await sso.loginForm({ username: USER.username, password: PASSWORD, next: NEXT })
  );

  // Second subsystem: the same login page, but with the cookie in hand.
  const response = await sso.page(`/ui/login?next=${encodeURIComponent(NEXT)}`, cookie);
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("location"));
  assert.ok(location.searchParams.get("ticket"));

  // One session for both: that is the point of single sign-on.
  assert.equal(archive.sessions.size, 1);
});

test("a ticket issued for one subsystem is not good for another", async () => {
  const sso = await start(fakeAnagraphics());
  const entrato = await sso.loginForm({
    username: USER.username,
    password: PASSWORD,
    next: NEXT,
  });
  const ticket = new URL(entrato.headers.get("location")).searchParams.get("ticket");

  const response = await sso.exchange({ ticket, service: "http://127.0.0.1:9999" });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "TICKET_MISMATCH" });
});

test("wrong password: we stay on the page, with no cookie and no ticket", async () => {
  const sso = await start(fakeAnagraphics());
  const response = await sso.loginForm({
    username: USER.username,
    password: "sbagliata",
    next: NEXT,
  }, "webtools_locale=it");
  const html = await response.text();

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.match(html, /Username o password non validi/);
  // The username stays written, the password does not.
  assert.match(html, new RegExp(`value="${USER.username}"`));
});

test("logging out closes the shared session and removes the cookie", async () => {
  const archive = fakeAnagraphics();
  const sso = await start(archive);
  const entrato = await sso.loginForm({
    username: USER.username,
    password: PASSWORD,
    next: NEXT,
  });
  const cookie = cookieFrom(entrato);
  assert.equal(archive.sessions.size, 1);

  const uscito = await sso.page(`/ui/logout?next=${encodeURIComponent(NEXT)}`, cookie);
  assert.equal(uscito.status, 303);
  assert.equal(uscito.headers.get("location"), NEXT);
  assert.match(uscito.headers.getSetCookie()[0], /Max-Age=0/);
  // The session is gone: no subsystem recognises that token any more.
  assert.equal(archive.sessions.size, 0);
});

test("registration says it is not active", async () => {
  const sso = await start(fakeAnagraphics());
  const response = await sso.page(`/ui/register?next=${encodeURIComponent(NEXT)}`, "webtools_locale=it");
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /non è ancora attiva/);
});

test("exchange with an invalid body", async () => {
  const sso = await start(fakeAnagraphics());
  for (const body of [{}, { ticket: "x" }, { service: "http://127.0.0.1:9200" }]) {
    const response = await sso.exchange(body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "INVALID_BODY" });
  }
});

test("outside the IP pool nothing is visible", async () => {
  // An empty pool is the most direct way of being "outside": the call still starts
  // from 127.0.0.1, which is now no longer allowed.
  const sso = await start(fakeAnagraphics(), { ...SETTINGS, allowedIps: [] });
  for (const response of [
    await sso.login({ username: USER.username, password: PASSWORD }),
    await sso.session("token"),
    await sso.raw("/nope"),
  ]) {
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "IP_NOT_ALLOWED" });
  }
});

/* ---------------------------------------------------------- the language */

test("the page is in the cookie's language, and the switcher returns to the page", async () => {
  const sso = await start(fakeAnagraphics());
  const path = `/ui/login?next=${encodeURIComponent(NEXT)}`;

  const italiano = await (await sso.page(path, "webtools_locale=it")).text();
  assert.match(italiano, /<html lang="it">/);
  assert.match(italiano, /strumenti su misura/);
  assert.match(italiano, /name="return_to" value="\/ui\/login\?next=http%3A%2F%2F127\.0\.0\.1%3A9200%2F"/);

  const inglese = await (await sso.page(path, "webtools_locale=en")).text();
  assert.match(inglese, /<html lang="en">/);
  assert.match(inglese, /tailor-made tools/);
});

test("POST /locale writes the shared cookie and returns to the page", async () => {
  const sso = await start(fakeAnagraphics());
  const change = (body) =>
    sso.raw("/locale", {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

  const ok = await change("locale=it&return_to=%2Fui%2Flogin%3Fnext%3Dx");
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("location"), "/ui/login?next=x");
  assert.match(ok.headers.get("set-cookie"), /^webtools_locale=it; Path=\//);

  // The return is only a path of this server.
  const outside = await change("locale=it&return_to=%2F%2Fsito-finto.example");
  assert.equal(outside.headers.get("location"), "/");

  const unknown = await change("locale=xx&return_to=%2F");
  assert.equal(unknown.status, 400);
  assert.deepEqual(await unknown.json(), { error: "INVALID_LOCALE" });
});

test("at the first login the page's language becomes the profile's", async () => {
  const archive = fakeAnagraphics();
  const sso = await start(archive);
  const entrato = await sso.loginForm(
    { username: USER.username, password: PASSWORD, next: NEXT },
    "webtools_locale=it"
  );

  assert.equal(entrato.status, 303);
  assert.equal(archive.users[0].user.locale, "it");
  const [session] = archive.sessions.values();
  assert.equal(session.data.locale, "it");
  assert.ok(entrato.headers.getSetCookie().some((c) => c.startsWith("webtools_locale=it;")));
});

test("the profile's language wins over the page's, and rewrites the cookie", async () => {
  const archive = fakeAnagraphics({ users: [{ user: { ...USER, locale: "en" }, credential: CREDENTIAL }] });
  const sso = await start(archive);
  const entrato = await sso.loginForm(
    { username: USER.username, password: PASSWORD, next: NEXT },
    "webtools_locale=it"
  );

  assert.equal(archive.users[0].user.locale, "en");
  assert.ok(entrato.headers.getSetCookie().some((c) => c.startsWith("webtools_locale=en;")));
});

test("POST /session/locale: the language goes into the session and into the profile", async () => {
  const archive = fakeAnagraphics();
  const sso = await start(archive);
  const token = (await (await sso.login({ username: USER.username, password: PASSWORD })).json()).session.token;
  const change = (body, bearer = token) =>
    sso.raw("/session/locale", {
      method: "POST",
      headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    });

  const ok = await change({ locale: "it" });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).session.data.locale, "it");
  assert.equal(archive.users[0].user.locale, "it");

  const unknown = await change({ locale: "xx" });
  assert.equal(unknown.status, 400);
  assert.deepEqual(await unknown.json(), { error: "INVALID_LOCALE" });

  const noToken = await change({ locale: "it" }, null);
  assert.deepEqual(await noToken.json(), { error: "MISSING_TOKEN" });

  const otherToken = await change({ locale: "it" }, "token-that-does-not-exist");
  assert.deepEqual(await otherToken.json(), { logged: false });
});

test("the sso pages' switcher, for whoever has logged in, saves the language", async () => {
  const archive = fakeAnagraphics();
  const sso = await start(archive);
  const cookie = cookieFrom(await sso.loginForm({ username: USER.username, password: PASSWORD, next: NEXT }));

  const changed = await sso.raw("/locale", {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: "locale=it&return_to=%2Fui%2Fregister",
  });
  assert.equal(changed.status, 303);
  assert.equal(archive.users[0].user.locale, "it");
  const [session] = archive.sessions.values();
  assert.equal(session.data.locale, "it");
});
