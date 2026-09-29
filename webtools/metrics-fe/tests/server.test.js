// The server: who is answered, what every page draws, and what happens when metrics
// does not answer.
//
// A stub takes the place of metrics, so the tests do not need the system running.
// **Everything it answers is invented**: metric names, dimension values, kinds of
// token, providers, phases. The pages have to draw those exactly as they draw ours,
// because they must hold for the class and not for the instance we happen to have.

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";

import { createServer } from "../src/server.js";

// One answer per question, with nothing in common between them but the four fields
// every period answer carries.
const ANSWERS = {
  funnel: {
    stages: {
      "form.opened": { count: 120 },
      "form.submitted.sent": { count: 44, duration: durations(400) },
      "gate.invented_gate.passed": { count: 9 },
      "gate.invented_gate.rejected.no_reason_we_know": { count: 3 },
      "gate.invented_gate.some_third_outcome": { count: 4 },
      "gate.another_gate.open": { count: 2 },
      "project.created": { count: 11 },
    },
    reconciliation: { available: true, projects: 14, projects_measured: 11, lost: 3, something_new: "carried" },
  },
  cost: {
    total: { count: 300, tokens: { glyphs: 91000, whispers: 4000 }, duration: durations(9000) },
    by_phase: { invented_phase: { count: 200, tokens: { glyphs: 80000 } }, none: { count: 100, tokens: { whispers: 4000 } } },
    by_model: { "model-that-does-not-exist": { count: 300, tokens: { glyphs: 91000, whispers: 4000 } } },
    by_subsystem: { "some-subsystem": { count: 300, tokens: { glyphs: 91000 } } },
    per_project: {
      projects: 4,
      by_kind: {
        glyphs: { total: 91000, mean: 22750, min: 0, p50: 20000, p95: 40000, max: 41000 },
        whispers: { total: 4000, mean: 1000, min: 0, p50: 900, p95: 1900, max: 2000 },
      },
    },
  },
  preanalysis: {
    turns: { count: 88, tokens: { glyphs: 50000 }, duration: durations(137_000, null) },
    turns_per_preanalysis: { preanalyses: 6, mean: 7, min: 2, p50: 6, p95: 14, max: 15 },
    closed: { ready: { count: 4 }, invented_ending: { count: 2 }, another_ending: { count: 1 } },
    validation: { accepted: { count: 3, duration: durations(2000) } },
  },
  providers: {
    calls: { "model-that-does-not-exist": { count: 40, tokens: { glyphs: 9 }, duration: durations(5000) }, "—": { count: 2 } },
    by_outcome: { complete: { count: 38 }, cut: { count: 4 }, refused: { count: 2 } },
    failures: { invented_reason: { count: 5 } },
    retries: { invented_phase: { count: 2 } },
    failure_rate: { of: 47, count: 5, per_thousand: 106 },
  },
  http: {
    by_route: { "some-subsystem /a/route": { count: 900, duration: durations(40) } },
    by_status: { 200: { count: 880 }, 403: { count: 20 }, 500: { count: 5 } },
    errors: { SOME_CODE: { count: 20 } },
    refused_ips: 7,
  },
  economics: {
    turns_granted: { invented_source: { count: 50 } },
    turns_spent: { invented_phase: { count: 30 } },
    tokens_charged_to_drivers: { count: 12, tokens: { glyphs: 700 } },
    cost_per_accepted_demo: { accepted_demos: 2, tokens: { glyphs: 45500 }, note: "a note metrics wrote" },
    cost_of_refusals: {
      projects: 3,
      tokens: { glyphs: 12000 },
      by_reason: { some_reason: { projects: 2, tokens: { glyphs: 9000 } }, other_reason: { projects: 1, tokens: {} } },
    },
  },
  timing: {
    by_gate: { invented_gate: { count: 9, duration: durations(60_000) } },
    lead_time: { paid: { count: 2, duration: durations(86_400_000, null) } },
    form: { sent: { count: 44, duration: durations(400) } },
  },
  health: {
    starts: { ok: { count: 12 }, invented_outcome: { count: 1 } },
    dependencies: { "some-subsystem → another": { count: 500, duration: durations(80) } },
    dependency_failure_rate: { of: 500, count: 2, per_thousand: 4 },
    mongo: { ok: { count: 4000, duration: durations(3) } },
    logins: { ok: { count: 30, duration: durations(600) } },
  },
};

