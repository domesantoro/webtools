// The HTTP server of webtools_projects_hub.
//
//   GET  /                     the projects this person owns
//   GET  /driver               a driver's links, and the projects they supervise
//   GET  /broken               the projects nobody supervises (level 2 and up)
//   POST /links                makes one of a driver's links and shows it
//   GET  /projects/{id}/documents/{kind}   the analysis or the points, as a file
//   POST /projects/{id}/validation         what approving or refusing would do
//   POST /projects/{id}/validation/confirm the driver's decision, written
//   GET  /login-done, /logout  the login round trip
//   POST /locale               changes the language (shared cookie) and returns to the page
//   everything else            the static files of public/
//
// **One thing here moves a project, and it is the driver's gate.** Everything else lists
// or hands over a document. The gate is here because this is the driver's interface: the
// projects waiting on them are already on this page, the analysis they judge is already
// served from it, and the session already says who they are. A subsystem of its own would
// have had to be given all three again.
//
// A tab asked for by somebody it is not for answers **404, not 403** — the same rule the
// preanalyst already applies to somebody else's project: a thing you may not see does
// not exist, and a 403 tells you it does.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { addPipelineStep, findProject, findUser, listProjects } from "./anagraphics.js";
import { analysisRefused } from "./comm_center.js";
import {
  claimTicket,
  clearSessionCookie,
  currentSession,
  loginUrl,
  logoutUrl,
  saveSessionLocale,
  sessionCookie,
  ticketFrom,
} from "./commons/sso_client.js";
import {
  AMBASSADOR,
  ambassadorLink,
  codeFor,
  discountLink,
  driverLink,
  maySupervise,
  readPercentage,
} from "./links.js";
import {
  BROKEN,
  DRIVER_TAB,
  OWNED,
  renderBroken,
  renderDriverTab,
  renderMessage,
  renderOwned,
  renderValidation,
} from "./page.js";
import {
  DRIVER_REVIEW_STATES,
  FAILED_STATES,
  MIN_BROKEN_PROJECTS_LEVEL,
  STATES_OWED_A_DRIVER,
  forDriver,
  forOwner,
  orphans,
} from "./projects.js";
import { GATE, decisionOf, mayDecide, reasonFrom, stepData } from "./validation.js";
import { latestDocument } from "./workspaces.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

// The kinds of document this subsystem hands over, and who may have each one.
//
// The client is offered the points and **only** the points: the analysis is written for
// whoever has to judge whether the work is worth taking on, which is not what their tab
// is for. Everything else is a 404.
const DOCUMENT_KINDS = {
  proposal: ["owner", "driver", "prj_admin"],
  analysis: ["driver", "prj_admin"],
};

function send(response, status, contentType, body) {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  response.end(body);
}

function redirect(response, location, headers = {}) {
  response.writeHead(303, { location, "cache-control": "no-store", ...headers });
  response.end();
}

// A page saying one thing. `code` is kept on the response so the one measurement per
// request can say **which** refusal it was, without any branch of the routing counting
// itself. A page that is simply not there for this person carries none: the status says
// all there is to say, and there is no fault to act on.
function message(response, ui, status, kind, code = null) {
  if (code) response.webtoolsErrorCode = code;
  send(response, status, "text/html; charset=utf-8", renderMessage(ui, kind));
}

const notThere = (response, ui) => message(response, ui, 404, "not_found");

// How long is left before the session expires. The cookie must not outlive the session
// it stands for, so the duration is not decided here: it is read.
function secondsUntil(moment) {
  const expiry = Date.parse(moment ?? "");
  if (Number.isNaN(expiry)) return 0;
  return Math.max(0, Math.floor((expiry - Date.now()) / 1000));
}

/* ------------------------------------------------------ who is looking at this */

// The driver, as this session carries it. The sso puts the photograph of the user in the
// session at login time: `null` for whoever is not a driver, and otherwise
// `{driver_uid, level}` exactly as the user document holds it.
//
// **The photograph ages.** A driver enabled, promoted or switched off while they are
// logged in goes on seeing the tabs of the level they came in with, until the next login.
// It is the sso's documented trade-off, and it is worth writing down here because this is
// the first subsystem in which a level decides what a page shows.
function driverOf(session) {
  const driver = session?.data?.driver;
  if (!driver?.driver_uid) return null;
  return {
    driver_uid: driver.driver_uid,
    level: driver.level,
    may_supervise: maySupervise(driver),
    // The one thing this level is allowed that no level below it is.
    sees_broken: Number.isInteger(driver.level) && driver.level >= MIN_BROKEN_PROJECTS_LEVEL,
  };
}

