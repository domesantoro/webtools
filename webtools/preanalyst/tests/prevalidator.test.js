// I test del prevalidator: come si legge la risposta del modello e che cosa se
// ne fa. La chiamata al fornitore non si prova qui — costa e non è ripetibile:
// si provano le funzioni che decidono, che sono quelle che possono sbagliare.
//
//   node --test

import assert from "node:assert/strict";
import { test } from "node:test";

import { normalize, OUTCOMES, rejects, REJECTING, UNDERSPECIFIED, verdict } from "../src/prevalidator.js";

const somma = (distribution) => OUTCOMES.reduce((totale, name) => totale + distribution[name], 0);

// Una distribuzione completa a partire da quello che interessa al test: gli
// esiti non nominati valgono zero. Senza, ogni caso dovrebbe scrivere cinque
// numeri anche per provarne uno.
const dist = (valori) => Object.fromEntries(OUTCOMES.map((name) => [name, valori[name] ?? 0]));

test("normalize: una distribuzione che somma a 1 resta com'è", () => {
  const raw = dist({ run_out_certain: 0.1, run_out_likely: 0.2, safe: 0.5, ultrasafe: 0.2 });
  const { distribution, outcome } = normalize(raw);
  assert.equal(outcome, "safe");
  assert.equal(distribution.safe, 0.5);
  assert.ok(Math.abs(somma(distribution) - 1) < 1e-9);
});

test("normalize: una distribuzione che non somma a 1 viene riportata a 1", () => {
  // Il modello dichiara cinque numeri e quasi mai sommano esattamente a uno.
  const raw = dist({ run_out_certain: 2, run_out_likely: 2, safe: 4, ultrasafe: 2 });
  const { distribution, outcome } = normalize(raw);
  assert.equal(outcome, "safe");
  assert.equal(distribution.safe, 0.4);
  assert.ok(Math.abs(somma(distribution) - 1) < 1e-9);
});

test("normalize: a parità vince il più prudente", () => {
  const raw = dist(Object.fromEntries(OUTCOMES.map((name) => [name, 1])));
  // Il primo dell'elenco: fra sei letture ugualmente probabili si tiene quella
  // che ferma tutto.
  assert.equal(normalize(raw).outcome, OUTCOMES[0]);
  assert.ok(REJECTING.includes(normalize(raw).outcome));
});

test("normalize: `non_sequitur` è un esito come gli altri", () => {
  const raw = dist({ non_sequitur: 0.8, run_out_likely: 0.1, safe: 0.1 });
  assert.equal(normalize(raw).outcome, "non_sequitur");
});

test("normalize: `underspecified` è un esito come gli altri", () => {
  const raw = dist({ run_out_likely: 0.2, underspecified: 0.6, safe: 0.2 });
  assert.equal(normalize(raw).outcome, UNDERSPECIFIED);
});

test("normalize: rifiuta quello che non è una distribuzione", () => {
  assert.equal(normalize(undefined), null);
  assert.equal(normalize({}), null);
  // Un esito che manca: con cinque numeri su sei non si sa che cosa dica il
  // sesto, e un esito mancante non vale zero.
  assert.equal(
    normalize({ run_out_certain: 0.5, run_out_likely: 0, safe: 0.5, ultrasafe: 0 }),
    null
  );
  // Valori che non sono numeri, o sono impossibili.
  assert.equal(normalize(dist({ run_out_certain: "alto" })), null);
  assert.equal(normalize(dist({ run_out_certain: -1, safe: 1 })), null);
  assert.equal(normalize(dist({ run_out_certain: NaN, safe: 1 })), null);
  // Tutti a zero: non c'è niente da normalizzare, e dividere per zero darebbe
  // NaN. È il caso che si è visto davvero — il modello che azzerava tutto su una
  // richiesta fuori dominio, prima che `non_sequitur` le desse un posto dove
  // stare. La policy lo vieta, la guardia resta.
  assert.equal(normalize(dist({})), null);
});

