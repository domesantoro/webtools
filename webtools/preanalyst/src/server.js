// The pre-analysis HTTP server.
//
//   GET  /                     the page with the form
//                              with ?rejected={id}: the refused-request modal
//   POST /submit               the form: the project, the pre-specification and the prevalidation
//   GET  /analysis/{id}        the analysis page: the specification rounds
//   POST /analysis/{id}/messages, /turns, /turns/buy   the chat and its turns
//   GET  /projects/{id}/rejection.pdf   the form data after a refusal
//   POST /upload               a ready-made specification, for an existing project
//   GET  /login-done, /session-fragment, /logout   the login round trip
//   POST /locale               changes the language (shared cookie) and returns to the page
//   everything else            the static files of public/

import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ambassadorOf, resolveAmbassador } from "./ambassador.js";
import {
  addPipelineStep,
  createProject,
  deleteProject,
  findDriver,
  findProject,
  findUser,
  grantUserTurns,
  listDrivers,
  spendUserTurns,
  updateOpenStep,
} from "./anagraphics.js";
import { FrontMatterError, isProjectId, parse } from "./commons/spec_front_matter.js";
import {
  claimTicket,
  clearSessionCookie,
  currentSession,
  logoutUrl,
  saveSessionLocale,
  sessionCookie,
  ticketFrom,
} from "./commons/sso_client.js";
import { driverLinkOfProject, NONE, resolveDriverLink, withoutOwnLink } from "./driver_link.js";
import {
  mockReplies,
  renderAccessFragments,
  renderAnalysis,
  renderLoginDone,
  renderMessage,
  renderPage,
} from "./page.js";
import { readAnswers, renderPrespec } from "./prespec.js";
import { prevalidate, verdict } from "./prevalidator.js";
import { linkTermsOf } from "./project_driver.js";
import { writeRejectionPdf } from "./rejection_pdf.js";
import { latestSpec, storeSpec } from "./workspaces.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function send(response, status, contentType, body) {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}

function redirect(response, location, headers = {}) {
  response.writeHead(303, { location, "cache-control": "no-store", ...headers });
  response.end();
}

// How long is left before the session expires. The cookie must not outlive the
// session it stands for, so the duration is not decided here: it is read.
function secondsUntil(moment) {
  const expiry = Date.parse(moment ?? "");
  if (Number.isNaN(expiry)) return 0;
  return Math.max(0, Math.floor((expiry - Date.now()) / 1000));
}

// `/login-done`: the **login window** lands here, not the starting page. The
// ticket is exchanged, the cookie is set, and a small page is rendered that
// notifies the starting window and closes itself (`public/sso_popup.js`).
//
// The return does not happen on the pre-analysis page on purpose: the wrong window
// would land there, opening a second copy of the form and leaving the real one
// convinced nobody had logged in.
async function finishLogin(url, settings, response, ui, ticket) {
  const html = (ok) => send(response, 200, "text/html; charset=utf-8", renderLoginDone(ui, { ok }));

  if (!ticket) {
    // Somebody got here by hand, without going through the login.
    return html(false);
  }

  const claimed = await claimTicket(settings, ticket);
  if (!claimed.ok || !claimed.logged) {
    console.warn("[preanalyst] invalid ticket on the way back from the login");
    return html(false);
  }

  const duration = secondsUntil(claimed.session.expires_at);
  if (duration === 0) {
    console.warn("[preanalyst] session already expired on the way back from the login");
    return html(false);
  }

  console.log(`[preanalyst] logged in: ${claimed.session.username}`);
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "set-cookie": sessionCookie(settings, claimed.session.token, duration),
  });
  return response.end(renderLoginDone(ui, { ok: true }));
}

