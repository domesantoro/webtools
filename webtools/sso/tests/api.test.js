// Le tre rotte, provate per intero ma senza anagraphics acceso: al suo posto
// c'è un archivio finto che risponde come risponderebbe lui, compresi i guasti.

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

// Archivio finto: utenti in una mappa, sessioni in un'altra. `broken` spegne
// tutto, come se anagraphics non rispondesse.
function fakeAnagraphics({ users: iniziali = [{ user: USER, credential: CREDENTIAL }], broken = false } = {}) {
  // Copie: la lingua salvata nel profilo di una prova non deve finire nella successiva.
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
    // Come anagraphics: legge e cancella insieme, quindi il secondo che passa
    // non trova più niente.
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

// Avvia il sso su una porta libera e restituisce come chiamarlo.
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
    // Le pagine: il browser non segue da solo i redirect, qui li guardiamo noi.
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

// Il valore del cookie da rimandare indietro, come farebbe un browser.
function cookieFrom(response, name = "webtools_sso") {
  const header = response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`${name}=([^;]*)`).exec(header);
  return match ? `${name}=${match[1]}` : null;
}

after(() => {
  for (const server of servers) server.close();
});

test("login, stato, logout: il giro completo", async () => {
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
  // La sessione è finita nell'archivio, non è rimasta dentro il sso.
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

test("una seconda sessione dello stesso utente non tocca la prima", async () => {
  const sso = await start(fakeAnagraphics());
  const credenziali = { username: USER.username, password: PASSWORD };
  const prima = (await (await sso.login(credenziali)).json()).session;
  const seconda = (await (await sso.login(credenziali)).json()).session;

  assert.notEqual(prima.token, seconda.token);
  await sso.logout(prima.token);
  assert.equal((await (await sso.session(seconda.token)).json()).logged, true);
});

test("tutti i modi di non entrare rispondono la stessa cosa", async () => {
  const archive = fakeAnagraphics({
    users: [
      { user: USER, credential: CREDENTIAL },
      { user: { ...USER, username: "senza@example.com" }, credential: null },
      { user: { ...USER, username: "spento@example.com", active: false }, credential: CREDENTIAL },
    ],
  });
  const sso = await start(archive);

  const tentativi = [
    { username: USER.username, password: "sbagliata" },
    { username: "sconosciuto@example.com", password: PASSWORD },
    { username: "senza@example.com", password: PASSWORD },
    { username: "spento@example.com", password: PASSWORD },
  ];
  for (const tentativo of tentativi) {
    const response = await sso.login(tentativo);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "INVALID_CREDENTIALS" });
  }
  assert.equal(archive.sessions.size, 0);
});

test("login con corpo non valido", async () => {
  const sso = await start(fakeAnagraphics());
  const corpi = [
    {},
    { username: USER.username },
    { username: USER.username, password: "" },
    { username: 42, password: PASSWORD },
    "non è json",
    "[]",
  ];
  for (const corpo of corpi) {
    const response = await sso.login(corpo);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "INVALID_BODY" });
  }
});

test("senza token non si chiede né lo stato né il logout", async () => {
  const sso = await start(fakeAnagraphics());
  for (const response of [await sso.session(null), await sso.logout(null)]) {
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "MISSING_TOKEN" });
  }
});

test("token sconosciuto: non loggato, e il logout resta ripetibile", async () => {
  const sso = await start(fakeAnagraphics());
  const status = await sso.session("token-che-non-esiste");
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { logged: false });

  const loggedOut = await sso.logout("token-che-non-esiste");
  assert.equal(loggedOut.status, 200);
  assert.deepEqual(await loggedOut.json(), { logged: false });
});

test("una sessione scaduta non è loggata", async () => {
  const archive = fakeAnagraphics();
  // TTL negativo: la sessione nasce già scaduta.
  const sso = await start(archive, { ...SETTINGS, sessionTtlSeconds: -1 });
  const { session } = await (await sso.login({ username: USER.username, password: PASSWORD })).json();

  const status = await sso.session(session.token);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { logged: false });
  // Non è stata cancellata dal sso: la toglie l'indice TTL di anagraphics.
  assert.equal(archive.sessions.has(session.token), true);
});

