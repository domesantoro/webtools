// The HTTP server of the metrics front end.
//
//   GET /                the three questions this front end exists to answer
//   GET /<question>      one page per question metrics answers
//   GET /daily           the buckets every figure is computed from
//   GET /projects?id=    one project's accumulator
//   GET /vocabulary      what may be sent
//   GET /<file>          public/<file>
//
// **Nothing here writes.** Not to metrics, not to anagraphics, not anywhere: metrics
// is written to by whoever measures, and a measurement is not something a page sends.
// So every address takes a reading and nothing else, and a method that is not a
// reading is refused wherever it is sent.
//
// The period is two days on the address (`?from=&to=`), and it is read once per
// request: the pages are drawn from the same slice, and a page that chose its own
// would be a figure nobody could compare with the one beside it.
//
// The errors of the routes that are not a page follow the project's contract:
// correct HTTP status and a stable code, {"error": "<CODE>"}. A page is another
// matter — when metrics cannot be read it is still drawn, and it says what did not
// answer. Whoever opens a dashboard opens it precisely when something is not
// answering.
//
// Nothing on these pages refreshes by itself, and nothing opens by itself. A picture
// that changed while it was being read would be a reading of a moment nobody asked
// about; the bar at the top says when it was read, and reading it again is a click.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { failures, truncations } from "./figures.js";
import { renderPage } from "./page.js";
import { navigation, pageAt } from "./pages.js";
import { dayOf, readPeriod } from "./period.js";

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

function sendPage(response, html, status = 200) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    // What is shown is the state of another system at one moment. A page taken from
    // the cache would be a reading of a moment nobody asked about.
    "cache-control": "no-store",
  });
  response.end(html);
}

// What every page carries besides its own figures: where it is, what it was read
// over, and what of the reading did not work.
function shell({ page, period, readings, settings, readAt, refused = null }) {
  return {
    page: { route: page.route, label: page.label, usesPeriod: page.usesPeriod },
    navigation: navigation(page.route),
    period: page.usesPeriod ? period : null,
    // The period that was written on the address and could not be read. The page is
    // drawn without figures: showing another period's numbers under the one that was
    // asked for is worse than showing none.
    refused,
    readAt,
    // Where the figures come from, so a page that says nothing can be checked
    // against the service it was reading.
    metricsUrl: settings.metricsUrl,
    // Each reading that did not come back, with the word for what happened to it.
    failures: failures(readings),
    // Each reading that ran out of buckets before the period ran out. A figure
    // computed from half the rows is not the figure it claims to be, and the page
    // says which ones.
    truncations: truncations(readings),
  };
}

async function servePage(settings, response, page, url) {
  const readAt = new Date().toISOString().replace("T", " ").slice(0, 19);
  const period = readPeriod(url.searchParams, settings);

  if (!period.ok) {
    // The bar still offers the periods that can be read, so the page is a way out
    // and not a dead end.
    const fallback = readPeriod(new URLSearchParams(), settings);
    const view = shell({
      page,
      period: fallback.period,
      readings: {},
      settings,
      readAt,
      refused: { from: period.from, to: period.to, code: period.code, today: dayOf(new Date()) },
    });
    return sendPage(response, renderPage("period_refused.njk", view), 400);
  }

  const view = await page.view(settings, period.period, url.searchParams);
  return sendPage(
    response,
    renderPage(page.template, {
      ...shell({ page, period: period.period, readings: view.readings, settings, readAt }),
      ...view,
    })
  );
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
      console.warn(`[metrics-fe] request from an IP outside the pool: ${remote}`);
      return sendError(response, 403, IP_NOT_ALLOWED);
    }

    try {
      // Nothing is written from here, so nothing but a reading is taken.
      if (request.method !== "GET" && request.method !== "HEAD") {
        return sendError(response, 405, METHOD_NOT_ALLOWED);
      }

      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        // An invalid "%" in the address: no page and no file can be called that.
        return sendError(response, 404, ROUTE_NOT_FOUND);
      }
      // A trailing slash is the same address: `/cost/` and `/cost` are one page.
      const route = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

      const page = pageAt(route);
      if (page) return await servePage(settings, response, page, url);
      return await serveStatic(pathname, response);
    } catch (error) {
      console.error(`[metrics-fe] error on ${request.method} ${url.pathname}: ${error.stack ?? error}`);
      if (!response.headersSent) sendError(response, 500, INTERNAL_ERROR);
    }
  });
}