// The parts of the page that depend on who has logged in, already rendered by the
// templates. The browser asks for them after a login done in the separate window,
// and puts them in place of the old ones: the form is not touched, and nothing is
// reloaded.
//
// The browser also sends the address parameters (`?discount=`, `?driver=`) because
// the right-hand column depends on them: after the login it can change, for
// instance if the person who logged in is the link's driver.
async function serveAccessFragments(request, url, settings, response, ui) {
  const state = await pageState(request, url, settings);
  const body = JSON.stringify(renderAccessFragments(ui, state.access, settings, state));
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

/* ------------------------------------------------------------- the upload */

// The whole body, or `null` if it goes over the limit: in that case `tooLarge` has
// already answered. First we answer, then we close: closing straight away, the
// client would never read the reason and would only see a dropped connection.
async function readBody(request, response, maxBytes, tooLarge) {
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > maxBytes) {
      // `connection: close`, because the rest, still on its way, is neither to be
      // read nor waited for.
      response.once("finish", () => request.destroy());
      tooLarge();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// `POST /upload` — a ready-made specification, for a project that already exists.
//
// The file arrives **in the body as it is**, with its name in `X-File-Name`: a
// single file does not need a multipart form, and without multipart nothing is
// needed to take it apart. The declared type is not looked at: the content is.
//
// The file must be UTF-8 text with the `project_id` in the front matter, and the
// project must belong to whoever uploads it. Another person's project answers like
// one that does not exist: that way one cannot discover which ids exist. If
// anything is wrong, the file is not stored.
//
// The responses follow the project's API contract, HTTP status plus a stable code:
// here we are not speaking to a person but to the page's JavaScript.
async function receiveUpload(request, settings, response) {
  const answer = (status, payload, headers = {}) => {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
      ...headers,
    });
    response.end(body);
  };
  const fail = (status, code) => answer(status, { error: code });

  // Uploading is an action, not a read: you have to be in.
  const access = await currentSession(settings, request);
  if (!access.ok) return fail(503, "SSO_UNAVAILABLE");
  if (!access.logged) return fail(401, "NOT_LOGGED");

  const name = fileName(request);
  if (!name) return fail(400, "MISSING_FILE_NAME");

  const body = await readBody(request, response, settings.uploadMaxBytes, () =>
    answer(413, { error: "FILE_TOO_LARGE" }, { connection: "close" })
  );
  if (body === null) return;
  if (body.length === 0) return fail(400, "EMPTY_FILE");

  let text;
  try {
    // `fatal`: an invalid byte is an error, not a character silently replaced. A
    // PDF or a Word file ends up here.
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return fail(400, "NOT_UTF8");
  }

  let data;
  try {
    data = parse(text).data;
  } catch (error) {
    if (error instanceof FrontMatterError) return fail(400, "INVALID_FRONT_MATTER");
    throw error;
  }
  const projectId = data?.project_id;
  if (projectId === undefined || projectId === null) return fail(400, "MISSING_PROJECT_ID");
  if (!isProjectId(projectId)) return fail(400, "INVALID_PROJECT_ID");

  const project = await findProject(settings, projectId);
  if (!project.ok && project.reason === "not_found") return fail(404, "PROJECT_NOT_FOUND");
  if (!project.ok) return fail(503, "ANAGRAPHICS_UNAVAILABLE");
  if (project.data.owner_uid !== access.session.uid) {
    console.warn(
      `[preanalyst] ${access.session.username} uploaded a specification for somebody ` +
        `else's project (${projectId}): refused`
    );
    return fail(404, "PROJECT_NOT_FOUND");
  }

  // The origin is decided by the channel: an uploaded file is always third-party,
  // even if its front matter declares otherwise.
  const stored = await storeSpec(settings, projectId, text, {
    origin: "third_party",
    uploadedBy: access.session.uid,
  });
  if (!stored.ok && stored.reason === "rejected") return fail(400, stored.code);
  if (!stored.ok) return fail(503, "WORKSPACES_UNAVAILABLE");

  console.log(
    `[preanalyst] specification uploaded by ${access.session.username}: ${name} ` +
      `(${body.length} bytes) → project ${projectId}, version ${stored.data.version}`
  );
  return answer(201, {
    received: true,
    name,
    project_id: projectId,
    version: stored.data.version,
  });
}

// The name arrives encoded in the header, because a header carries ASCII only and
// a file name can have accents. Only the last part is kept: a name with paths
// inside it is an attempt, not a name.
function fileName(request) {
  const raw = request.headers["x-file-name"];
  if (!raw) return null;
  let name;
  try {
    name = decodeURIComponent(raw);
  } catch {
    return null;
  }
  name = name.split(/[/\\]/).pop().trim();
  return name && name !== "." && name !== ".." ? name.slice(0, 200) : null;
}

// "Esci" logs out of everything: first our cookie is removed, then the browser is
// sent to the sso, which closes the shared session and removes its own. From then
// on no subsystem recognises that token.
function leave(settings, response) {
  return redirect(response, logoutUrl(settings, `${settings.publicUrl}/`), {
    "set-cookie": clearSessionCookie(settings),
  });
}

/* ------------------------------------------------- submitting the form */

function sendMessage(response, ui, status, kind) {
  send(response, status, "text/html; charset=utf-8", renderMessage(ui, kind));
}

// `POST /submit` — the pre-analysis form.
//
// In order: the project is born in anagraphics, the answers become the
// pre-specification, the pre-specification goes into the project's workspace, the
// browser goes to the analysis page. The `303` means that reloading that page does
// not resend the form.
//
// Two safeguards:
// - `submission_id`, generated when the page was rendered: the same form sent
//   twice (double click, reload) finds the project already born;
// - if the pre-specification cannot be written, the project is deleted: a project
//   with no pre-specification has nothing to start from.
async function receiveForm(request, settings, response, ui) {
  const access = await currentSession(settings, request);
  if (!access.ok) return sendMessage(response, ui, 503, "unavailable");
  if (!access.logged) return sendMessage(response, ui, 401, "not_logged");

  const body = await readBody(request, response, settings.formMaxBytes, () =>
    send(response, 413, "text/html; charset=utf-8", renderMessage(ui, "too_large"))
  );
  if (body === null) return;
  const form = new URLSearchParams(body.toString("utf8"));

  const submissionId = form.get("submission_id") ?? "";
  if (!isProjectId(submissionId)) return sendMessage(response, ui, 400, "invalid");

  const { answers, missing } = readAnswers(form, settings.answerMaxChars);
  if (missing.length > 0) return sendMessage(response, ui, 400, "missing");

  // A rewrite: somebody sent back because a few more details were needed resends
  // the form with the id of their project. We start again from that one instead of
  // creating another, so the rounds stay counted in one place only.
  const resumed = await resumedProject(settings, form, access.session);
  if (resumed) {
    return await writeAndPrevalidate(settings, response, ui, {
      projectId: resumed.projectId,
      answers,
      session: access.session,
      attempts: resumed.attempts,
    });
  }

  // Everything arriving from the hidden fields is checked again on anagraphics.
  const ownDriverUid = access.session.data?.driver_uid ?? null;
  const autonomous = Boolean(ownDriverUid) && form.get("autonomous_work") === "yes";
  const link = await linkTermsOf(settings, form, ownDriverUid, autonomous);
  if (!link.ok) return sendMessage(response, ui, 503, "unavailable");
  const ambassador = await ambassadorOf(settings, form, ownDriverUid);
  if (!ambassador.ok) return sendMessage(response, ui, 503, "unavailable");

  const { review, billing } = projectTerms({ ownDriverUid, autonomous, link, ambassadorUid: ambassador.uid });
  const created = await createProject(settings, {
    ownerUid: access.session.uid,
    submissionId,
    review,
    billing,
  });
  if (!created.ok && created.reason === "rejected") return sendMessage(response, ui, 400, "invalid");
  if (!created.ok) return sendMessage(response, ui, 503, "unavailable");
  const projectId = created.data.project_id;

  // 200 instead of 201: this submission had already arrived, and the project is
  // already there. The pre-specification is not rewritten: we go where we would
  // have gone the first time.
  if (created.status === 200) {
    console.log(`[preanalyst] repeated submission from ${access.session.username}: project ${projectId}`);
    return redirect(response, `/analysis/${projectId}`);
  }

  return await writeAndPrevalidate(settings, response, ui, {
    projectId,
    answers,
    session: access.session,
    attempts: 0,
  });
}

