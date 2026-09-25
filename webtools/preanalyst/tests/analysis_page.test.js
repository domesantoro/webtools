// The analysis page: what it shows about the state the conversation got to.
//
// The page is rendered with the real catalogues and the real template: it is the
// rendering that has to be right, not a copy of it made here. The settings are
// the least the page asks for, written out: a page that starts needing more will
// say so by failing.
//
//   node --test

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadI18n } from "../src/commons/i18n/webtools_i18n.js";
import { renderAnalysis } from "../src/page.js";

// The configuration as the i18n client reads it: the same fields, out of a plain
// object, so the test does not need anagraphics.
const I18N_CONFIGURATION = {
  "i18n.locales": ["en", "it"],
  "i18n.fallback_locale": "en",
  "i18n.cookie_name": "webtools_locale",
  "i18n.cookie_max_age_seconds": 31536000,
  "i18n.body_max_bytes": 1024,
};
const configuration = {
  string: (path) => I18N_CONFIGURATION[path],
  stringList: (path) => I18N_CONFIGURATION[path],
  integer: (path) => I18N_CONFIGURATION[path],
};
const i18n = loadI18n(configuration);
const ui = i18n.pageContext({ headers: {} }, new URL("http://127.0.0.1:9200/analysis/x"));

const settings = {
  publicUrl: "http://127.0.0.1:9200",
  frontGateUrl: "http://127.0.0.1:9000",
  ssoUrl: "http://127.0.0.1:9300",
  answerMaxChars: 20000,
  analysis: { maxTurns: 5, warnFromTurn: 3 },
};
const access = { logged: true, ssoAvailable: true, session: { username: "a@b.c", data: {} } };
const terms = { driverLink: { state: "none" }, ambassador: null, autonomous: false };

function page({ ready, turnsLeft }) {
  return renderAnalysis(ui, {
    access,
    settings,
    terms,
    project_id: "1f251606-bdba-40c4-bbee-bfedc6e57f70",
    chat: { messages: [], turnsLeft, ready, credit: 0 },
  });
}

// The conversation as it is printed, without the <template>s that follow it.
function chatLog(html) {
  const log = /<ol class="chat-log"[\s\S]*?<\/ol>/.exec(html);
  assert.ok(log, "the conversation log is not in the page");
  return log[0];
}

// What the browser reads as "off": the attribute, on that element's own tag.
function hidden(html, marker) {
  const tag = new RegExp(`<[^>]*\\b${marker}\\b[^>]*>`).exec(html);
  assert.ok(tag, `${marker} is not in the page`);
  return / hidden(?![-\w])/.test(tag[0]);
}

test("a conversation that has not begun opens empty: the analyst has still to speak", () => {
  // No fixed greeting in the page. The first message is a real question, asked by
  // the analyst and written onto the step, so here there is nothing yet.
  //
  // Only the log is looked at: the <template>s at the bottom of the page carry the
  // same markup, and they are models to clone, not messages.
  assert.equal(chatLog(page({ ready: false, turnsLeft: 5 })).includes("<li"), false);
});

test("the messages of the conversation are printed, whoever wrote them", () => {
  const html = renderAnalysis(ui, {
    access,
    settings,
    terms,
    project_id: "1f251606-bdba-40c4-bbee-bfedc6e57f70",
    chat: {
      messages: [
        { role: "system", text: "Cosa serve annotare?" },
        { role: "client", text: "la data e il cliente" },
      ],
      turnsLeft: 4,
      credit: 0,
    },
  });
  assert.match(html, /chat-turn-system/);
  assert.match(html, /Cosa serve annotare\?/);
  assert.match(html, /chat-turn-client/);
  assert.match(html, /la data e il cliente/);
  // I turni usati sono i messaggi del cliente, non la metà dei messaggi:
  // l'analista apre la conversazione, quindi i suoi sono uno in più.
  assert.match(html, /data-chat-used>1</);
});

test("while the analysis is not complete the notice is off", () => {
  const html = page({ ready: false, turnsLeft: 5 });
  assert.equal(hidden(html, "data-chat-ready"), true);
});

test("when the analysis is complete the page is born with the notice on", () => {
  // Not left to the JavaScript: the verdict lives on the step, and a reload must
  // find again where the conversation got to.
  const html = page({ ready: true, turnsLeft: 5 });
  assert.equal(hidden(html, "data-chat-ready"), false);
  assert.match(html, /Va bene così|This is fine/);
});

test("the notice does not take the field away: with turns left one goes on writing", () => {
  const html = page({ ready: true, turnsLeft: 5 });
  assert.equal(hidden(html, "data-chat-form"), false);
  assert.equal(hidden(html, "data-chat-exhausted"), true);
});

test("the go button is born off whatever the state: what it does lives in the JavaScript", () => {
  for (const state of [{ ready: false, turnsLeft: 5 }, { ready: true, turnsLeft: 5 }, { ready: false, turnsLeft: 0 }]) {
    const tag = /<[^>]*data-chat-go[^>]*>/.exec(page(state))[0];
    assert.match(tag, /disabled/);
  }
});

test("a step that never got there is not a ready written false by somebody", () => {
  // `ready` missing from the step: the page is the same as a `false`, and nothing
  // is invented in between.
  const html = renderAnalysis(ui, {
    access,
    settings,
    terms,
    project_id: "1f251606-bdba-40c4-bbee-bfedc6e57f70",
    chat: { messages: [], turnsLeft: 5, credit: 0 },
  });
  assert.equal(hidden(html, "data-chat-ready"), true);
});
