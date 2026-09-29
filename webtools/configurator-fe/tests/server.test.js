// The server: who is answered, what is answered, and what happens when
// anagraphics does not answer.
//
// A stub takes the place of anagraphics, so the tests do not need the system
// running. The configuration it returns is made up: the page must deal with any
// document, not with ours.

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";

import { createServer } from "../src/server.js";

const CONFIGURATIONS = [
  { subsystem: "anagraphics", access: { allowed_ips: ["127.0.0.1"] } },
  {
    subsystem: "example",
    listen: { host: "127.0.0.1", port: 9999 },
    access: { allowed_ips: ["127.0.0.1"] },
    ai: { api_key: "sk-ant-not-to-be-shown", model: "claude-opus-5" },
    pricing: { standard_price_cents: 40000 },
    // A provider that declares what it counts, and a door that asks a model of
    // it: the two halves a price needs.
    providers: { made_up: { token_kinds: ["input", "output"] } },
    asking: { providers: { made_up: { model: "made-up-small" } } },
  },
];

const DOOR = "asking.providers.made_up";
const FILLED_FORM = `subsystem=example&provider_path=${DOOR}&currency=USD&kind.input=1500&kind.output=7500`;

let anagraphics;
let anagraphicsUrl;
let server;
let base;
// What the stub was asked to write, and what it answers. Set by the tests.
let writes = [];
let pricingAnswer = { status: 200, body: null };

// The server measures what it serves. These tests are about the routes, not about
// the measuring, so what is given here counts the calls and sends nothing: a real
// client would try to reach a metrics that is not running, and the test would be
// waiting for a timeout it does not care about.
const measurements = [];
const METRICS = {
  measure: (metric, fields) => measurements.push({ metric, ...fields }),
  timer: () => () => 0,
  counters: () => ({ sent: measurements.length, failed: 0 }),
};

function settingsFor(url) {
  return {
    host: "127.0.0.1",
    port: 0,
    metrics: METRICS,
    allowedIps: ["127.0.0.1", "::1"],
    anagraphicsUrl: url,
    anagraphicsTimeoutMs: 2000,
    // Not there on purpose: no path is known to be secret, and the page says so.
    secretsDirectory: "/webtools_secrets_that_are_not_there",
    currencies: ["USD", "EUR", "JPY"],
    pricingBodyMaxBytes: 512,
  };
}

function postForm(body, headers = {}) {
  return fetch(`${base}/providers/pricing`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
    redirect: "manual",
  });
}

function outcomeOf(response) {
  return Object.fromEntries(new URL(response.headers.get("location"), base).searchParams);
}

