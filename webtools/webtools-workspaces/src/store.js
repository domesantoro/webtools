// The workspaces' filesystem.
//
//   <root>/<project_id>/specs/spec-v001.md
//                            spec-v002.md   ← the last one counts
//
// Here things are only stored: that the project exists, and whose it is, is
// checked by the caller. A project's workspace is born with the first
// specification.

import { randomUUID } from "node:crypto";
import { link, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { isProjectId, stamp } from "./commons/spec_front_matter.js";

export const ORIGINS = ["system", "third_party"];

const SPEC_FILE = /^spec-v(\d{3,})\.md$/;

// Past this number of concurrent writes on the same project something is wrong:
// better an error than an endless loop.
const MAX_ATTEMPTS = 20;

// The format check is also the defence against paths: an id that passes it
// contains neither `/` nor `..`, so it cannot escape the root.
export { isProjectId };

function specsDir(root, projectId) {
  if (!isProjectId(projectId)) throw new Error(`invalid project_id: ${projectId}`);
  return path.join(root, projectId, "specs");
}

function fileName(version) {
  return `spec-v${String(version).padStart(3, "0")}.md`;
}

async function versions(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => SPEC_FILE.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
}

// Writes a new version of the specification and returns its number.
//
// The system fields (origin, version, who, when) are written into the front
// matter's reserved key, over whatever the file declared there.
//
// The final file is born **already complete**: a temporary one is written and then
// linked to the version's name with `link`, which fails if that name exists. Two
// concurrent writes cannot take the same number, and whoever reads the last
// version never finds a half-written file.
export async function writeSpec(root, projectId, text, { origin, uploadedBy, now = new Date() }) {
  const dir = specsDir(root, projectId);
  // First the front matter is checked, then the disk is touched: a refused file
  // must not leave even the project's directory behind.
  stamp(text, {});
  await mkdir(dir, { recursive: true });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const existing = await versions(dir);
    const version = (existing.at(-1) ?? 0) + 1;
    const content = stamp(text, {
      origin,
      version,
      received_at: now.toISOString(),
      uploaded_by: uploadedBy,
    });

    const temporary = path.join(dir, `.incoming-${randomUUID()}.tmp`);
    await writeFile(temporary, content, { flag: "wx" });
    try {
      await link(temporary, path.join(dir, fileName(version)));
      return { version };
    } catch (error) {
      // Another write took this number: we try again with the next one.
      if (error.code !== "EEXIST") throw error;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  throw new Error(`too many concurrent writes on project ${projectId}`);
}

// The last version, or `null` if the project has no specifications.
export async function latestSpec(root, projectId) {
  const dir = specsDir(root, projectId);
  const version = (await versions(dir)).at(-1);
  if (version === undefined) return null;
  return { version, text: await readFile(path.join(dir, fileName(version)), "utf8") };
}
