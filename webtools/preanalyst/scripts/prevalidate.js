// Tries the prevalidator on a file, from the command line.
//
//   set -a; source ../configurator/bootstrap.env; set +a
//   node scripts/prevalidate.js <file.md>
//
// The bootstrap is there to find anagraphics, as for every subsystem.
//
// It is for looking at how a policy judges without going through the form: write a
// pre-specification by hand, run it, read the outcome, the distribution, the flag
// and the tokens consumed. **It makes a real call to the provider**, so it costs:
// a few thousandths of a euro, but it is not free.
//
// The configuration is the real one, read from anagraphics: the provider, the
// model, the policy and the threshold are the ones the server would use.

import { readFile } from "node:fs/promises";

import { prevalidate, verdict } from "../src/prevalidator.js";
import { loadSettings } from "../src/settings.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/prevalidate.js <file.md>");
  process.exit(2);
}

const settings = await loadSettings();
const spec = await readFile(file, "utf8");

const start = Date.now();
const outcome = await prevalidate(settings, spec);
const elapsed = Date.now() - start;

if (!outcome.ok) {
  console.error(`Prevalidation failed: ${outcome.reason} (${elapsed} ms)`);
  process.exit(1);
}

const { outcome: verdictName, distribution, off_domain, reason, policy, provider, model, usage } = outcome.data;
// The verdict as the server would take it, on the **first** round: there is no
// project here, so there are no rounds already done to count.
const decision = verdict(distribution, verdictName, {
  threshold: settings.prevalidation.rejectThreshold,
  attempts: 0,
  maxAttempts: settings.prevalidation.maxUnderspecifiedAttempts,
});

console.log(`file      ${file}`);
console.log(`policy    ${policy} · ${provider} · ${model} · ${elapsed} ms`);
console.log(`tokens    ${usage.input_tokens} in, ${usage.output_tokens} out`);
console.log("");
for (const [name, value] of Object.entries(distribution)) {
  const bar = "█".repeat(Math.round(value * 40));
  console.log(`  ${name.padEnd(16)} ${value.toFixed(3)}  ${bar}`);
}
console.log("");
console.log(`outcome   ${verdictName}  →  ${decision.toUpperCase()}`);
console.log(`domain    ${off_domain.flag ? `outside: ${off_domain.reason}` : "inside"}`);
console.log(`reason    ${reason}`);
