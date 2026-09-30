// The languages of the pages: catalogues, language choice, translation.
//
// THE ORIGINAL is in webtools/commons/i18n/. Each subsystem has a copy generated
// by the deployer (webtools/configurator/deploy.sh i18n), together with **all**
// the catalogues: edit here and run the deployer again, never the copy.
//
// Every text of every subsystem lives in `locales/<language>.json`, and only
// there: whoever translates or adds a language works on one file per language,
// without hunting for keys inside the subsystems. The keys are in English, dotted,
// grouped by area (`common.*`, `sso.*`, `preanalyst.*`, `front_gate.*`); the files
// are nested JSON objects with the same structure.
//
// Only what the user sees is translated: codes, data, API and logs stay in
// English.
//
// The language:
// - lives in the `i18n.cookie_name` cookie, shared by every subsystem: cookies
//   ignore the port, so the one written by a subsystem is read by all of them, on
//   every request;
// - without a cookie, the first available language of `Accept-Language` is taken;
// - otherwise `i18n.fallback_locale`.
// A key missing from the chosen language is taken from the fallback language.
//
// Configuration, in the subsystem's file (no default values):
//   "i18n": {
//     "locales": ["en", "it"],          languages offered, each with its catalogue
//     "fallback_locale": "en",          fallback language, must be among those offered
//     "cookie_name": "webtools_locale",
//     "cookie_max_age_seconds": 31536000,
//     "body_max_bytes": 1024            maximum body of POST /locale
//   }
//
// In the templates (see `pageContext`):
//   {{ t("sso.login.title") }}
//   {{ t("preanalyst.upload.limit", { mb: 10 }) }}   → "… {mb} …" becomes "… 10 …"
//   {{ euro(40000) }}                                → "400 €" / "€400"
//   {% if has("preanalyst.questions.fields.need.hint") %}…   optional keys
// The text of `t` goes through autoescaping like any other value.
//
// When a sentence has a marked-up piece inside it (a name in bold, a code), the
// catalogue text contains the HTML and `t_html` is used:
//   "driver_disabled": "Il driver <strong>{name}</strong> non è abilitato."
//   {{ t_html("preanalyst.driver_box.driver_disabled", { name: driver.screen_name }) }}
// The catalogues are ours and their HTML is printed as it is; the values, on the
// other hand, come from outside, and `t_html` cleans them one by one. A value
// already marked as safe (`| safe`, for a piece of HTML rendered by the template)
// is left alone.

import { existsSync, readFileSync } from "node:fs";

import nunjucks from "nunjucks";

import { ConfigurationError } from "../configuration_client.js";

const LOCALES_DIR = new URL("./locales/", import.meta.url);

// The return path after a language change: only a path of this same server. The
// browser reads `//other.site` or `/\other.site` as another address, and spaces
// (newlines included) do not belong in a header.
const SAFE_PATH = /^\/(?![/\\])\S*$/;

export const INVALID_LOCALE = "INVALID_LOCALE";
export const BODY_TOO_LARGE = "BODY_TOO_LARGE";

function readCatalog(locale) {
  const file = new URL(`${locale}.json`, LOCALES_DIR);
  if (!existsSync(file)) {
    throw new ConfigurationError(`i18n: language ${locale} is in the configuration but has no catalogue at ${file.pathname}`);
  }
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new ConfigurationError(`i18n: catalogue ${locale} cannot be read: ${error.message}`);
  }
  if (catalog === null || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new ConfigurationError(`i18n: catalogue ${locale} must be a JSON object`);
  }
  return catalog;
}

function lookup(catalog, key) {
  let value = catalog;
  for (const part of key.split(".")) {
    value = value !== null && typeof value === "object" ? value[part] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

function interpolate(text, vars, escape = String) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? escape(vars[name]) : whole));
}

function escapeHtml(value) {
  if (value instanceof nunjucks.runtime.SafeString) return value.toString();
  return nunjucks.lib.escape(String(value ?? ""));
}

// `it-IT,it;q=0.9,en;q=0.8` → ["it", "it", "en"], in order of preference.
function acceptedLanguages(header) {
  if (!header) return [];
  return header
    .split(",")
    .map((piece, index) => {
      const [tag, ...params] = piece.trim().split(";");
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)).find(Boolean);
      return { language: tag.split("-")[0].toLowerCase(), q: q ? Number(q[1]) : 1, index };
    })
    .filter((entry) => entry.language && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((entry) => entry.language);
}

function readCookie(request, name) {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const piece of header.split(";")) {
    const separator = piece.indexOf("=");
    if (separator === -1) continue;
    if (piece.slice(0, separator).trim() === name) return piece.slice(separator + 1).trim();
  }
  return null;
}

export class I18n {
  constructor({ locales, fallbackLocale, cookieName, cookieMaxAgeSeconds, bodyMaxBytes, catalogs }) {
    this.locales = locales;
    this.fallbackLocale = fallbackLocale;
    this.cookieName = cookieName;
    this.cookieMaxAgeSeconds = cookieMaxAgeSeconds;
    this.bodyMaxBytes = bodyMaxBytes;
    this.catalogs = catalogs;
    // Keys missing from the fallback language too are reported only once.
    this.missing = new Set();
  }

