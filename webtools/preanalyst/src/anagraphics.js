// HTTP client towards webtools_anagraphics.
//
// It raises no exceptions towards the caller: every call returns
// { ok: true, data } or { ok: false, reason }, because the page has to know *how*
// it went wrong, not only that it went wrong.
//
//   reason "not_found"    → the API answered 404 with its own error code
//   reason "rejected"     → 400 or 409: the request was wrong, retrying does not help
//   reason "unavailable"  → service unreachable, timeout, 5xx, 403, broken JSON
//
// Anagraphics' error responses are { "error": "<CODE>" }: the code is compared,
// never the text.
//
// **Every call through here is measured**, once, as a `dependency.call`. It is the one
// place the preanalyst talks to anagraphics, so a measurement here covers every call
// there is and one added later needs nothing but its own name. `operation` is that
// name: a stable word each helper gives, never the path — a path carries project ids,
// and a bucket per project id would make the number of documents grow with the traffic
// instead of with the number of kinds of thing measured.
//
// Four outcomes, because they are four different things to do about it: `ok`, `failed`,
// `timed_out` (it may well still be working, and it is certainly consuming something)
// and `not_found`, which is an answer and not a fault.

async function readJson(settings, path, { method = "GET", body, operation } = {}) {
  const url = `${settings.anagraphicsUrl}${path}`;
  const elapsed = settings.metrics.timer();
  const report = (outcome) =>
    settings.metrics.measure("dependency.call", {
      dims: { target: "anagraphics", operation, outcome },
      duration_ms: elapsed(),
    });
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(settings.anagraphicsTimeoutMs),
    });
  } catch (error) {
    // Service down, DNS, network, client timeout.
    console.error(`[anagraphics] ${method} ${path}: ${error.name} ${error.message}`);
    // We gave up waiting, or there was nothing at the other end: two facts, and in a log
    // they look alike.
    report(error.name === "TimeoutError" ? "timed_out" : "failed");
    return { ok: false, reason: "unavailable" };
  }

  // 204: no body to read.
  if (response.status === 204) {
    report("ok");
    return { ok: true, data: null };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    console.error(`[anagraphics] ${method} ${path}: response is not JSON (HTTP ${response.status})`);
    report("failed");
    return { ok: false, reason: "unavailable" };
  }

  if (response.ok) {
    report("ok");
    return { ok: true, data: payload, status: response.status };
  }

  if (response.status === 404) {
    // It answered, and what it said is that the thing is not there. Not a failure.
    report("not_found");
    return { ok: false, reason: "not_found", code: payload?.error };
  }
  report("failed");
  if (response.status === 400 || response.status === 409) {
    console.error(`[anagraphics] ${method} ${path}: HTTP ${response.status} ${payload?.error ?? "?"}`);
    return { ok: false, reason: "rejected", code: payload?.error };
  }
  // 403 IP_NOT_ALLOWED, 503 DATABASE_UNAVAILABLE, 500 INTERNAL_ERROR: to the page
  // they are all the same thing, but the real code must stay in the log.
  console.error(`[anagraphics] ${method} ${path}: HTTP ${response.status} ${payload?.error ?? "?"}`);
  return { ok: false, reason: "unavailable", code: payload?.error };
}

// GET /drivers → [{ uid, screen_name }, …]. The list does not contain usernames.
export async function listDrivers(settings) {
  const result = await readJson(settings, "/drivers", { operation: "list_drivers" });
  if (!result.ok) return result;
  return { ok: true, data: result.data.drivers ?? [] };
}

// GET /drivers/{uid} → { uid, username, screen_name }
export async function findDriver(settings, driverUid) {
  return readJson(settings, `/drivers/${encodeURIComponent(driverUid)}`, { operation: "find_driver" });
}

// GET /discounts/{code} → { discount_code, driver: { uid, screen_name }, percentage }
export async function findDiscount(settings, discountCode) {
  return readJson(settings, `/discounts/${encodeURIComponent(discountCode)}`, { operation: "find_discount" });
}

// GET /projects/{id} → the project, with `owner_uid`.
export async function findProject(settings, projectId) {
  return readJson(settings, `/projects/${encodeURIComponent(projectId)}`, { operation: "find_project" });
}

// POST /projects → the new project. The same `submission_id` a second time
// returns the project already created, not a new one.
export async function createProject(settings, { ownerUid, submissionId, review, billing }) {
  const created = await readJson(settings, "/projects", {
    method: "POST",
    body: { owner_uid: ownerUid, submission_id: submissionId, review, billing },
    operation: "create_project",
  });
  // **201 only.** A 200 is a submission that had already arrived: the project is already
  // there, and counting it again would be a project that does not exist. This is the
  // number the funnel is reconciled against, so it has to be the number of projects.
  if (created.ok && created.status === 201) {
    settings.metrics.measure("project.created", {
      dims: {
        autonomous_work: yesNo(billing?.autonomous_work),
        has_discount: yesNo(billing?.discount_code),
        has_ambassador: yesNo(billing?.ambassador_uid),
      },
      project_id: created.data?.project_id,
    });
  }
  return created;
}

// The vocabulary's two words for a thing that is either there or not.
function yesNo(value) {
  return value ? "yes" : "no";
}

