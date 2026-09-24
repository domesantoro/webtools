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

async function readJson(settings, path, { method = "GET", body } = {}) {
  const url = `${settings.anagraphicsUrl}${path}`;
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
    return { ok: false, reason: "unavailable" };
  }

  // 204: no body to read.
  if (response.status === 204) return { ok: true, data: null };

  let payload;
  try {
    payload = await response.json();
  } catch {
    console.error(`[anagraphics] ${method} ${path}: response is not JSON (HTTP ${response.status})`);
    return { ok: false, reason: "unavailable" };
  }

  if (response.ok) return { ok: true, data: payload, status: response.status };

  if (response.status === 404) {
    return { ok: false, reason: "not_found", code: payload?.error };
  }
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
  const result = await readJson(settings, "/drivers");
  if (!result.ok) return result;
  return { ok: true, data: result.data.drivers ?? [] };
}

// GET /drivers/{uid} → { uid, username, screen_name }
export async function findDriver(settings, driverUid) {
  return readJson(settings, `/drivers/${encodeURIComponent(driverUid)}`);
}

// GET /discounts/{code} → { discount_code, driver: { uid, screen_name }, percentage }
export async function findDiscount(settings, discountCode) {
  return readJson(settings, `/discounts/${encodeURIComponent(discountCode)}`);
}

// GET /projects/{id} → the project, with `owner_uid`.
export async function findProject(settings, projectId) {
  return readJson(settings, `/projects/${encodeURIComponent(projectId)}`);
}

// POST /projects → the new project. The same `submission_id` a second time
// returns the project already created, not a new one.
export async function createProject(settings, { ownerUid, submissionId, review, billing }) {
  return readJson(settings, "/projects", {
    method: "POST",
    body: { owner_uid: ownerUid, submission_id: submissionId, review, billing },
  });
}

// DELETE /projects/{id}: used only to undo a project left half-made.
export async function deleteProject(settings, projectId) {
  return readJson(settings, `/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
}

// POST /projects/{id}/pipeline/steps → the updated project.
// Appends a step to the pipeline and moves the project to the state the step
// says. When it happened is set by anagraphics.
export async function addPipelineStep(settings, projectId, { step, result, state, data }) {
  return readJson(settings, `/projects/${encodeURIComponent(projectId)}/pipeline/steps`, {
    method: "POST",
    body: { step, result, state, data },
  });
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
  });
}

// GET /users/{username} → the user without credentials, with `billing`.
export async function findUser(settings, username) {
  return readJson(settings, `/users/${encodeURIComponent(username)}`);
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
  });
}

// POST /users/{uid}/billing/turns/grant → the updated user.
//
// This is where the payment will arrive. Today only the fake purchase of the
// analysis page arrives here (see the TODO in `src/server.js`).
export async function grantUserTurns(settings, uid, turns) {
  return readJson(settings, `/users/${encodeURIComponent(uid)}/billing/turns/grant`, {
    method: "POST",
    body: { turns },
  });
}
