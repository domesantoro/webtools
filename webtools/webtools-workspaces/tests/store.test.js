// The workspaces' filesystem and the front matter module, on a temporary root.

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { FrontMatterError, parse, split, stamp } from "../src/commons/spec_front_matter.js";
import { isProjectId, latestSpec, writeSpec } from "../src/store.js";

const PROJECT = "1f251606-bdba-40c4-bbee-bfedc6e57f70";
const NOW = new Date("2026-09-21T15:00:00Z");
const root = await mkdtemp(path.join(os.tmpdir(), "webtools-workspaces-test-"));
after(() => rm(root, { recursive: true, force: true }));

const meta = (origin) => ({ origin, uploadedBy: "8ff93901-673e-44ba-b05b-56011395dcba", now: NOW });

test("front matter: it is read only if it is at the top", () => {
  assert.deepEqual(parse(`---\nproject_id: ${PROJECT}\n---\n# Titolo\n`).data, {
    project_id: PROJECT,
  });
  // A `---` in the middle of a document is a markdown horizontal rule.
  assert.equal(parse(`# Titolo\n\n---\nproject_id: x\n---\n`).data, null);
  assert.equal(split("﻿---\na: 1\n---\ncorpo").body, "corpo");
  assert.deepEqual(parse("---\n---\ncorpo").data, {});
});

test("front matter: broken YAML, or not a map", () => {
  assert.throws(() => parse("---\na: [1, 2\n---\n"), FrontMatterError);
  assert.throws(() => parse("---\n- uno\n- due\n---\n"), FrontMatterError);
  assert.throws(() => stamp("---\n- uno\n---\n", { origin: "system" }), FrontMatterError);
});

test("stamp: the reserved key is rewritten, the rest stays", () => {
  const text = `---\nproject_id: ${PROJECT}\nwebtools:\n  origin: system\n  altro: x\n---\n# Corpo\n`;
  const stamped = stamp(text, { origin: "third_party", version: 3 });
  const { data, body } = parse(stamped);
  assert.deepEqual(data, { project_id: PROJECT, webtools: { origin: "third_party", version: 3 } });
  assert.equal(body, "# Corpo\n");
});

test("stamp: a file with no front matter is given one", () => {
  const { data, body } = parse(stamp("# Solo corpo\n", { origin: "system" }));
  assert.deepEqual(data, { webtools: { origin: "system" } });
  assert.equal(body, "# Solo corpo\n");
});

test("project_id: canonical UUIDs only, no paths", () => {
  assert.ok(isProjectId(PROJECT));
  for (const value of ["..", "../etc", `${PROJECT}/..`, PROJECT.toUpperCase(), "", "abc"]) {
    assert.equal(isProjectId(value), false, value);
  }
});

test("versions: the first is 1, the last counts, the declared origin does not", async () => {
  assert.equal(await latestSpec(root, PROJECT), null);

  const first = await writeSpec(root, PROJECT, `---\nproject_id: ${PROJECT}\n---\nuno\n`, meta("system"));
  const second = await writeSpec(
    root,
    PROJECT,
    `---\nproject_id: ${PROJECT}\nwebtools:\n  origin: system\n---\ndue\n`,
    meta("third_party")
  );
  assert.equal(first.version, 1);
  assert.equal(second.version, 2);

  const latest = await latestSpec(root, PROJECT);
  assert.equal(latest.version, 2);
  const { data, body } = parse(latest.text);
  assert.deepEqual(data.webtools, {
    origin: "third_party",
    version: 2,
    received_at: "2026-09-21T15:00:00.000Z",
    uploaded_by: "8ff93901-673e-44ba-b05b-56011395dcba",
  });
  assert.equal(body, "due\n");

  const files = await readdir(path.join(root, PROJECT, "specs"));
  assert.deepEqual(files.sort(), ["spec-v001.md", "spec-v002.md"]);
});

test("concurrent writes: all different numbers, no half-written file", async () => {
  const project = "0b7e3c1a-2f4d-4e6a-9b8c-7d6e5f4a3b2c";
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => writeSpec(root, project, `corpo ${i}\n`, meta("system")))
  );
  assert.deepEqual(
    results.map((r) => r.version).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  );
  const dir = path.join(root, project, "specs");
  const files = await readdir(dir);
  // No temporary left behind.
  assert.equal(files.length, 10);
  for (const file of files) {
    const { data } = parse(await readFile(path.join(dir, file), "utf8"));
    assert.equal(`spec-v${String(data.webtools.version).padStart(3, "0")}.md`, file);
  }
});

test("broken front matter: nothing is written", async () => {
  const project = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
  await assert.rejects(writeSpec(root, project, "---\na: [\n---\n", meta("system")), FrontMatterError);
  await assert.rejects(readdir(path.join(root, project)), { code: "ENOENT" });
});
