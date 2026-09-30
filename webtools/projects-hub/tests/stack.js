// The stack a test runs the hub on: a real server of ours on a free port, with
// anagraphics, the sso and workspaces answering from three fake servers of their own.
//
// Fake **servers** and not fake modules: what these tests are about is the routing and the
// access rules, and those run through the three clients — the fetch, the timeout, the 404
// that is an answer rather than a failure. A client replaced by a function would leave the
// one part of the path nobody tried.
//
// This file holds no tests: `node --test tests/*.test.js` does not pick it up.

import http from "node:http";

import { Configuration } from "../src/commons/configuration_client.js";
import { loadI18n } from "../src/commons/i18n/webtools_i18n.js";
import { createServer } from "../src/server.js";

export const OWNER_UID = "8ff93901-673e-44ba-b05b-56011395dcba";
export const OTHER_UID = "adf36d8c-7ee7-4cd8-9c87-73cb4c81ec07";
export const DRIVER_UID = "7633be3d-e701-42ca-9fea-6c6d1bb4b7d1";
export const OTHER_DRIVER_UID = "639718a3-ea41-4533-bdb8-73ac58b3b1b2";
export const TOKEN = "a-session-token-long-enough";
export const TICKET = "a-ticket";

// A session as the sso answers with it. `data.driver` is `null` for whoever is not a driver
// and `{driver_uid, level}` for whoever is — the same shape the user document carries, not
// a translation of it.
export function session({ uid = OWNER_UID, driver = null, expiresInSeconds = 3600 } = {}) {
  return {
    token: TOKEN,
    uid,
    username: "dome.santoro@gmail.com",
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    data: { screen_name: "Dome", driver, locale: null },
  };
}

export const asDriver = (level) => ({ driver_uid: DRIVER_UID, level });

// The owner as anagraphics answers with them: who they are and where they are reached.
// It is what a communication to a client has to carry.
export const OWNER = {
  uid: OWNER_UID,
  screen_name: "Dome",
  username: "dome.santoro@gmail.com",
};

// A project as `GET /projects` answers with it: the whole document, with only the last
// step. The default is a project whose analysis has just been written.
export function project({
  id,
  state = "DRIVER_VALIDATION",
  ownerUid = OWNER_UID,
  driverUid = null,
  steps = null,
  ...rest
} = {}) {
  return {
    project_id: id,
    owner_uid: ownerUid,
    created_at: "2026-09-30T10:00:00Z",
    pipeline: {
      state,
      steps: steps ?? [
        {
          step: "analysis",
          result: "passed",
          data: { documents: { analysis: { version: 1 }, proposal: { version: 1 } } },
          decided_at: "2026-09-30T10:00:00Z",
        },
      ],
    },
    review: { driver: driverUid ? { uid: driverUid, screen_name: "Dome" } : null, preset: false },
    billing: {},
    ...rest,
  };
}

// The two steps a project carries once the analyst has handed it to a driver: the
// analysis, decided, and the driver's gate, open. The second is what the driver's
// decision closes, and it is the reason `gate.duration` has anything to report.
export const handedOver = () => [
  {
    step: "analysis",
    result: "passed",
    data: { documents: { analysis: { version: 1 }, proposal: { version: 1 } } },
    decided_at: "2026-09-30T10:00:00Z",
  },
  { step: "driver_validation", result: "open", data: {}, decided_at: "2026-09-30T10:00:00Z" },
];

// A step that says a run stopped, and where.
export const stoppedAt = (reason) => [
  { step: "analysis", result: "failed", data: { failed_at: reason }, decided_at: "2026-09-30T10:00:00Z" },
];

/* ------------------------------------------------------------------ measurements */

export function measurements() {
  const taken = [];
  return {
    taken,
    measure: (metric, fields = {}) => taken.push({ metric, ...fields }),
    timer: () => () => 0,
    counters: () => ({ sent: taken.length, failed: 0 }),
    of: (metric) => taken.filter((one) => one.metric === metric),
  };
}

/* ------------------------------------------------------------------ fake servers */

