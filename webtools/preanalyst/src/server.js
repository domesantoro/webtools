// Server HTTP: una sola pagina più i file statici di public/.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { listDrivers } from "./anagraphics.js";
import {
  claimTicket,
  clearSessionCookie,
  currentSession,
  logoutUrl,
  sessionCookie,
  ticketFrom,
} from "./commons/sso_client.js";
import { NONE, resolveReferral, withoutOwnReferral } from "./referral.js";
import { renderAccessFragments, renderLoginDone, renderPage } from "./page.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function send(response, status, contentType, body) {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}

function redirect(response, location, headers = {}) {
  response.writeHead(303, { location, "cache-control": "no-store", ...headers });
  response.end();
}

// Quanto manca alla scadenza della sessione. Il cookie non deve sopravvivere
// alla sessione che rappresenta, quindi la durata non si decide qui: si legge.
function secondsUntil(moment) {
  const scadenza = Date.parse(moment ?? "");
  if (Number.isNaN(scadenza)) return 0;
  return Math.max(0, Math.floor((scadenza - Date.now()) / 1000));
}

// `/login-done`: qui arriva la **finestra del login**, non la pagina di partenza.
// Si scambia il biglietto, si mette il cookie e si rende una paginetta che avvisa
// la finestra di partenza e si chiude da sola (`public/sso_popup.js`).
//
// Il ritorno non avviene sulla pagina della pre-analisi di proposito: ci
// arriverebbe la finestra sbagliata, aprendo una seconda copia del form e
// lasciando quella vera convinta che non sia entrato nessuno.
async function finishLogin(url, settings, response, ticket) {
  const html = (ok) => send(response, 200, "text/html; charset=utf-8", renderLoginDone({ ok }));

  if (!ticket) {
    // Qualcuno è arrivato qui a mano, senza passare dal login.
    return html(false);
  }

  const claimed = await claimTicket(settings, ticket);
  if (!claimed.ok || !claimed.logged) {
    console.warn("[preanalyst] biglietto non valido al ritorno dal login");
    return html(false);
  }

  const durata = secondsUntil(claimed.session.expires_at);
  if (durata === 0) {
    console.warn("[preanalyst] sessione già scaduta al ritorno dal login");
    return html(false);
  }

  console.log(`[preanalyst] entrato ${claimed.session.username}`);
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "set-cookie": sessionCookie(settings, claimed.session.token, durata),
  });
  return response.end(renderLoginDone({ ok: true }));
}

// I pezzi della pagina che dipendono da chi è entrato, già resi dai template.
// Li chiede il browser dopo un login fatto nella finestra a parte, e li mette al
// posto di quelli vecchi: il form non viene toccato, e non si ricarica niente.
//
// Il browser manda anche i parametri dell'indirizzo (`?discount=`, `?driver=`)
// perché la colonna destra dipende da quelli: dopo il login può cambiare, per
// esempio se chi è entrato è il driver del link.
async function serveAccessFragments(request, url, settings, response) {
  const stato = await pageState(request, url, settings);
  const body = JSON.stringify(renderAccessFragments(stato.access, settings, stato));
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

/* ------------------------------------------------------- il caricamento */

// `POST /upload` — un'analisi già pronta.
//
// Il file arriva **nel corpo così com'è**, con il nome in `X-File-Name`: per un
// file solo non serve un form multipart, e senza multipart non serve niente per
// smontarlo. Il tipo dichiarato non si guarda: non è un controllo di sicurezza,
// e chi vuole mentire mente comunque.
//
// Oggi il file **non si conserva**: si conta, si scrive nel log e si butta. Serve
// a fissare il contratto — chi può caricare, con che limiti, che cosa risponde —
// prima di decidere dove finiranno davvero questi file.
//
// Le risposte seguono il contratto delle API del progetto, stato HTTP più codice
// stabile: qui non si parla a una persona ma al JavaScript della pagina.
async function receiveUpload(request, settings, response) {
  const rispondi = (status, payload, headers = {}) => {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
      ...headers,
    });
    response.end(body);
  };

  // Caricare è un'azione, non una lettura: serve essere dentro.
  const accesso = await currentSession(settings, request);
  if (!accesso.ok) return rispondi(503, { error: "SSO_UNAVAILABLE" });
  if (!accesso.logged) return rispondi(401, { error: "NOT_LOGGED" });

  const nome = fileName(request);
  if (!nome) return rispondi(400, { error: "MISSING_FILE_NAME" });

  let ricevuti = 0;
  for await (const pezzo of request) {
    ricevuti += pezzo.length;
    if (ricevuti > settings.uploadMaxBytes) {
      // Prima si risponde, poi si chiude: chiudendo subito il client non
      // leggerebbe mai il motivo, e si vedrebbe solo una connessione caduta.
      // `connection: close` perché il resto del file, che sta ancora arrivando,
      // non lo si vuole né leggere né aspettare.
      response.once("finish", () => request.destroy());
      return rispondi(413, { error: "FILE_TOO_LARGE" }, { connection: "close" });
    }
    // Il contenuto non si tiene: non c'è ancora un posto dove metterlo.
  }
  if (ricevuti === 0) return rispondi(400, { error: "EMPTY_FILE" });

  console.log(
    `[preanalyst] analisi caricata da ${accesso.session.username}: ` +
      `${nome} (${ricevuti} byte) — non conservata`
  );
  return rispondi(201, { received: true, name: nome, bytes: ricevuti });
}