async function listen(created) {
  await new Promise((resolve) => created.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${created.address().port}`;
}

before(async () => {
  anagraphics = http.createServer(async (request, response) => {
    if (request.method === "PUT" && request.url === "/configuration/example/pricing") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      writes.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      const body = pricingAnswer.body ?? {
        pricing: {
          currency: "USD",
          cents_per_million_tokens: { input: 1500, output: 7500 },
          updated_at: "2026-09-26T10:22:31Z",
        },
      };
      response.writeHead(pricingAnswer.status, { "content-type": "application/json" });
      return response.end(JSON.stringify(body));
    }
    if (request.url !== "/configuration") {
      response.writeHead(404, { "content-type": "application/json" });
      return response.end(JSON.stringify({ error: "ROUTE_NOT_FOUND" }));
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ configurations: CONFIGURATIONS }));
  });
  anagraphicsUrl = await listen(anagraphics);
  server = createServer(settingsFor(anagraphicsUrl));
  base = await listen(server);
});

after(() => {
  server.close();
  anagraphics.close();
});

test("the page shows every subsystem that is in Mongo", async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  const html = await response.text();
  assert.match(html, /anagraphics/);
  assert.match(html, /example/);
  assert.match(html, /127\.0\.0\.1:9999/);
  // The hint beside the value, not in place of it.
  assert.match(html, /40000/);
  assert.match(html, /400\.00/);
  // The shared value, worked out from the two documents.
  assert.match(html, /access\.allowed_ips/);
});

test("with no secrets folder the page says nothing is masked, instead of implying there is nothing", async () => {
  const html = await fetch(`${base}/`).then((response) => response.text());
  assert.match(html, /The secrets folder was not read/);
  // No path is known to be secret here, so the key is shown as it is in Mongo:
  // masking it would be guessing from its name.
  assert.match(html, /sk-ant-not-to-be-shown/);
});

test("the page is not taken from a cache", async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("a file of public/ is served", async () => {
  const response = await fetch(`${base}/styles.css`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/css/);
});

test("getting out of public/ is a 404, like anything that is not there", async () => {
  for (const target of ["/../package.json", "/nothing.css", "/%ZZ"]) {
    const response = await fetch(`${base}${target}`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "ROUTE_NOT_FOUND" });
  }
});

test("one route writes, and only with POST: everything else is a reading", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const response = await fetch(`${base}/`, { method });
    assert.equal(response.status, 405, method);
    assert.deepEqual(await response.json(), { error: "METHOD_NOT_ALLOWED" });
  }
  // The route that writes is read too — it is the page with the forms on it —
  // but it takes no other method.
  for (const method of ["PUT", "DELETE", "PATCH"]) {
    const response = await fetch(`${base}/providers/pricing`, { method });
    assert.equal(response.status, 405, method);
    assert.deepEqual(await response.json(), { error: "METHOD_NOT_ALLOWED" });
  }
  assert.equal((await fetch(`${base}/providers/pricing`)).status, 200);
});

test("a caller outside the pool does not even learn which routes exist", async () => {
  const closed = createServer({ ...settingsFor(anagraphicsUrl), allowedIps: ["10.0.0.1"] });
  const closedBase = await listen(closed);
  try {
    for (const target of ["/", "/styles.css"]) {
      const response = await fetch(`${closedBase}${target}`);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: "IP_NOT_ALLOWED" });
    }
  } finally {
    closed.close();
  }
});

test("anagraphics not answering gives a page that says so, not a page half read", async () => {
  // A port nothing is listening on: the reading fails, the page is still produced.
  const alone = createServer(settingsFor("http://127.0.0.1:1"));
  const aloneBase = await listen(alone);
  try {
    const response = await fetch(`${aloneBase}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /The configuration was not read/);
    assert.match(html, /127\.0\.0\.1:1\/configuration/);
  } finally {
    alone.close();
  }
});

test("an answer that is not what the route promises is a failure, not half a page", async () => {
  const wrong = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ configurations: [{ listen: { port: 1 } }] }));
  });
  const wrongUrl = await listen(wrong);
  const alone = createServer(settingsFor(wrongUrl));
  const aloneBase = await listen(alone);
  try {
    const html = await fetch(`${aloneBase}/`).then((response) => response.text());
    assert.match(html, /a configuration has no/);
  } finally {
    alone.close();
    wrong.close();
  }
});

// --- the one thing that is written -------------------------------------------

test("the configuration is read, and nothing on it writes", async () => {
  const html = await fetch(`${base}/`).then((response) => response.text());
  // The providers are listed, with their model and what is stored.
  assert.match(html, /<h2>Providers<\/h2>/);
  assert.match(html, /asking\.providers\.made_up/);
  assert.match(html, /made-up-small/);
  // Not one thing that writes: no form, no field, no dropdown, no button.
  assert.doesNotMatch(html, /<form/);
  assert.doesNotMatch(html, /<input/);
  assert.doesNotMatch(html, /<select/);
  assert.doesNotMatch(html, /<button/);
  // The page that does write is a click away, and says so.
  assert.match(html, /href="\/providers\/pricing"/);
});

test("the page that writes has a form per provider object that names a model", async () => {
  const html = await fetch(`${base}/providers/pricing`).then((response) => response.text());
  assert.match(html, /name="provider_path" value="asking\.providers\.made_up"/);
  // A field per kind the provider declares, and the currencies offered.
  assert.match(html, /name="kind\.input"/);
  assert.match(html, /name="kind\.output"/);
  assert.match(html, /<option value="USD"/);
  assert.match(html, /<option value="JPY"/);
  // The provider object that declares the kinds names no model: it is not here at
  // all — there is nothing to ask a price for — and the kinds it declares are
  // named under the provider's heading instead.
  assert.doesNotMatch(html, /name="provider_path" value="providers\.made_up"/);
  assert.match(html, /declared in/);
  // And back to the reading, where that object is listed.
  assert.match(html, /href="\/">/);
});

