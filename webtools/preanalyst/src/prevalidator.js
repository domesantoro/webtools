// Il prevalidator: il primo cancello del flusso.
//
// Legge la pre-specifica appena scritta e dice se la richiesta sta dentro il
// perimetro del servizio. Non progetta niente, non fa domande, non scrive testi
// per il cliente: restituisce una decisione.
//
// Sei esiti, con una probabilità ciascuno — `non_sequitur`, `run_out_certain`,
// `run_out_likely`, `underspecified`, `safe`, `ultrasafe` — e una motivazione.
//
// Quattro esiti stanno sull'asse della dimensione. Gli altri due no:
// `underspecified` dice che su quell'asse la richiesta non si riesce a mettere,
// perché ha detto troppo poco — non è un rifiuto, è un invito a scrivere
// qualcosa in più; `non_sequitur` dice che su quell'asse la richiesta non ci
// sta per principio, perché non c'è nessun software da misurare. Un logo, un
// parere, una consulenza: il developer non potrebbe costruirli a nessuna
// dimensione, quindi la richiesta si rifiuta come una che non ci sta.
//
// Accanto agli esiti c'è il flag **interno** `off_domain`, che risponde a una
// domanda diversa: il software che ci chiedono è un webtool? Si alza per una
// richiesta che si potrebbe sviluppare — un sito vetrina, un negozio online,
// un'app, un gioco, un plugin, uno script senza interfaccia — ma che non è il
// genere di strumento che facciamo. È indipendente dalla dimensione: si può
// essere fuori dominio ed essere `safe`. Non decide niente da solo e non arriva
// mai al cliente: andrà al driver quando ci sarà l'area driver.
//
// Da non confondere con `non_sequitur`, che invece è un esito e rifiuta: quello
// dice che software non ce n'è affatto, questo che il software non è dei nostri.
//
// I criteri non stanno qui: stanno nella policy, che è configurazione
// (`webtools/configurator/policies/`), distribuita in `policies/`. Qui c'è solo
// come si legge la risposta e come si decide che cosa farne.
//
// Contratto verso chi chiama:
//   { ok: true, data: { outcome, distribution, off_domain, reason, policy,
//                       provider, model, usage } }
//   { ok: false, reason: "unavailable" | "rejected" | "unknown_provider",
//                usage?, model? }
//
// Anche quando va storto, se il modello ha risposto i token sono stati spesi:
// `usage` c'è, e chi chiama lo registra. Un costo che non si vede non si misura.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { decide } from "./ai/webtools_ai.js";

const POLICIES_DIR = fileURLToPath(new URL("../policies/", import.meta.url));

// L'ordine conta: a parità di probabilità vince il primo, cioè il più prudente.
export const OUTCOMES = [
  "non_sequitur",
  "run_out_certain",
  "run_out_likely",
  "underspecified",
  "safe",
  "ultrasafe",
];

// Gli esiti che portano la richiesta in REJECTED. Sono due e rifiutano allo
// stesso modo, ma per ragioni diverse: `run_out_certain` è troppo grande per
// noi, `non_sequitur` non è roba nostra a nessuna dimensione.
export const REJECTING = ["non_sequitur", "run_out_certain"];

// L'esito che rimanda l'utente al form: la richiesta non si riesce a giudicare,
// serve qualche dettaglio in più.
export const UNDERSPECIFIED = "underspecified";

// Lo schema che il modello deve rispettare. `additionalProperties: false` e
// `required` ovunque: quello che torna o è questo, o non è niente.
//
// **Niente `minimum` e `maximum` sulle probabilità**, per quanto verrebbe
// naturale scriverli: l'uscita vincolata non accetta i vincoli numerici, e
// l'API risponde `400 invalid_request_error` ("For 'number' type, properties
// maximum, minimum are not supported"). Non sono supportati nemmeno
// `minLength`/`maxLength`, `multipleOf` e gli schemi ricorsivi. Gli SDK li
// tolgono da soli solo quando lo schema è uno Zod passato a `messages.parse()`;
// qui lo schema è JSON e arriva all'API com'è scritto.
//
// Non si perde niente: l'intervallo lo controlla `normalize()`, che scarta
// quello che non è un numero finito e non negativo e riporta la somma a 1.
const SCHEMA = {
  type: "object",
  properties: {
    distribution: {
      type: "object",
      properties: Object.fromEntries(OUTCOMES.map((name) => [name, { type: "number" }])),
      required: OUTCOMES,
      additionalProperties: false,
    },
    off_domain: {
      type: "object",
      properties: { flag: { type: "boolean" }, reason: { type: "string" } },
      required: ["flag", "reason"],
      additionalProperties: false,
    },
    reason: { type: "string" },
  },
  required: ["distribution", "off_domain", "reason"],
  additionalProperties: false,
};