// The tabs this person is offered. One list, read here and given both to the navigation
// and to the routes: a tab in the header that answered 404 would be worse than no tab.
function tabsFor(driver) {
  const tabs = [OWNED];
  if (driver) tabs.push(DRIVER_TAB);
  if (driver?.sees_broken) tabs.push(BROKEN);
  return tabs;
}

// Who is asking, for a page. Three outcomes, and the third is the one that matters:
//
//   { access: "page", session, driver, tabs }   logged in
//   { access: "login" }                         not logged in: send them to the sso
//   { access: "unknown" }                       the sso did not answer: **we do not know**
//
// `{ok: false}` is **not** a redirect. Treating "we do not know" as a logout would throw
// everybody at a login that is not reachable, which is the loop `currentSession` is
// commented against.
async function whoIsAsking(settings, request) {
  const state = await currentSession(settings, request);
  if (!state.ok) return { access: "unknown" };
  if (!state.logged) return { access: "login" };
  const driver = driverOf(state.session);
  return { access: "page", session: state.session, driver, tabs: tabsFor(driver) };
}

// Everything a page route does before it has anything to render. It answers for the two
// outcomes that are not a page and hands back `null`; otherwise it hands back who is
// asking.
async function visitor(settings, request, response, ui) {
  const asking = await whoIsAsking(settings, request);
  if (asking.access === "unknown") {
    message(response, ui, 503, "unavailable", "SSO_UNAVAILABLE");
    return null;
  }
  if (asking.access === "login") {
    // The sso's own login page, which is the only one in the system. If the browser
    // already carries the sso's cookie it asks nothing: whoever logged in at the
    // pre-analysis an hour ago arrives here without seeing a form.
    redirect(response, loginUrl(settings, `${settings.publicUrl}/login-done`));
    return null;
  }
  return asking;
}

/* ---------------------------------------------------------- the login round trip */

// `/login-done`: where the sso sends the browser back. The ticket is exchanged server to
// server, our own cookie is set, and the browser is sent to the first tab.
//
// No popup, and no fragments to put back in place. The preanalyst has both because a
// half-filled form must not be lost and because it replaces what its templates had
// already rendered; neither holds here — there is nothing on these pages to lose, and
// "updating in place" would mean replacing the whole page, which is a reload written by
// hand.
async function finishLogin(settings, response, ui, ticket) {
  if (!ticket) {
    // Somebody got here by hand, without going through the login.
    return notThere(response, ui);
  }
  const claimed = await claimTicket(settings, ticket);
  if (!claimed.ok || !claimed.logged) {
    console.warn("[projects-hub] invalid ticket on the way back from the login");
    return notThere(response, ui);
  }
  const duration = secondsUntil(claimed.session.expires_at);
  if (duration === 0) {
    console.warn("[projects-hub] session already expired on the way back from the login");
    return notThere(response, ui);
  }
  console.log(`[projects-hub] logged in: ${claimed.session.username}`);
  return redirect(response, OWNED, { "set-cookie": sessionCookie(settings, claimed.session.token, duration) });
}

function leave(settings, response) {
  return redirect(response, logoutUrl(settings, `${settings.publicUrl}/`), {
    "set-cookie": clearSessionCookie(settings),
  });
}

/* --------------------------------------------------------------------- the tabs */

// One measurement per list shown, carrying how long it was. `http.request` already says
// which tab was opened and how long it took; what it cannot say is how much was on it,
// and that is the number somebody will ask for.
function countList(settings, list, projects) {
  settings.metrics.measure("projects.listed", {
    dims: { list },
    amounts: { projects: projects.length },
  });
}

// `GET /` — the projects this person owns.
async function serveOwned(request, settings, response, ui) {
  const asking = await visitor(settings, request, response, ui);
  if (!asking) return;

  // No `states` here: this tab shows everything the person owns, and the three lists are
  // a partition of it — narrowing the query would be the page deciding that a state it has
  // no list for is a project they do not have.
  const found = await listProjects(settings, { ownerUid: asking.session.uid });
  if (!found.ok) return message(response, ui, 503, "unavailable", "ANAGRAPHICS_UNAVAILABLE");

  const { active, returned, stopped } = forOwner(found.data);
  countList(settings, "owned_active", active);
  countList(settings, "owned_returned", returned);
  countList(settings, "owned_stopped", stopped);
  send(
    response,
    200,
    "text/html; charset=utf-8",
    renderOwned(ui, { tabs: asking.tabs, active, returned, stopped })
  );
}

