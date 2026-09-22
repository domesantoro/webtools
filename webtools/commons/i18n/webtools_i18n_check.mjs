// Controllo dei cataloghi delle lingue.
//
//   node webtools/commons/i18n/webtools_i18n_check.mjs
//
// 1. Ogni chiave scritta per esteso nei template e nel codice dei sottosistemi
//    (`t("…")`, `t_html("…")`, `has("…")`, `ui.t("…")`) deve esistere nel
//    catalogo di riserva, l'inglese: se manca lì, in pagina compare la chiave.
//    Esce con 1.
// 2. Le chiavi dell'inglese che mancano in un'altra lingua: in pagina esce il
//    testo inglese. È un elenco di lavoro per chi traduce, non un errore.
// 3. Le chiavi di un'altra lingua che l'inglese non ha: nessuno le usa.
//
// Le chiavi composte a runtime (`preanalyst.messages.${kind}.title`, le domande
// di questions.js) non si vedono da qui: le copre il punto 2, perché partono
// tutte dall'inglese.
//
// Non viene distribuito nei sottosistemi: gira sull'originale.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEBTOOLS = path.resolve(HERE, "../..");
const LOCALES = path.join(HERE, "locales");
const FALLBACK = "en";
// I sottosistemi con pagine: si guarda l'originale, non le copie in src/commons.
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
  console.log(`Chiavi usate ma assenti in ${FALLBACK}.json:`);
  for (const [key, file] of missing) console.log(`  ${key}   (${file})`);
}

for (const [locale, keys] of Object.entries(catalogs)) {
  if (locale === FALLBACK) continue;
  const untranslated = [...reference].filter((key) => !keys.has(key));
  const unused = [...keys].filter((key) => !reference.has(key));
  if (untranslated.length > 0) {
    console.log(`${locale}: ${untranslated.length} chiavi senza traduzione (si mostra l'inglese):`);
    for (const key of untranslated) console.log(`  ${key}`);
  }
  if (unused.length > 0) {
    console.log(`${locale}: ${unused.length} chiavi che ${FALLBACK}.json non ha:`);
    for (const key of unused) console.log(`  ${key}`);
  }
}

console.log(`${used.size} chiavi usate per esteso, ${reference.size} nel catalogo ${FALLBACK}.`);
process.exit(failed ? 1 : 0);