// DELETE /projects/{id}: used only to undo a project left half-made.
export async function deleteProject(settings, projectId) {
  return readJson(settings, `/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
    operation: "delete_project",
  });
}

// POST /projects/{id}/pipeline/steps → the updated project.
// Appends a step to the pipeline and moves the project to the state the step
// says. When it happened is set by anagraphics.
export async function addPipelineStep(settings, projectId, { step, result, state, data, reason = null }) {
  const stored = await readJson(settings, `/projects/${encodeURIComponent(projectId)}/pipeline/steps`, {
    method: "POST",
    body: { step, result, state, data },
    operation: "add_pipeline_step",
  });
  // **Every gate of the pipeline decides through here**, so every one of them is counted
  // here: a gate added to the pipeline is measured the day it first decides something,
  // and nobody has to remember to count it. Only a decision that was really written is
  // counted — a step anagraphics refused is not a decision the project carries.
  //
  // `reason` is the name of the refusal, and only a decision that refuses has one. It is
  // passed by whoever decided, because where the reason lives is that decision's business
  // and not this function's. Absent is absent.
  if (stored.ok) {
    settings.metrics.measure("gate.decided", {
      dims: { gate: step, outcome: result, ...(reason ? { reason } : {}) },
      project_id: projectId,
    });
    // How long a gate was open, reported by the step that closes it — which is not
    // always a step of that same gate. Nothing is reported when nothing was open:
    // absent is absent, and a zero would be a gate that took no time.
    const finished = gateThatFinished(stored.data);
    if (finished !== null) {
      settings.metrics.measure("gate.duration", {
        dims: { gate: finished.gate },
        duration_ms: finished.durationMs,
        project_id: projectId,
      });
    }
  }
  return stored;
}

// Which gate has just finished, and how long it was open — read off the project
// anagraphics answered with. `{ gate, durationMs }`, or null when nothing finished.
//
// **The gate is the one that was open, not the one that is being written.** A step
// that is `open` has decided nothing and lasts, and the convention the whole pipeline
// runs on is that the step which comes after it is what closes it — and that step may
// belong to another gate entirely. The rounds of questions are opened by the
// preanalyst and closed by the analyst's own opening step, so naming the interval
// after the step that closes it filed the whole conversation under `analysis`, where
// it was added to the run's own minutes in the same bucket. Two different things
// under one name, and the longest wait in the pipeline — the one the client actually
// feels — had no bucket of its own at all.
//
// When the step before was already decided there is nothing to report: that interval
// is the dead time between two gates, which is real and is a different question from
// how long a gate took. A duration that means one thing here and another there is
// worse than one that is missing.
//
// `decided_at` is set where the step is stored, so both ends come from the same clock
// — ours would be a second one, and two clocks make a duration that is not a duration.
export function gateThatFinished(project) {
  const steps = project?.pipeline?.steps;
  if (!Array.isArray(steps) || steps.length < 2) return null;
  const opened = steps[steps.length - 2];
  if (opened?.result !== "open") return null;
  const at = (one) => {
    const moment = Date.parse(one?.decided_at ?? "");
    return Number.isFinite(moment) ? moment : null;
  };
  const closed = at(steps[steps.length - 1]);
  const since = at(opened);
  if (closed === null || since === null) return null;
  // A clock that stepped back would give a negative duration, which is not a fast
  // gate: it is a wrong number, and it is not reported.
  if (closed < since) return null;
  return { gate: opened.step, durationMs: closed - since };
}

// PATCH /projects/{id}/pipeline/steps/{step} → the updated project.
//
// It touches only the **last open step** with that name: `set` rewrites fields of
// `data`, `push` appends to lists. A step that has already decided something is
// not rewritten, and in that case the answer is `not_found`.
export async function updateOpenStep(settings, projectId, step, { set, push } = {}) {
  return readJson(settings, `/projects/${encodeURIComponent(projectId)}/pipeline/steps/${encodeURIComponent(step)}`, {
    method: "PATCH",
    body: { set: set ?? {}, push: push ?? {} },
    operation: "update_open_step",
  });
}

// GET /users/{username} → the user without credentials, with `billing`.
export async function findUser(settings, username) {
  return readJson(settings, `/users/${encodeURIComponent(username)}`, { operation: "find_user" });
}

// POST /users/{uid}/billing/turns/spend → the updated user.
//
// `rejected` with code `NOT_ENOUGH_TURNS` when the credit is not enough: the check
// lives inside the anagraphics write, so either everything was drawn or nothing
// was.
export async function spendUserTurns(settings, uid, turns) {
  return readJson(settings, `/users/${encodeURIComponent(uid)}/billing/turns/spend`, {
    method: "POST",
    body: { turns },
    operation: "spend_user_turns",
  });
}

// POST /users/{uid}/billing/turns/grant → the updated user.
//
// This is where the payment will arrive. Today only the fake purchase of the
// pre-analysis page arrives here (see the TODO in `src/server.js`).
export async function grantUserTurns(settings, uid, turns, { source = null } = {}) {
  const granted = await readJson(settings, `/users/${encodeURIComponent(uid)}/billing/turns/grant`, {
    method: "POST",
    body: { turns },
    operation: "grant_user_turns",
  });
  // Turns that became available, and where they came from. `source` is the caller's word —
  // a purchase, a fake one, the ones included — because this function cannot know why
  // somebody was given turns. A grant with no source is a refund putting back what was
  // drawn: an undo, not turns becoming available, and it is not counted.
  if (granted.ok && source) {
    settings.metrics.measure("turns.granted", { dims: { source }, count: turns });
  }
  return granted;
}