// Il nome arriva codificato nell'header, perché un header porta solo ASCII e un
// nome di file può avere accenti. Si tiene solo l'ultima parte: un nome con dei
// percorsi dentro è un tentativo, non un nome.
function fileName(request) {
  const grezzo = request.headers["x-file-name"];
  if (!grezzo) return null;
  let nome;
  try {
    nome = decodeURIComponent(grezzo);
  } catch {
    return null;
  }
  nome = nome.split(/[/\\]/).pop().trim();
  return nome && nome !== "." && nome !== ".." ? nome.slice(0, 200) : null;
}

// "Esci" esce da tutto: prima si toglie il cookie nostro, poi si manda il
// browser al sso, che chiude la sessione condivisa e toglie il suo. Da lì in
// avanti nessun sottosistema riconosce più quel token.
function leave(settings, response) {
  return redirect(response, logoutUrl(settings, `${settings.publicUrl}/`), {
    "set-cookie": clearSessionCookie(settings),
  });
}

// Tutto ciò che serve a disegnare la pagina: chi è entrato, da dove arriva.
// Sta in un posto solo perché lo usano sia la pagina intera sia i frammenti che
// il browser chiede dopo il login: le due strade devono vedere la stessa cosa.
async function pageState(request, url, settings) {
  // Chi sta guardando la pagina. Tre esiti, e sono tre cose diverse: loggato,
  // non loggato, oppure "non lo sappiamo" perché il sso non risponde. L'ultimo
  // non si tratta come un logout.
  const accesso = await currentSession(settings, request);
  const access = {
    logged: accesso.ok ? accesso.logged : false,
    session: accesso.ok ? accesso.session : null,
    ssoAvailable: accesso.ok,
  };

  // Chi è entrato è anche un driver? L'uid del suo documento in `drivers` viene
  // dalla sessione, fotografato al login.
  const ownDriverUid = access.logged ? (access.session.data?.driver_uid ?? null) : null;

  const params = {
    discountCode: url.searchParams.get("discount"),
    driverUid: url.searchParams.get("driver"),
  };

  // Il box del driver si vede solo a chi è arrivato dal link di un driver.
  // Per tutti gli altri non c'è nessuna scelta da fare, quindi non c'è box e
  // non serve nemmeno chiedere l'elenco ad anagraphics.
  const showDriverBox = Boolean(params.discountCode || params.driverUid);

  let drivers = [];
  let driversAvailable = true;
  let referral = { state: NONE };

  if (showDriverBox) {
    const driversResult = await listDrivers(settings);
    driversAvailable = driversResult.ok;
    drivers = driversResult.ok ? driversResult.data : [];
    // Senza elenco non si può risolvere niente: il box lo dice e la pre-analisi
    // continua lo stesso, perché scegliere il driver è facoltativo.
    referral = driversResult.ok ? await resolveReferral(settings, params, drivers) : { state: NONE };
    // Un driver non si manda un cliente da solo: il proprio sconto e il proprio
    // link non valgono. Quelli di altri driver sì.
    referral = withoutOwnReferral(referral, ownDriverUid);
  }

  return {
    access,
    params,
    referral,
    showDriverBox,
    driversAvailable,
    isDriver: Boolean(ownDriverUid),
  };
}

async function servePage(request, url, settings, response) {
  const stato = await pageState(request, url, settings);
  const html = renderPage({ ...stato, settings });
  send(response, 200, "text/html; charset=utf-8", html);
}

async function serveStatic(pathname, response) {
  // Solo file dentro public/: path.normalize toglie i "..".
  const relative = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const file = path.join(PUBLIC_DIR, relative);
  if (!file.startsWith(PUBLIC_DIR)) {
    return send(response, 403, "text/plain; charset=utf-8", "Vietato");
  }

  let info;
  try {
    info = await stat(file);
  } catch {
    return send(response, 404, "text/plain; charset=utf-8", "Non trovato");
  }
  if (!info.isFile()) {
    return send(response, 404, "text/plain; charset=utf-8", "Non trovato");
  }

  response.writeHead(200, {
    "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
    "content-length": info.size,
  });
  createReadStream(file).pipe(response);
}

export function createServer(settings) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

    try {
      if (request.method === "POST" && url.pathname === "/upload") {
        return await receiveUpload(request, settings, response);
      }
      if (request.method !== "GET") {
        return send(response, 405, "text/plain; charset=utf-8", "Metodo non ammesso");
      }

      if (url.pathname === "/") {
        return await servePage(request, url, settings, response);
      }
      if (url.pathname === "/login-done") {
        return await finishLogin(url, settings, response, ticketFrom(url));
      }
      if (url.pathname === "/session-fragment") {
        return await serveAccessFragments(request, url, settings, response);
      }
      if (url.pathname === "/logout") {
        return leave(settings, response);
      }
      return await serveStatic(url.pathname, response);
    } catch (error) {
      console.error(`[preanalyst] errore su ${url.pathname}: ${error.stack ?? error}`);
      if (!response.headersSent) {
        send(response, 500, "text/plain; charset=utf-8", "Errore interno");
      }
    }
  });
}
