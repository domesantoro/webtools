// The front matter of project SPECIFICATIONS: the YAML block at the top of a .md file.
//
//   ---
//   project_id: 1f251606-bdba-40c4-bbee-bfedc6e57f70
//   webtools:
//     origin: third_party
//     version: 2
//   ---
//   # The rest of the document
//
// The original is in webtools/commons/specs/. Each subsystem has a copy generated
// by configurator/specs_deployer/deploy.sh: edit here and run it again.
//
// The `webtools:` key is reserved for the system: it is written by whoever stores
// the file (`stamp`), and whatever an uploaded file declares in there counts for
// nothing.

import YAML from "yaml";

export const RESERVED_KEY = "webtools";

// The shape of a project_id: a UUID in canonical lowercase form, as anagraphics
// generates it. Whoever reads one from a file checks it before using it, and
// whoever builds a path from it knows it contains neither `/` nor `..`.
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isProjectId(value) {
  return typeof value === "string" && PROJECT_ID.test(value);
}

// The front matter is not valid: broken YAML, or not a key → value map.
export class FrontMatterError extends Error {}

// Splits the block from the body. The block is only there if the file starts with
// a `---` line and has another one further down: a `---` in the middle of a
// document is a markdown horizontal rule, not a front matter.
export function split(text) {
  const clean = text.startsWith("﻿") ? text.slice(1) : text;
  const match = /^---[ \t]*\r?\n([\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(clean);
  if (!match) return { frontMatter: null, body: clean };
  return { frontMatter: match[1] ?? "", body: clean.slice(match[0].length) };
}

// The front matter data, or `null` if the file has none.
export function parse(text) {
  const { frontMatter, body } = split(text);
  if (frontMatter === null) return { data: null, body };
  return { data: toMap(parseDocument(frontMatter).toJS()), body };
}

// Rewrites the reserved key with the given values, leaving the rest as it is.
// If the file has no front matter, it is given one.
export function stamp(text, values) {
  const { frontMatter, body } = split(text);
  const document = parseDocument(frontMatter ?? "");
  if (document.contents === null) document.contents = document.createNode({});
  toMap(document.toJS());
  document.set(RESERVED_KEY, values);
  return `---\n${document.toString()}---\n${body}`;
}

function parseDocument(source) {
  const document = YAML.parseDocument(source);
  if (document.errors.length > 0) {
    throw new FrontMatterError(document.errors[0].message);
  }
  return document;
}

function toMap(value) {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new FrontMatterError("the front matter is not a key → value map");
  }
  return value;
}
