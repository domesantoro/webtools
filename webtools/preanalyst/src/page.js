// The data that goes to the page.
//
// There is no HTML here: it lives in `templates/`, in .njk files rendered by
// nunjucks. This file prepares the data and nothing else — which sections, how the
// provenance from a driver's link turned out, who has logged in.
//
// Why a template engine and not strings inside the JavaScript: with autoescaping
// on, every value that ends up in the HTML is cleaned by itself. Writing the HTML
// by hand makes escaping a matter of discipline, and here the values all come from
// outside — from the URL and from the database.
//
// The shared layout (`templates/commons/base.njk`) is a **generated copy**: edit
// the original in `webtools/commons/templates/` and run
// `webtools/configurator/deploy.sh` again.
//
// The page is rendered by the server: the browser receives the HTML already
// complete and never talks to anagraphics, which only accepts calls from known
// IPs.

import { fileURLToPath } from "node:url";

import nunjucks from "nunjucks";

import { loginUrl, registerUrl } from "./commons/sso_client.js";
import { SECTIONS } from "./questions.js";
import { DISCOUNT_APPLIED, DISCOUNT_DRIVER_DISABLED, isResolved, OWN_LINK } from "./driver_link.js";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

const env = nunjucks.configure(TEMPLATES_DIR, {
  // The setting that matters: everything written with {{ }} goes through
  // escaping. To print real HTML you have to say so with `| safe`.
  autoescape: true,
  noCache: false,
  // No trimBlocks: together with the templates' `{%-` it would squeeze the page
  // into a few very long lines, and the rendered HTML is read by humans too.
  trimBlocks: false,
});

// What arrived in the URL must not be lost at the first submission: the discount
// code sits in no visible field, so it travels hidden. When the driver has been
// recognised their uid is sent; when nothing could be resolved, what arrived is
// sent back — if the failure is ours, the user must not pay for it.
function hiddenFields(driverLink, params, driversAvailable) {
  const campi = [];
  // The discount of a driver who is not enabled does not apply: it does not travel with the form.
  if (params.discountCode && driverLink.state !== DISCOUNT_DRIVER_DISABLED) {
    campi.push({ name: "discount", value: params.discountCode });
  }
  if (driversAvailable && isResolved(driverLink)) {
    campi.push({ name: "driver", value: driverLink.driver.uid });
  } else if (!driversAvailable && params.driverUid) {
    campi.push({ name: "driver", value: params.driverUid });
  }
  return campi;
}

// Where the sso sends the browser after the login: **not** the starting page, but
// the small page that closes the round trip (`/login-done`). The login window
// lands there, notifies the starting page and closes. Sending it to the starting
// page would open a second copy of the pre-analysis in the wrong window, leaving
// the real one convinced nobody had logged in.
function afterLogin(settings) {
  return `${settings.publicUrl}/login-done`;
}

// The "Autonomous work" section of the showcase site's "Work with us" page.
function workWithUsUrl(settings) {
  return `${settings.frontGateUrl}/lavora-con-noi.html#lavoro-autonomo`;
}

// The fragments that depend on who has logged in. They are the same macros the
// page uses, so the page just loaded and the page refreshed by the browser cannot
// diverge.
// The fragments to replace after the login, each with its container's selector.
// The whole right-hand column is not replaced: the upload block is in there, and
// redoing it would throw away the file the user has already chosen.
export function renderAccessFragments(ui, access, settings, colonna) {
  const dati = accessData(access, settings);
  const aside = asideData({ ...colonna, moreUrl: workWithUsUrl(settings) });
  return {
    logged: dati.logged,
    fragments: {
      "[data-sso-header]": env.render("fragments/access_header.njk", { ...ui, access: dati }),
      "[data-sso-driver]": env.render("fragments/driver.njk", { ...ui, aside }),
    },
  };
}