// `GET /driver` — a driver's links, and the projects that are theirs to act on.
async function serveDriverTab(request, settings, response, ui) {
  const asking = await visitor(settings, request, response, ui);
  if (!asking) return;
  if (!asking.driver) return notThere(response, ui);
  return driverTabPage(settings, response, ui, asking);
}

// The tab itself, out of who is already known to be asking. `POST /links` and the gate's
// confirmation both render it again — with the link just made, or with what was just
// decided — and they go through here rather than through the route above: asking the sso
// a second time who somebody is, inside one request, would be a second answer to a
// question already answered.
async function driverTabPage(settings, response, ui, asking, { link = null, decided = null } = {}) {
  const found = await listProjects(settings, {
    driverUid: asking.driver.driver_uid,
    // The two lists this tab holds, asked for together: one call, and nothing read that
    // nothing shows.
    states: [...DRIVER_REVIEW_STATES, ...FAILED_STATES],
  });
  if (!found.ok) return message(response, ui, 503, "unavailable", "ANAGRAPHICS_UNAVAILABLE");

  const { waiting, failed } = forDriver(found.data);
  countList(settings, "driver_review", waiting);
  countList(settings, "driver_failed", failed);
  send(
    response,
    200,
    "text/html; charset=utf-8",
    renderDriverTab(ui, settings, {
      tabs: asking.tabs,
      driver: asking.driver,
      link,
      decided,
      waiting,
      failed,
    })
  );
}

// `GET /broken` — the projects a driver is owed and that have none.
async function serveBroken(request, settings, response, ui) {
  const asking = await visitor(settings, request, response, ui);
  if (!asking) return;
  if (!asking.driver?.sees_broken) {
    if (asking.driver) {
      console.log(`[projects-hub] /broken asked for by a driver at level ${asking.driver.level}`);
    }
    return notThere(response, ui);
  }

  const found = await listProjects(settings, { withoutDriver: true, states: STATES_OWED_A_DRIVER });
  if (!found.ok) return message(response, ui, 503, "unavailable", "ANAGRAPHICS_UNAVAILABLE");

  const { orphan, orphanFailed } = orphans(found.data);
  countList(settings, "orphan", orphan);
  countList(settings, "orphan_failed", orphanFailed);
  send(
    response,
    200,
    "text/html; charset=utf-8",
    renderBroken(ui, { tabs: asking.tabs, orphan, orphanFailed })
  );
}

/* -------------------------------------------------------------------- the links */

// `POST /links` — one of a driver's links, made and shown.
//
// A `POST` and not an address with the percentage in it: the address ends up in the
// browser's history and in whatever log sits in front of us, and this address is a thing
// that pays somebody. The same reason the sso's session token travels as a ticket and not
// as a parameter.
async function makeLink(request, settings, response, ui) {
  const asking = await visitor(settings, request, response, ui);
  if (!asking) return;
  if (!asking.driver) return notThere(response, ui);

  const form = await readForm(request, settings);
  // Two fields, neither of them long: a body over the limit is not somebody using the
  // page.
  if (!form.ok) return bodyTooLarge(response);

  const kind = form.data.get("kind");
  if (kind === AMBASSADOR) {
    console.log(`[projects-hub] ambassador link for ${asking.driver.driver_uid}`);
    settings.metrics.measure("driver_link.issued", { dims: { kind: AMBASSADOR } });
    return driverTabPage(settings, response, ui, asking, {
      link: { kind: AMBASSADOR, url: ambassadorLink(settings, asking.driver.driver_uid) },
    });
  }
  if (kind !== "driver") return notThere(response, ui);
  // A driver's link hands somebody a project to supervise: a driver who may not
  // supervise is not offered it, and asking for it anyway is a 404 like any other tab
  // that is not theirs.
  if (!asking.driver.may_supervise) return notThere(response, ui);

  const percentage = readPercentage(settings, form.data.get("percentage"));
  if (percentage === null) {
    // No discount, or a percentage outside the range we are willing to give away. The
    // plain link either way: a number nobody may choose is not a smaller discount.
    console.log(`[projects-hub] driver link for ${asking.driver.driver_uid}`);
    settings.metrics.measure("driver_link.issued", { dims: { kind: "driver" } });
    return driverTabPage(settings, response, ui, asking, {
      link: { kind: "driver", url: driverLink(settings, asking.driver.driver_uid) },
    });
  }

  const code = await codeFor(settings, asking.driver.driver_uid, percentage);
  if (!code.ok) return message(response, ui, 503, "link_unavailable", "ANAGRAPHICS_UNAVAILABLE");

  console.log(
    code.created
      ? `[projects-hub] discount code ${code.code} created at ${percentage}%`
      : `[projects-hub] discount code ${code.code} reused at ${percentage}%`
  );
  settings.metrics.measure("driver_link.issued", {
    dims: {
      kind: code.created ? "discount_created" : "discount_reused",
      percentage: String(percentage),
    },
  });
  return driverTabPage(settings, response, ui, asking, {
    link: { kind: "driver", url: discountLink(settings, code.code), percentage },
  });
}

