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
  "/che-cos-e.html": "che-cos-e.njk",
  "/esempi.html": "esempi.njk",
  "/come-funziona.html": "come-funziona.njk",
  "/quanto-costa.html": "quanto-costa.njk",
  "/contatti.html": "contatti.njk",
  "/lavora-con-noi.html": "lavora-con-noi.njk",
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
