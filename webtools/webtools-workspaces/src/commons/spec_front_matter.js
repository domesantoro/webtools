// Il front matter delle SPECIFICHE di progetto: il blocco YAML in testa a un file .md.
//
//   ---
//   project_id: 1f251606-bdba-40c4-bbee-bfedc6e57f70
//   webtools:
//     origin: third_party
//     version: 2
//   ---
//   # Il resto del documento
//
// Originale in webtools/commons/specs/. Nei sottosistemi c'è una copia generata
// da configurator/specs_deployer/deploy.sh: si modifica qui e si rilancia.
//
// La chiave `webtools:` è riservata al sistema: la scrive chi conserva il file
// (`stamp`), e quello che un file caricato dichiara lì dentro non vale niente.

import YAML from "yaml";

export const RESERVED_KEY = "webtools";

// Il formato di un project_id: UUID in forma canonica minuscola, come lo genera
// anagraphics. Chi lo legge da un file lo controlla prima di usarlo, e chi ci
// costruisce un percorso sa che non contiene né `/` né `..`.
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isProjectId(value) {
  return typeof value === "string" && PROJECT_ID.test(value);
}

// Il front matter non è valido: YAML rotto, oppure non è una mappa chiave → valore.
export class FrontMatterError extends Error {}

// Separa il blocco dal corpo. Il blocco c'è solo se il file comincia con una
// riga `---` e ne ha un'altra più sotto: un `---` a metà documento è una riga
// orizzontale del markdown, non un front matter.
export function split(text) {
  const clean = text.startsWith("﻿") ? text.slice(1) : text;
  const match = /^---[ \t]*\r?\n([\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(clean);
  if (!match) return { frontMatter: null, body: clean };
  return { frontMatter: match[1] ?? "", body: clean.slice(match[0].length) };
}

// I dati del front matter, oppure `null` se il file non ne ha uno.
export function parse(text) {
  const { frontMatter, body } = split(text);
  if (frontMatter === null) return { data: null, body };
  return { data: toMap(parseDocument(frontMatter).toJS()), body };
}

// Riscrive la chiave riservata con i valori dati, lasciando il resto com'è.
// Se il file non ha un front matter, gliene dà uno.
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
    throw new FrontMatterError("il front matter non è una mappa chiave → valore");
  }
  return value;
}