// La policy, letta dal disco una volta sola: non cambia mentre il server gira, e
// dopo un deploy il server si riavvia comunque.
const policies = new Map();

async function readPolicy(name) {
  if (!policies.has(name)) {
    const testo = await readFile(`${POLICIES_DIR}${name}.md`, "utf8");
    // La copia porta in testa un commento HTML messo dal deployer («non
    // modificare qui»): è roba nostra, non va nel prompt.
    policies.set(name, testo.replace(/^\s*<!--[\s\S]*?-->\s*/, ""));
  }
  return policies.get(name);
}

// La distribuzione, ripulita. Il modello dichiara sei numeri e quasi mai
// sommano esattamente a 1: si normalizza, invece di fidarsi o di rifiutare una
// risposta buona per un errore di aritmetica.
//   → { distribution, outcome } oppure null se non c'è niente da normalizzare.
export function normalize(raw) {
  const valori = OUTCOMES.map((name) => {
    const value = raw?.[name];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  });
  if (valori.some((value) => value === null)) return null;

  const totale = valori.reduce((somma, value) => somma + value, 0);
  if (totale <= 0) return null;

  const distribution = {};
  OUTCOMES.forEach((name, indice) => {
    distribution[name] = valori[indice] / totale;
  });

  // L'esito è il più probabile. A parità vince il primo dell'elenco, cioè il più
  // prudente: fra due letture ugualmente probabili si tiene quella che ferma.
  let outcome = OUTCOMES[0];
  for (const name of OUTCOMES) {
    if (distribution[name] > distribution[outcome]) outcome = name;
  }
  return { distribution, outcome };
}

// Si rifiuta solo se l'esito più probabile è uno dei due che rifiutano **e**
// supera la soglia. Due condizioni e non una: un `run_out_certain` al 35%, pur
// essendo il più alto dei sei, non è una certezza di niente. La soglia è la
// stessa per tutti e due: chi rifiuta lo fa alle stesse condizioni.
export function rejects(distribution, outcome, threshold) {
  return REJECTING.includes(outcome) && distribution[outcome] > threshold;
}

// Che cosa si fa di una prevalidazione riuscita: "rejected", "underspecified"
// oppure "passed".
//
// `attempts` è quante volte questa stessa richiesta è già tornata indietro per
// mancanza di dettagli. Oltre il limite non si chiede più: continuare a
// rimandare indietro qualcuno che ha già riscritto tante volte non è un invito,
// è un muro, e allora tanto vale dirlo.
export function verdict(distribution, outcome, { threshold, attempts, maxAttempts }) {
  if (rejects(distribution, outcome, threshold)) return "rejected";
  if (outcome !== UNDERSPECIFIED) return "passed";
  return attempts >= maxAttempts ? "rejected" : "underspecified";
}

export async function prevalidate(settings, spec) {
  const { policy, specMaxChars } = settings.prevalidation;
  const instructions = await readPolicy(policy);

  const risposta = await decide(settings, {
    instructions,
    // Il taglio è una rete di sicurezza, non un controllo: le risposte aperte
    // sono già limitate al momento dell'invio (`form.answer_max_chars`).
    document: spec.slice(0, specMaxChars),
    schema: SCHEMA,
  });
  if (!risposta.ok) return risposta;

  const { output, model, usage } = risposta.data;
  const normalizzata = normalize(output?.distribution);
  if (normalizzata === null) {
    // Succede se il modello manda numeri che non sono numeri, o li mette tutti a
    // zero: da una distribuzione vuota non si ricava nessun esito. La policy lo
    // vieta esplicitamente — se non c'è altro, la massa va su `non_sequitur` —
    // ma la guardia resta, perché il modello non è tenuto a obbedire. I token
    // però sono stati spesi, e si riportano indietro.
    console.error("[prevalidator] distribuzione non utilizzabile");
    return { ok: false, reason: "rejected", usage, model };
  }

  return {
    ok: true,
    data: {
      outcome: normalizzata.outcome,
      distribution: normalizzata.distribution,
      off_domain: {
        flag: Boolean(output.off_domain?.flag),
        reason: String(output.off_domain?.reason ?? ""),
      },
      reason: String(output.reason ?? ""),
      policy,
      provider: settings.ai.provider,
      model,
      usage,
    },
  };
}
