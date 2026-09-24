// La pre-specifica: le risposte del form, scritte come documento .md.
//
// È il punto di partenza dell'analisi, quindi è scritta per chi la legge dopo:
// - il front matter porta solo **codici**, presi dalle opzioni del form, così un
//   programma (il prevalidator) li legge senza interpretare niente. Mai testo
//   scritto dall'utente: non potrebbe iniettare chiavi YAML;
// - il corpo è in inglese, con la domanda e la risposta chiusa in chiaro, perché
//   un «No» non vuol dire niente senza la domanda;
// - le risposte aperte restano testuali, nella lingua del cliente, dentro un
//   blockquote: un `## titolo` scritto dal cliente resta testo suo e non diventa
//   una sezione del documento;
// - un campo vuoto si scrive `Not provided.`, non si omette, e finisce negli
//   «Open points» insieme alle risposte "non saprei": è l'elenco di quello che
//   la chat di analisi deve chiedere;
// - niente nome, email, sconto o driver: il documento va a un fornitore AI, e
//   chi è il cliente e da dove arriva restano nel progetto.
//
// La chiave `webtools:` del front matter non si scrive qui: la timbra
// webtools-workspaces quando conserva il file.
//
// Il template sta in `templates/commons/prespec.md.njk`, ed è una **copia
// generata**: la forma del documento è configurazione, quindi l'originale è in
// `webtools/configurator/documents/` e lo distribuisce il documents_deployer.

import { fileURLToPath } from "node:url";

import nunjucks from "nunjucks";

import { SECTIONS } from "./questions.js";

export const TEMPLATE = "prespec/1";

// Le risposte chiuse che vanno nel front matter. Le skill no: l'elenco delle
// caselle è aperto e sta accanto a un campo libero, quindi un codice da solo
// racconterebbe metà della risposta.
const FRONT_MATTER_FIELDS = ["today", "users", "devices", "volume", "personal_data", "existing_data"];

// Le risposte che valgono come "non lo so", e quindi sono un punto aperto.
const UNKNOWN = "unknown";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

// Un ambiente a parte, **senza autoescape**: questo è markdown, e l'escape
// dell'HTML trasformerebbe `&` e `<` del cliente in entità. Il testo del cliente
// entra solo attraverso il filtro `quote`.
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

// Le risposte del form, ripulite. Un codice che non è tra le opzioni si scarta:
// nel front matter finisce solo quello che il form poteva mandare.
//   → { answers: { nome: stringa | stringa[] | null }, missing: [nomi obbligatori vuoti] }
// Una risposta aperta più lunga di `maxTextLength` caratteri si tronca.
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

// Come si scrive una risposta nel corpo: testo del cliente citato, risposte
// chiuse col loro testo inglese, `null` se manca.
function bodyAnswer(field, value) {
  if (isEmpty(value)) return null;
  if (field.kind === "checkbox") return { list: value.map((code) => optionText(field, code)) };
  if (field.kind === "radio") return { text: optionText(field, value) };
  return { quote: value };
}

// I punti aperti: i campi senza risposta e le risposte "non saprei". Un gruppo
// (le skill e il loro "Altro") manca solo se mancano tutte le sue domande.
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

// `language`: la lingua in cui il cliente ha scritto le risposte aperte, cioè
// quella della pagina da cui ha mandato il form. Il resto è in inglese.
export function renderPrespec(projectId, answers, language) {
  return env.render("commons/prespec.md.njk", {
    project_id: projectId,
    template: TEMPLATE,
    language,
    // I codici sono sempre fra quelli del form ([a-z_]), quindi si scrivono
    // nel YAML così come sono, senza virgolette.
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