test("a provider object that names no model is on the configuration, not on the prices", async () => {
  const summary = await fetch(`${base}/`).then((response) => response.text());
  // It is what the configuration holds, so it is in the list, with no model.
  assert.match(summary, /providers\.made_up/);
});

test("a filled form is sent on as a price, and the page is read again", async () => {
  writes = [];
  pricingAnswer = { status: 200, body: null };
  const response = await postForm(FILLED_FORM);
  assert.equal(response.status, 303);
  assert.deepEqual(writes, [
    {
      provider_path: DOOR,
      currency: "USD",
      cents_per_million_tokens: { input: 1500, output: 7500 },
    },
  ]);
  assert.equal(new URL(response.headers.get("location"), base).pathname, "/providers/pricing");
  assert.deepEqual(outcomeOf(response), {
    pricing_subsystem: "example",
    pricing_path: DOOR,
    pricing_outcome: "written",
  });
});

test("the page that the redirect leads to says it was written, beside that form", async () => {
  const address = `${base}/providers/pricing?pricing_subsystem=example&pricing_path=${DOOR}&pricing_outcome=written`;
  const html = await fetch(address).then((response) => response.text());
  assert.match(html, /<p class="written">Written\.<\/p>/);
});

test("a refusal by anagraphics is said with the code it answered", async () => {
  writes = [];
  pricingAnswer = { status: 400, body: { error: "NOT_A_PROVIDER_OBJECT" } };
  const response = await postForm(FILLED_FORM);
  assert.equal(response.status, 303);
  assert.deepEqual(outcomeOf(response), {
    pricing_subsystem: "example",
    pricing_path: DOOR,
    pricing_outcome: "not_written",
    pricing_reason: "HTTP 400 NOT_A_PROVIDER_OBJECT",
  });
  const html = await fetch(new URL(response.headers.get("location"), base)).then((r) => r.text());
  assert.match(html, /Not written: <code>HTTP 400 NOT_A_PROVIDER_OBJECT<\/code>/);
  pricingAnswer = { status: 200, body: null };
});

test("a form that cannot be read is not sent on, and says which form it was", async () => {
  writes = [];
  const response = await postForm(`subsystem=example&provider_path=${DOOR}&currency=&kind.input=1500`);
  assert.equal(response.status, 303);
  assert.deepEqual(writes, []);
  assert.equal(outcomeOf(response).pricing_reason, "CURRENCY_NOT_GIVEN");
});

test("a request that does not say which provider object it is about is an error of the request", async () => {
  writes = [];
  const response = await postForm("currency=USD&kind.input=1500");
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "INVALID_FORM" });
  assert.deepEqual(writes, []);
});

test("only a form is read, and only up to the configured size", async () => {
  writes = [];
  const asJson = await postForm(FILLED_FORM, { "content-type": "application/json" });
  assert.equal(asJson.status, 415);
  assert.deepEqual(await asJson.json(), { error: "UNSUPPORTED_MEDIA_TYPE" });

  const tooLarge = await postForm(`${FILLED_FORM}&kind.padding=${"1".repeat(600)}`);
  assert.equal(tooLarge.status, 413);
  assert.deepEqual(await tooLarge.json(), { error: "BODY_TOO_LARGE" });
  assert.deepEqual(writes, []);
});

test("an outcome about a provider object that is not on the page is not swallowed", async () => {
  const address = `${base}/providers/pricing?pricing_subsystem=gone&pricing_path=a.providers.b&pricing_outcome=not_written&pricing_reason=PROVIDER_NOT_FOUND`;
  const html = await fetch(address).then((response) => response.text());
  assert.match(html, /which is not among the provider objects below/);
  assert.match(html, /PROVIDER_NOT_FOUND/);
});

test("an outcome missing a piece is not half a sentence: it is not shown", async () => {
  for (const query of [
    "pricing_outcome=written",
    "pricing_subsystem=example&pricing_outcome=written",
    `pricing_subsystem=example&pricing_path=${DOOR}&pricing_outcome=maybe`,
  ]) {
    const html = await fetch(`${base}/providers/pricing?${query}`).then((response) => response.text());
    assert.doesNotMatch(html, /class="written"/, query);
    assert.doesNotMatch(html, /not among the provider objects/, query);
  }
});
