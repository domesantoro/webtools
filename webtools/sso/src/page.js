// The sso pages: log in, register.
//
// There is no HTML here: it lives in `templates/`, in .njk files rendered by
// nunjucks. This file decides only **which data** goes to each page.
//
// Why a template engine and not strings inside the JavaScript: with autoescaping
// on, every value that ends up in the HTML is cleaned by itself. Writing the HTML
// by hand, escaping is discipline instead: forget it once on a value coming from
// outside and a hole is open. Passwords are typed here: this is not the place for
// something that works "if you remember".
//
// The shared layout (`templates/commons/base.njk`) is a **generated copy**: edit
// the original in `webtools/commons/templates/` and run
// `webtools/configurator/deploy.sh` again.

import { fileURLToPath } from "node:url";

import nunjucks from "nunjucks";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

const env = nunjucks.configure(TEMPLATES_DIR, {
  // The one setting that really matters: everything written with {{ }} goes
  // through escaping. To print real HTML you have to say so with `| safe`.
  autoescape: true,
  // The templates live on disk next to the code and change only with a deploy:
  // they are read once and stay in memory.
  noCache: false,
  // No trimBlocks: together with the templates' `{%-` it would squeeze the page
  // into a few very long lines, and the rendered HTML is read by humans too.
  trimBlocks: false,
});

// The login error messages never say which of the two fields is wrong: whoever is
// trying is not told whether an address is registered. The texts live in the
// catalogues, under `sso.login.errors.<error>`.
const ERRORS = ["invalid_credentials", "unavailable"];

// `ui` is what `settings.i18n.pageContext(…)` gives: language, `t` and the
// language switcher, which the shared layout uses on every page.
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
