// The HTTP server of webtools_workspaces. For programs only, never for browsers.
//
//   POST /projects/{project_id}/specs          body: the .md as it is
//        X-Spec-Origin: system | third_party   → 201 { project_id, version }
//        X-Uploaded-By: <uid>
//   GET  /projects/{project_id}/specs/latest   → 200 the .md, with X-Spec-Version
//
//   POST /projects/{project_id}/documents/{kind}         body: the .md as it is
//        kind: analysis | proposal            → 201 { project_id, kind, version }
//   GET  /projects/{project_id}/documents/{kind}/latest  → 200 the .md, with
//                                                          X-Document-Version
//
// The two families are described in store.js: a specification arrives and carries its
// origin and whoever sent it, a document is written by the system and carries neither.
// That is why the documents' routes take no headers.
//
// It stores and does not decide: it does not check that the project exists, nor
// whose it is. The caller does that, before sending the file.
//
// Errors: correct HTTP status and a stable code, { "error": "<CODE>" }.

import http from "node:http";

import { FrontMatterError } from "./commons/spec_front_matter.js";
import {
  DOCUMENT_KINDS,
  isProjectId,
  latestDocument,
  latestSpec,
  ORIGINS,
  writeDocument,
  writeSpec,
} from "./store.js";

export const INVALID_PROJECT_ID = "INVALID_PROJECT_ID";
export const INVALID_ORIGIN = "INVALID_ORIGIN";
export const MISSING_UPLOADER = "MISSING_UPLOADER";
export const EMPTY_SPEC = "EMPTY_SPEC";
export const SPEC_TOO_LARGE = "SPEC_TOO_LARGE";
export const NOT_UTF8 = "NOT_UTF8";
export const INVALID_FRONT_MATTER = "INVALID_FRONT_MATTER";
export const SPEC_NOT_FOUND = "SPEC_NOT_FOUND";
export const INVALID_KIND = "INVALID_KIND";
export const EMPTY_DOCUMENT = "EMPTY_DOCUMENT";
export const DOCUMENT_TOO_LARGE = "DOCUMENT_TOO_LARGE";
export const DOCUMENT_NOT_FOUND = "DOCUMENT_NOT_FOUND";
export const ROUTE_NOT_FOUND = "ROUTE_NOT_FOUND";
export const METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED";
export const IP_NOT_ALLOWED = "IP_NOT_ALLOWED";
export const INTERNAL_ERROR = "INTERNAL_ERROR";

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
  // Kept on the response so the one measurement per request can say **which** error it
  // was, without any branch of the routing having to count itself.
  response.webtoolsErrorCode = code;
  sendJson(response, status, { error: code }, headers);
}

