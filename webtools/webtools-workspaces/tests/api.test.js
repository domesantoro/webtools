// The routes, tested end to end on a temporary root.

import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { createServer } from "../src/server.js";

const PROJECT = "1f251606-bdba-40c4-bbee-bfedc6e57f70";
const UPLOADER = "8ff93901-673e-44ba-b05b-56011395dcba";

// The server measures what it serves. These tests are about the routes, not about the
// measuring, so what is given here writes down what it was asked to send and sends
// nothing: a real client would try to reach a metrics that is not running, and the test
// would wait for a timeout it does not care about.
const measurements = [];
const METRICS = {
  measure: (metric, fields) => measurements.push({ metric, ...fields }),
  timer: () => () => 0,
  counters: () => ({ sent: measurements.length, failed: 0 }),
};

const root = await mkdtemp(path.join(os.tmpdir(), "webtools-workspaces-api-"));
const server = createServer({
  metrics: METRICS,
  allowedIps: ["127.0.0.1", "::1"],
  root,
  specMaxBytes: 1024,
  documentMaxBytes: 1024,
});
let base;

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

function upload(projectId, body, headers = {}) {
  return fetch(`${base}/projects/${projectId}/specs`, {
    method: "POST",
    headers: { "x-spec-origin": "third_party", "x-uploaded-by": UPLOADER, ...headers },
    body,
  });
}

async function expectError(response, status, code) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error: code });
}

test("upload and reading of the last version", async () => {
  const response = await upload(PROJECT, `---\nproject_id: ${PROJECT}\n---\n# Spec\n`);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { project_id: PROJECT, version: 1 });

  const latest = await fetch(`${base}/projects/${PROJECT}/specs/latest`);
  assert.equal(latest.status, 200);
  assert.equal(latest.headers.get("x-spec-version"), "1");
  assert.match(latest.headers.get("content-type"), /^text\/markdown/);
  const text = await latest.text();
  assert.match(text, /origin: third_party/);
  assert.match(text, /# Spec\n$/);
});

test("bad requests: no file written", async () => {
  const project = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
  await expectError(await upload("non-un-uuid", "x"), 400, "INVALID_PROJECT_ID");
  await expectError(await upload("..%2F..%2Fetc", "x"), 400, "INVALID_PROJECT_ID");
  await expectError(await upload(project, "x", { "x-spec-origin": "io" }), 400, "INVALID_ORIGIN");
  await expectError(await upload(project, "x", { "x-uploaded-by": "" }), 400, "MISSING_UPLOADER");
  await expectError(await upload(project, ""), 400, "EMPTY_SPEC");
  await expectError(await upload(project, Buffer.from([0x23, 0x20, 0xff, 0xfe])), 400, "NOT_UTF8");
  await expectError(await upload(project, "---\na: [\n---\n"), 400, "INVALID_FRONT_MATTER");
  await expectError(await upload(project, "x".repeat(2048)), 413, "SPEC_TOO_LARGE");
  await assert.rejects(readdir(path.join(root, project)), { code: "ENOENT" });
});

test("last version of a project with no specifications", async () => {
  await expectError(
    await fetch(`${base}/projects/3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a/specs/latest`),
    404,
    "SPEC_NOT_FOUND"
  );
});

test("unknown routes and methods", async () => {
  await expectError(await fetch(`${base}/nope`), 404, "ROUTE_NOT_FOUND");
  await expectError(await fetch(`${base}/projects/${PROJECT}/specs`), 405, "METHOD_NOT_ALLOWED");
  await expectError(
    await fetch(`${base}/projects/${PROJECT}/documents/analysis`),
    405,
    "METHOD_NOT_ALLOWED"
  );
  await expectError(
    await fetch(`${base}/projects/${PROJECT}/documents/analysis/latest`, { method: "POST" }),
    405,
    "METHOD_NOT_ALLOWED"
  );
});