/* ------------------------------------------------------------ the driver's gate */

// The one place in this subsystem where a project moves.
//
// Two routes and not one, because there are two moments and only the second decides
// anything:
//
//   POST /projects/{id}/validation          says what is about to happen, and asks
//   POST /projects/{id}/validation/confirm  writes the step
//
// **The confirmation is a page from this server and not a dialog in the browser.** Both
// decisions are final — an approval hands the analysis to the client, a refusal closes
// the request, and there is no route anywhere that undoes either — so what stands between
// the button and the decision must not be something a browser can be without. There is no
// JavaScript in this subsystem at all, and the refusal needs a box to type the motivation
// into, which is a page either way.
//
// Both are `POST`. A confirmation screen reachable with a `GET` would be an address that
// sits in the history and in whatever log is in front of us, saying which project somebody
// was about to refuse; it is the same reason `POST /links` is not an address.

// The project this driver may decide about, or why not. Three outcomes, and the third is
// the one that matters: anagraphics not answering is not a project that is not there.
//
// **Everything a driver may not decide about answers the same way**: a project that does
// not exist, one that is somebody else's, one that has already been through this gate or
// has not got here yet. One answer, because telling them apart would tell somebody which
// project ids exist and what state they are in — the rule the download route already
// applies.
async function decidableProject(settings, asking, projectId) {
  const found = await findProject(settings, projectId);
  if (!found.ok) {
    return found.reason === "not_found" ? { ok: false, gone: true } : { ok: false, gone: false };
  }
  if (!mayDecide(found.data, asking.driver?.driver_uid)) return { ok: false, gone: true };
  return { ok: true, project: found.data };
}

// A form body too big for what these forms hold. It gets the code and no page, like the
// language switcher's own refusal: a body over the limit is not somebody using the page —
// the box has the limit on it, and the server has it again here.
function bodyTooLarge(response) {
  response.webtoolsErrorCode = "BODY_TOO_LARGE";
  return send(response, 413, "text/plain; charset=utf-8", "BODY_TOO_LARGE");
}

// Everything the two routes do the same way, up to the point where they differ: who is
// asking, what they pressed, and which project it was about. It hands back `null` when it
// has already answered.
async function decisionAsked(request, projectId, settings, response, ui) {
  const asking = await visitor(settings, request, response, ui);
  if (!asking) return null;
  if (!asking.driver) {
    notThere(response, ui);
    return null;
  }

  const form = await readForm(request, settings);
  if (!form.ok) {
    bodyTooLarge(response);
    return null;
  }

  // A word that is not one of the two decisions is not a third one: it is somebody
  // posting by hand.
  const decision = decisionOf(form.data.get("decision"));
  if (!decision) {
    notThere(response, ui);
    return null;
  }

  const found = await decidableProject(settings, asking, projectId);
  if (!found.ok) {
    if (found.gone) notThere(response, ui);
    else message(response, ui, 503, "unavailable", "ANAGRAPHICS_UNAVAILABLE");
    return null;
  }
  return { asking, decision, name: form.data.get("decision"), project: found.project, form: form.data };
}

// `POST /projects/{id}/validation` — what this decision would do, and the button that
// does it. For a refusal, the box the motivation goes in.
async function askToConfirm(request, projectId, settings, response, ui) {
  const asked = await decisionAsked(request, projectId, settings, response, ui);
  if (!asked) return;
  return confirmation(settings, response, ui, asked, { typed: "", wrong: null });
}

