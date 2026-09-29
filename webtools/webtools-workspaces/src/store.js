// The workspaces' filesystem.
//
//   <root>/<project_id>/specs/spec-v001.md                    the specifications
//                            spec-v002.md          ← the last one counts
//                      documents/analysis/analysis-v001.md    what the system wrote
//                                proposal/proposal-v001.md
//
// Two families, because two different things are kept. A specification **arrives** —
// rendered from the form, or uploaded by the client — so where it came from is part of
// what is recorded about it. A document is **produced by us** for a project, one kind
// per directory: there is no origin to record, because everything under `documents/`
// was written by the system, and nobody uploaded it.
//
// Here things are only stored: that the project exists, and whose it is, is
// checked by the caller. A project's workspace is born with the first file stored
// for it.

import { randomUUID } from "node:crypto";
import { link, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { isProjectId, stamp } from "./commons/spec_front_matter.js";

export const ORIGINS = ["system", "third_party"];

// The kinds of document a project can hold, one directory each. The list is closed,
// so a caller with a typo is refused instead of opening a directory nobody will ever
// read. `prespec` is deliberately **not** in it: the pre-specification is stored by
// `POST /projects/{id}/specs` and lives under `specs/`, and accepting it here as well
// would give one kind two places to be, with no rule about which of the two counts.
export const DOCUMENT_KINDS = ["analysis", "proposal"];

// Past this number of concurrent writes on the same family something is wrong:
// better an error than an endless loop.
const MAX_ATTEMPTS = 20;

// The format check is also the defence against paths: an id that passes it
// contains neither `/` nor `..`, so it cannot escape the root.
export { isProjectId };

function projectDir(root, projectId) {
  if (!isProjectId(projectId)) throw new Error(`invalid project_id: ${projectId}`);
  return path.join(root, projectId);
}

// A family of versioned files: the directory they live in, and the stem their names
// are built on. The stem is in the name of every file — `spec-v001.md`,
// `analysis-v001.md` — so a file says which family it belongs to even when it is read
// far from the directory it was written in.
function specs(root, projectId) {
  return { dir: path.join(projectDir(root, projectId), "specs"), stem: "spec" };
}

// The kind is checked against the closed list, which for the path does what
// `isProjectId` does for the identifier: what passes contains neither `/` nor `..`.
function documents(root, projectId, kind) {
  if (!DOCUMENT_KINDS.includes(kind)) throw new Error(`unknown document kind: ${kind}`);
  return { dir: path.join(projectDir(root, projectId), "documents", kind), stem: kind };
}

function fileName(stem, version) {
  return `${stem}-v${String(version).padStart(3, "0")}.md`;
}

async function versions({ dir, stem }) {
  const versioned = new RegExp(`^${stem}-v(\\d{3,})\\.md$`);
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => versioned.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
}

// Writes a new version in a family and returns its number. `systemFields` is asked
// for the values of the front matter's reserved key once the number is known, because
// the number is one of them.
//
// The final file is born **already complete**: a temporary one is written and then
// linked to the version's name with `link`, which fails if that name exists. Two
// concurrent writes cannot take the same number, and whoever reads the last
// version never finds a half-written file.
async function writeVersion(family, text, systemFields) {
  // First the front matter is checked, then the disk is touched: a refused file
  // must not leave even the project's directory behind.
  stamp(text, {});
  await mkdir(family.dir, { recursive: true });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const existing = await versions(family);
    const version = (existing.at(-1) ?? 0) + 1;
    const content = stamp(text, systemFields(version));

    const temporary = path.join(family.dir, `.incoming-${randomUUID()}.tmp`);
    await writeFile(temporary, content, { flag: "wx" });
    try {
      await link(temporary, path.join(family.dir, fileName(family.stem, version)));
      return { version };
    } catch (error) {
      // Another write took this number: we try again with the next one.
      if (error.code !== "EEXIST") throw error;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  throw new Error(`too many concurrent writes in ${family.dir}`);
}

// The last version of a family, or `null` if it holds nothing yet.
async function latestVersion(family) {
  const version = (await versions(family)).at(-1);
  if (version === undefined) return null;
  const file = path.join(family.dir, fileName(family.stem, version));
  return { version, text: await readFile(file, "utf8") };
}

// A specification: the system fields say where the file came from and who sent it.
export async function writeSpec(root, projectId, text, { origin, uploadedBy, now = new Date() }) {
  return writeVersion(specs(root, projectId), text, (version) => ({
    origin,
    version,
    received_at: now.toISOString(),
    uploaded_by: uploadedBy,
  }));
}

export async function latestSpec(root, projectId) {
  return latestVersion(specs(root, projectId));
}

// A document the system wrote for a project. The reserved key carries the version and
// when it was written, and neither an origin nor an uploader: under `documents/` there
// is only one origin, so a field repeating it on every file of every kind would say
// nothing, and there is no person to name — a run of the analyst has no session
// behind it, and an identifier put there to fill the field would be invented.
export async function writeDocument(root, projectId, kind, text, { now = new Date() } = {}) {
  return writeVersion(documents(root, projectId, kind), text, (version) => ({
    version,
    written_at: now.toISOString(),
  }));
}

export async function latestDocument(root, projectId, kind) {
  return latestVersion(documents(root, projectId, kind));
}
