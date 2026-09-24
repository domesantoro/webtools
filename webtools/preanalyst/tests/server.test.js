// Il conteggio dei giri: quante volte una richiesta è già tornata indietro.
//
// È l'unico numero da cui dipende un rifiuto che non viene dal modello, e non è
// conservato da nessuna parte: si legge dal registro dei passi del progetto. Se
// si contasse male, o si rifiuterebbe chi ha ancora giri, o non si smetterebbe
// mai di chiedere.
//
//   node --test

import assert from "node:assert/strict";
import { test } from "node:test";

import { underspecifiedAttempts } from "../src/server.js";

const progetto = (results) => ({
  pipeline: { steps: results.map((result) => ({ step: "prevalidation", result })) },
});

test("underspecifiedAttempts: nessun passo, nessun giro", () => {
  assert.equal(underspecifiedAttempts({}), 0);
  assert.equal(underspecifiedAttempts({ pipeline: { state: "PREANALYSIS" } }), 0);
  assert.equal(underspecifiedAttempts(progetto([])), 0);
});

test("underspecifiedAttempts: si contano solo i giri tornati indietro", () => {
  assert.equal(underspecifiedAttempts(progetto(["underspecified"])), 1);
  assert.equal(underspecifiedAttempts(progetto(["underspecified", "underspecified"])), 2);
  // Un controllo non riuscito non è un giro: l'utente non ha riscritto niente.
  assert.equal(underspecifiedAttempts(progetto(["failed", "underspecified", "failed"])), 1);
  assert.equal(underspecifiedAttempts(progetto(["passed"])), 0);
});