// The right-hand column: the driver box and, for a driver only, the autonomous
// work block. It can be empty — somebody arriving without a link who is not a
// driver has nothing to see there — and in that case the page stays single-column.
function asideData({
  driverLink,
  params,
  showDriverBox,
  driversAvailable,
  ambassador,
  isDriver,
  moreUrl,
  autonomousWork,
  locked,
}) {
  const ownLink = driverLink.state === OWN_LINK;
  // One's own link is not shown: the box disappears and the autonomous work
  // block says so, which is there for a driver anyway.
  const boxShow = showDriverBox && !ownLink;
  const resolved = driversAvailable && isResolved(driverLink);

  return {
    driver_box: {
      show: boxShow,
      drivers_available: driversAvailable,
      resolved,
      link: driverLink,
      // The notice only makes sense if there is a box to tick and something valid
      // not to apply: a driver looking at a reference to another driver, and a
      // recognised one. On an expired discount there is nothing to ignore. With
      // the checkbox locked there is nothing left to ignore, and nothing must
      // travel with the form: the project's terms were settled at the first
      // submission and this round does not read them again.
      can_be_ignored: boxShow && isDriver && resolved && !locked,
      hidden: locked ? [] : hiddenFields(driverLink, params, driversAvailable),
    },
    // Who invited the user to use webtools (src/ambassador.js). It is there only
    // if the ambassador has been recognised; with autonomous work ticked the CSS
    // switches it off.
    ambassador_box: {
      show: Boolean(ambassador),
      driver: ambassador,
      // When the form comes back the box is read and nothing else: the uid does
      // not travel with the form again, because the project already has it.
      locked: Boolean(locked),
    },
    driver_work: {
      show: isDriver,
      own_link: ownLink,
      more_url: moreUrl,
      // How the checkbox stands. At the first submission it is free and empty;
      // when the form comes back it says what the project has already recorded and
      // is not touched again, because that choice has been made (src/server.js).
      checked: Boolean(autonomousWork?.checked),
      locked: Boolean(autonomousWork?.locked),
    },
  };
}

// The outcome pages of the submission and of the analysis, when something goes
// wrong. One sentence on what happened, one on what to do: the texts live in the
// catalogues, under `preanalyst.messages.<kind>.title` and `.text`.
//
// `ui`, in every page rendered here, is what `settings.i18n.pageContext(…)` gives:
// language, `t` and the language switcher, which the shared layout uses on every
// page.
export function renderMessage(ui, kind) {
  const message = {
    title: ui.t(`preanalyst.messages.${kind}.title`),
    text: ui.t(`preanalyst.messages.${kind}.text`),
  };
  return env.render("message.njk", { ...ui, title: message.title, noindex: true, home_link: "/", message });
}

// The summary next to the chat: what was decided when the request set off. Only
// what is there is shown — with no driver, no discount, no ambassador and no
// autonomous work the box is left with the turn counter alone, which is the reason
// it is there anyway.
//
// `driverLinkOfProject` returns only `none`, `driver_applied` or
// `discount_applied`: the states for link-reading failures do not come through
// here, because the link is not read again (src/server.js).
function summaryData({ driverLink, ambassador, autonomous }) {
  const driver = isResolved(driverLink) ? driverLink.driver : null;
  return {
    driver: driver ? { name: driver.screen_name } : null,
    // If the discount is there but the percentage could not be read again, we
    // stay silent instead of writing a discount with no number.
    discount: driverLink.state === DISCOUNT_APPLIED && driverLink.percentage != null
      ? { percentage: driverLink.percentage }
      : null,
    ambassador: ambassador ? { name: ambassador.screen_name } : null,
    autonomous,
    // The box is always there, but if it carries no terms it says so instead of
    // showing an empty list.
    empty: !driver && !ambassador && !autonomous,
  };
}

// The analysis page: the specification rounds.
//
// The conversation and the turns live on the project, read by `serveAnalysis`;
// **only the answer is fake**, chosen by the server from a fixed list.
//
// `answer_max_chars` is the same limit as the form's answers: a message is an
// answer like any other, and no new configuration field is needed.
export function renderAnalysis(ui, { access, settings, terms, project_id, chat }) {
  // The turns **used** are not counted separately: they are the rounds already
  // done, that is, half the messages. The total is what has been used plus what is
  // left, and not `max_turns`: with bought turns the starting cap is no longer the
  // total.
  const usati = Math.floor(chat.messages.length / 2);
  return env.render("analysis.njk", {
    ...ui,
    title: ui.t("preanalyst.analysis.title"),
    noindex: true,
    home_link: "/",
    access: accessData(access, settings),
    chat: {
      project_id,
      max_chars: settings.answerMaxChars,
      messages: chat.messages,
      turns_left: chat.turnsLeft,
      used: usati,
      total: usati + chat.turnsLeft,
      // At how many remaining turns we warn. In the configuration the number is
      // said from the other end — "from the twentieth of thirty" — but what holds
      // with bought turns too is how many are left, not how far along we are.
      warn_when_left: settings.analysis.maxTurns - settings.analysis.warnFromTurn,
      credit: chat.credit,
    },
    summary: summaryData(terms),
  });
}

export function renderLoginDone(ui, { ok }) {
  return env.render("login_done.njk", { ...ui, title: ui.t("preanalyst.login_done.title"), noindex: true, ok });
}