// The project to resume, if the form carries a valid one.
//   → { projectId, attempts } or null
//
// It counts only for a project that exists, belongs to whoever sends the form and
// is sitting in `UNDERSPECIFIED`: any old id in the hidden field does not allow
// rewriting somebody else's project, nor reviving one already refused.
//
// `attempts` are the rounds already done, counted on the pipeline steps: the
// register of steps is the only place where that number exists, and there is no
// need to keep it anywhere else.
async function resumedProject(settings, form, session) {
  const projectId = form.get("project_id") ?? "";
  if (!isProjectId(projectId)) return null;

  const project = await findProject(settings, projectId);
  if (!project.ok) return null;
  if (project.data.owner_uid !== session.uid) {
    console.warn(
      `[preanalyst] ${session.username} rewrote somebody else's project (${projectId}): ignored`
    );
    return null;
  }
  if (project.data.pipeline?.state !== "UNDERSPECIFIED") return null;

  return { projectId, attempts: underspecifiedAttempts(project.data) };
}

// How many times this request has already come back for want of detail.
export function underspecifiedAttempts(project) {
  const steps = project.pipeline?.steps ?? [];
  return steps.filter((entry) => entry.result === "underspecified").length;
}

// The pre-specification is rendered, stored and prevalidated. It is the part
// shared by the first submission and the rewrite of somebody sent back (§16.6 of
// the README): only which project we start from and how many rounds have already
// been done change.
async function writeAndPrevalidate(settings, response, ui, { projectId, answers, session, attempts }) {
  const prespec = renderPrespec(projectId, answers, ui.locale);
  const stored = await storeSpec(settings, projectId, prespec, {
    origin: "system",
    uploadedBy: session.uid,
  });
  if (!stored.ok) {
    // Only on the first round is the project deleted: without a pre-specification
    // it has nothing to start from. Somebody who has already rewritten has a good
    // version behind them, and throwing it away would be worse.
    if (attempts === 0) {
      const deleted = await deleteProject(settings, projectId);
      console.error(
        `[preanalyst] pre-specification not written for project ${projectId}: ` +
          (deleted.ok ? "project deleted" : "PROJECT LEFT WITHOUT A PRE-SPECIFICATION")
      );
    } else {
      console.error(`[preanalyst] rewrite not stored for project ${projectId}`);
    }
    return sendMessage(response, ui, 503, "unavailable");
  }

  console.log(
    `[preanalyst] request from ${session.username}: project ${projectId}, ` +
      `pre-specification v${stored.data.version}${attempts ? ` (round ${attempts + 1})` : ""}`
  );

  const outcome = await runPrevalidation(settings, projectId, prespec, attempts);

  if (outcome === "rejected") return redirect(response, `/?rejected=${projectId}`);
  if (outcome === "underspecified") {
    // Here we do **not** redirect: the page is rendered with the answers already
    // in it. Asking for a few more details and handing back an empty form would be
    // an invitation impossible to accept. The price is that reloading resends the
    // form — see §16.7 of the README.
    return await serveFormAgain(settings, response, ui, { projectId, answers, session });
  }
  return redirect(response, `/analysis/${projectId}`);
}

