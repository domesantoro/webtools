// Le rotte, provate per intero su una radice temporanea.

import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { createServer } from "../src/server.js";

const PROJECT = "1f251606-bdba-40c4-bbee-bfedc6e57f70";
const UPLOADER = "8ff93901-673e-44ba-b05b-56011395dcba";

const root = await mkdtemp(path.join(os.tmpdir(), "webtools-workspaces-api-"));
const server = createServer({
  allowedIps: ["127.0.0.1", "::1"],
  root,
  specMaxBytes: 1024,
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

test("upload e lettura dell'ultima versione", async () => {
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

test("richieste sbagliate: nessun file scritto", async () => {
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

test("ultima versione di un progetto senza specifiche", async () => {
  await expectError(
    await fetch(`${base}/projects/3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a/specs/latest`),
    404,
    "SPEC_NOT_FOUND"
  );
});

test("rotte e metodi sconosciuti", async () => {
  await expectError(await fetch(`${base}/nope`), 404, "ROUTE_NOT_FOUND");
  await expectError(await fetch(`${base}/projects/${PROJECT}/specs`), 405, "METHOD_NOT_ALLOWED");
});

test("IP fuori dal pool", async () => {
  const closed = createServer({ allowedIps: ["10.0.0.1"], root, specMaxBytes: 1024 });
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const response = await fetch(`http://127.0.0.1:${closed.address().port}/nope`);
  await new Promise((resolve) => closed.close(resolve));
  await expectError(response, 403, "IP_NOT_ALLOWED");
});