// A server on a free port, answering from one handler. The handler gets the request, the
// parsed URL and the body, and gives back `{status, json}` or `{status, text}`.
async function fakeServer(handler) {
  const asked = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://fake");
    asked.push(`${request.method} ${url.pathname}${url.search}`);
    const answer = (await handler(request, url, await readBody(request))) ?? {
      status: 404,
      json: { error: "ROUTE_NOT_FOUND" },
    };
    if (answer.json !== undefined) {
      response.writeHead(answer.status, { "content-type": "application/json" });
      return response.end(JSON.stringify(answer.json));
    }
    response.writeHead(answer.status, { "content-type": answer.contentType ?? "text/plain" });
    return response.end(answer.text ?? "");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { url: `http://127.0.0.1:${server.address().port}`, asked, close: () => server.close() };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// The sso, as far as this subsystem uses it: who is asking, and the ticket exchange.
function ssoHandler(sso) {
  return (request, url, body) => {
    if (sso.broken) return { status: 503, json: { error: "DOWN" } };
    if (request.method === "GET" && url.pathname === "/session") {
      return { status: 200, json: { logged: Boolean(sso.logged), session: sso.session ?? null } };
    }
    if (request.method === "POST" && url.pathname === "/tickets/exchange") {
      if (body?.ticket !== TICKET) return { status: 404, json: { error: "TICKET_NOT_FOUND" } };
      return { status: 200, json: { logged: true, session: sso.session ?? session() } };
    }
    if (request.method === "POST" && url.pathname === "/session/locale") {
      return { status: 200, json: { logged: true } };
    }
    return null;
  };
}

// anagraphics: the list, one project, and a driver's codes. The filters are applied the way
// the real route applies them — **including its refusals** — so a test cannot pass by asking
// a question the real service would have turned down.
function anagraphicsHandler({ projects, discounts, created, users, broken }) {
  return (request, url, body) => {
    if (broken) return { status: 503, json: { error: "DATABASE_UNAVAILABLE" } };

    // The read by uid: a project keeps its owner's uid and no copy of the person, so
    // whoever has something to say to a client comes through here for the address.
    if (request.method === "GET" && url.pathname === "/users") {
      const uid = url.searchParams.get("uid");
      const found = users.find((user) => user.uid === uid);
      if (!found) return { status: 404, json: { error: "USER_NOT_FOUND", uid } };
      return { status: 200, json: found };
    }

    if (request.method === "GET" && url.pathname === "/projects") {
      const ownerUid = url.searchParams.get("owner_uid");
      const driverUid = url.searchParams.get("driver_uid");
      const withoutDriver = url.searchParams.get("without_driver") === "true";
      const states = url.searchParams.getAll("state");
      const named = [ownerUid !== null, driverUid !== null, withoutDriver].filter(Boolean);
      if (named.length !== 1) return { status: 400, json: { error: "INVALID_QUERY" } };
      const found = projects.filter((one) => {
        if (ownerUid !== null && one.owner_uid !== ownerUid) return false;
        if (driverUid !== null && one.review?.driver?.uid !== driverUid) return false;
        if (withoutDriver && one.review?.driver !== null) return false;
        return states.length === 0 || states.includes(one.pipeline.state);
      });
      return { status: 200, json: { projects: found } };
    }

    const one = /^\/projects\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && one) {
      const found = projects.find((project) => project.project_id === one[1]);
      if (!found) return { status: 404, json: { error: "PROJECT_NOT_FOUND", project_id: one[1] } };
      return { status: 200, json: found };
    }

    // The step is appended and the state moved **in one write**, the way the real route
    // does it: a test that wrote only the step would leave a project whose state and
    // whose steps disagree, which is a shape the service cannot produce.
    const steps = /^\/projects\/([^/]+)\/pipeline\/steps$/.exec(url.pathname);
    if (request.method === "POST" && steps) {
      const found = projects.find((project) => project.project_id === steps[1]);
      if (!found) return { status: 404, json: { error: "PROJECT_NOT_FOUND", project_id: steps[1] } };
      found.pipeline.steps.push({
        step: body.step,
        result: body.result,
        data: body.data,
        decided_at: STEP_DECIDED_AT,
      });
      found.pipeline.state = body.state;
      return { status: 201, json: found };
    }

    const codes = /^\/drivers\/([^/]+)\/discounts$/.exec(url.pathname);
    if (codes && request.method === "GET") {
      const theirs = discounts.filter((discount) => discount.driver.uid === codes[1]);
      return { status: 200, json: { uid: codes[1], discounts: theirs } };
    }
    if (codes && request.method === "POST") {
      const discount = {
        discount_code: `made-${body.percentage}`,
        driver: { uid: codes[1], screen_name: "Dome" },
        percentage: body.percentage,
      };
      created.push(discount);
      discounts.push(discount);
      return { status: 201, json: discount };
    }
    return null;
  };
}