// `POST /projects/{id}/validation/confirm` — the decision, written on the project.
async function receiveDecision(request, projectId, settings, response, ui) {
  const asked = await decisionAsked(request, projectId, settings, response, ui);
  if (!asked) return;
  const { asking, decision, name } = asked;

  // The motivation is the driver's obligation, so it is checked before anything is
  // written and a refusal without one writes nothing at all. What comes back is the same
  // screen with what is wrong said on it and the text still in the box: a page that threw
  // the sentence away would make the driver type it again to be told the same thing.
  let reason = null;
  if (decision.needsReason) {
    const typed = asked.form.get("reason") ?? "";
    const read = reasonFrom(typed, settings.rejectionReasonMaxChars);
    if (!read.ok) {
      return confirmation(settings, response, ui, asked, { typed, wrong: read.wrong });
    }
    reason = read.reason;
  }

  const stored = await addPipelineStep(settings, projectId, {
    step: GATE,
    result: decision.result,
    state: decision.state,
    data: stepData({ driverUid: asking.driver.driver_uid, reason }),
  });
  if (!stored.ok) {
    // Nothing was written: the project is exactly as it was, and the driver can decide
    // again. Saying so is the whole of what can be done about it here — writing the
    // decision anywhere else would be a second place it lives.
    console.error(`[projects-hub] ${GATE} of ${projectId} not recorded: ${stored.reason}`);
    return message(response, ui, 503, "decision_unavailable", "ANAGRAPHICS_UNAVAILABLE");
  }

  // The decision is measured by `addPipelineStep`, once, as `gate.decided` — and so is
  // how long the analysis waited, because the analyst opens this gate's step when it
  // hands the project over and this is what closes it. Nothing is counted here.
  console.log(
    `[projects-hub] ${GATE} of ${projectId}: ${decision.result} by ${asking.session.username}`
  );

  // A refusal closes the request, and the client is not here to see it happen: the
  // driver is. So it is said to them, with the sentence the driver was obliged to
  // write — the driver is told nothing, because this is their own decision.
  //
  // An approval says nothing to anybody yet. It moves the project to the client's own
  // gate, and that gate does not exist: a message asking somebody to do something they
  // have nowhere to do would be worse than none.
  if (reason !== null) await tellTheClientItIsRefused(settings, asked.project, projectId, reason);


  return driverTabPage(settings, response, ui, asking, { decided: name });
}

// The client, told that their request was closed and why.
//
// **It cannot fail the decision.** The step is written, the project is in `REJECTED`
// and the driver has been answered: every way this can go wrong — a project with no
// owner on it, an account no longer there, anagraphics or the comm-center not
// answering — leaves all of that exactly as it is, and says in the log that nobody was
// told. Rolling a driver's decision back because a message did not leave would be the
// worse of the two.
async function tellTheClientItIsRefused(settings, project, projectId, reason) {
  const ownerUid = project?.owner_uid;
  if (!ownerUid) {
    console.error(`[projects-hub] ${projectId} refused and no owner on it: nobody to tell`);
    return;
  }
  const found = await findUser(settings, ownerUid);
  if (!found.ok) {
    console.error(`[projects-hub] ${projectId} refused and the client could not be read: ${found.reason}`);
    return;
  }
  const told = await analysisRefused(settings, projectId, found.data, reason);
  if (!told.ok) {
    console.error(`[projects-hub] ${projectId} refused and the client not told: ${told.reason}`);
  }
}

// The confirmation screen, for either decision. `project` is read for its name: a page
// asking somebody to close a request has to say which one.
function confirmation(settings, response, ui, asked, { typed, wrong }) {
  send(
    response,
    200,
    "text/html; charset=utf-8",
    renderValidation(ui, {
      tabs: asked.asking.tabs,
      project: asked.project,
      decision: asked.name,
      typed,
      wrong,
      reasonMaxChars: settings.rejectionReasonMaxChars,
    })
  );
}

/* ---------------------------------------------------------------- the documents */