// The form again, holding what the user had already written, because the request
// did not say enough to be judged.
//
// It is not a redirect: the page is rendered here, in answer to the POST. A `303`
// to the home page would bring back an empty form, and asking for a few more
// details while handing over a blank sheet is an invitation nobody can accept.
//
// **The page stays the page**: the right-hand column is the one from before — the
// driver box, the ambassador box, the autonomous work block for a driver, the
// upload of a ready-made specification. Whoever sees the form again must find it
// as it was, or it looks as if something has broken.
//
// What changes is that the boxes are **read and not touched**: the project's
// economic terms were settled at the first submission and this round does not read
// them again. So no hidden fields travelling with the form, no "this driver will
// be ignored" notice, and the autonomous work checkbox shows what is recorded,
// locked.
//
// The address parameters are not here — this is the answer to a `POST` — but they
// are not needed: what they carried is on the project, and it is read from there
// (`driverLinkOfProject`).
async function serveFormAgain(settings, response, ui, { projectId, answers, session }) {
  // What was settled at the first submission. If anagraphics does not answer we go
  // on with the page anyway: a detail of the right-hand column is not worth the
  // user's request, which has already been written.
  const project = await findProject(settings, projectId);
  const data = project.ok ? project.data : null;
  const autonomous = Boolean(data?.billing?.autonomous_work);

  // In autonomous work the driver is whoever is filling the form in, and the box
  // is not shown: that is what happens at the first submission, where the
  // checkbox's CSS switches it off.
  const driverLink = data && !autonomous ? await driverLinkOfProject(settings, data) : { state: NONE };

  const ambassadorUid = data?.billing?.ambassador_uid ?? null;
  const invitation = ambassadorUid ? await findDriver(settings, ambassadorUid) : { ok: false };

  const html = renderPage(ui, {
    access: { logged: true, session, ssoAvailable: true },
    settings,
    params: {},
    driverLink,
    showDriverBox: driverLink.state !== NONE,
    driversAvailable: true,
    ambassador: invitation.ok ? invitation.data : null,
    isDriver: Boolean(session.data?.driver_uid),
    // The checkbox says how the project stands, and it can no longer be changed: on
    // the second round nobody reads `autonomous_work` again, and a checkbox that
    // does nothing is worse than a locked one.
    autonomousWork: { checked: autonomous, locked: true },
    // A new id for the new round: this is another submission, and the submission
    // de-duplication works on that.
    submissionId: randomUUID(),
    answers,
    resumed: { projectId },
    rejection: null,
  });
  send(response, 200, "text/html; charset=utf-8", html);
}

// Where the pipeline goes for each of the three decisions. The step says two
// things — how it went and where we go — and this gate is what decides them.
const STATE_AFTER = {
  passed: "ANALYSIS",
  rejected: "REJECTED",
  underspecified: "UNDERSPECIFIED",
};

// The first gate: the pre-specification goes through the prevalidator and the
// outcome is appended to the project's pipeline. It returns what is done with the
// request — "passed", "rejected", "underspecified" — or "failed" if the check did
// not succeed.
//
// If the check does not succeed — provider down, unusable answer — the project
// **stays**: the step is marked `failed` and we go on. A valid request is not
// thrown away because a check did not work; a refusal is a decision, not a
// failure.
async function runPrevalidation(settings, projectId, prespec, attempts) {
  const outcome = await prevalidate(settings, prespec);

  if (!outcome.ok) {
    // If the model answered — badly, but it answered — the tokens were paid for
    // all the same, and they go on the step together with the error: the cost of
    // an attempt gone wrong is cost, and the PoC measures the real one. If the
    // provider did not answer at all there is no `usage` to write.
    const { usage, model } = outcome;
    console.error(
      `[preanalyst] prevalidation failed for ${projectId}: ${outcome.reason}` +
        (usage ? `; ${usage.input_tokens}+${usage.output_tokens} tokens spent anyway` : "")
    );
    await savePipelineStep(settings, projectId, {
      step: "prevalidation",
      result: "failed",
      state: "PREVALIDATION",
      data: { error: outcome.reason, ...(usage ? { usage, model } : {}) },
    });
    return "failed";
  }

  const { outcome: verdictName, distribution } = outcome.data;
  const decision = verdict(distribution, verdictName, {
    threshold: settings.prevalidation.rejectThreshold,
    attempts,
    maxAttempts: settings.prevalidation.maxUnderspecifiedAttempts,
  });

  console.log(
    `[preanalyst] prevalidation of ${projectId}: ${verdictName} ` +
      `(${distribution[verdictName].toFixed(2)}) → ${decision}` +
      `${outcome.data.off_domain.flag ? ", off domain" : ""}; ` +
      `${outcome.data.usage.input_tokens}+${outcome.data.usage.output_tokens} tokens`
  );

  await savePipelineStep(settings, projectId, {
    step: "prevalidation",
    result: decision,
    state: STATE_AFTER[decision],
    data: outcome.data,
  });

  // Past the gate the project **arrives** at the specification rounds: the step is
  // opened here, with the included turns and an empty chat. It is an `open` step,
  // one that has not decided anything yet and that grows; it will be closed by
  // another step when the analysis ends.
  if (decision === "passed") await openAnalysisStep(settings, projectId);
  return decision;
}

// Opens the `analysis` step: the included turns and the conversation, which starts
// empty.
//
// It is called when the prevalidation passes, and again when the page is opened if
// the step is not there — projects born before this code sit in `ANALYSIS` with no
// open step, and without one there would be no writing and no counting.
async function openAnalysisStep(settings, projectId) {
  return savePipelineStep(settings, projectId, {
    step: "analysis",
    result: "open",
    state: "ANALYSIS",
    data: { turns_left: settings.analysis.maxTurns, chat: [] },
  });
}

// The project's last open `analysis` step, or null.
export function openAnalysisOf(project) {
  const steps = project.pipeline?.steps ?? [];
  return [...steps].reverse().find((entry) => entry.step === "analysis" && entry.result === "open") ?? null;
}

// The user's turn credit. If it cannot be read it counts as zero: the page will
// show the purchase instead of the field for drawing on it, which is the lesser
// evil — better to offer buying than to offer spending a credit we do not know is
// there.
async function turnsCredit(settings, username) {
  const user = await findUser(settings, username);
  if (!user.ok) {
    console.error(`[preanalyst] credit of ${username} not read: ${user.reason}`);
    return 0;
  }
  return Number(user.data.billing?.turns_credit ?? 0);
}