// When anagraphics says a step was decided: five minutes after the moment every project
// fixture is born at. A fixed instant and not `now`, because the tests that read
// `gate.duration` need both ends of the interval to be theirs — with a clock at one end
// the number they check would be a different one every run.
const STEP_DECIDED_AT = "2026-09-30T10:05:00Z";
export const STEP_WAITED_MS = 5 * 60 * 1000;

// workspaces: the one route this subsystem reads. `documents` is keyed `"<project>/<kind>"`.
function workspacesHandler({ documents, broken }) {
  return (request, url) => {
    if (broken) return { status: 503, json: { error: "DOWN" } };
    const found = /^\/projects\/([^/]+)\/documents\/([^/]+)\/latest$/.exec(url.pathname);
    const text = found ? documents[`${found[1]}/${found[2]}`] : undefined;
    if (text === undefined) return { status: 404, json: { error: "DOCUMENT_NOT_FOUND" } };
    return { status: 200, text, contentType: "text/markdown; charset=utf-8" };
  };
}

// The comm-center: it takes what it is given and says so. Every communication that left
// is kept, because what these tests ask is whether one left at all and what it carried.
function commCenterHandler({ said, broken }) {
  return (request, url, body) => {
    if (broken) return { status: 503, json: { error: "DOWN" } };
    if (request.method !== "POST" || !url.pathname.startsWith("/communications/")) return null;
    said.push({ form: url.pathname.slice("/communications/".length), body });
    return { status: 202, json: { taken: true } };
  };
}

/* ------------------------------------------------------------------- the stack */

export async function stack({
  sso = { logged: false },
  projects = [],
  discounts = [],
  documents = {},
  // Whoever the fake anagraphics knows by uid. The owner of the default project is in
  // it, so a test that is not about a missing account does not have to say so.
  users = [OWNER],
  anagraphicsBroken = false,
  workspacesBroken = false,
  commCenterBroken = false,
} = {}) {
  const created = [];
  const said = [];
  const ssoFake = await fakeServer(ssoHandler(sso));
  const anagraphics = await fakeServer(
    anagraphicsHandler({ projects, discounts, created, users, broken: anagraphicsBroken })
  );
  const workspaces = await fakeServer(workspacesHandler({ documents, broken: workspacesBroken }));
  const commCenter = await fakeServer(commCenterHandler({ said, broken: commCenterBroken }));

  const settings = {
    metrics: measurements(),
    anagraphicsUrl: anagraphics.url,
    anagraphicsTimeoutMs: 2000,
    ssoUrl: ssoFake.url,
    ssoTimeoutMs: 2000,
    workspacesUrl: workspaces.url,
    workspacesTimeoutMs: 2000,
    preanalystUrl: "http://127.0.0.1:9200",
    commCenterUrl: commCenter.url,
    commCenterTimeoutMs: 2000,
    cookieName: "webtools_projects_hub",
    discount: { minPercentage: 1, maxPercentage: 5 },
    bodyMaxBytes: 4096,
    // Short on purpose: a test that has to write past the limit writes two lines, not two
    // thousand characters. What the number is does not change any rule that reads it.
    rejectionReasonMaxChars: 200,
    // Filled in below: our own public address is not known until the port is.
    publicUrl: null,
    i18n: loadI18n(
      new Configuration(
        "projects-hub",
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

  const hub = createServer(settings);
  await new Promise((done) => hub.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${hub.address().port}`;
  // The server reads `publicUrl` per request, never at construction: it is written here,
  // before the first one, which is the only moment the port is known.
  settings.publicUrl = base;

  return {
    base,
    settings,
    created,
    discounts,
    // The same array the fake answers from. The step routes write into it, so a test
    // reads the project afterwards the way anybody else would: from the register.
    projects,
    asked: { anagraphics: anagraphics.asked, sso: ssoFake.asked, workspaces: workspaces.asked },
    // Everything that was said to a person, in the order it was said.
    said,
    close() {
      hub.close();
      ssoFake.close();
      anagraphics.close();
      workspaces.close();
      commCenter.close();
    },
  };
}

/* ------------------------------------------------------------------- asking */

// A request to the hub, without following redirects: where it sends the browser is what
// most of these tests are about.
export function ask(up, path, { method = "GET", token = null, body = null, locale = null } = {}) {
  const cookies = [];
  if (token) cookies.push(`${up.settings.cookieName}=${token}`);
  if (locale) cookies.push(`webtools_locale=${locale}`);
  return fetch(`${up.base}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(cookies.length ? { cookie: cookies.join("; ") } : {}),
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body ?? undefined,
  });
}