  // The language of this request: cookie, then Accept-Language, then the fallback.
  localeOf(request) {
    const chosen = readCookie(request, this.cookieName);
    if (chosen && this.locales.includes(chosen)) return chosen;
    const accepted = acceptedLanguages(request.headers["accept-language"]).find((l) => this.locales.includes(l));
    return accepted ?? this.fallbackLocale;
  }

  #text(locale, key) {
    return lookup(this.catalogs[locale] ?? {}, key) ?? lookup(this.catalogs[this.fallbackLocale], key);
  }

  // Is there a text for `key`, in this language or in the fallback one?
  has(locale, key) {
    return this.#text(locale, key) !== undefined;
  }

  // The text of `key` in `locale`; if missing, the fallback language's; if missing
  // there too, the key itself, which is immediately visible on the page.
  translate(locale, key, vars) {
    const text = this.#text(locale, key);
    if (text === undefined) {
      if (!this.missing.has(key)) {
        this.missing.add(key);
        console.warn(`[i18n] key missing from ${this.fallbackLocale} as well: ${key}`);
      }
      return key;
    }
    return interpolate(text, vars);
  }

  // Like `translate`, for catalogue texts that contain HTML: the text is printed
  // as it is, the values are cleaned.
  translateHtml(locale, key, vars) {
    const text = this.#text(locale, key);
    if (text === undefined) return this.translate(locale, key);
    return new nunjucks.runtime.SafeString(interpolate(text, vars, escapeHtml));
  }

  // 40000 → "400 €" in Italian, "€400" in English: decimals only if there are cents.
  euro(locale, cents) {
    const decimals = cents % 100 === 0 ? 0 : 2;
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(cents / 100);
  }

  // The name of each language in that language (`common.locale.name`): somebody
  // who cannot read the current language must still recognise their own.
  choices(current) {
    return this.locales.map((code) => ({
      code,
      name: lookup(this.catalogs[code], "common.locale.name") ?? code,
      current: code === current,
    }));
  }

  // Everything the templates need: the language, `t`, `t_html`, `has`, `euro` and
  // the switcher.
  // `returnTo` is where the browser goes after a language change: usually the page
  // itself; whoever renders a page in answer to a POST names one that can be
  // reopened with a GET.
  pageContext(request, url, { returnTo } = {}) {
    const locale = this.localeOf(request);
    return {
      locale,
      t: (key, vars) => this.translate(locale, key, vars),
      t_html: (key, vars) => this.translateHtml(locale, key, vars),
      has: (key) => this.has(locale, key),
      euro: (cents) => this.euro(locale, cents),
      locale_switch: {
        action: "/locale",
        return_to: returnTo ?? `${url.pathname}${url.search}`,
        choices: this.choices(locale),
      },
    };
  }

  cookie(locale) {
    return `${this.cookieName}=${locale}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${this.cookieMaxAgeSeconds}`;
  }

  // `POST /locale` with `locale` and `return_to` in a form. It does not answer: it
  // tells the caller what to answer, so every server uses its own responses.
  //   → { ok: true, locale, cookie, location }   303 to location, with the cookie
  //   → { ok: false, status, code }              an API-contract error
  async readChange(request) {
    const chunks = [];
    let received = 0;
    for await (const chunk of request) {
      received += chunk.length;
      if (received > this.bodyMaxBytes) return { ok: false, status: 413, code: BODY_TOO_LARGE };
      chunks.push(chunk);
    }
    const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    const locale = form.get("locale");
    if (!locale || !this.locales.includes(locale)) return { ok: false, status: 400, code: INVALID_LOCALE };
    const returnTo = form.get("return_to") ?? "";
    return {
      ok: true,
      locale,
      cookie: this.cookie(locale),
      location: SAFE_PATH.test(returnTo) ? returnTo : "/",
    };
  }
}

// Reads the `i18n` section of the configuration and the catalogues of the
// languages offered. Throws ConfigurationError: without languages the subsystem
// does not start.
export function loadI18n(configuration) {
  const locales = configuration.stringList("i18n.locales");
  const fallbackLocale = configuration.string("i18n.fallback_locale");
  if (!locales.includes(fallbackLocale)) {
    throw new ConfigurationError(`i18n: fallback_locale ${fallbackLocale} is not among the languages offered (${locales.join(", ")})`);
  }
  const catalogs = Object.fromEntries(locales.map((locale) => [locale, readCatalog(locale)]));
  return new I18n({
    locales,
    fallbackLocale,
    cookieName: configuration.string("i18n.cookie_name"),
    cookieMaxAgeSeconds: configuration.integer("i18n.cookie_max_age_seconds", { min: 1 }),
    bodyMaxBytes: configuration.integer("i18n.body_max_bytes", { min: 1 }),
    catalogs,
  });
}