test("IP outside the pool", async () => {
  const closed = createServer({
    metrics: METRICS,
    allowedIps: ["10.0.0.1"],
    root,
    specMaxBytes: 1024,
    documentMaxBytes: 1024,
  });
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const response = await fetch(`http://127.0.0.1:${closed.address().port}/nope`);
  await new Promise((resolve) => closed.close(resolve));
  await expectError(response, 403, "IP_NOT_ALLOWED");
});

function storeDocument(projectId, kind, body) {
  return fetch(`${base}/projects/${projectId}/documents/${kind}`, {
    method: "POST",
    headers: { "content-type": "text/markdown; charset=utf-8" },
    body,
  });
}

test("documents: written, read back, and measured", async () => {
  const analysis = await storeDocument(PROJECT, "analysis", "---\nkind: analysis\n---\n# Analysis\n");
  assert.equal(analysis.status, 201);
  assert.deepEqual(await analysis.json(), { project_id: PROJECT, kind: "analysis", version: 1 });

  const proposal = await storeDocument(PROJECT, "proposal", "---\nkind: proposal\n---\n# Proposal\n");
  assert.equal(proposal.status, 201);
  assert.deepEqual(await proposal.json(), { project_id: PROJECT, kind: "proposal", version: 1 });

  const latest = await fetch(`${base}/projects/${PROJECT}/documents/analysis/latest`);
  assert.equal(latest.status, 200);
  assert.equal(latest.headers.get("x-document-version"), "1");
  assert.match(latest.headers.get("content-type"), /^text\/markdown/);
  const text = await latest.text();
  assert.match(text, /written_at:/);
  assert.doesNotMatch(text, /origin:/);
  assert.doesNotMatch(text, /uploaded_by:/);
  assert.match(text, /# Analysis\n$/);

  const written = measurements.filter((m) => m.metric === "document.written");
  assert.deepEqual(
    written.map((m) => m.dims.kind),
    ["analysis", "proposal"]
  );
  assert.equal(written[0].project_id, PROJECT);
  assert.ok(written[0].bytes > 0);
  // The route is measured under its pattern, with the kind in it as a name and not as
  // a value: one bucket per kind of thing measured, not one per project.
  const requests = measurements.filter(
    (m) => m.metric === "http.request" && m.dims.route === "/projects/{project_id}/documents/{kind}"
  );
  assert.ok(requests.length >= 2);
});

test("documents: bad requests, and no file written", async () => {
  const project = "4e5f6a7b-8c9d-4e0f-8a1b-2c3d4e5f6a7b";
  await expectError(await storeDocument("non-un-uuid", "analysis", "x"), 400, "INVALID_PROJECT_ID");
  // The pre-specification has its own route: here it is a kind that does not exist.
  await expectError(await storeDocument(project, "prespec", "x"), 400, "INVALID_KIND");
  await expectError(await storeDocument(project, "nonsense", "x"), 400, "INVALID_KIND");
  await expectError(await storeDocument(project, "analysis", ""), 400, "EMPTY_DOCUMENT");
  await expectError(
    await storeDocument(project, "analysis", Buffer.from([0x23, 0x20, 0xff, 0xfe])),
    400,
    "NOT_UTF8"
  );
  await expectError(await storeDocument(project, "analysis", "---\na: [\n---\n"), 400, "INVALID_FRONT_MATTER");
  await expectError(await storeDocument(project, "analysis", "x".repeat(2048)), 413, "DOCUMENT_TOO_LARGE");
  await assert.rejects(readdir(path.join(root, project)), { code: "ENOENT" });
});

test("documents: none of that kind yet, and a kind that does not exist", async () => {
  const project = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
  await expectError(
    await fetch(`${base}/projects/${project}/documents/analysis/latest`),
    404,
    "DOCUMENT_NOT_FOUND"
  );
  await expectError(
    await fetch(`${base}/projects/${project}/documents/prespec/latest`),
    400,
    "INVALID_KIND"
  );
});
