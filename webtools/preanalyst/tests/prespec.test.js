// What the form's answers become, and what happens to one that is too long.
//
// The pre-specification is the document everything downstream is built on: the
// prevalidation judges it, the analysis is written from it and, in the consumption
// tier, the price is worked out on what that work consumed. An answer cut on the way
// in would make all three of them run on a text the client never wrote, and nothing
// anywhere would say so.
//
//   node --test

import assert from "node:assert/strict";
import { test } from "node:test";

import { readAnswers, renderPrespec } from "../src/prespec.js";

const LIMIT = 100;

// A submission, in the shape `POST /submit` reads: the form's own fields.
const submission = (values) => new URLSearchParams(values);

test("readAnswers: an over-long answer is reported, and kept whole", () => {
  const long = "x".repeat(LIMIT + 1);
  const { answers, tooLong } = readAnswers(submission({ need: long }), LIMIT);

  assert.deepEqual(tooLong, ["need"]);
  // Whole: the reply belongs to the client, and whoever called decides what to do
  // about it. Shortening it here is what used to happen, in silence.
  assert.equal(answers.need, long);
  assert.equal(answers.need.length, LIMIT + 1);
});

test("readAnswers: at the limit nothing is reported", () => {
  const exact = "x".repeat(LIMIT);
  const { answers, tooLong } = readAnswers(submission({ need: exact }), LIMIT);

  assert.deepEqual(tooLong, []);
  assert.equal(answers.need, exact);
});

test("readAnswers: every over-long answer is named, not the first one", () => {
  const long = "x".repeat(LIMIT + 1);
  const { tooLong } = readAnswers(
    submission({ need: long, pain: "short", out_of_scope: long }),
    LIMIT
  );

  // The page names the questions to go back to, so all of them have to be there:
  // naming one would send somebody back twice for the same submission.
  assert.deepEqual(tooLong, ["need", "out_of_scope"]);
});

test("readAnswers: a closed answer is a code, and codes are never too long", () => {
  const { answers, tooLong } = readAnswers(submission({ need: "ok", today: "spreadsheet" }), 1);

  // The limit is one character and the code is eleven, and it is not reported: the
  // value did not come from whoever filled the form in — it is one of ours.
  assert.equal(answers.today, "spreadsheet");
  assert.deepEqual(tooLong, ["need"]);
});

test("renderPrespec: the document carries the answer at the length it was written", () => {
  const long = "y".repeat(5000);
  const { answers } = readAnswers(submission({ need: long }), 100);
  const document = renderPrespec("11111111-2222-3333-4444-555555555555", answers, "it");

  // Nothing between the form and the document shortens it: what the prevalidation
  // reads, and what the analyst will read, is what was written.
  assert.ok(document.includes(long));
});
