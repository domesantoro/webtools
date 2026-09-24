// Prova il prevalidator su un file, da riga di comando.
//
//   set -a; source ../configurator/bootstrap.env; set +a
//   node scripts/prevalidate.js <file.md>
//
// Il bootstrap serve a trovare anagraphics, come per ogni sottosistema.
//
// Serve a guardare come giudica una policy senza passare dal form: si scrive una
// pre-specifica a mano, si lancia, si leggono esito, distribuzione, flag e token
// consumati. **Fa una chiamata vera al fornitore**, quindi costa: pochi millesimi
// di euro, ma non è gratis.
//
// La configurazione è quella vera, letta da anagraphics: il fornitore, il
// modello, la policy e la soglia sono quelli che userebbe il server.

import { readFile } from "node:fs/promises";

import { prevalidate, verdict } from "../src/prevalidator.js";
import { loadSettings } from "../src/settings.js";

const file = process.argv[2];
if (!file) {
  console.error("Uso: node scripts/prevalidate.js <file.md>");
  process.exit(2);
}

const settings = await loadSettings();
const spec = await readFile(file, "utf8");

const inizio = Date.now();
const esito = await prevalidate(settings, spec);
const durata = Date.now() - inizio;

if (!esito.ok) {
  console.error(`Prevalidazione non riuscita: ${esito.reason} (${durata} ms)`);
  process.exit(1);
}

const { outcome, distribution, off_domain, reason, policy, provider, model, usage } = esito.data;
// Il verdetto come lo prenderebbe il server, al **primo** giro: qui non c'è un
// progetto, quindi non ci sono giri già fatti da contare.
const decisione = verdict(distribution, outcome, {
  threshold: settings.prevalidation.rejectThreshold,
  attempts: 0,
  maxAttempts: settings.prevalidation.maxUnderspecifiedAttempts,
});

console.log(`file      ${file}`);
console.log(`policy    ${policy} · ${provider} · ${model} · ${durata} ms`);
console.log(`token     ${usage.input_tokens} in, ${usage.output_tokens} out`);
console.log("");
for (const [nome, valore] of Object.entries(distribution)) {
  const barra = "█".repeat(Math.round(valore * 40));
  console.log(`  ${nome.padEnd(16)} ${valore.toFixed(3)}  ${barra}`);
}
console.log("");
console.log(`esito     ${outcome}  →  ${decisione.toUpperCase()}`);
console.log(`dominio   ${off_domain.flag ? `fuori: ${off_domain.reason}` : "dentro"}`);
console.log(`motivo    ${reason}`);