test("con anagraphics giù non si entra, e non si dice a nessuno che è uscito", async () => {
  const sso = await start(fakeAnagraphics({ broken: true }));

  for (const response of [
    await sso.login({ username: USER.username, password: PASSWORD }),
    // Qui sta il punto: rispondere { logged: false } farebbe sloggare tutti
    // a ogni guasto di Mongo. Non lo sappiamo, e lo diciamo.
    await sso.session("un-token-qualsiasi"),
    await sso.logout("un-token-qualsiasi"),
  ]) {
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "ANAGRAPHICS_UNAVAILABLE" });
  }
});

test("rotte e metodi", async () => {
  const sso = await start(fakeAnagraphics());

  const sconosciuta = await sso.raw("/nope");
  assert.equal(sconosciuta.status, 404);
  assert.deepEqual(await sconosciuta.json(), { error: "ROUTE_NOT_FOUND" });

  const metodoSbagliato = await sso.raw("/login");
  assert.equal(metodoSbagliato.status, 405);
  assert.deepEqual(await metodoSbagliato.json(), { error: "METHOD_NOT_ALLOWED" });
});

/* ----------------------------------------------- le pagine e i biglietti */

test("la pagina di login mostra il form, e ricorda dove tornare", async () => {
  const sso = await start(fakeAnagraphics());
  const response = await sso.page(`/ui/login?next=${encodeURIComponent(NEXT)}`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(html, /name="username"/);
  assert.match(html, /type="password"/);
  assert.match(html, /name="next" value="http:\/\/127\.0\.0\.1:9200\/"/);
});

test("un next fuori dagli indirizzi ammessi non viene usato", async () => {
  const sso = await start(fakeAnagraphics());
  const response = await sso.page("/ui/login?next=http://sito-finto.example/ruba");
  const html = await response.text();

  // Al suo posto c'è il primo indirizzo ammesso: la pagina di login non può
  // diventare il trampolino per mandare la gente dove capita.
  assert.doesNotMatch(html, /sito-finto/);
  assert.match(html, /name="next" value="http:\/\/127\.0\.0\.1:9200"/);
});

test("il giro completo del login dalle pagine", async () => {
  const archive = fakeAnagraphics();
  const sso = await start(archive);

  const entrato = await sso.loginForm({
    username: USER.username,
    password: PASSWORD,
    next: NEXT,
  });

  // Si torna al sottosistema, con il biglietto nell'indirizzo…
  assert.equal(entrato.status, 303);
  const location = new URL(entrato.headers.get("location"));
  assert.equal(location.origin, "http://127.0.0.1:9200");
  const ticket = location.searchParams.get("ticket");
  assert.ok(ticket);

  // …e il cookie del sso, che serve a non richiedere la password al prossimo
  // sottosistema. Il token non compare mai nell'indirizzo.
  const cookie = cookieFrom(entrato);
  assert.ok(cookie);
  assert.doesNotMatch(location.search, /token/);
  const setCookie = entrato.headers.getSetCookie()[0];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);

  // Lo scambio, da server a server: il sottosistema riceve la sessione.
  const scambiato = await sso.exchange({ ticket, service: "http://127.0.0.1:9200" });
  assert.equal(scambiato.status, 200);
  const body = await scambiato.json();
  assert.equal(body.logged, true);
  assert.equal(body.session.username, USER.username);

  // Il biglietto vale una volta sola.
  const ripetuto = await sso.exchange({ ticket, service: "http://127.0.0.1:9200" });
  assert.equal(ripetuto.status, 404);
  assert.deepEqual(await ripetuto.json(), { error: "TICKET_NOT_FOUND" });
});

test("chi è già entrato non ridigita la password", async () => {
  const archive = fakeAnagraphics();
  const sso = await start(archive);
  const cookie = cookieFrom(
    await sso.loginForm({ username: USER.username, password: PASSWORD, next: NEXT })
  );

  // Secondo sottosistema: stessa pagina di login, ma con il cookie in mano.
  const response = await sso.page(`/ui/login?next=${encodeURIComponent(NEXT)}`, cookie);
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("location"));
  assert.ok(location.searchParams.get("ticket"));

  // Una sola sessione per tutti e due: è il punto del single sign-on.
  assert.equal(archive.sessions.size, 1);
});

