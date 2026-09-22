// Server HTTP del sito vetrina.
//
// Le pagine si rendono dai template, con i valori della configurazione letta
// all'avvio (vedi settings.js); tutto il resto sono file di public/.
//
//   GET  /, /<pagina>.html   la pagina, da templates/<pagina>.njk
//   GET  /<file>             public/<file>
//   POST /locale             cambia la lingua (cookie comune) e torna alla pagina
//
// Gli errori seguono il contratto del progetto: stato HTTP corretto e codice
// stabile, { "error": "<CODICE>" }.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PAGES, renderPage } from "./page.js";

export const ROUTE_NOT_FOUND = "ROUTE_NOT_FOUND";
export const METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED";
export const INTERNAL_ERROR = "INTERNAL_ERROR";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function sendError(response, status, code) {
  const body = JSON.stringify({ error: code });
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function servePage(template, settings, response, ui) {
  const html = renderPage(template, settings, ui);
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
  });
  response.end(html);
}

async function serveStatic(pathname, response) {
  // Solo file dentro public/: path.normalize toglie i "..".
  const relative = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const file = path.join(PUBLIC_DIR, relative);
  // Tentativo di uscire da public/ con dei "..": per chi chiama è come se il
  // file non esistesse.
  if (!file.startsWith(PUBLIC_DIR)) return sendError(response, 404, ROUTE_NOT_FOUND);

  let info;
  try {
    info = await stat(file);
  } catch {
    return sendError(response, 404, ROUTE_NOT_FOUND);
  }
  if (!info.isFile()) return sendError(response, 404, ROUTE_NOT_FOUND);

  response.writeHead(200, {
    "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
    "content-length": info.size,
  });
  createReadStream(file).pipe(response);
}

function redirect(response, location, headers = {}) {
  response.writeHead(303, { location, "cache-control": "no-store", ...headers });
  response.end();
}

// Il selettore della lingua, in testata su ogni pagina. Scrive il cookie comune
// e torna alla pagina da cui è partito: gli altri sottosistemi leggono lo stesso
// cookie, quindi cambiano lingua anche loro alla prossima pagina. Qui non c'è
// nessuna sessione da aggiornare: il sito vetrina non sa chi è entrato.
async function changeLocale(request, settings, response) {
  const change = await settings.i18n.readChange(request);
  if (!change.ok) return sendError(response, change.status, change.code);
  return redirect(response, change.location, { "set-cookie": change.cookie });
}

export function createServer(settings) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    try {
      if (request.method === "POST" && url.pathname === "/locale") {
        return await changeLocale(request, settings, response);
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return sendError(response, 405, METHOD_NOT_ALLOWED);
      }
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        // Un "%" non valido nell'indirizzo: nessun file può chiamarsi così.
        return sendError(response, 404, ROUTE_NOT_FOUND);
      }
      const template = PAGES[pathname];
      if (template) return servePage(template, settings, response, settings.i18n.pageContext(request, url));
      return await serveStatic(pathname, response);
    } catch (error) {
      console.error(`[front-gate] errore su ${request.method} ${url.pathname}: ${error.stack ?? error}`);
      if (!response.headersSent) sendError(response, 500, INTERNAL_ERROR);
    }
  });
}