// The whole body, or `null` if it goes over the limit. In that case the answer has
// already gone: first we answer, then we close, otherwise the client would never
// read the reason and would only see a dropped connection.
//
// Which code says "too large" belongs to the family being stored, so it is given:
// the limits are two configured fields and the two answers are told apart by whoever
// reads them.
async function readBody(request, response, maxBytes, tooLargeCode) {
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > maxBytes) {
      response.once("finish", () => request.destroy());
      sendError(response, 413, tooLargeCode, { connection: "close" });
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// The body as text, or `null` when it is empty or not UTF-8 — in which case the
// answer has already gone. `emptyCode` is the family's, as in readBody.
function textOf(body, response, emptyCode) {
  if (body.length === 0) {
    sendError(response, 400, emptyCode);
    return null;
  }
  try {
    // `fatal`: an invalid byte is an error, not a character silently replaced.
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    sendError(response, 400, NOT_UTF8);
    return null;
  }
}

async function receiveSpec(request, response, settings, [projectId]) {
  if (!isProjectId(projectId)) return sendError(response, 400, INVALID_PROJECT_ID);

  const origin = request.headers["x-spec-origin"];
  if (!ORIGINS.includes(origin)) return sendError(response, 400, INVALID_ORIGIN);
  const uploadedBy = (request.headers["x-uploaded-by"] ?? "").trim();
  if (!uploadedBy) return sendError(response, 400, MISSING_UPLOADER);

  const body = await readBody(request, response, settings.specMaxBytes, SPEC_TOO_LARGE);
  if (body === null) return;
  const text = textOf(body, response, EMPTY_SPEC);
  if (text === null) return;

  let result;
  try {
    result = await writeSpec(settings.root, projectId, text, { origin, uploadedBy });
  } catch (error) {
    if (error instanceof FrontMatterError) return sendError(response, 400, INVALID_FRONT_MATTER);
    throw error;
  }
  console.log(
    `[workspaces] ${projectId}: spec v${result.version} (${origin}, ${body.length} bytes) from ${uploadedBy}`
  );
  // A specification that was written, and how big it was. The origin is the one the
  // caller declared and the vocabulary closes — system or third party — and it is what
  // says whether we wrote it or somebody sent it to us.
  settings.metrics.measure("spec.written", {
    dims: { origin },
    bytes: body.length,
    project_id: projectId,
  });
  return sendJson(response, 201, { project_id: projectId, version: result.version });
}

async function serveLatest(request, response, settings, [projectId]) {
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

async function receiveDocument(request, response, settings, [projectId, kind]) {
  if (!isProjectId(projectId)) return sendError(response, 400, INVALID_PROJECT_ID);
  // The list is closed in store.js, and `prespec` is not in it: a pre-specification is
  // stored by the specs' route and has one place only.
  if (!DOCUMENT_KINDS.includes(kind)) return sendError(response, 400, INVALID_KIND);

  const body = await readBody(request, response, settings.documentMaxBytes, DOCUMENT_TOO_LARGE);
  if (body === null) return;
  const text = textOf(body, response, EMPTY_DOCUMENT);
  if (text === null) return;

  let result;
  try {
    result = await writeDocument(settings.root, projectId, kind, text);
  } catch (error) {
    if (error instanceof FrontMatterError) return sendError(response, 400, INVALID_FRONT_MATTER);
    throw error;
  }
  console.log(`[workspaces] ${projectId}: ${kind} v${result.version} (${body.length} bytes)`);
  // A document that was written, and how big it was. The kind is the dimension, and it
  // is left open by the vocabulary: which kinds exist belongs here, and a second copy
  // of the list would be one more thing to keep in step.
  settings.metrics.measure("document.written", {
    dims: { kind },
    bytes: body.length,
    project_id: projectId,
  });
  return sendJson(response, 201, { project_id: projectId, kind, version: result.version });
}

async function serveLatestDocument(request, response, settings, [projectId, kind]) {
  if (!isProjectId(projectId)) return sendError(response, 400, INVALID_PROJECT_ID);
  if (!DOCUMENT_KINDS.includes(kind)) return sendError(response, 400, INVALID_KIND);
  const document = await latestDocument(settings.root, projectId, kind);
  if (document === null) return sendError(response, 404, DOCUMENT_NOT_FOUND);
  response.writeHead(200, {
    "content-type": "text/markdown; charset=utf-8",
    "content-length": Buffer.byteLength(document.text),
    "cache-control": "no-store",
    "x-document-version": String(document.version),
  });
  response.end(document.text);
}

// The routes, with the pattern each one is measured under. One list serves the
// dispatch and the measurement, so a route added tomorrow is counted under its own
// name instead of falling into `(unknown)` until somebody notices.
//
// The pattern is the route as it is **written**, never the address as it was called: a
// raw path would make one bucket per project that ever stored a file, and the number
// of documents in metrics would grow with the traffic instead of with the number of
// kinds of thing measured.
const ROUTES = [
  {
    pattern: "/projects/{project_id}/specs",
    regex: /^\/projects\/([^/]+)\/specs$/,
    method: "POST",
    handle: receiveSpec,
  },
  {
    pattern: "/projects/{project_id}/specs/latest",
    regex: /^\/projects\/([^/]+)\/specs\/latest$/,
    method: "GET",
    handle: serveLatest,
  },
  {
    pattern: "/projects/{project_id}/documents/{kind}",
    regex: /^\/projects\/([^/]+)\/documents\/([^/]+)$/,
    method: "POST",
    handle: receiveDocument,
  },
  {
    pattern: "/projects/{project_id}/documents/{kind}/latest",
    regex: /^\/projects\/([^/]+)\/documents\/([^/]+)\/latest$/,
    method: "GET",
    handle: serveLatestDocument,
  },
];

// The route that matched and what the path carried, or `null` for a path that matches
// none of them.
function match(pathname) {
  for (const route of ROUTES) {
    const found = route.regex.exec(pathname);
    if (found) return { route, params: found.slice(1) };
  }
  return null;
}

// One measurement per request, sent when the response is done: the status and the
// duration are only known then.
function countRequest(settings, request, response, found) {
  const elapsed = settings.metrics.timer();
  const route = found?.route.pattern ?? "(unknown)";
  response.on("finish", () => {
    settings.metrics.measure("http.request", {
      dims: { route, method: request.method, status: String(response.statusCode) },
      duration_ms: elapsed(),
    });
    if (response.webtoolsErrorCode) {
      settings.metrics.measure("http.error", { dims: { code: response.webtoolsErrorCode } });
    }
  });
}

export function createServer(settings) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const found = match(url.pathname);
    countRequest(settings, request, response, found);

    try {
      // Listening on IPv6 the same address arrives as "::ffff:127.0.0.1": it is
      // the same IP written another way, not another caller.
      const remote = (request.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
      if (!settings.allowedIps.includes(remote)) {
        console.warn(`[workspaces] request from an IP outside the pool: ${remote}`);
        // Somebody knocking, or a subsystem started with the wrong configuration. In a
        // log it is a line nobody reads; here it is a number that grows.
        settings.metrics.measure("http.refused_ip");
        return sendError(response, 403, IP_NOT_ALLOWED);
      }

      if (found === null) return sendError(response, 404, ROUTE_NOT_FOUND);
      if (request.method !== found.route.method) {
        return sendError(response, 405, METHOD_NOT_ALLOWED);
      }
      return await found.route.handle(request, response, settings, found.params);
    } catch (error) {
      console.error(`[workspaces] error on ${url.pathname}: ${error.stack ?? error}`);
      if (!response.headersSent) sendError(response, 500, INTERNAL_ERROR);
    }
  });
}
