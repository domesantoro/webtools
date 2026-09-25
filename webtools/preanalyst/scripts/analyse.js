// Tries one turn of the analyst on a pre-specification, from the command line.
//
//   set -a; source ../configurator/bootstrap.env; set +a
//   node scripts/analyse.js <file.md> "the client's message" [language]
//
// It is for looking at how a policy conducts the conversation without spending a
// client's turn: write a pre-specification by hand, send a message, read the
// question that comes back, what the analyst thinks is still missing, and what it
// cost. **It makes a real call to the provider**, so it costs.
//
// One turn, with an empty conversation behind it: it is not a whole interview.
// For the whole interview there is the page.
//
// The configuration is the real one, read from anagraphics: the provider, the
// model, the effort and the policy are the ones the server would use.

import { readFile } from "node:fs/promises";

import { ask } from "../src/analyst.js";
import { loadSettings } from "../src/settings.js";

const [file, message, language] = process.argv.slice(2);
if (!file || !message) {
  console.error('Usage: node scripts/analyse.js <file.md> "the client\'s message" [language]');
  process.exit(2);
}

const settings = await loadSettings();
const spec = await readFile(file, "utf8");

const start = Date.now();
const answer = await ask(settings, {
  spec,
  chat: [],
  message,
  turnsLeft: settings.analysis.maxTurns,
  // The page passes the language of whoever is reading. Here it is said on the
  // command line, because the point of this script is to try a policy.
  language: language ?? settings.i18n.fallbackLocale,
});
const elapsed = Date.now() - start;

if (!answer.ok) {
  console.error(`\nfailed: ${answer.reason}`);
  if (answer.usage) console.error(`tokens ${answer.usage.input_tokens} in, ${answer.usage.output_tokens} out`);
  process.exit(1);
}

const { data } = answer;
const usage = data.usage;
console.log(`\nfile      ${file}`);
console.log(`policy    ${data.policy} · ${data.provider} · ${data.model} · ${elapsed} ms`);
console.log(
  `tokens    ${usage.input_tokens} in, ${usage.output_tokens} out` +
    ` · cache ${usage.cache_read_input_tokens} read, ${usage.cache_creation_input_tokens} written`,
);
console.log(`\nclient    ${message}`);
console.log(`\nanalyst   ${data.message}`);
console.log(`\nready     ${data.ready}`);
if (data.missing.length > 0) console.log(`missing   ${data.missing.join("\n          ")}`);
console.log(`reason    ${data.reason}`);
