// Checks on the language catalogues.
//
//   node webtools/commons/i18n/webtools_i18n_check.mjs
//
// 1. Every key written out in full in the subsystems' templates and code
//    (`t("…")`, `t_html("…")`, `has("…")`, `ui.t("…")`) must exist in the
//    fallback catalogue, English: if it is missing there, the key itself shows up
//    on the page. Exits with 1.
// 2. English keys missing from another language: the English text shows up on the
//    page. It is a worklist for whoever translates, not an error.
// 3. Keys of another language that English does not have: nobody uses them.
//
// Keys composed at runtime (`preanalyst.messages.${kind}.title`, the questions in
// questions.js) are invisible from here: point 2 covers them, because they all
// start from English.
//
// This is not distributed to the subsystems: it runs on the original.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEBTOOLS = path.resolve(HERE, "../..");
const LOCALES = path.join(HERE, "locales");
const FALLBACK = "en";
// The subsystems with pages: the original is looked at, not the copies in src/commons.
const SUBSYSTEMS = ["front-gate", "preanalyst", "sso", "commons/templates"];

const KEY_CALL = /\b(?:t|t_html|has)\(\s*["']([a-z_]+(?:\.[A-Za-z0-9_]+)+)["']/g;

function flatten(tree, prefix = "", out = new Set()) {
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object") flatten(value, full, out);
    else out.add(full);
  }
  return out;
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "commons" && dir.endsWith("src")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(njk|js)$/.test(name)) yield full;
  }
}

const catalogs = Object.fromEntries(
  readdirSync(LOCALES)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [name.slice(0, -5), flatten(JSON.parse(readFileSync(path.join(LOCALES, name), "utf8")))])
);
const reference = catalogs[FALLBACK];

let failed = false;

const used = new Map();
for (const subsystem of SUBSYSTEMS) {
  for (const file of files(path.join(WEBTOOLS, subsystem))) {
    for (const match of readFileSync(file, "utf8").matchAll(KEY_CALL)) {
      if (!used.has(match[1])) used.set(match[1], path.relative(WEBTOOLS, file));
    }
  }
}
const missing = [...used].filter(([key]) => !reference.has(key));
if (missing.length > 0) {
  failed = true;
  console.log(`Keys used but missing from ${FALLBACK}.json:`);
  for (const [key, file] of missing) console.log(`  ${key}   (${file})`);
}

for (const [locale, keys] of Object.entries(catalogs)) {
  if (locale === FALLBACK) continue;
  const untranslated = [...reference].filter((key) => !keys.has(key));
  const unused = [...keys].filter((key) => !reference.has(key));
  if (untranslated.length > 0) {
    console.log(`${locale}: ${untranslated.length} keys without a translation (English is shown):`);
    for (const key of untranslated) console.log(`  ${key}`);
  }
  if (unused.length > 0) {
    console.log(`${locale}: ${unused.length} keys that ${FALLBACK}.json does not have:`);
    for (const key of unused) console.log(`  ${key}`);
  }
}

console.log(`${used.size} keys used in full, ${reference.size} in the ${FALLBACK} catalogue.`);
process.exit(failed ? 1 : 0);