test("rejects: serve l'esito più probabile E la soglia superata", () => {
  const sopra = normalize(dist({ run_out_certain: 0.8, run_out_likely: 0.1, safe: 0.1 }));
  assert.equal(rejects(sopra.distribution, sopra.outcome, 0.6), true);

  // Il più alto dei cinque, ma sotto la soglia: non è una certezza di niente.
  const sotto = normalize(dist({ run_out_certain: 0.35, run_out_likely: 0.3, safe: 0.2, ultrasafe: 0.15 }));
  assert.equal(sotto.outcome, "run_out_certain");
  assert.equal(rejects(sotto.distribution, sotto.outcome, 0.6), false);
});

test("rejects: rifiutano solo i due esiti che rifiutano", () => {
  const probabile = normalize(dist({ run_out_certain: 0.1, run_out_likely: 0.8, safe: 0.1 }));
  assert.equal(probabile.outcome, "run_out_likely");
  assert.equal(rejects(probabile.distribution, probabile.outcome, 0.6), false);

  // `non_sequitur` rifiuta come `run_out_certain`, e alle stesse condizioni.
  const fuori = normalize(dist({ non_sequitur: 0.9, run_out_certain: 0.1 }));
  assert.equal(rejects(fuori.distribution, fuori.outcome, 0.6), true);

  const incerto = normalize(dist({ non_sequitur: 0.4, safe: 0.35, run_out_likely: 0.25 }));
  assert.equal(incerto.outcome, "non_sequitur");
  assert.equal(rejects(incerto.distribution, incerto.outcome, 0.6), false);
});

// --------------------------------------------------------------- il verdetto

const decide = (valori, { attempts = 0, maxAttempts = 2 } = {}) => {
  const { distribution, outcome } = normalize(dist(valori));
  return verdict(distribution, outcome, { threshold: 0.6, attempts, maxAttempts });
};

test("verdict: quello che sta dentro il perimetro passa", () => {
  assert.equal(decide({ safe: 0.7, run_out_likely: 0.3 }), "passed");
  assert.equal(decide({ ultrasafe: 0.9, safe: 0.1 }), "passed");
  // `run_out_likely` non è un rifiuto: il cancello ferma solo le certezze.
  assert.equal(decide({ run_out_likely: 0.8, safe: 0.2 }), "passed");
});

test("verdict: il rifiuto viene prima di tutto il resto", () => {
  assert.equal(decide({ run_out_certain: 0.9, underspecified: 0.1 }), "rejected");
});

test("verdict: quello che non potremmo costruire si rifiuta", () => {
  // Un logo, un parere, una consulenza: non è una questione di dimensione, e la
  // sorte è quella di una richiesta troppo grande.
  assert.equal(decide({ non_sequitur: 0.95, run_out_likely: 0.05 }), "rejected");
  // Sotto la soglia no: due condizioni, come per ogni rifiuto.
  assert.equal(decide({ non_sequitur: 0.5, safe: 0.3, run_out_likely: 0.2 }), "passed");
});

test("verdict: una richiesta che dice troppo poco torna indietro", () => {
  assert.equal(decide({ underspecified: 0.7, safe: 0.3 }, { attempts: 0 }), "underspecified");
  assert.equal(decide({ underspecified: 0.7, safe: 0.3 }, { attempts: 1 }), "underspecified");
});

test("verdict: finiti i giri non si chiede più, si rifiuta", () => {
  // Chi ha già riscritto `maxAttempts` volte non viene rimandato indietro un'altra
  // volta: continuare a chiedere non è un invito, è un muro.
  assert.equal(decide({ underspecified: 0.7, safe: 0.3 }, { attempts: 2, maxAttempts: 2 }), "rejected");
  assert.equal(decide({ underspecified: 0.7, safe: 0.3 }, { attempts: 5, maxAttempts: 2 }), "rejected");
});

test("verdict: il tetto dei giri non tocca gli altri esiti", () => {
  // Una richiesta chiara resta chiara anche al terzo giro.
  assert.equal(decide({ safe: 0.8, underspecified: 0.2 }, { attempts: 9, maxAttempts: 2 }), "passed");
});
