// The data that goes to the pages.
//
// There is no HTML here: it lives in `templates/`, in .njk files rendered by nunjucks.
// This file decides only **which data** each page gets.
//
// Why a template engine and not strings inside the JavaScript: with autoescaping on,
// every value that ends up in the HTML is cleaned by itself. Writing the HTML by hand
// makes escaping a matter of the writer's memory, and here almost everything comes from
// outside — a project's description was written by a model, a driver's name by a person.
//
// The shared layout (`templates/commons/base.njk`) is a **generated copy**: edit the
// original in `webtools/commons/templates/` and run `webtools/configurator/deploy.sh`
// again.

import { fileURLToPath } from "node:url";

import nunjucks from "nunjucks";

import { ambassadorLink, driverLink, percentages } from "./links.js";
import { approvedByDriver, rowOf, stateOf } from "./projects.js";
import { DECIDABLE_STATE, REJECT } from "./validation.js";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

const env = nunjucks.configure(TEMPLATES_DIR, {
  // The setting that matters: everything written with {{ }} goes through escaping. To
  // print real HTML you have to say so with `| safe`.
  autoescape: true,
  // The templates live on disk next to the code and change only with a deploy: they are
  // read once and stay in memory.
  noCache: false,
  // No trimBlocks: together with the templates' `{%-` it would squeeze the page into a
  // few very long lines, and the rendered HTML is read by humans too.
  trimBlocks: false,
});

/* ------------------------------------------------------------------ the tabs */

export const OWNED = "/";
export const DRIVER_TAB = "/driver";
export const BROKEN = "/broken";

// Which tabs this person is offered, and which one they are on. What the navigation
// shows and what a route allows are the same list, read once by the server and passed
// here: a tab in the navigation that answered 404 would be worse than no tab.
function navigation(ui, tabs, current) {
  const label = { [OWNED]: "owned", [DRIVER_TAB]: "driver", [BROKEN]: "broken" };
  return tabs.map((href) => ({
    href,
    label: ui.t(`projects_hub.nav.${label[href]}`),
    current: href === current,
  }));
}

/* ------------------------------------------------------------------ the rows */

// Which of the two maps of states a reader is given. The two readers are asked two
// different questions — «what is happening to my project» and «what is there for me to
// do» — so `DRIVER_VALIDATION` is "being reviewed" for one and "waiting for you" for the
// other. For the client `FAILED` and `FAILED_NO_DRIVERS` say the same thing, because the
// difference between them is ours.
const STATE_MAP = { owner: "client", driver: "driver", prj_admin: "driver" };

// What a row looks like at a glance, before anybody reads it. Four tones, and they answer
// the only question somebody scanning a list of projects has: is this one waiting for me.
//
// **The tone is per reader**, like the sentence: `DRIVER_VALIDATION` is `waiting` for the
// driver, whose work it is, and `moving` for the client, who has nothing to do about it.
// A state this map does not know is `moving`, which is the honest default — a row is shown
// as something going on rather than as something wrong, and a state added to the pipeline
// tomorrow does not turn a client's page red by accident.
const TONES = {
  client: {
    UNDERSPECIFIED: "waiting",
    CLIENT_VALIDATION: "waiting",
    DEMO: "waiting",
    PAID: "done",
    PREANALYSIS: "stopped",
    REJECTED: "stopped",
    FAILED: "stopped",
    FAILED_NO_DRIVERS: "stopped",
  },
  driver: {
    DRIVER_VALIDATION: "waiting",
    PAID: "done",
    REJECTED: "stopped",
    FAILED: "stopped",
    FAILED_NO_DRIVERS: "stopped",
  },
};

// Which documents a reader is offered. The client is offered the points and only the
// points: the analysis is written for whoever has to judge the work, and handing it to
// them is not what this page is for.
const DOCUMENTS = { owner: ["proposal"], driver: ["proposal", "analysis"], prj_admin: ["proposal", "analysis"] };

