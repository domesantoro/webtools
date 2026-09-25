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
  },
];

let anagraphics;
let anagraphicsUrl;
let server;
let base;

function settingsFor(url) {
  return {
    host: "127.0.0.1",
    port: 0,
    allowedIps: ["127.0.0.1", "::1"],
    anagraphicsUrl: url,
    anagraphicsTimeoutMs: 2000,
    // Not there on purpose: no path is known to be secret, and the page says so.
    secretsDirectory: "/webtools_secrets_that_are_not_there",
  };
}

async function listen(created) {
  await new Promise((resolve) => created.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${created.address().port}`;
}

before(async () => {
  anagraphics = http.createServer((request, response) => {
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

test("nothing is written here: any method that is not a reading is refused", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const response = await fetch(`${base}/`, { method });
    assert.equal(response.status, 405);
    assert.deepEqual(await response.json(), { error: "METHOD_NOT_ALLOWED" });
  }
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
