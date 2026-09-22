// Le lingue delle pagine: cataloghi, scelta della lingua, traduzione.
//
// ORIGINALE in webtools/commons/i18n/. Nei sottosistemi ce n'è una copia
// generata dal deployer (webtools/configurator/deploy.sh i18n), insieme a
// **tutti** i cataloghi: si modifica qui e si rilancia il deployer, mai la copia.
//
// Tutti i testi di tutti i sottosistemi stanno in `locales/<lingua>.json`, e solo
// lì: chi traduce o aggiunge una lingua lavora su un file per lingua, senza
// cercare chiavi nei sottosistemi. Le chiavi sono in inglese, a punti, divise per
// area (`common.*`, `sso.*`, `preanalyst.*`, `front_gate.*`); i file sono oggetti
// JSON annidati con la stessa struttura.
//
// Si traduce solo quello che vede l'utente: codici, dati, API e log restano in
// inglese.
//
// La lingua:
// - sta nel cookie `i18n.cookie_name`, comune a tutti i sottosistemi: i cookie
//   ignorano la porta, quindi quello scritto da un sottosistema lo leggono tutti,
//   a ogni richiesta;
// - senza cookie, si prende la prima lingua disponibile di `Accept-Language`;
// - altrimenti `i18n.fallback_locale`.
// Una chiave che manca nella lingua scelta si prende dalla lingua di riserva.
//
// Configurazione, nel file del sottosistema (niente valori di default):
//   "i18n": {
//     "locales": ["en", "it"],          lingue offerte, ognuna con il suo catalogo
//     "fallback_locale": "en",          lingua di riserva, deve essere tra le offerte
//     "cookie_name": "webtools_locale",
//     "cookie_max_age_seconds": 31536000,
//     "body_max_bytes": 1024            corpo massimo di POST /locale
//   }
//
// Nei template (vedi `pageContext`):
//   {{ t("sso.login.title") }}
//   {{ t("preanalyst.upload.limit", { mb: 10 }) }}   → "… {mb} …" diventa "… 10 …"
//   {{ euro(40000) }}                                → "400 €" / "€400"
//   {% if has("preanalyst.questions.fields.need.hint") %}…   chiavi facoltative
// Il testo di `t` passa dall'autoescape come ogni altro valore.
//
// Quando una frase ha dentro un pezzo marcato (un nome in grassetto, un codice),
// il testo del catalogo contiene l'HTML e si usa `t_html`:
//   "driver_disabled": "Il driver <strong>{name}</strong> non è abilitato."
//   {{ t_html("preanalyst.driver_box.driver_disabled", { name: driver.screen_name }) }}
// I cataloghi sono nostri e il loro HTML si stampa così com'è; i valori invece
// arrivano da fuori, e `t_html` li ripulisce uno per uno. Un valore già marcato
// come sicuro (`| safe`, per un pezzo di HTML reso dal template) resta com'è.

import { existsSync, readFileSync } from "node:fs";

import nunjucks from "nunjucks";

import { ConfigurationError } from "../configuration_client.js";

const LOCALES_DIR = new URL("./locales/", import.meta.url);

// Il percorso di ritorno dopo il cambio di lingua: solo un percorso di questo
// stesso server. `//altro.sito` o `/\altro.sito` il browser li legge come un
// altro indirizzo, e gli spazi (compresi gli a capo) non stanno in un header.
const SAFE_PATH = /^\/(?![/\\])\S*$/;

export const INVALID_LOCALE = "INVALID_LOCALE";
export const BODY_TOO_LARGE = "BODY_TOO_LARGE";

