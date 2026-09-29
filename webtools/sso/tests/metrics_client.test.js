// The metrics client (a copy of commons/metrics): what it sends, and — the point
// of the whole file — what it does when metrics does not answer.
//
// A measurement must never become an error in a page or a turn of chat, so every
// test here that breaks the server checks two things at once: that nothing was
// thrown, and that the subsystem still knows how much it failed to report.
//
//   node --test

import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import { Configuration, ConfigurationError } from "../src/commons/configuration_client.js";
import { Metrics, loadMetrics } from "../src/commons/metrics/webtools_metrics_client.js";

const settings = (url) => ({
  subsystems_infos: { metrics: { url, timeout_ms: 500 } },
  metrics: { log_failures: false },
});

const configuration = (document) => new Configuration("sso", document, "http://127.0.0.1:9100");

// A metrics that answers as the real one does, and writes down what it received.
async function fakeMetrics({ status = 202, hang = false } = {}) {
  const received = [];
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push(JSON.parse(Buffer.concat(chunks).toString()));
    if (hang) await held;
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify({ folded: status === 202 }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    received,
    async close() {
      release();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// The client does not wait, so a test that checks what arrived has to. Waiting
// here and nowhere else is the point: the subsystem never does.
async function settle(metrics, { sent = 1 } = {}) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const counters = metrics.counters();
    if (counters.sent >= sent) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (counters.failed || attempt > 0) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("it sends the measurement with the subsystem it was configured as", async () => {
  const server = await fakeMetrics();
  const metrics = loadMetrics(configuration(settings(server.url)));

  metrics.measure("login.attempt", { dims: { outcome: "ok" }, duration_ms: 42 });
  await settle(metrics);

  assert.deepEqual(server.received, [
    { subsystem: "sso", metric: "login.attempt", dims: { outcome: "ok" }, duration_ms: 42 },
  ]);
  assert.deepEqual(metrics.counters(), { sent: 1, failed: 0 });
  await server.close();
});

test("measuring returns before anything has been sent", async () => {
  const server = await fakeMetrics({ hang: true });
  const metrics = loadMetrics(configuration(settings(server.url)));

  // The server holds every request open: if `measure` waited, this line would
  // not be reached until the timeout. It is the guarantee the subsystems rely
  // on, and it is the one worth asserting.
  const before = Date.now();
  metrics.measure("session.opened");
  assert.ok(Date.now() - before < 100);
  assert.equal(metrics.measure("session.opened"), undefined);

  await server.close();
});

test("with metrics down nothing is thrown and the failures are counted", async () => {
  // Nothing listens here: the port was used by a server that has been closed.
  const server = await fakeMetrics();
  const url = server.url;
  await server.close();

  const metrics = loadMetrics(configuration(settings(url)));
  metrics.measure("login.attempt", { dims: { outcome: "ok" } });
  await settle(metrics);

  assert.deepEqual(metrics.counters(), { sent: 1, failed: 1 });
});

test("a refused measurement is a failure of ours, and is counted as one", async () => {
  // 400 is the vocabulary refusing what this subsystem sent: a mistake in our
  // own code, which would otherwise be invisible — nobody is reading the answer.
  const server = await fakeMetrics({ status: 400 });
  const metrics = loadMetrics(configuration(settings(server.url)));

  metrics.measure("login.attempt", { dims: { outcome: "invented" } });
  await settle(metrics);

  assert.deepEqual(metrics.counters(), { sent: 1, failed: 1 });
  await server.close();
});

test("a send that takes too long is given up on, not waited out", async () => {
  const server = await fakeMetrics({ hang: true });
  const metrics = new Metrics({
    url: server.url,
    timeoutMs: 50,
    logFailures: false,
    subsystem: "sso",
  });

  metrics.measure("session.opened");
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.deepEqual(metrics.counters(), { sent: 1, failed: 1 });
  await server.close();
});

test("failures are written to the log only when the configuration says so", async () => {
  const server = await fakeMetrics();
  const url = server.url;
  await server.close();

  const written = [];
  const warn = console.warn;
  console.warn = (line) => written.push(line);
  try {
    const quiet = loadMetrics(configuration(settings(url)));
    quiet.measure("session.opened");
    await settle(quiet);
    assert.deepEqual(written, []);

    const loud = loadMetrics(
      configuration({ ...settings(url), metrics: { log_failures: true } })
    );
    loud.measure("session.opened");
    await settle(loud);
    assert.equal(written.length, 1);
    assert.match(written[0], /\[sso\] metrics: session\.opened not sent/);
  } finally {
    console.warn = warn;
  }
});

test("the timer measures from the monotonic clock", () => {
  const metrics = new Metrics({ url: "http://127.0.0.1:1", timeoutMs: 10, logFailures: false, subsystem: "sso" });
  const elapsed = metrics.timer();
  const first = elapsed();
  assert.ok(Number.isInteger(first) && first >= 0);
  assert.ok(elapsed() >= first);
});

test("without its configuration the subsystem does not start", () => {
  const url = "http://127.0.0.1:9600";
  assert.throws(() => loadMetrics(configuration({})), ConfigurationError);
  assert.throws(
    () => loadMetrics(configuration({ subsystems_infos: { metrics: { url } }, metrics: { log_failures: false } })),
    /timeout_ms/
  );
  assert.throws(
    () => loadMetrics(configuration({ subsystems_infos: { metrics: { url, timeout_ms: 500 } } })),
    /log_failures/
  );
  assert.throws(
    () => loadMetrics(configuration(settings("ftp://127.0.0.1:9600"))),
    /subsystems_infos\.metrics\.url/
  );
});
