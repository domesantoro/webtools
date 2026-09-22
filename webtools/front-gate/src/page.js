// Le pagine del sito vetrina.
//
// Qui non c'è HTML: sta in `templates/`, in file .njk resi da nunjucks con
// l'autoescape acceso. Questo file decide soltanto quali pagine esistono e
// quali dati ricevono.

import { fileURLToPath } from "node:url";

import nunjucks from "nunjucks";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

const env = nunjucks.configure(TEMPLATES_DIR, {
  autoescape: true,
  noCache: false,
  trimBlocks: false,
});

// Indirizzo → template. Gli indirizzi restano quelli del sito statico, perché
// le pagine si collegano tra loro con `<nome>.html`.
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

// `ui` è quello che dà `settings.i18n.pageContext(…)`: lingua, `t` e selettore
// della lingua. I testi di tutte le pagine stanno nei cataloghi, sotto
// `front_gate.*`; il prezzo si scrive secondo la lingua (400 € / €400).
export function renderPage(template, settings, ui) {
  return env.render(template, {
    ...ui,
    preanalystUrl: settings.preanalystUrl,
    standardPrice: ui.euro(settings.standardPriceCents),
  });
}
