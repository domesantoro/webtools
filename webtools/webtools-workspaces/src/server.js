// Server HTTP di webtools_workspaces. Solo per i programmi, mai per i browser.
//
//   POST /projects/{project_id}/specs          corpo: il .md così com'è
//        X-Spec-Origin: system | third_party   → 201 { project_id, version }
//        X-Uploaded-By: <uid>
//   GET  /projects/{project_id}/specs/latest   → 200 il .md, con X-Spec-Version
//
// Conserva e non decide: non verifica che il progetto esista né di chi sia.
// Quello lo fa chi chiama, prima di mandare il file.
//
// Errori: stato HTTP corretto e codice stabile, { "error": "<CODICE>" }.

import http from "node:http";

import { FrontMatterError } from "./commons/spec_front_matter.js";
import { isProjectId, latestSpec, ORIGINS, writeSpec } from "./store.js";

export const INVALID_PROJECT_ID = "INVALID_PROJECT_ID";
export const INVALID_ORIGIN = "INVALID_ORIGIN";
export const MISSING_UPLOADER = "MISSING_UPLOADER";
export const EMPTY_SPEC = "EMPTY_SPEC";
export const SPEC_TOO_LARGE = "SPEC_TOO_LARGE";
export const NOT_UTF8 = "NOT_UTF8";
export const INVALID_FRONT_MATTER = "INVALID_FRONT_MATTER";
export const SPEC_NOT_FOUND = "SPEC_NOT_FOUND";
export const ROUTE_NOT_FOUND = "ROUTE_NOT_FOUND";
export const METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED";
export const IP_NOT_ALLOWED = "IP_NOT_ALLOWED";
export const INTERNAL_ERROR = "INTERNAL_ERROR";

const SPECS = /^\/projects\/([^/]+)\/specs$/;
const LATEST = /^\/projects\/([^/]+)\/specs\/latest$/;

function sendJson(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...headers,
  });
  response.end(body);
}

function sendError(response, status, code, headers = {}) {
  sendJson(response, status, { error: code }, headers);
}

// Il corpo intero, oppure `null` se supera il limite. In quel caso la risposta
// è già partita: prima si risponde, poi si chiude, altrimenti il client non
// leggerebbe mai il motivo e vedrebbe solo una connessione caduta.
async function readBody(request, response, maxBytes) {
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > maxBytes) {
      response.once("finish", () => request.destroy());
      sendError(response, 413, SPEC_TOO_LARGE, { connection: "close" });
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function receiveSpec(request, response, settings, projectId) {
  if (!isProjectId(projectId)) return sendError(response, 400, INVALID_PROJECT_ID);

  const origin = request.headers["x-spec-origin"];
  if (!ORIGINS.includes(origin)) return sendError(response, 400, INVALID_ORIGIN);
  const uploadedBy = (request.headers["x-uploaded-by"] ?? "").trim();
  if (!uploadedBy) return sendError(response, 400, MISSING_UPLOADER);

  const body = await readBody(request, response, settings.specMaxBytes);
  if (body === null) return;
  if (body.length === 0) return sendError(response, 400, EMPTY_SPEC);

  let text;
  try {
    // `fatal`: un byte non valido è un errore, non un carattere sostituito in silenzio.
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return sendError(response, 400, NOT_UTF8);
  }

  let result;
  try {
    result = await writeSpec(settings.root, projectId, text, { origin, uploadedBy });
  } catch (error) {
    if (error instanceof FrontMatterError) return sendError(response, 400, INVALID_FRONT_MATTER);
    throw error;
  }
  console.log(
    `[workspaces] ${projectId}: specifica v${result.version} (${origin}, ${body.length} byte) da ${uploadedBy}`
  );
  return sendJson(response, 201, { project_id: projectId, version: result.version });
}

async function serveLatest(response, settings, projectId) {
  if (!isProjectId(projectId)) return sendError(response, 400, INVALID_PROJECT_ID);
  const spec = await latestSpec(settings.root, projectId);
  if (spec === null) return sendError(response, 404, SPEC_NOT_FOUND);
  response.writeHead(200, {
    "content-type": "text/markdown; charset=utf-8",
    "content-length": Buffer.byteLength(spec.text),
    "cache-control": "no-store",
    "x-spec-version": String(spec.version),
  });
  response.end(spec.text);
}

export function createServer(settings) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");

    try {
      // In ascolto su IPv6 lo stesso indirizzo arriva come "::ffff:127.0.0.1":
      // è lo stesso IP scritto in un altro modo, non un altro chiamante.
      const remote = (request.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
      if (!settings.allowedIps.includes(remote)) {
        console.warn(`[workspaces] richiesta da IP fuori dal pool: ${remote}`);
        return sendError(response, 403, IP_NOT_ALLOWED);
      }

      const specs = SPECS.exec(url.pathname);
      if (specs) {
        if (request.method !== "POST") return sendError(response, 405, METHOD_NOT_ALLOWED);
        return await receiveSpec(request, response, settings, specs[1]);
      }
      const latest = LATEST.exec(url.pathname);
      if (latest) {
        if (request.method !== "GET") return sendError(response, 405, METHOD_NOT_ALLOWED);
        return await serveLatest(response, settings, latest[1]);
      }
      return sendError(response, 404, ROUTE_NOT_FOUND);
    } catch (error) {
      console.error(`[workspaces] errore su ${url.pathname}: ${error.stack ?? error}`);
      if (!response.headersSent) sendError(response, 500, INTERNAL_ERROR);
    }
  });
}