// What the link is called. **The client's word is not the driver's**: the client reads the
// functionalities of the tool that is being built for them, and the driver opens the same
// file to review somebody else's project — «the functionalities of your system» would be
// a sentence about a system that is not theirs. The two readers have their own labels for
// the same reason they have their own maps of states.
const DOCUMENT_LABEL = {
  owner: { proposal: "read_features" },
  driver: { proposal: "points", analysis: "analysis" },
  prj_admin: { proposal: "points", analysis: "analysis" },
};

// **When** a reader is offered them, which is not the same question as which ones.
//
// The client is offered the list once the driver has approved the analysis, and not while
// it is under review: what they would open before that is a draft nobody stands behind.
// The driver is offered it exactly while it is under review, because reviewing it is the
// work. So the same file, on the same project, is offered to one and not to the other —
// and that is the whole reason this is a rule of the page and not of the download route,
// which answers the different question of who may have it at all.
function offersDocuments(project, reader) {
  if (!rowOf(project).has_documents) return false;
  return reader === "owner" ? approvedByDriver(project) : true;
}

// Whether this row carries the two buttons of the driver's gate.
//
// **The page decides what to offer, the route decides what is allowed**, and the two
// are not the same question — the same division `offersDocuments` and `DOCUMENT_KINDS`
// already keep. Here it is enough that the reader is a driver reading their own list,
// which anagraphics has already narrowed to the projects that driver supervises, and
// that the project is where this gate decides. Whether this particular person may
// decide about this particular project is asked again by the route, of the project
// itself, before anything is written.
//
// The client is never offered them, and neither is the level that sees other people's
// projects: the analysis was handed to one person, and the step will carry their name.
function offersDecision(project, reader) {
  return reader === "driver" && stateOf(project) === DECIDABLE_STATE;
}

// One row of a list, ready for the template.
//
// A project still in pre-analysis has no description and no documents. The row then
// shows the state and **nothing** where the other two would be — no dash, no "not yet
// available": absent is absent.
export function rowView(ui, project, reader) {
  const row = rowOf(project);
  return {
    ...row,
    name: row.name ?? ui.t("projects_hub.project.unnamed"),
    // The state in this reader's words, and how it looks before it is read.
    state_text: ui.t(`projects_hub.state.${STATE_MAP[reader]}.${row.state}`),
    tone: TONES[STATE_MAP[reader]][row.state] ?? "moving",
    // Why it stopped, when the last step says. A reason this subsystem has no sentence
    // for is shown as the word itself: a reason added to the pipeline tomorrow appears
    // as a fact before it appears as a sentence, which is better than disappearing.
    stopped_text: reasonText(ui, row.stopped_on),
    documents: offersDocuments(project, reader)
      ? DOCUMENTS[reader].map((kind) => ({
          url: `/projects/${encodeURIComponent(row.project_id)}/documents/${kind}`,
          label: ui.t(`projects_hub.project.${DOCUMENT_LABEL[reader][kind]}`),
        }))
      : [],
    // The gate's two buttons, or nothing. They post to the confirmation screen, which
    // is the page that decides nothing and asks.
    decide: offersDecision(project, reader)
      ? { url: `/projects/${encodeURIComponent(row.project_id)}/validation` }
      : null,
  };
}

function reasonText(ui, reason) {
  if (reason === null) return null;
  const key = `projects_hub.failure.${reason}`;
  return ui.has(key) ? ui.t(key) : reason;
}

function listView(ui, projects, reader) {
  return projects.map((project) => rowView(ui, project, reader));
}

/* ----------------------------------------------------------------- the pages */

// `ui` is what `settings.i18n.pageContext(…)` gives: the language, `t`, `has` and the
// language switcher, which the shared layout uses on every page.
// The client's page: three lists, in the order the client cares about them — what is
// moving, what has come back to them, and what has stopped. `empty` is the one sentence
// for somebody with no projects at all, which is a different thing from three empty lists.
export function renderOwned(ui, { tabs, active, returned, stopped }) {
  const title = ui.t("projects_hub.owned.title");
  return env.render("owned.njk", {
    ...ui,
    title,
    noindex: true,
    home_link: OWNED,
    nav: navigation(ui, tabs, OWNED),
    heading: title,
    active: listView(ui, active, "owner"),
    returned: listView(ui, returned, "owner"),
    stopped: listView(ui, stopped, "owner"),
    nothing_at_all: active.length + returned.length + stopped.length === 0,
  });
}