/* ------------------------------------------- the routes of the analysis chat */

// These three answer the page's JavaScript, not a person: HTTP status plus a
// stable code, as `POST /upload` does.
function jsonReplier(response) {
  const answer = (status, payload) => {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
    });
    response.end(body);
  };
  return { answer, fail: (status, code) => answer(status, { error: code }) };
}

// Who is calling, and the project with its open step. All the checks the three
// routes make in the same way, in one place only.
//
// Somebody else's project answers like one that does not exist: that way the
// address is of no use for discovering which ids exist.
async function chatContext(request, projectId, settings, fail) {
  const access = await currentSession(settings, request);
  if (!access.ok) return fail(503, "SSO_UNAVAILABLE") ?? null;
  if (!access.logged) return fail(401, "NOT_LOGGED") ?? null;
  if (!isProjectId(projectId)) return fail(404, "PROJECT_NOT_FOUND") ?? null;

  const project = await findProject(settings, projectId);
  if (!project.ok && project.reason !== "not_found") return fail(503, "ANAGRAPHICS_UNAVAILABLE") ?? null;
  if (!project.ok || project.data.owner_uid !== access.session.uid) {
    return fail(404, "PROJECT_NOT_FOUND") ?? null;
  }

  const step = openAnalysisOf(project.data);
  if (step === null) return fail(409, "ANALYSIS_NOT_OPEN") ?? null;

  return { session: access.session, project: project.data, step };
}

// The JSON body of one of these routes. `null` if it could not be read: in that
// case the answer has already been sent.
async function readJsonBody(request, response, settings, fail) {
  const raw = await readBody(request, response, settings.formMaxBytes, () => fail(413, "BODY_TOO_LARGE"));
  if (raw === null) return null;
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    fail(400, "INVALID_BODY");
    return null;
  }
}

// `POST /analysis/{id}/messages` — one turn of the chat.
//
// The turn is counted by **the server**, not the browser: the conversation and the
// remaining turns live on the project's open step, and whoever reloads the page
// finds again what was there. A message with no turns left is not accepted.
//
// THE ANSWER IS STILL FAKE: `mockReplies` picks it from the language catalogue.
// What is real is everything else — the turn spent, the chat written, the round
// trip that survives a reload.
async function receiveChatMessage(request, projectId, settings, response, ui) {
  const { answer, fail } = jsonReplier(response);

  const context = await chatContext(request, projectId, settings, fail);
  if (!context) return;

  const body = await readJsonBody(request, response, settings, fail);
  if (body === null) return;

  const text = String(body.message ?? "").trim().slice(0, settings.answerMaxChars);
  if (text === "") return fail(400, "EMPTY_MESSAGE");

  const left = Number(context.step.data?.turns_left ?? 0);
  if (left <= 0) return fail(409, "NO_TURNS_LEFT");

  const replies = mockReplies(ui);
  const reply = replies.length > 0 ? replies[Math.floor(Math.random() * replies.length)] : "";
  const now = new Date().toISOString();

  // One single write: the two messages and the turn spent are the same thing seen
  // from two sides, and must not be able to exist separately.
  const stored = await updateOpenStep(settings, projectId, "analysis", {
    set: { turns_left: left - 1 },
    push: {
      chat: [
        { role: "client", text, at: now },
        { role: "system", text: reply, at: now },
      ],
    },
  });
  if (!stored.ok) {
    console.error(`[preanalyst] turn not recorded on project ${projectId}: ${stored.reason}`);
    return fail(503, "ANAGRAPHICS_UNAVAILABLE");
  }

  console.log(`[preanalyst] chat turn on ${projectId}: ${left - 1} left`);
  return answer(200, { reply, turns_left: left - 1 });
}

// `POST /analysis/{id}/turns` — moves turns from the user's credit to the project.
//
// First the credit is drawn down, then the turns are added: the credit is the part
// that must not be spendable twice, and anagraphics checks it inside the write. If
// the second step does not succeed the credit **is given back**, or the user would
// have paid for nothing.
async function receiveTurnsFromCredit(request, projectId, settings, response) {
  const { answer, fail } = jsonReplier(response);

  const context = await chatContext(request, projectId, settings, fail);
  if (!context) return;

  const body = await readJsonBody(request, response, settings, fail);
  if (body === null) return;

  const howMany = Number(body.turns);
  if (!Number.isInteger(howMany) || howMany <= 0) return fail(400, "INVALID_TURNS");

  const uid = context.session.uid;
  const spent = await spendUserTurns(settings, uid, howMany);
  if (!spent.ok) {
    if (spent.code === "NOT_ENOUGH_TURNS") return fail(409, "NOT_ENOUGH_TURNS");
    return fail(503, "ANAGRAPHICS_UNAVAILABLE");
  }

  const left = Number(context.step.data?.turns_left ?? 0) + howMany;
  const stored = await updateOpenStep(settings, projectId, "analysis", { set: { turns_left: left } });
  if (!stored.ok) {
    console.error(
      `[preanalyst] turns drawn but not added to project ${projectId}: ${stored.reason}; giving them back`
    );
    const refund = await grantUserTurns(settings, uid, howMany);
    if (!refund.ok) {
      console.error(`[preanalyst] REFUND FAILED: ${howMany} turns lost by user ${uid}`);
    }
    return fail(503, "ANAGRAPHICS_UNAVAILABLE");
  }

  const credit = Number(spent.data.billing?.turns_credit ?? 0);
  console.log(`[preanalyst] ${howMany} turns from ${uid}'s credit to project ${projectId}: now ${left}`);
  return answer(200, { turns_left: left, credit });
}

