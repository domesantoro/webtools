// Le pagine del sso: entra, registrati.
//
// Qui non c'è HTML: sta in `templates/`, in file .njk resi da nunjucks. Questo
// file decide soltanto **quali dati** vanno a ogni pagina.
//
// Perché un motore di template e non stringhe dentro il JavaScript: con
// l'autoescape acceso ogni valore che finisce nell'HTML viene ripulito da solo.
// Scrivendo l'HTML a mano, invece, l'escape è disciplina: basta dimenticarlo una
// volta su un valore che arriva da fuori e si è aperto un buco. Qui si digitano
// password: non è il posto dove tenere una cosa che funziona "se ci si ricorda".
//
// Il layout comune (`templates/commons/base.njk`) è una **copia generata** dal
// deployer: si modifica l'originale in `webtools/commons/templates/` e si
// rilancia `webtools/configurator/deploy.sh`.

import { fileURLToPath } from "node:url";

import nunjucks from "nunjucks";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

const env = nunjucks.configure(TEMPLATES_DIR, {
  // L'unica impostazione che conta davvero: tutto ciò che si scrive con {{ }}
  // passa dall'escape. Per stampare HTML vero serve dirlo apposta con `| safe`.
  autoescape: true,
  // I template stanno su disco accanto al codice e cambiano solo con un deploy:
  // si leggono una volta e restano in memoria.
  noCache: false,
  // Niente trimBlocks: insieme ai `{%-` dei template ridurrebbe la pagina a
  // poche righe lunghissime, e l'HTML reso va letto anche da un essere umano.
  trimBlocks: false,
});

// I messaggi d'errore del login non dicono mai quale dei due campi è sbagliato:
// non si fa sapere a chi prova se un indirizzo è registrato. I testi stanno nei
// cataloghi, sotto `sso.login.errors.<errore>`.
const ERRORS = ["invalid_credentials", "unavailable"];

// `ui` è quello che dà `settings.i18n.pageContext(…)`: lingua, `t` e selettore
// della lingua, che il layout comune usa su ogni pagina.
export function renderLoginPage(ui, { next, username = "", error = null }) {
  return env.render("login.njk", {
    ...ui,
    title: ui.t("sso.login.title"),
    noindex: true,
    next,
    username,
    error,
    error_message: error ? ui.t(`sso.login.errors.${ERRORS.includes(error) ? error : "unavailable"}`) : null,
  });
}

export function renderRegisterPage(ui, { next }) {
  return env.render("register.njk", {
    ...ui,
    title: ui.t("sso.register.title"),
    noindex: true,
    next,
  });
}
