// The showcase site's pages.
//
// There is no HTML here: it lives in `templates/`, in .njk files rendered by
// nunjucks with autoescaping on. This file decides only which pages exist and
// which data they receive.

import { fileURLToPath } from "node:url";

import nunjucks from "nunjucks";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

const env = nunjucks.configure(TEMPLATES_DIR, {
  autoescape: true,
  noCache: false,
  trimBlocks: false,
});

// Address → template. The addresses stay those of the static site, because the
// pages link to each other with `<name>.html`.
export const PAGES = {
  "/": "index.njk",
  "/index.html": "index.njk",
  "/what-it-is.html": "what-it-is.njk",
  "/examples.html": "examples.njk",
  "/how-it-works.html": "how-it-works.njk",
  "/pricing.html": "pricing.njk",
  "/contacts.html": "contacts.njk",
  "/work-with-us.html": "work-with-us.njk",
};

// `ui` is what `settings.i18n.pageContext(…)` gives: language, `t` and the
// language switcher. The texts of every page live in the catalogues, under
// `front_gate.*`; the price is written according to the language (400 € / €400).
export function renderPage(template, settings, ui) {
  return env.render(template, {
    ...ui,
    preanalystUrl: settings.preanalystUrl,
    standardPrice: ui.euro(settings.standardPriceCents),
  });
}