// TODO(mock): remove when the real payment exists.
// `POST /analysis/{id}/turns/buy` buys nothing: it grants turns to the user's
// credit without anybody paying. It is only there so the out-of-turns page can be
// tried from beginning to end. When the payment arrives, this route and this
// constant go away together. It is in `contesto/todos.md`.
const FAKE_PURCHASE_TURNS = 10;

async function receiveTurnsPurchase(request, projectId, settings, response) {
  const { answer, fail } = jsonReplier(response);

  const context = await chatContext(request, projectId, settings, fail);
  if (!context) return;

  const uid = context.session.uid;
  const granted = await grantUserTurns(settings, uid, FAKE_PURCHASE_TURNS);
  if (!granted.ok) return fail(503, "ANAGRAPHICS_UNAVAILABLE");

  const credit = Number(granted.data.billing?.turns_credit ?? 0);
  console.warn(`[preanalyst] FAKE PURCHASE: ${FAKE_PURCHASE_TURNS} turns granted to ${uid}, credit ${credit}`);
  return answer(200, { credit });
}

// The step is not lost in silence: if anagraphics does not take it, it stays in
// the log.
async function savePipelineStep(settings, projectId, step) {
  const stored = await addPipelineStep(settings, projectId, step);
  if (!stored.ok) {
    console.error(
      `[preanalyst] step '${step.step}' not recorded on project ${projectId}: ${stored.reason}`
    );
  }
  return stored;
}

// Drivers and discounts are data of the **project**, not of the pre-specification:
// they go in `review` (who supervises it) and `billing` (the economic data).
//
// - Autonomous work: it counts only if whoever sends the form is a driver. The
//   driver is them (preset) and another driver's discount code does not apply: the
//   two exclude each other.
// - Otherwise the link's driver, if there was one and it is valid, is preset;
//   without one the system will assign it (`driver_uid: null`, `preset: false`).
//
// Driver, discount and ambassador arrive already checked: `linkTermsOf()` in
// src/project_driver.js and `ambassadorOf()` in src/ambassador.js.
function projectTerms({ ownDriverUid, autonomous, link, ambassadorUid }) {
  if (autonomous) {
    return {
      review: { driver_uid: ownDriverUid, preset: true },
      billing: {
        discount_code: null,
        autonomous_work: true,
        ambassador_uid: null,
      },
    };
  }
  return {
    review: { driver_uid: link.driverUid, preset: Boolean(link.driverUid) },
    billing: {
      discount_code: link.discountCode,
      autonomous_work: false,
      ambassador_uid: ambassadorUid,
    },
  };
}

// `GET /projects/{id}/rejection.pdf` — what the user had written in the form, to
// take away after a refusal.
//
// Only the owner sees it, and only for a project that really was refused:
// somebody else's project answers like one that does not exist.
//
// The **extended reason** for the refusal goes into it in two cases: if the
// configuration says to give it to everybody, or if whoever downloads it is a
// driver. It is internal data: outside those two cases the PDF does not even
// mention it.
async function serveRejectionPdf(request, projectId, settings, response, ui) {
  const access = await currentSession(settings, request);
  if (!access.ok) return sendMessage(response, ui, 503, "unavailable");
  if (!access.logged) return sendMessage(response, ui, 401, "not_logged");
  if (!isProjectId(projectId)) return sendMessage(response, ui, 404, "not_found");

  const project = await findProject(settings, projectId);
  if (!project.ok && project.reason !== "not_found") return sendMessage(response, ui, 503, "unavailable");
  if (!project.ok || project.data.owner_uid !== access.session.uid) {
    return sendMessage(response, ui, 404, "not_found");
  }
  if (project.data.pipeline?.state !== "REJECTED") return sendMessage(response, ui, 404, "not_found");

  const spec = await latestSpec(settings, projectId);
  if (!spec.ok && spec.reason === "not_found") return sendMessage(response, ui, 404, "not_found");
  if (!spec.ok) return sendMessage(response, ui, 503, "unavailable");

  const isDriver = Boolean(access.session.data?.driver_uid);
  const showReason = settings.prevalidation.rejectionReasonInPdf || isDriver;

  return writeRejectionPdf(response, {
    t: ui.t,
    spec: spec.data,
    reason: showReason ? rejectionReasonOf(project.data) : null,
    // The file name: just the id, which is a UUID, so there is nothing to clean.
    fileName: `webtools-${projectId}.pdf`,
  });
}

// The reason written by the prevalidator, taken from the last step that decided.
// `off_domain.reason` is added if it is there: it is the other half of the
// judgement.
function rejectionReasonOf(project) {
  const steps = project.pipeline?.steps ?? [];
  const step = [...steps].reverse().find((entry) => entry.step === "prevalidation" && entry.data?.reason);
  if (!step) return null;
  const offDomain = step.data.off_domain?.flag ? step.data.off_domain.reason : "";
  return [step.data.reason, offDomain].filter(Boolean).join("\n\n");
}