function readCatalog(locale) {
  const file = new URL(`${locale}.json`, LOCALES_DIR);
  if (!existsSync(file)) {
    throw new ConfigurationError(`i18n: la lingua ${locale} è in configurazione ma non ha il catalogo ${file.pathname}`);
  }
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new ConfigurationError(`i18n: catalogo ${locale} non leggibile: ${error.message}`);
  }
  if (catalog === null || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new ConfigurationError(`i18n: il catalogo ${locale} deve essere un oggetto JSON`);
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

// `it-IT,it;q=0.9,en;q=0.8` → ["it", "it", "en"], in ordine di preferenza.
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
    const separatore = piece.indexOf("=");
    if (separatore === -1) continue;
    if (piece.slice(0, separatore).trim() === name) return piece.slice(separatore + 1).trim();
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
    // Le chiavi mancanti anche nella lingua di riserva si segnalano una volta sola.
    this.missing = new Set();
  }

  // La lingua di questa richiesta: cookie, poi Accept-Language, poi la riserva.
  localeOf(request) {
    const scelta = readCookie(request, this.cookieName);
    if (scelta && this.locales.includes(scelta)) return scelta;
    const accettata = acceptedLanguages(request.headers["accept-language"]).find((l) => this.locales.includes(l));
    return accettata ?? this.fallbackLocale;
  }

  #text(locale, key) {
    return lookup(this.catalogs[locale] ?? {}, key) ?? lookup(this.catalogs[this.fallbackLocale], key);
  }

  // C'è un testo per `key`, nella lingua o in quella di riserva?
  has(locale, key) {
    return this.#text(locale, key) !== undefined;
  }

  // Il testo di `key` in `locale`; se manca, quello della lingua di riserva; se
  // manca anche lì, la chiave stessa, che in pagina si nota subito.
  translate(locale, key, vars) {
    const text = this.#text(locale, key);
    if (text === undefined) {
      if (!this.missing.has(key)) {
        this.missing.add(key);
        console.warn(`[i18n] chiave mancante anche in ${this.fallbackLocale}: ${key}`);
      }
      return key;
    }
    return interpolate(text, vars);
  }

  // Come `translate`, per i testi del catalogo che contengono HTML: il testo si
  // stampa così com'è, i valori si ripuliscono.
  translateHtml(locale, key, vars) {
    const text = this.#text(locale, key);
    if (text === undefined) return this.translate(locale, key);
    return new nunjucks.runtime.SafeString(interpolate(text, vars, escapeHtml));
  }

  // 40000 → "400 €" in italiano, "€400" in inglese: i decimali solo se ci sono centesimi.
  euro(locale, cents) {
    const decimals = cents % 100 === 0 ? 0 : 2;
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(cents / 100);
  }

  // Il nome di ogni lingua nella lingua stessa (`common.locale.name`): chi non
  // legge la lingua corrente deve comunque riconoscere la propria.
  choices(current) {
    return this.locales.map((code) => ({
      code,
      name: lookup(this.catalogs[code], "common.locale.name") ?? code,
      current: code === current,
    }));
  }

  // Tutto quello che serve ai template: la lingua, `t`, `t_html`, `has`, `euro`
  // e il selettore.
  // `returnTo` è dove torna il browser dopo il cambio di lingua: di solito la
  // pagina stessa; chi rende una pagina in risposta a un POST ne indica una che
  // si possa riaprire con un GET.
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

  // `POST /locale` con `locale` e `return_to` in un form. Non risponde: dice a chi
  // chiama che cosa rispondere, così ogni server usa le sue risposte.
  //   → { ok: true, locale, cookie, location }   303 verso location, con il cookie
  //   → { ok: false, status, code }               errore del contratto API
  async readChange(request) {
    const pezzi = [];
    let ricevuti = 0;
    for await (const pezzo of request) {
      ricevuti += pezzo.length;
      if (ricevuti > this.bodyMaxBytes) return { ok: false, status: 413, code: BODY_TOO_LARGE };
      pezzi.push(pezzo);
    }
    const form = new URLSearchParams(Buffer.concat(pezzi).toString("utf8"));
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

// Legge la sezione `i18n` della configurazione e i cataloghi delle lingue
// offerte. Lancia ConfigurationError: senza lingue il sottosistema non parte.
export function loadI18n(configuration) {
  const locales = configuration.stringList("i18n.locales");
  const fallbackLocale = configuration.string("i18n.fallback_locale");
  if (!locales.includes(fallbackLocale)) {
    throw new ConfigurationError(`i18n: fallback_locale ${fallbackLocale} non è tra le lingue offerte (${locales.join(", ")})`);
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