// A duration as metrics answers it: the percentiles are the upper edge of a bucket,
// and `null` is the bucket that has no upper bound.
function durations(mean, p95 = undefined) {
  return {
    count: 10,
    mean_ms: mean,
    min_ms: Math.max(1, Math.round(mean / 8)),
    max_ms: mean * 3,
    p50_at_most_ms: mean,
    p95_at_most_ms: p95 === undefined ? mean * 2 : p95,
    estimated_from: "histogram buckets",
  };
}

const DAILY_ROWS = [
  { day: "2026-09-24", subsystem: "some-subsystem", metric: "invented.metric", dims: { whatever: "value" }, count: 12, tokens: { glyphs: 500 }, duration_ms: { sum: 1200, min: 20, max: 400, buckets: { 100: 4, 1000: 5, inf: 1 } } },
  { day: "2026-09-26", subsystem: "another", metric: "invented.metric", dims: {}, count: 3 },
  { day: "2026-09-26", subsystem: "another", metric: "second.invented", dims: { open_one: "x" }, count: 40, bytes: 4096 },
];

const VOCABULARY = {
  subsystems: ["some-subsystem", "another"],
  metrics: {
    "invented.metric": { required: { whatever: null }, optional: {}, values: ["duration_ms", "tokens"], project: true },
    "second.invented": { required: { open_one: null }, optional: { sometimes: ["a", "b"] }, values: ["bytes"], project: false },
  },
};

const PROJECT = {
  project_id: "project-that-does-not-exist",
  first_at: "2026-09-01T10:00:00Z",
  last_at: "2026-09-20T10:00:00Z",
  tokens: { glyphs: 40000, whispers: 900 },
  phases: { invented_phase: { count: 9, tokens: { glyphs: 39000 } } },
  gates: { passed: 3, rejected: 1 },
  gate_reasons: { some_reason: 1 },
  metrics: {
    invented_metric: { count: 9, tokens: { glyphs: 39000 }, duration_ms: { sum: 90000, min: 1000, max: 40000, buckets: { 5000: 6, inf: 3 } } },
    a_field_no_vocabulary_knows: { count: 1 },
  },
  something_added_later: 4,
};

// What the stub does, so a test can make metrics fail, run out, or not be there.
let behaviour;
let asked;
let stub;
let stubUrl;
let server;
let base;

function resetBehaviour() {
  asked = [];
  behaviour = { truncated: false, refuse: null, notJson: false, silent: false, silentBefore: false, project: PROJECT, empty: false };
}

// A system that has just started: metrics answers, and it has nothing in it. Every
// key of every answer is there and every one of them is empty — which is what a new
// environment really looks like, and not a case to be reached later.
const EMPTY = {
  funnel: { stages: {}, reconciliation: { available: false, reason: "no_route", projects_measured: 0 } },
  cost: { total: { count: 0 }, by_phase: {}, by_model: {}, by_subsystem: {}, per_project: { projects: 0 } },
  preanalysis: { turns: { count: 0 }, turns_per_preanalysis: { preanalyses: 0 }, closed: {}, validation: {} },
  providers: { calls: {}, by_outcome: {}, failures: {}, retries: {}, failure_rate: { of: 0 } },
  http: { by_route: {}, by_status: {}, errors: {}, refused_ips: 0 },
  economics: {
    turns_granted: {},
    turns_spent: {},
    tokens_charged_to_drivers: { count: 0 },
    cost_per_accepted_demo: { accepted_demos: 0, tokens: null, note: "a note metrics wrote" },
    cost_of_refusals: { projects: 0, tokens: {}, by_reason: {} },
  },
  timing: { by_gate: {}, lead_time: {}, form: {} },
  health: { starts: {}, dependencies: {}, dependency_failure_rate: { of: 0 }, mongo: {}, logins: {} },
};