// `GET /projects/{id}/documents/{kind}` — the analysis or the points, as a file.
//
// The documents live in workspaces, behind its own pool of IPs, and nothing that faces a
// person reads them. This subsystem serves them because it is the only thing that knows
// **who is asking**: workspaces stores and does not decide.
//
// Everything that is not allowed is a 404 — a kind that does not exist, a project that
// does not exist, a project that is not this person's, a document that was never written.
// One answer, because telling them apart would tell somebody which project ids exist.
async function serveDocument(request, projectId, kind, settings, response, ui) {
  const asking = await visitor(settings, request, response, ui);
  if (!asking) return;

  const allowed = DOCUMENT_KINDS[kind];
  if (!allowed) return notThere(response, ui);

  const capacity = await capacityOver(settings, asking, projectId);
  if (capacity === null) return message(response, ui, 503, "unavailable", "ANAGRAPHICS_UNAVAILABLE");
  if (!allowed.includes(capacity)) return notThere(response, ui);

  const document = await latestDocument(settings, projectId, kind);
  if (!document.ok) {
    if (document.reason === "not_found") return notThere(response, ui);
    return message(response, ui, 503, "document_unavailable", "WORKSPACES_UNAVAILABLE");
  }

  const body = Buffer.from(document.data, "utf8");
  console.log(
    `[projects-hub] ${kind} of ${projectId} to ${asking.session.username} as ${capacity}`
  );
  // Only a download that succeeded is counted. Workspaces not answering is already a
  // `dependency.call`, and a refusal is already an `http.error` with its own code.
  settings.metrics.measure("document.served", {
    dims: { kind, as: capacity },
    bytes: body.length,
    project_id: projectId,
  });
  response.writeHead(200, {
    "content-type": "text/markdown; charset=utf-8",
    "content-length": body.length,
    // The browser saves it instead of showing it, and the name carries the project it
    // belongs to: these files end up in a downloads folder among others.
    "content-disposition": `attachment; filename="webtools-${kind}-${projectId}.md"`,
    "cache-control": "no-store",
  });
  response.end(body);
}

// In what capacity this person may have this project's documents: `false` for none,
// `null` when anagraphics could not say, and the word itself otherwise.
//
// Three capacities, and they are the three readers the whole subsystem is built around:
// the project's owner, the project's driver, and somebody from the level that sees other
// people's projects.
//
// **The order is the order they are checked in, and it is not an accident.** A driver
// reading a project of their own is its driver and not an administrator, and a client who
// happens to be a driver is its owner: the narrowest true answer is the one taken, because
// this word is what `document.served` is later read by — an administrator opening the
// wreckage and a driver starting work are the two readings that number exists to tell
// apart.
//
// A project that is not there answers like one that is nobody's: `false`. The route turns
// both into the same 404, so the address is of no use for finding out which ids exist.
async function capacityOver(settings, asking, projectId) {
  const found = await findProject(settings, projectId);
  if (!found.ok) return found.reason === "not_found" ? false : null;

  const project = found.data;
  if (project.owner_uid === asking.session.uid) return "owner";
  if (asking.driver && project.review?.driver?.uid === asking.driver.driver_uid) return "driver";
  return asking.driver?.sees_broken ? "prj_admin" : false;
}

/* ------------------------------------------------------------------ the plumbing */

// A form body, with the limit the configuration sets.
async function readForm(request, settings) {
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > settings.bodyMaxBytes) return { ok: false, status: 413 };
    chunks.push(chunk);
  }
  return { ok: true, data: new URLSearchParams(Buffer.concat(chunks).toString("utf8")) };
}

// The language switcher, in the footer of every page. It writes the shared cookie and,
// for whoever has logged in, asks the sso to keep it in the session and in the profile.
async function changeLocale(request, settings, response) {
  const change = await settings.i18n.readChange(request);
  if (!change.ok) {
    response.webtoolsErrorCode = change.code;
    return send(response, change.status, "text/plain; charset=utf-8", change.code);
  }
  // The sso not answering does not stop the change: the cookie is enough for the pages.
  const saved = await saveSessionLocale(settings, request, change.locale);
  if (!saved.ok) {
    console.error("[projects-hub] language not saved in the session: the sso does not answer");
  }
  return redirect(response, change.location, { "set-cookie": change.cookie });
}

async function serveStatic(pathname, response) {
  // Only files inside public/: path.normalize strips the "..".
  const relative = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const file = path.join(PUBLIC_DIR, relative);
  if (!file.startsWith(PUBLIC_DIR)) {
    return send(response, 403, "text/plain; charset=utf-8", "Forbidden");
  }
  let info;
  try {
    info = await stat(file);
  } catch {
    return send(response, 404, "text/plain; charset=utf-8", "Not found");
  }
  if (!info.isFile()) {
    return send(response, 404, "text/plain; charset=utf-8", "Not found");
  }
  response.writeHead(200, {
    "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
    "content-length": info.size,
  });
  createReadStream(file).pipe(response);
}

