// The HTTP server of the configurator's front end.
//
//   GET /            the configuration that is in Mongo, read-only
//   GET /<file>      public/<file>
//
// Nothing is written: the page has no form and no route that changes anything.
// Changing a value stays what it was — edit the file in
// webtools/configurator/configuration/, run load_configuration.sh, restart
// whoever reads it.
//
// The errors of the routes that are not the page follow the project's contract:
// correct HTTP status and a stable code, {"error": "<CODE>"}. The page itself is
// another matter: when the configuration cannot be read it is still rendered, and
// it says what did not work. Whoever opens this page opens it precisely when
// something is not answering.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readConfigurations } from "./anagraphics.js";
import { renderConfigurationPage } from "./page.js";
import { readSecretPaths } from "./secrets.js";
import { buildView } from "./view.js";

export const ROUTE_NOT_FOUND = "ROUTE_NOT_FOUND";
export const METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED";
export const IP_NOT_ALLOWED = "IP_NOT_ALLOWED";
export const INTERNAL_ERROR = "INTERNAL_ERROR";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendError(response, status, code) {
  const body = JSON.stringify({ error: code });
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function servePage(settings, response) {
  // Both readings happen at every request: the page's whole point is saying what
  // is in Mongo *now*, and a copy kept in memory would be exactly the stale answer
  // somebody came here to check against.
  const [read, secrets] = await Promise.all([
    readConfigurations(settings),
    readSecretPaths(settings.secretsDirectory),
  ]);
  const view = buildView({
    configurations: read.ok ? read.configurations : [],
    secrets,
    environment: process.env,
    readAt: new Date(),
    failure: read.ok ? null : read.error,
  });
  const html = renderConfigurationPage(view);
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    // What is shown is the state of another system: a page taken from the cache
    // would be a reading of a moment nobody asked about.
    "cache-control": "no-store",
  });
  response.end(html);
}

async function serveStatic(pathname, response) {
  // Only files inside public/: path.normalize strips the "..".
  const relative = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const file = path.join(PUBLIC_DIR, relative);
  // An attempt to get out of public/ with "..": to the caller it is as if the file
  // did not exist.
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

export function createServer(settings) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

    // The IP pool comes before everything. Only the connection's IP counts.
    // Listening on IPv6 the same address arrives as "::ffff:127.0.0.1": it is the
    // same IP written another way, not another caller.
    const remote = (request.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
    if (!settings.allowedIps.includes(remote)) {
      console.warn(`[configurator-fe] request from an IP outside the pool: ${remote}`);
      return sendError(response, 403, IP_NOT_ALLOWED);
    }

    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return sendError(response, 405, METHOD_NOT_ALLOWED);
      }
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        // An invalid "%" in the address: no file can be called that.
        return sendError(response, 404, ROUTE_NOT_FOUND);
      }
      if (pathname === "/") return await servePage(settings, response);
      return await serveStatic(pathname, response);
    } catch (error) {
      console.error(`[configurator-fe] error on ${request.method} ${url.pathname}: ${error.stack ?? error}`);
      if (!response.headersSent) sendError(response, 500, INTERNAL_ERROR);
    }
  });
}