// The questions of `src/questions.js` with their texts in the page's language.
// `hint` and `placeholder` are there only if the catalogue has them.
//
// `answers` are the answers already given, when the form comes back to somebody
// who was sent back (src/server.js): every field carries what was there. At the
// first submission it is empty and the fields are born empty.
function localizedSections(ui, answers) {
  const optional = (key) => (ui.has(key) ? ui.t(key) : null);
  return SECTIONS.map((section) => {
    const base = `preanalyst.questions.sections.${section.id}`;
    return {
      ...section,
      legend: ui.t(`${base}.legend`),
      hint: optional(`${base}.hint`),
      fields: section.fields.map((field) => {
        const key = `preanalyst.questions.fields.${field.name}`;
        return {
          ...field,
          label: ui.t(`${key}.label`),
          hint: optional(`${key}.hint`),
          placeholder: optional(`${key}.placeholder`),
          options: field.options?.map(([code]) => [code, ui.t(`${key}.options.${code}`)]),
          ...answered(field, answers[field.name]),
        };
      }),
    };
  });
}

// What the user had answered to a question, in the shape the template needs:
// `value` for text fields, `selected` for choices — always a list of codes, even
// for a radio, so the template does one thing only.
function answered(field, value) {
  if (field.kind === "radio" || field.kind === "checkbox") {
    const codici = Array.isArray(value) ? value : value ? [value] : [];
    return { selected: codici };
  }
  return { value: typeof value === "string" ? value : "" };
}

// The upload messages (public/upload.js): the browser has no catalogues, it gets
// them from the page already in the right language. An error code with no text
// falls back to `failed`.
const UPLOAD_ERRORS = [
  "NOT_LOGGED",
  "FILE_TOO_LARGE",
  "EMPTY_FILE",
  "MISSING_FILE_NAME",
  "NOT_UTF8",
  "INVALID_FRONT_MATTER",
  "MISSING_PROJECT_ID",
  "INVALID_PROJECT_ID",
  "PROJECT_NOT_FOUND",
  "SSO_UNAVAILABLE",
  "ANAGRAPHICS_UNAVAILABLE",
  "WORKSPACES_UNAVAILABLE",
];

function uploadMessages(ui) {
  const status = ["finish_login", "in_progress", "done", "failed"];
  return {
    ...Object.fromEntries(status.map((name) => [name, ui.t(`preanalyst.upload.status.${name}`)])),
    errors: Object.fromEntries(UPLOAD_ERRORS.map((code) => [code, ui.t(`preanalyst.upload.errors.${code}`)])),
  };
}

function accessData(access, settings) {
  const next = afterLogin(settings);
  return {
    logged: access.logged,
    sso_available: access.ssoAvailable,
    name: access.logged
      ? (access.session.data?.screen_name ?? access.session.username)
      : null,
    login_url: loginUrl(settings, next),
    register_url: registerUrl(settings, next),
  };
}

export function renderPage(ui, {
  driverLink,
  params,
  showDriverBox,
  driversAvailable,
  ambassador,
  isDriver,
  access,
  settings,
  submissionId,
  rejection,
  answers = {},
  resumed = null,
  autonomousWork = null,
}) {
  return env.render("page.njk", {
    ...ui,
    submission_id: submissionId,
    title: ui.t("preanalyst.page.title"),
    description: ui.t("preanalyst.page.description"),
    home_link: "/",
    sections: localizedSections(ui, answers),
    // The second round: the request came back because it said too little. The page
    // says so at the top of the form and carries the project along, so the rewrite
    // does not give birth to another one.
    resumed: resumed ? { project_id: resumed.projectId } : null,
    access: accessData(access, settings),
    aside: asideData({
      driverLink,
      params,
      showDriverBox,
      driversAvailable,
      ambassador,
      isDriver,
      moreUrl: workWithUsUrl(settings),
      autonomousWork,
      locked: Boolean(autonomousWork?.locked),
    }),
    upload: {
      max_mb: Math.round(settings.uploadMaxBytes / (1024 * 1024)),
      accept: settings.uploadAccept,
      messages: uploadMessages(ui),
    },
    // The refusal modal is there only for somebody just sent here by `/submit`.
    // `rejection` arrives already checked: the project exists, belongs to the
    // viewer, really was refused, and carries the case to show (src/server.js).
    rejection: rejection
      ? {
          pdf_url: `/projects/${encodeURIComponent(rejection.project_id)}/rejection.pdf`,
          home_url: settings.frontGateUrl,
          case: rejection.case,
        }
      : null,
  });
}