// `GET /analysis/{id}` — the specification rounds. Only the project's owner sees
// it: for everybody else the project does not exist.
//
// Next to the chat there is the summary of what was settled at submission time —
// driver, discount, ambassador, autonomous work. It is not read from the address,
// which carries nothing here: it is on the project, and it is read from there just
// as the form does when it comes back (`serveFormAgain`).
async function serveAnalysis(request, projectId, settings, response, ui) {
  const session = await currentSession(settings, request);
  if (!session.ok) return sendMessage(response, ui, 503, "unavailable");
  if (!session.logged) return sendMessage(response, ui, 401, "not_logged");
  if (!isProjectId(projectId)) return sendMessage(response, ui, 404, "not_found");

  const project = await findProject(settings, projectId);
  if (!project.ok && project.reason !== "not_found") return sendMessage(response, ui, 503, "unavailable");
  if (!project.ok || project.data.owner_uid !== session.session.uid) {
    return sendMessage(response, ui, 404, "not_found");
  }

  // The specification-rounds step. If it is not there it is opened now: that is
  // how projects born before this step existed get one.
  let step = openAnalysisOf(project.data);
  if (step === null) {
    const opened = await openAnalysisStep(settings, projectId);
    step = opened.ok ? openAnalysisOf(opened.data) : null;
  }
  // Without an open step there is no writing and no counting: the page would say
  // something false, so it is not shown.
  if (step === null) return sendMessage(response, ui, 503, "unavailable");

  const access = { logged: true, session: session.session, ssoAvailable: true };
  send(response, 200, "text/html; charset=utf-8", renderAnalysis(ui, {
    access,
    settings,
    terms: await projectSummary(settings, project.data),
    project_id: projectId,
    // The conversation and the turns live on the project: reloading the page loses
    // nothing. The credit lives on the user.
    chat: {
      messages: step.data?.chat ?? [],
      turnsLeft: Number(step.data?.turns_left ?? 0),
      credit: await turnsCredit(settings, session.session.username),
    },
  }));
}

// The project's terms, for the summary next to the chat. If anagraphics does not
// answer we go on with whatever could be read: an incomplete summary box is not
// worth the page.
//
// In autonomous work the driver is whoever is looking, and they are not shown as
// if they were somebody else: the autonomous work line says it, and it is there
// for that.
async function projectSummary(settings, project) {
  const autonomous = Boolean(project.billing?.autonomous_work);
  const driverLink = autonomous ? { state: NONE } : await driverLinkOfProject(settings, project);

  const ambassadorUid = project.billing?.ambassador_uid ?? null;
  const invitation = ambassadorUid ? await findDriver(settings, ambassadorUid) : { ok: false };

  return { driverLink, ambassador: invitation.ok ? invitation.data : null, autonomous };
}

// Everything needed to draw the page: who has logged in, where they came from.
// It lives in one place because both the whole page and the fragments the browser
// asks for after the login use it: the two roads must see the same thing.
async function pageState(request, url, settings) {
  // Who is looking at the page. Three outcomes, and they are three different
  // things: logged in, not logged in, or "we do not know" because the sso does not
  // answer. The last one is not treated as a logout.
  const current = await currentSession(settings, request);
  const access = {
    logged: current.ok ? current.logged : false,
    session: current.ok ? current.session : null,
    ssoAvailable: current.ok,
  };

  // Is whoever logged in also a driver? The uid of their document in `drivers`
  // comes from the session, photographed at login time.
  const ownDriverUid = access.logged ? (access.session.data?.driver_uid ?? null) : null;

  const params = {
    discountCode: url.searchParams.get("discount"),
    driverUid: url.searchParams.get("driver"),
    ambassadorUid: url.searchParams.get("ambassador"),
  };

  // The driver box is seen only by somebody who arrived from a driver's link. For
  // everybody else there is no choice to make, so there is no box and there is not
  // even any need to ask anagraphics for the list.
  const showDriverBox = Boolean(params.discountCode || params.driverUid);
  // The ambassador counts only without a driver's link (src/ambassador.js).
  const ambassadorAsked = Boolean(params.ambassadorUid) && !showDriverBox;

  let drivers = [];
  let driversAvailable = true;
  let driverLink = { state: NONE };

  if (showDriverBox) {
    const driversResult = await listDrivers(settings);
    driversAvailable = driversResult.ok;
    drivers = driversResult.ok ? driversResult.data : [];
    // Without the list nothing can be resolved: the box says so and the
    // pre-analysis goes on anyway, because choosing the driver is optional.
    driverLink = driversResult.ok ? await resolveDriverLink(settings, params, drivers) : { state: NONE };
    // A driver does not send a client to themselves: their own discount and their
    // own link do not count. Other drivers' do.
    driverLink = withoutOwnLink(driverLink, ownDriverUid);
  }

  // Without the driver list the ambassador cannot be checked: the box is not there.
  let ambassador = null;
  if (ambassadorAsked) {
    const driversResult = await listDrivers(settings);
    ambassador = driversResult.ok ? resolveAmbassador(params, driversResult.data, ownDriverUid) : null;
  }

  return {
    access,
    params,
    driverLink,
    showDriverBox,
    driversAvailable,
    ambassador,
    isDriver: Boolean(ownDriverUid),
    rejection: await rejectedProject(request, url, settings, access),
  };
}

