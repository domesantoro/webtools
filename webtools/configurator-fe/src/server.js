// The HTTP server of the configurator's front end.
//
//   GET  /                   the configuration that is in Mongo, read
//   GET  /providers/pricing  the prices of the providers' models, to be written
//   POST /providers/pricing  writes one of them
//   GET  /<file>             public/<file>
//
// **Two pages, and they are two on purpose.** `/` is read: it says what is
// running, and it is opened precisely when something has to be checked. The forms
// are not on it — a form in the middle of a reading is a click away from a write
// nobody meant — they are on `/providers/pricing`, which is the page that
// changes something, and the two link to each other.
//
// **One thing is written, and it is one key.** `POST /providers/pricing` sends
// anagraphics the `pricing` of a provider object and nothing else; anagraphics
// refuses a path that does not name one. Every other value stays what it was —
// edit the file in webtools/configurator/configuration/, run
// load_configuration.sh, restart whoever reads it.
//
// A write answers with a redirect to that same page, which says what happened
// next to the form it happened to. So a reload re-reads, and does not write a
// second time.
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

import { readConfigurations, writePricing } from "./anagraphics.js";
import { renderConfigurationPage, renderPricingPage } from "./page.js";
import { readPricingForm } from "./pricing_form.js";
import { readSecretPaths } from "./secrets.js";
import { buildPricingView, buildView } from "./view.js";

export const ROUTE_NOT_FOUND = "ROUTE_NOT_FOUND";
export const METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED";
export const IP_NOT_ALLOWED = "IP_NOT_ALLOWED";
export const INTERNAL_ERROR = "INTERNAL_ERROR";
export const UNSUPPORTED_MEDIA_TYPE = "UNSUPPORTED_MEDIA_TYPE";
export const BODY_TOO_LARGE = "BODY_TOO_LARGE";
export const INVALID_FORM = "INVALID_FORM";

export const PRICING_ROUTE = "/providers/pricing";

// How long a reason may be when it comes back on the address bar. It is put
// there by the redirect below, so it is ours — but the address can be typed, and
// a page is not made to print whatever is typed into it.
const REASON_MAX_CHARS = 200;

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendError(response, status, code) {
  // The code is kept on the response so the one measurement per request — sent when
  // the response is done — can say **which** error it was. No branch of the routing
  // has to remember to count itself.
  response.webtoolsErrorCode = code;
  const body = JSON.stringify({ error: code });
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

// What the last write said, read back off the address the redirect sent the
// browser to — the page with the forms, which is where a write comes from and
// where its outcome is read. All three of subsystem, path and outcome must be there: two of
// them are a sentence with nothing to attach it to.
function outcomeFrom(parameters) {
  const subsystem = parameters.get("pricing_subsystem");
  const path = parameters.get("pricing_path");
  const outcome = parameters.get("pricing_outcome");
  if (!subsystem || !path || (outcome !== "written" && outcome !== "not_written")) return null;
  return {
    subsystem,
    path,
    written: outcome === "written",
    reason: (parameters.get("pricing_reason") ?? "").slice(0, REASON_MAX_CHARS) || null,
  };
}

// What both pages read: the documents, and which paths are secret. Both readings
// happen at every request — the point of these pages is saying what is in Mongo
// *now*, and a copy kept in memory would be exactly the stale answer somebody
// came here to check against.
function read(settings) {
  return Promise.all([readConfigurations(settings), readSecretPaths(settings.secretsDirectory)]);
}

function sendPage(response, html) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    // What is shown is the state of another system: a page taken from the cache
    // would be a reading of a moment nobody asked about.
    "cache-control": "no-store",
  });
  response.end(html);
}

async function servePage(settings, response) {
  const [configurations, secrets] = await read(settings);
  const view = buildView({
    configurations: configurations.ok ? configurations.configurations : [],
    secrets,
    environment: process.env,
    readAt: new Date(),
    failure: configurations.ok ? null : configurations.error,
  });
  sendPage(response, renderConfigurationPage(view));
}

// The other page: the same provider objects, with a form each. `outcome` is what
// the write before this request answered, read off the address the redirect sent
// the browser to.
async function servePricingPage(settings, response, outcome) {
  const [configurations, secrets] = await read(settings);
  const view = buildPricingView({
    configurations: configurations.ok ? configurations.configurations : [],
    secrets,
    readAt: new Date(),
    failure: configurations.ok ? null : configurations.error,
    currencies: settings.currencies,
    outcome,
  });
  sendPage(response, renderPricingPage(view));
}

