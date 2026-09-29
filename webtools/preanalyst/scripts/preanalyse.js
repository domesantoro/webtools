// Tries one turn of the preanalyst on a pre-specification, from the command line.
//
//   set -a; source ../configurator/bootstrap.env; set +a
//   node scripts/preanalyse.js <file.md> ["the client's message"] [language]
//
// With no message it runs the **opening**: the first question, the one the preanalyst
// asks after reading the pre-specification and before anybody has written.
//
// It is for looking at how a policy conducts the conversation without spending a
// client's turn: write a pre-specification by hand, send a message, read the
// question that comes back, what the preanalyst thinks is still missing, and what it
// cost. **It makes a real call to the provider**, so it costs.
//
// One turn, with an empty conversation behind it: it is not a whole interview.
// For the whole interview there is the page.
//
// The configuration is the real one, read from anagraphics: the provider, the
// model, the effort and the policy are the ones the server would use.

import { readFile } from "node:fs/promises";

import { ask } from "../src/preanalyst.js";
import { loadSettings } from "../src/settings.js";

const [file, message, language] = process.argv.slice(2);
if (!file) {
  console.error('Usage: node scripts/preanalyse.js <file.md> ["the client\'s message"] [language]');
  process.exit(2);
}
// No message: the opening, which is a turn with nobody having written yet.
const opening = !message;

const settings = await loadSettings();
const spec = await readFile(file, "utf8");

const start = Date.now();
const answer = await ask(settings, {
  spec,
  chat: [],
  message: message ?? null,
  opening,
  turnsLeft: settings.preanalysis.maxTurns,
  // The page passes the language of whoever is reading. Here it is said on the
  // command line, because the point of this script is to try a policy.
  language: language ?? settings.i18n.fallbackLocale,
});
const elapsed = Date.now() - start;

// The spend printed as it comes: the names of the kinds are the adapter's, and a
// list of them written here would be a provider's vocabulary in a script.
const spendLine = (answer) =>
  answer.spend
    ? Object.entries(answer.spend.kinds)
        .map(([kind, units]) => `${kind} ${units}`)
        .join(", ")
    : "nothing recorded";

if (!answer.ok) {
  console.error(`\nended ${answer.ended}${answer.failure ? ` (${answer.failure})` : ""} after ${answer.attempts} attempt(s)`);
  console.error(`spend ${spendLine(answer)}`);
  process.exit(1);
}

const { output } = answer;
console.log(`\nfile      ${file}`);
console.log(`policy    ${answer.policy} · ${answer.provider} · ${answer.model} · ${elapsed} ms`);
console.log(`attempts  ${answer.attempts}${answer.fell_back ? " · fell back to another model" : ""}`);
console.log(`spend     ${spendLine(answer)}`);
console.log(`\nclient    ${message}`);
console.log(`\npreanalyst ${output.message}`);
console.log(`\nready     ${output.ready}`);
if (output.missing.length > 0) console.log(`missing   ${output.missing.join("\n          ")}`);
console.log(`reason    ${output.reason}`);