test("un biglietto emesso per un sottosistema non vale per un altro", async () => {
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

test("password sbagliata: si resta sulla pagina, senza cookie e senza biglietto", async () => {
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
  // Lo username resta scritto, la password no.
  assert.match(html, new RegExp(`value="${USER.username}"`));
});

test("esci chiude la sessione condivisa e toglie il cookie", async () => {
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
  // La sessione non c'è più: nessun sottosistema riconosce più quel token.
  assert.equal(archive.sessions.size, 0);
});

test("la registrazione dice che non è attiva", async () => {
  const sso = await start(fakeAnagraphics());
  const response = await sso.page(`/ui/register?next=${encodeURIComponent(NEXT)}`, "webtools_locale=it");
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /non è ancora attiva/);
});

test("scambio con corpo non valido", async () => {
  const sso = await start(fakeAnagraphics());
  for (const body of [{}, { ticket: "x" }, { service: "http://127.0.0.1:9200" }]) {
    const response = await sso.exchange(body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "INVALID_BODY" });
  }
});

test("fuori dal pool di IP non si vede niente", async () => {
  // Il pool vuoto è il modo più diretto per essere "fuori": la chiamata parte
  // comunque da 127.0.0.1, che ora non è più ammesso.
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

/* ------------------------------------------------------------- la lingua */

test("la pagina è nella lingua del cookie, e il selettore torna alla pagina", async () => {
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

test("POST /locale scrive il cookie comune e torna alla pagina", async () => {
  const sso = await start(fakeAnagraphics());
  const cambia = (body) =>
    sso.raw("/locale", {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

  const ok = await cambia("locale=it&return_to=%2Fui%2Flogin%3Fnext%3Dx");
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("location"), "/ui/login?next=x");
  assert.match(ok.headers.get("set-cookie"), /^webtools_locale=it; Path=\//);

  // Il ritorno è solo un percorso di questo server.
  const fuori = await cambia("locale=it&return_to=%2F%2Fsito-finto.example");
  assert.equal(fuori.headers.get("location"), "/");

  const sconosciuta = await cambia("locale=xx&return_to=%2F");
  assert.equal(sconosciuta.status, 400);
  assert.deepEqual(await sconosciuta.json(), { error: "INVALID_LOCALE" });
});

test("al primo login la lingua della pagina diventa quella del profilo", async () => {
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

test("la lingua del profilo vince su quella della pagina, e riscrive il cookie", async () => {
  const archive = fakeAnagraphics({ users: [{ user: { ...USER, locale: "en" }, credential: CREDENTIAL }] });
  const sso = await start(archive);
  const entrato = await sso.loginForm(
    { username: USER.username, password: PASSWORD, next: NEXT },
    "webtools_locale=it"
  );

  assert.equal(archive.users[0].user.locale, "en");
  assert.ok(entrato.headers.getSetCookie().some((c) => c.startsWith("webtools_locale=en;")));
});

test("POST /session/locale: la lingua va nella sessione e nel profilo", async () => {
  const archive = fakeAnagraphics();
  const sso = await start(archive);
  const token = (await (await sso.login({ username: USER.username, password: PASSWORD })).json()).session.token;
  const cambia = (body, bearer = token) =>
    sso.raw("/session/locale", {
      method: "POST",
      headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    });

  const ok = await cambia({ locale: "it" });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).session.data.locale, "it");
  assert.equal(archive.users[0].user.locale, "it");

  const sconosciuta = await cambia({ locale: "xx" });
  assert.equal(sconosciuta.status, 400);
  assert.deepEqual(await sconosciuta.json(), { error: "INVALID_LOCALE" });

  const senzaToken = await cambia({ locale: "it" }, null);
  assert.deepEqual(await senzaToken.json(), { error: "MISSING_TOKEN" });

  const altroToken = await cambia({ locale: "it" }, "token-che-non-esiste");
  assert.deepEqual(await altroToken.json(), { logged: false });
});

test("il selettore delle pagine del sso, per chi è entrato, salva la lingua", async () => {
  const archive = fakeAnagraphics();
  const sso = await start(archive);
  const cookie = cookieFrom(await sso.loginForm({ username: USER.username, password: PASSWORD, next: NEXT }));

  const cambiato = await sso.raw("/locale", {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: "locale=it&return_to=%2Fui%2Fregister",
  });
  assert.equal(cambiato.status, 303);
  assert.equal(archive.users[0].user.locale, "it");
  const [session] = archive.sessions.values();
  assert.equal(session.data.locale, "it");
});