// The form's body, up to the configured ceiling. Read here and nowhere else:
// it is the only body this server reads.
//
// → { ok: true, text } | { ok: false, code }
async function readFormBody(request, maxBytes) {
  const type = (request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") return { ok: false, code: UNSUPPORTED_MEDIA_TYPE };

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    // The ceiling is checked while reading, not after: a body too large must not
    // be held in memory in order to be refused.
    if (size > maxBytes) return { ok: false, code: BODY_TOO_LARGE };
    chunks.push(chunk);
  }
  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

// Back to the page, with what happened on the address. POST answers a redirect
// and not a page, so that a reload re-reads the configuration instead of writing
// the same price again under a new date.
function backToPage(response, { subsystem, providerPath, written, reason = null }) {
  const parameters = new URLSearchParams({
    pricing_subsystem: subsystem,
    pricing_path: providerPath,
    pricing_outcome: written ? "written" : "not_written",
  });
  if (reason) parameters.set("pricing_reason", reason.slice(0, REASON_MAX_CHARS));
  response.writeHead(303, {
    location: `${PRICING_ROUTE}?${parameters}`,
    "cache-control": "no-store",
  });
  response.end();
}

async function writeProviderPricing(settings, request, response) {
  const body = await readFormBody(request, settings.pricingBodyMaxBytes);
  if (!body.ok) {
    return sendError(response, body.code === BODY_TOO_LARGE ? 413 : 415, body.code);
  }

  const form = readPricingForm(body.text);
  if (!form.ok) {
    // Without a target there is no form on the page to put the sentence beside,
    // and the request did not come from one: it is an error of the request.
    if (!form.target) return sendError(response, 400, INVALID_FORM);
    return backToPage(response, { ...form.target, written: false, reason: form.code });
  }

  const written = await writePricing(settings, form);
  return backToPage(response, {
    subsystem: form.subsystem,
    providerPath: form.providerPath,
    written: written.ok,
    reason: written.ok ? null : written.error,
  });
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

// One measurement per request, sent when the response is done: the status and the
// duration are only known then. This subsystem has no ids in its addresses, so a known
// route is counted under its own path and everything else under a label — never a raw
// path, which would make one bucket per file ever asked for.
function countRequest(settings, request, response, pathname) {
  const elapsed = settings.metrics.timer();
  response.on("finish", () => {
    settings.metrics.measure("http.request", {
      dims: {
        route: pathname === "/" || pathname === PRICING_ROUTE ? pathname : "(static)",
        method: request.method,
        status: String(response.statusCode),
      },
      duration_ms: elapsed(),
    });
    // The error's own code, where there was one. A status says how it went; the code
    // says what it was, and only one of the two can be acted on.
    if (response.webtoolsErrorCode) {
      settings.metrics.measure("http.error", { dims: { code: response.webtoolsErrorCode } });
    }
  });
}

export function createServer(settings) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    countRequest(settings, request, response, url.pathname);

    // The IP pool comes before everything. Only the connection's IP counts.
    // Listening on IPv6 the same address arrives as "::ffff:127.0.0.1": it is the
    // same IP written another way, not another caller.
    const remote = (request.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
    if (!settings.allowedIps.includes(remote)) {
      console.warn(`[configurator-fe] request from an IP outside the pool: ${remote}`);
      // Somebody knocking, or a subsystem started with the wrong configuration. In a
      // log it is a line nobody reads; here it is a number that grows.
      settings.metrics.measure("http.refused_ip");
      return sendError(response, 403, IP_NOT_ALLOWED);
    }

    try {
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        // An invalid "%" in the address: no file can be called that.
        return sendError(response, 404, ROUTE_NOT_FOUND);
      }

      // The one route that writes, and the one method it takes. The same address
      // read is the page with the forms on it.
      if (request.method === "POST" && pathname === PRICING_ROUTE) {
        return await writeProviderPricing(settings, request, response);
      }
      // Everything else is read. A method that is not a reading is refused
      // wherever it is sent: no other address takes one.
      if (request.method !== "GET" && request.method !== "HEAD") {
        return sendError(response, 405, METHOD_NOT_ALLOWED);
      }
      if (pathname === PRICING_ROUTE) {
        return await servePricingPage(settings, response, outcomeFrom(url.searchParams));
      }
      if (pathname === "/") return await servePage(settings, response);
      return await serveStatic(pathname, response);
    } catch (error) {
      console.error(`[configurator-fe] error on ${request.method} ${url.pathname}: ${error.stack ?? error}`);
      if (!response.headersSent) sendError(response, 500, INTERNAL_ERROR);
    }
  });
}