// What the refusal modal says. Three cases, and they are three different things:
//
//   out_of_scope     `run_out_certain`: software that could be made, but not here.
//                    "we are probably not the right tool" is true.
//   not_software     `non_sequitur`: what was asked for is not software. Here we say
//                    what webtools builds — small software, used in a browser — and
//                    name a few examples of what it does not build. It is a
//                    description of the service, not a judgement on the request.
//   not_recognised   the rest: the `underspecified` that has run out of rounds.
//                    There is nothing to judge, and saying we are not the right tool
//                    would make it seem the request had been understood and set aside.
//
// None of the three says **why that** request was refused: the model's reason stays
// ours and the driver's.
const REJECTION_CASE = {
  run_out_certain: "out_of_scope",
  non_sequitur: "not_software",
};

export function rejectionCase(project) {
  const steps = project.pipeline?.steps ?? [];
  const step = [...steps].reverse().find((entry) => entry.step === "prevalidation" && entry.data?.outcome);
  return REJECTION_CASE[step?.data.outcome] ?? "not_recognised";
}

// `?rejected={id}` — this is where somebody lands who has just sent the form and
// had the request refused. The parameter counts only if the project exists,
// belongs to the viewer and really was refused: in every other case it is ignored
// and the page is the usual one. That way the address cannot be used to make a
// refusal appear to somebody else, nor to discover which projects exist.
async function rejectedProject(request, url, settings, access) {
  const projectId = url.searchParams.get("rejected");
  if (!projectId || !isProjectId(projectId) || !access.logged) return null;

  const project = await findProject(settings, projectId);
  if (!project.ok) return null;
  if (project.data.owner_uid !== access.session.uid) return null;
  if (project.data.pipeline?.state !== "REJECTED") return null;
  return { project_id: projectId, case: rejectionCase(project.data) };
}

async function servePage(request, url, settings, response, ui) {
  const state = await pageState(request, url, settings);
  // An id for this form: if the same submission arrives twice, there is still one project.
  const html = renderPage(ui, { ...state, settings, submissionId: randomUUID() });
  send(response, 200, "text/html; charset=utf-8", html);
}

async function serveStatic(pathname, response) {
  // Only files inside public/: path.normalize strips the ".."..
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

// The language switcher, in the header of every page. It writes the shared cookie
// and returns to the page it started from: the other subsystems read the same
// cookie, so they change language too on the next page.
async function changeLocale(request, settings, response) {
  const change = await settings.i18n.readChange(request);
  if (!change.ok) {
    const body = JSON.stringify({ error: change.code });
    response.writeHead(change.status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    });
    return response.end(body);
  }
  // Whoever has logged in finds it again at the next login. If the sso does not
  // answer the language changes anyway: the cookie is enough for the pages.
  const saved = await saveSessionLocale(settings, request, change.locale);
  if (!saved.ok) console.error("[preanalyst] language not saved in the session: the sso does not answer");
  return redirect(response, change.location, { "set-cookie": change.cookie });
}

export function createServer(settings) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    // Language and switcher for the pages. Pages rendered in answer to a POST
    // cannot be reopened with a GET: changing language from there goes back to the
    // pre-analysis.
    const ui = settings.i18n.pageContext(request, url, request.method === "GET" ? {} : { returnTo: "/" });

    try {
      if (request.method === "POST" && url.pathname === "/upload") {
        return await receiveUpload(request, settings, response);
      }
      if (request.method === "POST" && url.pathname === "/submit") {
        return await receiveForm(request, settings, response, ui);
      }
      if (request.method === "POST" && url.pathname === "/locale") {
        return await changeLocale(request, settings, response);
      }
      const message = /^\/analysis\/([^/]+)\/messages$/.exec(url.pathname);
      if (request.method === "POST" && message) {
        return await receiveChatMessage(request, message[1], settings, response, ui);
      }
      const purchase = /^\/analysis\/([^/]+)\/turns\/buy$/.exec(url.pathname);
      if (request.method === "POST" && purchase) {
        return await receiveTurnsPurchase(request, purchase[1], settings, response);
      }
      const turns = /^\/analysis\/([^/]+)\/turns$/.exec(url.pathname);
      if (request.method === "POST" && turns) {
        return await receiveTurnsFromCredit(request, turns[1], settings, response);
      }
      if (request.method !== "GET") {
        return send(response, 405, "text/plain; charset=utf-8", "Method not allowed");
      }

      if (url.pathname === "/") {
        return await servePage(request, url, settings, response, ui);
      }
      if (url.pathname === "/login-done") {
        return await finishLogin(url, settings, response, ui, ticketFrom(url));
      }
      if (url.pathname === "/session-fragment") {
        return await serveAccessFragments(request, url, settings, response, ui);
      }
      if (url.pathname === "/logout") {
        return leave(settings, response);
      }
      const analysis = /^\/analysis\/([^/]+)$/.exec(url.pathname);
      if (analysis) {
        return await serveAnalysis(request, analysis[1], settings, response, ui);
      }
      const rejection = /^\/projects\/([^/]+)\/rejection\.pdf$/.exec(url.pathname);
      if (rejection) {
        return await serveRejectionPdf(request, rejection[1], settings, response, ui);
      }
      return await serveStatic(url.pathname, response);
    } catch (error) {
      console.error(`[preanalyst] error on ${url.pathname}: ${error.stack ?? error}`);
      if (!response.headersSent) {
        send(response, 500, "text/plain; charset=utf-8", "Internal error");
      }
    }
  });
}
