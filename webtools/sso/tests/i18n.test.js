// The languages (a copy of commons/i18n): choosing the language, translating with
// a fallback to the fallback language, required configuration.

import assert from "node:assert/strict";
import { test } from "node:test";

import { Configuration, ConfigurationError } from "../src/commons/configuration_client.js";
import { I18n, loadI18n } from "../src/commons/i18n/webtools_i18n.js";

const I18N = {
  locales: ["en", "it"],
  fallback_locale: "en",
  cookie_name: "webtools_locale",
  cookie_max_age_seconds: 60,
  body_max_bytes: 1024,
};

const configuration = (i18n) => new Configuration("sso", { i18n }, "http://127.0.0.1:9100");

const richiesta = (headers) => ({ headers });

// Catalogues written here: the tests do not depend on the real texts.
const i18n = new I18n({
  locales: ["en", "it"],
  fallbackLocale: "en",
  cookieName: "webtools_locale",
  cookieMaxAgeSeconds: 60,
  bodyMaxBytes: 1024,
  catalogs: {
    en: { common: { locale: { name: "English" } }, page: { hello: "Hello {name}", only_en: "Only in English" } },
    it: { common: { locale: { name: "Italiano" } }, page: { hello: "Ciao {name}" } },
  },
});

test("the language: cookie, then Accept-Language, then the fallback", () => {
  assert.equal(i18n.localeOf(richiesta({ cookie: "altro=1; webtools_locale=it" })), "it");
  assert.equal(i18n.localeOf(richiesta({ cookie: "webtools_locale=xx", "accept-language": "it-IT,it;q=0.9" })), "it");
  assert.equal(i18n.localeOf(richiesta({ "accept-language": "de-DE,en;q=0.5,it;q=0.8" })), "it");
  assert.equal(i18n.localeOf(richiesta({ "accept-language": "de-DE" })), "en");
  assert.equal(i18n.localeOf(richiesta({})), "en");
});

test("a missing key is taken from the fallback language", () => {
  assert.equal(i18n.translate("it", "page.hello", { name: "Dome" }), "Ciao Dome");
  assert.equal(i18n.translate("it", "page.only_en"), "Only in English");
  assert.equal(i18n.translate("it", "page.nowhere"), "page.nowhere");
});

test("amounts are written according to the language", () => {
  assert.equal(i18n.euro("it", 40000).replace(/\s/g, " "), "400 €");
  assert.equal(i18n.euro("en", 40050), "€400.50");
});

test("the switcher shows each language in that language", () => {
  assert.deepEqual(i18n.choices("it"), [
    { code: "en", name: "English", current: false },
    { code: "it", name: "Italiano", current: true },
  ]);
});

test("the real catalogues are there for the languages in the configuration", () => {
  const vero = loadI18n(configuration(I18N));
  assert.equal(vero.translate("it", "common.locale.name"), "Italiano");
  assert.equal(vero.translate("en", "common.locale.name"), "English");
});

test("incomplete or wrong configuration: we do not start", () => {
  assert.throws(() => loadI18n(configuration({ ...I18N, cookie_name: undefined })), ConfigurationError);
  assert.throws(() => loadI18n(configuration({ ...I18N, fallback_locale: "de" })), /fallback_locale/);
  assert.throws(() => loadI18n(configuration({ ...I18N, locales: ["en", "xx"] })), /catalogue/);
});
