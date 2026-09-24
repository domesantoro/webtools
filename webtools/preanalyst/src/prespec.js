// The pre-specification: the form's answers, written out as a .md document.
//
// It is the starting point of the analysis, so it is written for whoever reads it
// afterwards:
// - the front matter carries **codes** only, taken from the form's options, so a
//   program (the prevalidator) reads them without interpreting anything. Never
//   text written by the user: that could not inject YAML keys;
// - the body is in English, with the question and the closed answer spelled out,
//   because a "No" means nothing without the question;
// - the open answers stay as text, in the client's language, inside a blockquote:
//   a `## heading` written by the client stays their text and does not become a
//   section of the document;
// - an empty field is written `Not provided.`, not omitted, and ends up in the
//   "Open points" together with the "I do not know" answers: that is the list of
//   what the analysis chat has to ask about;
// - no name, email, discount or driver: the document goes to an AI provider, and
//   who the client is and where they came from stay on the project.
//
// The front matter's `webtools:` key is not written here: webtools-workspaces
// stamps it when it stores the file.
//
// The template is in `templates/commons/prespec.md.njk`, and it is a **generated
// copy**: the shape of the document is configuration, so the original is in
// `webtools/configurator/documents/` and the documents_deployer distributes it.

import { fileURLToPath } from "node:url";

import nunjucks from "nunjucks";

import { SECTIONS } from "./questions.js";

export const TEMPLATE = "prespec/1";

// The closed answers that go into the front matter. Not the skills: the list of
// checkboxes is open and sits next to a free field, so a code on its own would
// tell half the answer.
const FRONT_MATTER_FIELDS = ["today", "users", "devices", "volume", "personal_data", "existing_data"];

// The answers that count as "I do not know", and are therefore an open point.
const UNKNOWN = "unknown";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

// A separate environment, **without autoescaping**: this is markdown, and HTML
// escaping would turn the client's `&` and `<` into entities. The client's text
// only gets in through the `quote` filter.
const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(TEMPLATES_DIR), {
  autoescape: false,
  trimBlocks: true,
  lstripBlocks: true,
});
env.addFilter("quote", (text) =>
  text
    .split("\n")
    .map((line) => (line.trim() === "" ? ">" : `> ${line}`))
    .join("\n")
);

const FIELDS = SECTIONS.flatMap((section) => section.fields);

// The form's answers, cleaned up. A code that is not among the options is
// discarded: only what the form could have sent ends up in the front matter.
//   → { answers: { name: string | string[] | null }, missing: [names of empty required fields] }
// An open answer longer than `maxTextLength` characters is truncated.
export function readAnswers(form, maxTextLength) {
  const answers = {};
  for (const field of FIELDS) {
    const codes = (field.options ?? []).map((option) => option[0]);
    if (field.kind === "checkbox") {
      const values = form.getAll(`${field.name}[]`);
      answers[field.name] = codes.filter((code) => values.includes(code));
    } else if (field.kind === "radio") {
      const value = form.get(field.name);
      answers[field.name] = codes.includes(value) ? value : null;
    } else {
      const value = (form.get(field.name) ?? "").replace(/\r\n?/g, "\n").trim();
      answers[field.name] = value ? value.slice(0, maxTextLength) : null;
    }
  }
  const missing = FIELDS.filter((field) => field.required && isEmpty(answers[field.name])).map(
    (field) => field.name
  );
  return { answers, missing };
}

function isEmpty(value) {
  return value === null || (Array.isArray(value) && value.length === 0);
}

function optionText(field, code) {
  return field.options.find((option) => option[0] === code)[1];
}

// How an answer is written in the body: the client's text quoted, closed answers
// with their English text, `null` if it is missing.
function bodyAnswer(field, value) {
  if (isEmpty(value)) return null;
  if (field.kind === "checkbox") return { list: value.map((code) => optionText(field, code)) };
  if (field.kind === "radio") return { text: optionText(field, value) };
  return { quote: value };
}

// The open points: the fields with no answer and the "I would not know" answers.
// A group (the skills and their "Other") is missing only if all its questions are.
function openPoints(answers) {
  const points = [];
  const groups = new Set();
  for (const field of FIELDS) {
    const value = answers[field.name];
    if (field.group) {
      if (groups.has(field.group)) continue;
      groups.add(field.group);
      const members = FIELDS.filter((other) => other.group === field.group);
      if (members.every((member) => isEmpty(answers[member.name]))) {
        points.push(`${members.map((member) => member.spec).join(" / ")}: not provided.`);
      }
      continue;
    }
    if (isEmpty(value)) points.push(`${field.spec}: not provided.`);
    else if (value === UNKNOWN) points.push(`${field.spec}: the client does not know.`);
  }
  return points;
}

// `language`: the language in which the client wrote the open answers, that is,
// the one of the page they sent the form from. The rest is in English.
export function renderPrespec(projectId, answers, language) {
  return env.render("commons/prespec.md.njk", {
    project_id: projectId,
    template: TEMPLATE,
    language,
    // The codes always come from the form's own ([a-z_]), so they are written into
    // the YAML as they are, without quotes.
    answers: FRONT_MATTER_FIELDS.map((name) => {
      const value = answers[name];
      let yaml = "null";
      if (Array.isArray(value)) yaml = `[${value.join(", ")}]`;
      else if (value !== null) yaml = value;
      return { name, yaml };
    }),
    sections: SECTIONS.map((section) => ({
      title: section.spec,
      fields: section.fields.map((field) => ({
        title: field.spec,
        answer: bodyAnswer(field, answers[field.name]),
      })),
    })),
    open_points: openPoints(answers),
  });
}