export function renderDriverTab(ui, settings, { tabs, driver, link, decided, waiting, failed }) {
  const title = ui.t("projects_hub.driver.title");
  return env.render("driver.njk", {
    ...ui,
    title,
    noindex: true,
    home_link: OWNED,
    nav: navigation(ui, tabs, DRIVER_TAB),
    heading: title,
    links: linksView(ui, settings, driver, link),
    // What was just decided, when this page is the answer to the gate's confirmation.
    // The project it was about has left both lists — an approved one is the client's to
    // answer now, a refused one is closed — so without this sentence the driver would
    // press confirm and watch a row disappear with nothing said about it.
    decided: decided ? ui.t(`projects_hub.driver.validation.decided.${decided}`) : null,
    waiting: listView(ui, waiting, "driver"),
    failed: listView(ui, failed, "driver"),
  });
}

// The confirmation screen of the driver's gate: one decision, said plainly, with the
// button that takes it.
//
// `wrong` is what is the matter with the motivation — `missing` or `too_long`, the two
// different things that can be — and `typed` is what the driver had written, put back in
// the box. A page that threw the sentence away would make them type it again to be told
// the same thing.
export function renderValidation(ui, { tabs, project, decision, typed, wrong, reasonMaxChars }) {
  const row = rowView(ui, project, "driver");
  const title = ui.t(`projects_hub.driver.validation.${decision}.title`);
  return env.render("validation.njk", {
    ...ui,
    title,
    noindex: true,
    home_link: OWNED,
    nav: navigation(ui, tabs, DRIVER_TAB),
    heading: title,
    project: row,
    decision,
    // What this decision does to the project, in one sentence. It is the whole reason
    // this page exists, so it is not a hint under a button: it is the text of the page.
    lead: ui.t(`projects_hub.driver.validation.${decision}.lead`),
    // Only a refusal asks for anything. An approval is the sentence and the button.
    reason:
      decision === REJECT
        ? {
            typed,
            max_chars: reasonMaxChars,
            hint: ui.t("projects_hub.driver.validation.reason_hint", { max: reasonMaxChars }),
            wrong: wrong ? ui.t(`projects_hub.driver.validation.reason_${wrong}`, { max: reasonMaxChars }) : null,
          }
        : null,
    confirm_url: `/projects/${encodeURIComponent(row.project_id)}/validation/confirm`,
  });
}

export function renderBroken(ui, { tabs, orphan, orphanFailed }) {
  const title = ui.t("projects_hub.broken.title");
  return env.render("broken.njk", {
    ...ui,
    title,
    noindex: true,
    home_link: OWNED,
    nav: navigation(ui, tabs, BROKEN),
    heading: title,
    orphan: listView(ui, orphan, "prj_admin"),
    orphan_failed: listView(ui, orphanFailed, "prj_admin"),
  });
}

// The two link boxes. The ambassador's link is a string this server already has
// everything for, so it is shown straight away; the driver's link is behind a button
// because with a percentage it may have to create a code, and because the address is
// something that pays somebody — it does not belong in the browser's history.
//
// `link` is what was just made, when this page is the answer to that button: the kind,
// the address, and the percentage if it carried one. Without it the boxes are shown with
// nothing made yet.
function linksView(ui, settings, driver, link) {
  return {
    ambassador: ambassadorLink(settings, driver.driver_uid),
    // Shown only from the level that may supervise: a link that hands somebody a project
    // to supervise is of no use to a driver who may not.
    driver: driver.may_supervise ? driverLink(settings, driver.driver_uid) : null,
    percentages: percentages(settings),
    made: link ?? null,
  };
}

export function renderMessage(ui, kind) {
  const message = {
    title: ui.t(`projects_hub.messages.${kind}.title`),
    text: ui.t(`projects_hub.messages.${kind}.text`),
  };
  return env.render("message.njk", {
    ...ui,
    title: message.title,
    noindex: true,
    home_link: OWNED,
    message,
  });
}
