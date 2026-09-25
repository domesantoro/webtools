// Which paths come from the secrets' files.
//
// The files are made here, in a temporary folder: the real ones are outside git
// and are not on every machine, and a test that needed them would be a test that
// only passes on one.

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { leafEntries } from "../src/leaves.js";
import { readSecretPaths } from "../src/secrets.js";

async function folderWith(files) {
  const directory = await mkdtemp(path.join(tmpdir(), "webtools_secrets_"));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(directory, name), typeof content === "string" ? content : JSON.stringify(content));
  }
  return directory;
}

test("a leaf is anything that is not a plain object, lists included", () => {
  assert.deepEqual(
    leafEntries({ a: { b: 1, c: { d: "x" } }, e: ["one", "two"], f: null }),
    [["a.b", 1], ["a.c.d", "x"], ["e", ["one", "two"]], ["f", null]]
  );
});

test("the paths of a secrets file are read, not its values", async () => {
  const directory = await folderWith({
    "preanalyst.json": { ai: { providers: { anthropic: { api_key: "sk-ant-secret" } } } },
  });
  try {
    const secrets = await readSecretPaths(directory);
    assert.equal(secrets.available, true);
    assert.deepEqual([...secrets.bySubsystem.get("preanalyst")], ["ai.providers.anthropic.api_key"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("only the <subsystem>.json files count: the examples and the README are in git", async () => {
  const directory = await folderWith({
    "sso.json": { session: { pepper: "x" } },
    "preanalyst.json.example": { ai: { providers: { anthropic: { api_key: "…" } } } },
    "README.md": "# secrets",
  });
  try {
    const secrets = await readSecretPaths(directory);
    assert.deepEqual([...secrets.bySubsystem.keys()], ["sso"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a folder that is not there is not an error: nothing is known to be secret, and it is said", async () => {
  const secrets = await readSecretPaths(path.join(tmpdir(), "webtools_secrets_that_are_not_there"));
  assert.equal(secrets.available, false);
  assert.match(secrets.reason, /ENOENT/);
  assert.equal(secrets.bySubsystem.size, 0);
});

test("a file that cannot be read does not carry away the others, and is reported", async () => {
  const directory = await folderWith({ "broken.json": "{ not json", "sso.json": { a: 1 }, "list.json": "[1, 2]" });
  try {
    const secrets = await readSecretPaths(directory);
    assert.deepEqual([...secrets.bySubsystem.keys()], ["sso"]);
    assert.equal(secrets.problems.length, 2);
    assert.match(secrets.problems.join(" "), /broken\.json/);
    assert.match(secrets.problems.join(" "), /list\.json: does not hold a JSON object/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