// The label a request is counted under. **Not** the path: a project id in a dimension
// would open a new bucket for every project, and a counter split a thousand ways is a
// counter nobody reads. The list is explicit, so a route added tomorrow is counted as
// `(other)` — a fact — instead of being guessed at by a pattern.
const ROUTE_LABELS = [
  [/^\/$/, "/"],
  [/^\/driver$/, "/driver"],
  [/^\/broken$/, "/broken"],
  [/^\/links$/, "/links"],
  [/^\/locale$/, "/locale"],
  [/^\/login-done$/, "/login-done"],
  [/^\/logout$/, "/logout"],
  [/^\/projects\/[^/]+\/documents\/[^/]+$/, "/projects/{id}/documents/{kind}"],
  [/^\/projects\/[^/]+\/validation$/, "/projects/{id}/validation"],
  [/^\/projects\/[^/]+\/validation\/confirm$/, "/projects/{id}/validation/confirm"],
  [/^\/(styles\.css|commons\.css|assets\/.+|fonts\/.+)$/, "(static)"],
];

export function routeLabel(pathname) {
  for (const [pattern, label] of ROUTE_LABELS) {
    if (pattern.test(pathname)) return label;
  }
  return "(other)";
}

// One measurement per request, sent when the response is done — the status and the
// duration are only known then. It is attached here and nowhere else, so no branch of the
// routing has to remember to count itself.
function countRequest(settings, request, response, pathname) {
  const elapsed = settings.metrics.timer();
  response.on("finish", () => {
    settings.metrics.measure("http.request", {
      dims: {
        route: routeLabel(pathname),
        method: request.method,
        status: String(response.statusCode),
      },
      duration_ms: elapsed(),
    });
    // The error's own code, where there was one. A status says how it went; the code says
    // what it was, and only one of the two can be acted on.
    if (response.webtoolsErrorCode) {
      settings.metrics.measure("http.error", { dims: { code: response.webtoolsErrorCode } });
    }
  });
}

export function createServer(settings) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    countRequest(settings, request, response, url.pathname);
    // Language and switcher for the pages. A page rendered in answer to a POST cannot be
    // reopened with a GET: changing language from there goes back to the driver's tab,
    // which is the only page a POST here renders.
    const ui = settings.i18n.pageContext(
      request,
      url,
      request.method === "GET" ? {} : { returnTo: DRIVER_TAB }
    );

    try {
      if (request.method === "POST" && url.pathname === "/locale") {
        return await changeLocale(request, settings, response);
      }
      if (request.method === "POST" && url.pathname === "/links") {
        return await makeLink(request, settings, response, ui);
      }
      if (request.method === "POST") {
        const confirm = /^\/projects\/([^/]+)\/validation\/confirm$/.exec(url.pathname);
        if (confirm) {
          return await receiveDecision(request, confirm[1], settings, response, ui);
        }
        const validation = /^\/projects\/([^/]+)\/validation$/.exec(url.pathname);
        if (validation) {
          return await askToConfirm(request, validation[1], settings, response, ui);
        }
      }
      if (request.method !== "GET") {
        return send(response, 405, "text/plain; charset=utf-8", "Method not allowed");
      }

      if (url.pathname === OWNED) {
        return await serveOwned(request, settings, response, ui);
      }
      if (url.pathname === DRIVER_TAB) {
        return await serveDriverTab(request, settings, response, ui);
      }
      if (url.pathname === BROKEN) {
        return await serveBroken(request, settings, response, ui);
      }
      if (url.pathname === "/login-done") {
        return await finishLogin(settings, response, ui, ticketFrom(url));
      }
      if (url.pathname === "/logout") {
        return leave(settings, response);
      }
      const document = /^\/projects\/([^/]+)\/documents\/([^/]+)$/.exec(url.pathname);
      if (document) {
        return await serveDocument(request, document[1], document[2], settings, response, ui);
      }
      return await serveStatic(url.pathname, response);
    } catch (error) {
      console.error(`[projects-hub] error on ${url.pathname}: ${error.stack ?? error}`);
      if (!response.headersSent) {
        send(response, 500, "text/plain; charset=utf-8", "Internal error");
      }
    }
  });
}