before(async () => {
  resetBehaviour();
  stub = http.createServer((request, response) => {
    const url = new URL(request.url, "http://stub");
    if (behaviour.silent) return response.destroy();
    if (behaviour.notJson) {
      response.writeHead(200, { "content-type": "text/plain" });
      return response.end("not json at all");
    }
    if (behaviour.refuse) {
      response.writeHead(behaviour.refuse.status, { "content-type": "application/json" });
      return response.end(JSON.stringify({ error: behaviour.refuse.code }));
    }
    const answer = (body) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const period = {
      from: url.searchParams.get("from") ?? "2026-09-01",
      to: url.searchParams.get("to") ?? "2026-09-26",
      days: 26,
      truncated: behaviour.truncated,
    };
    asked.push(`${url.pathname} ${period.from}..${period.to}`);
    // The period before the one being read: a smaller funnel, so a change is a number
    // and not a zero.
    const earlier = period.to < "2026-09-01";
    if (earlier && behaviour.silentBefore) return response.destroy();

    if (url.pathname === "/vocabulary") return answer(VOCABULARY);
    if (url.pathname === "/metrics/daily") {
      const metric = url.searchParams.get("metric");
      const all = behaviour.empty ? [] : DAILY_ROWS;
      return answer({ ...period, rows: metric ? all.filter((row) => row.metric === metric) : all });
    }
    if (url.pathname.startsWith("/metrics/projects/")) {
      if (!behaviour.project) {
        response.writeHead(404, { "content-type": "application/json" });
        return response.end(JSON.stringify({ error: "PROJECT_NOT_FOUND" }));
      }
      return answer(behaviour.project);
    }
    const question = url.pathname.replace("/metrics/", "");
    const answers = behaviour.empty ? EMPTY : ANSWERS;
    if (answers[question]) {
      const body = { ...period, ...answers[question] };
      if (earlier && question === "funnel" && !behaviour.empty) {
        body.reconciliation = { ...body.reconciliation, projects: 6, projects_measured: 5, lost: 1 };
        body.stages = { ...body.stages, "project.created": { count: 5 } };
      }
      return answer(body);
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "ROUTE_NOT_FOUND" }));
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  stubUrl = `http://127.0.0.1:${stub.address().port}`;

  server = createServer({
    host: "127.0.0.1",
    port: 0,
    allowedIps: ["127.0.0.1", "::1"],
    metricsUrl: stubUrl,
    metricsTimeoutMs: 2000,
    defaultDays: 30,
    presetsDays: [1, 7, 30],
    topRows: 25,
    seriesMetrics: 3,
    ringSlices: 5,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => stub.close(resolve));
});

async function get(path) {
  const response = await fetch(`${base}${path}`, { redirect: "manual" });
  return { status: response.status, type: response.headers.get("content-type"), body: await response.text() };
}

const PAGES = [
  "/",
  "/funnel",
  "/cost",
  "/preanalysis",
  "/providers",
  "/http",
  "/economics",
  "/timing",
  "/health",
  "/daily",
  "/projects",
  "/vocabulary",
];

test("every page is drawn, and nothing in it is a stack trace", async () => {
  resetBehaviour();
  for (const path of PAGES) {
    const page = await get(path);
    assert.equal(page.status, 200, path);
    assert.match(page.type, /text\/html/, path);
    assert.match(page.body, /<\/html>/, path);
    assert.doesNotMatch(page.body, /at Object\.|node:internal/, `${path} shows a stack trace`);
    // Never a raw [object Object] or an undefined printed as a value.
    assert.doesNotMatch(page.body, /\[object Object\]/, path);
    assert.doesNotMatch(page.body, />undefined</, path);
    assert.doesNotMatch(page.body, />NaN</, path);
  }
});

test("a system that has just started draws every page, with nothing filled in", async () => {
  resetBehaviour();
  behaviour.empty = true;
  behaviour.project = null;
  for (const path of PAGES) {
    const page = await get(`${path}?from=2026-09-01&to=2026-09-26`);
    assert.equal(page.status, 200, path);
    assert.doesNotMatch(page.body, /could not be used/, `${path} calls an empty answer a failure`);
    assert.doesNotMatch(page.body, />NaN</, path);
    assert.doesNotMatch(page.body, />undefined</, path);
  }
  // Nothing is filled in with a zero where there is no answer yet.
  const overview = await get("/?from=2026-09-01&to=2026-09-26");
  assert.match(overview.body, /No project has consumed anything yet/);
  assert.match(overview.body, /No demo was accepted in this period/);
  assert.match(overview.body, /No pre-analysis has taken a turn yet/);
  // The projects could not be counted, and the hero says which number it is showing.
  assert.match(overview.body, /no_route/);
  assert.match(overview.body, /projects measured in the period/);
});

test("names nobody configured here reach the page as they arrived", async () => {
  resetBehaviour();
  const cost = await get("/cost?from=2026-09-01&to=2026-09-26");
  // An invented kind of token becomes a column.
  assert.match(cost.body, /glyphs/);
  assert.match(cost.body, /whispers/);
  // An invented phase and an invented model become rows.
  assert.match(cost.body, /invented_phase/);
  assert.match(cost.body, /model-that-does-not-exist/);

  const funnel = await get("/funnel?from=2026-09-01&to=2026-09-26");
  // A gate this system has never heard of is in the chain and has a group of its own.
  assert.match(funnel.body, /gate\.invented_gate/);
  assert.match(funnel.body, /gate\.another_gate/);
  // And the rows inside a group are named by what is left of the name — the flat list
  // of every full stage name is not printed under them.
  assert.match(funnel.body, /rejected\.no_reason_we_know/);
  assert.equal(funnel.body.includes("gate.invented_gate.rejected.no_reason_we_know"), false);
  // And a field metrics added to the reconciliation is shown rather than dropped.
  assert.match(funnel.body, /something_new/);
});

test("no page turns a token into money, or adds two kinds together", async () => {
  resetBehaviour();
  for (const path of PAGES) {
    const page = await get(`${path}?from=2026-09-01&to=2026-09-26`);
    assert.doesNotMatch(page.body, /€|\$|EUR|USD|_cents/, `${path} mentions a currency`);
  }
  // 91,000 glyphs and 4,000 whispers, and no 95,000 anywhere.
  const cost = await get("/cost?from=2026-09-01&to=2026-09-26");
  assert.match(cost.body, /91,000/);
  assert.doesNotMatch(cost.body, /95,000/);
});

test("a percentile with no upper bound is not printed as a number", async () => {
  resetBehaviour();
  const preanalysis = await get("/preanalysis?from=2026-09-01&to=2026-09-26");
  assert.match(preanalysis.body, /no upper bound/);
});

test("the three questions carry what they are out of, each in its own words", async () => {
  resetBehaviour();
  const overview = await get("/?from=2026-09-01&to=2026-09-26");
  assert.match(overview.body, /over 4 projects with an accumulator/);
  assert.match(overview.body, /out of 6 pre-analyses that took at least one turn/);
  assert.match(overview.body, /tokens of the period over 2 accepted demos/);
  // The hero is the projects that really exist, and it says where the number is from.
  assert.match(overview.body, /counted in anagraphics/);
  assert.match(overview.body, /3 of them reached no measurement/);
});

test("a page reads the period before it, and says how the figure moved", async () => {
  resetBehaviour();
  const funnel = await get("/funnel?from=2026-09-01&to=2026-09-26");
  // 26 days, so the period before is the 26 days that end the day before it.
  assert.ok(asked.includes("/metrics/funnel 2026-09-01..2026-09-26"), asked.join(" | "));
  assert.ok(asked.includes("/metrics/funnel 2026-08-06..2026-08-31"), asked.join(" | "));
  // 11 measured now against 5 before: +6, and +120 %.
  assert.match(funnel.body, /\+6/);
  assert.match(funnel.body, /\+120 %/);
});

test("a period before that cannot be read does not take this period's figures down", async () => {
  resetBehaviour();
  behaviour.silentBefore = true;
  const funnel = await get("/funnel?from=2026-09-01&to=2026-09-26");
  assert.equal(funnel.status, 200);
  // The failure is reported under its own name, so it is clear which reading it was.
  assert.match(funnel.body, /funnel \(period before\)/);
  assert.match(funnel.body, /unreachable/);
  // And this period is still drawn: 11 projects measured, and no change beside it.
  assert.match(funnel.body, /From one gate to the next/);
  assert.match(funnel.body, />11</);
});

test("the funnel says how many of one gate's decisions reached the next", async () => {
  resetBehaviour();
  const funnel = await get("/funnel?from=2026-09-01&to=2026-09-26");
  // invented_gate decided 16 (9 + 3 + 4), another_gate decided 2.
  assert.match(funnel.body, /From one gate to the next/);
  // 2 of 16 is 12.5 %, and 14 were lost between them.
  assert.match(funnel.body, /12\.5 %/);
  assert.match(funnel.body, />14</);
  // And the way in: 120 forms opened, 44 submitted, 11 projects — 25 % of the
  // submitted ones became a project.
  assert.match(funnel.body, /The way in/);
  assert.match(funnel.body, /25 %/);
});

test("a table says what one of the things it counts consumed", async () => {
  resetBehaviour();
  const cost = await get("/cost?from=2026-09-01&to=2026-09-26");
  // 91,000 glyphs over 300 buckets that carry tokens: 303 each.
  assert.match(cost.body, /303/);
  // by_model: 91,000 glyphs over 300 calls of the one model.
  assert.match(cost.body, /each/);
});

test("the share of the consumption that produced nothing is worked out", async () => {
  resetBehaviour();
  const economics = await get("/economics?from=2026-09-01&to=2026-09-26");
  // 12,000 glyphs on refused projects out of 91,000 consumed: 13.2 %.
  assert.match(economics.body, /13\.2 %/);
  const overview = await get("/?from=2026-09-01&to=2026-09-26");
  assert.match(overview.body, /produced nothing/);
  assert.match(overview.body, /13\.2 %/);
});

test("parts of one whole are drawn as a ring, and nothing else is", async () => {
  resetBehaviour();
  const funnel = await get("/funnel?from=2026-09-01&to=2026-09-26");
  // invented_gate decided three different things: three parts of one whole, so a ring.
  assert.match(funnel.body, /<figure class="ring">/);
  // another_gate decided one thing only: no ring for a whole with one part.
  assert.equal(funnel.body.match(/<figure class="ring">/g).length, 1);

  // Four outcomes of one call: a ring. And the routes, of which there is a ranked list
  // with no total anybody asked about: none.
  const providers = await get("/providers?from=2026-09-01&to=2026-09-26");
  assert.match(providers.body, /<figure class="ring">/);

  // Nothing on a ring is readable by colour alone: the legend names every slice, and
  // the counts are in the table beside it.
  assert.match(providers.body, /class="legend"/);
});

test("the overview draws the two wholes that are wholes, and no other", async () => {
  resetBehaviour();
  const overview = await get("/?from=2026-09-01&to=2026-09-26");
  // How a pre-analysis closed (3 parts) and where a call ended up (3 parts).
  assert.equal(overview.body.match(/<figure class="ring">/g).length, 2);
  // Not the kinds of token, which are not parts of anything: their sum is a rate
  // nobody decided.
  assert.doesNotMatch(overview.body, /class="middle"[^>]*>95,009</);
});

test("a ring says the whole it is of, in the middle of it", async () => {
  resetBehaviour();
  const http = await get("/http?from=2026-09-01&to=2026-09-26");
  // 880 + 20 + 5 requests by status: the ring's middle carries the 905 it is of, and
  // the name is under it rather than inside a hole it might not fit.
  assert.match(http.body, /class="middle"[^>]*>905</);
  assert.match(http.body, /class="of-what">by status</);
});

test("a reading that ran out is said so, on the page it changes", async () => {
  resetBehaviour();
  behaviour.truncated = true;
  const page = await get("/http?from=2026-09-01&to=2026-09-26");
  assert.equal(page.status, 200);
  assert.match(page.body, /ran out before the period did/);
  assert.match(page.body, /max_rows/);
});

test("metrics that does not answer is a sentence on the page, not an error", async () => {
  resetBehaviour();
  behaviour.silent = true;
  const page = await get("/cost?from=2026-09-01&to=2026-09-26");
  assert.equal(page.status, 200);
  assert.match(page.body, /could not be used/);
  assert.match(page.body, /unreachable/);
  // And nothing was invented in the place of the figures.
  assert.match(page.body, /Nothing was folded under this in the period|absent/);
});

test("a refusal, an answer that is not JSON and one that is not the route's are different words", async () => {
  resetBehaviour();
  behaviour.refuse = { status: 400, code: "INVALID_RANGE" };
  let page = await get("/cost?from=2026-09-01&to=2026-09-26");
  assert.match(page.body, /refused/);
  assert.match(page.body, /INVALID_RANGE/);

  resetBehaviour();
  behaviour.notJson = true;
  page = await get("/cost?from=2026-09-01&to=2026-09-26");
  assert.match(page.body, /not_json/);
});

test("a project nobody measured is an answer, not a failed reading", async () => {
  resetBehaviour();
  behaviour.project = null;
  const page = await get("/projects?id=nobody");
  assert.equal(page.status, 200);
  assert.match(page.body, /No accumulator for/);
  // It is an answer about that project, not a reading the page could not use.
  assert.doesNotMatch(page.body, /could not be used/);
});

test("a project's stored field names come back as metric names where the vocabulary has them", async () => {
  resetBehaviour();
  const page = await get("/projects?id=project-that-does-not-exist");
  // `invented_metric` is `invented.metric` in the vocabulary.
  assert.match(page.body, /invented\.metric/);
  // And one the vocabulary does not know is shown as it is stored, and said to be.
  assert.match(page.body, /a_field_no_vocabulary_knows/);
  assert.match(page.body, /\(stored\)/);
  // A field added to the accumulator is not dropped.
  assert.match(page.body, /something_added_later/);
  // It says, where the figures are, that this is not the invoice.
  assert.match(page.body, /Not the invoice/);
});

test("the metric chooser offers every name, and marks the ones nothing was folded under", async () => {
  resetBehaviour();
  const page = await get("/daily?from=2026-09-01&to=2026-09-26&metric=second.invented");
  assert.match(page.body, /invented\.metric/);
  assert.match(page.body, /nothing was folded under this name in the period/);
  // The chosen metric is carried by the period controls, so changing the days keeps it.
  assert.match(page.body, /metric=second\.invented/);
});

test("a period that cannot be read draws no figure and is a 400", async () => {
  resetBehaviour();
  for (const query of ["?from=2026-02-31&to=2026-03-01", "?from=2026-09-30&to=2026-09-01", "?to=2026-09-01"]) {
    const page = await get(`/cost${query}`);
    assert.equal(page.status, 400, query);
    assert.match(page.body, /could not be read/);
    // The bar still offers a period that can be read: a way out, not a dead end.
    assert.match(page.body, /read again/);
  }
});

test("only the pool is answered, and only a reading is taken", async () => {
  resetBehaviour();
  const refused = await fetch(`${base}/`, { method: "POST" });
  assert.equal(refused.status, 405);
  assert.deepEqual(await refused.json(), { error: "METHOD_NOT_ALLOWED" });

  const missing = await get("/no-such-place");
  assert.equal(missing.status, 404);
  assert.deepEqual(JSON.parse(missing.body), { error: "ROUTE_NOT_FOUND" });
});

test("an IP outside the pool gets the contract's error and no page", async () => {
  const closed = createServer({
    host: "127.0.0.1",
    port: 0,
    allowedIps: ["10.0.0.1"],
    metricsUrl: stubUrl,
    metricsTimeoutMs: 2000,
    defaultDays: 30,
    presetsDays: [7],
    topRows: 10,
    seriesMetrics: 3,
    ringSlices: 5,
  });
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const response = await fetch(`http://127.0.0.1:${closed.address().port}/`);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "IP_NOT_ALLOWED" });
  await new Promise((resolve) => closed.close(resolve));
});

test("the stylesheet is served, and nothing above public/ is", async () => {
  const style = await get("/styles.css");
  assert.equal(style.status, 200);
  assert.match(style.type, /text\/css/);

  for (const path of ["/../package.json", "/%2e%2e/package.json", "/../src/server.js"]) {
    const escaped = await get(path);
    assert.equal(escaped.status, 404, path);
  }
});

test("a trailing slash is the same page", async () => {
  resetBehaviour();
  const page = await get("/cost/?from=2026-09-01&to=2026-09-26");
  assert.equal(page.status, 200);
});

test("what a page shows is not cached: it is the state of another system at one moment", async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  await response.text();
});
