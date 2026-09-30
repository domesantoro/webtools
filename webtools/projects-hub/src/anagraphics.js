// HTTP client towards webtools_anagraphics: the projects, and a driver's discount
// codes.
//
// It raises no exceptions towards the caller: every call returns
// { ok: true, data } or { ok: false, reason }, because the page has to know *how* it
// went wrong, not only that it went wrong.
//
//   reason "not_found"    → the API answered 404 with its own error code
//   reason "rejected"     → 400 or 409: the request was wrong, retrying does not help
//   reason "unavailable"  → service unreachable, timeout, 5xx, 403, broken JSON
//
// Anagraphics' error responses are { "error": "<CODE>" }: the code is compared, never
// the text.
//
// **Every call through here is measured**, once, as a `dependency.call`. It is the one
// place this subsystem talks to anagraphics, so a measurement here covers every call
// there is and one added later needs nothing but its own name. `operation` is that
// name: a stable word each helper gives, never the path — a path carries uids and
// project ids, and a bucket per identifier would make the number of documents grow
// with the traffic instead of with the number of kinds of thing measured.
//
// Four outcomes, because they are four different things to do about it: `ok`, `failed`,
// `timed_out` (it may well still be working) and `not_found`, which is an answer and
// not a fault.

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
    console.error(`[anagraphics] ${method} ${path}: ${error.name} ${error.message}`);
    // We gave up waiting, or there was nothing at the other end: two facts, and in a log
    // they look alike.
    report(error.name === "TimeoutError" ? "timed_out" : "failed");
    return { ok: false, reason: "unavailable" };
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
  console.error(`[anagraphics] ${method} ${path}: HTTP ${response.status} ${payload?.error ?? "?"}`);
  if (response.status === 400 || response.status === 409) {
    return { ok: false, reason: "rejected", code: payload?.error };
  }
  // 403 IP_NOT_ALLOWED, 503 DATABASE_UNAVAILABLE, 500 INTERNAL_ERROR: to the page they
  // are all the same thing, but the real code must stay in the log.
  return { ok: false, reason: "unavailable", code: payload?.error };
}

// GET /projects?<one filter> → the projects, newest first.
//
// Exactly one of the three filters travels, because that is what the route accepts: two
// of them together is a `400`, and so is none. `states` is optional and narrows any of
// them; it is built by the caller out of `src/projects.js`, where the rules about which
// states matter live.
export async function listProjects(settings, { ownerUid, driverUid, withoutDriver, states } = {}) {
  const query = new URLSearchParams();
  if (ownerUid !== undefined) query.set("owner_uid", ownerUid);
  if (driverUid !== undefined) query.set("driver_uid", driverUid);
  if (withoutDriver) query.set("without_driver", "true");
  for (const state of states ?? []) query.append("state", state);

  const result = await readJson(settings, `/projects?${query}`, { operation: "list_projects" });
  if (!result.ok) return result;
  return { ok: true, data: result.data.projects ?? [] };
}

// GET /projects/{id} → the project, whole, with `owner_uid` and `review.driver`.
//
// Asked for by the download route, which has one project to settle a question about:
// whose it is. The list routes would answer it too, by fetching every project of a person
// and looking for one in the answer — a read that grows with how many projects they have
// in order to decide one thing.
export async function findProject(settings, projectId) {
  return readJson(settings, `/projects/${encodeURIComponent(projectId)}`, { operation: "find_project" });
}

// GET /drivers/{uid}/discounts → the codes this driver already has.
// A driver who exists and has none answers with an empty list; one who does not exist
// answers `not_found`.
export async function listDiscounts(settings, driverUid) {
  const result = await readJson(settings, `/drivers/${encodeURIComponent(driverUid)}/discounts`, {
    operation: "list_discounts",
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data.discounts ?? [] };
}

// POST /drivers/{uid}/discounts → the code just created.
//
// The code and the driver's name are written by anagraphics, not chosen here: the
// drivers live there. What this subsystem decides is the percentage, and whether that
// percentage is one we are willing to give away — which is read from our own
// configuration and checked before the call (src/links.js).
export async function createDiscount(settings, driverUid, percentage) {
  return readJson(settings, `/drivers/${encodeURIComponent(driverUid)}/discounts`, {
    method: "POST",
    body: { percentage },
    operation: "create_discount",
  });
}

// POST /projects/{id}/pipeline/steps → the project as it is afterwards.
//
// One write for two facts: the step is appended and the project moves to the state the
// step says, so there is no moment in which the step is there and the state is still the
// previous one. `decided_at` is anagraphics', not ours: the caller does not choose when
// something happened.
//
// **This subsystem's one gate decides through here, so it is counted here**: nobody has
// to remember to count a decision, and a step anagraphics refused is not counted at all,
// because a decision the project does not carry is not a decision.
//
// `reason` is the **name** of a refusal, from a list somebody can act on, and only a
// decision that refuses has one. The driver's refusal has no such name — what it has is
// a sentence they wrote, which lives on the step and would open a bucket of its own for
// every refusal if it came here. So this gate passes none, and absent is absent.
export async function addPipelineStep(settings, projectId, { step, result, state, data, reason = null }) {
  const stored = await readJson(settings, `/projects/${encodeURIComponent(projectId)}/pipeline/steps`, {
    method: "POST",
    body: { step, result, state, data },
    operation: "add_pipeline_step",
  });
  if (!stored.ok) return stored;

  settings.metrics.measure("gate.decided", {
    dims: { gate: step, outcome: result, ...(reason ? { reason } : {}) },
    project_id: projectId,
  });
  // How long a gate was open, reported by the step that closes it — which is not always
  // a step of that same gate. Nothing is reported when nothing was open: absent is
  // absent, and a zero would be a gate that took no time.
  const finished = gateThatFinished(stored.data);
  if (finished !== null) {
    settings.metrics.measure("gate.duration", {
      dims: { gate: finished.gate },
      duration_ms: finished.durationMs,
      project_id: projectId,
    });
  }
  return stored;
}

// Which gate has just finished, and how long it was open — read off the project
// anagraphics answered with. `{ gate, durationMs }`, or null when nothing finished.
//
// **The gate is the one that was open, not the one being written.** A step that is
// `open` has decided nothing and lasts, and the convention the whole pipeline runs on is
// that the step which comes after it is what closes it — and that step may belong to
// another gate entirely. Here the two happen to be the same: the analyst opens
// `driver_validation` when it hands the project over, and the driver's decision closes
// it, so what this reports is the time an analysis spent on a person's desk.
//
// When the step before was already decided there is nothing to report: that interval is
// the dead time between two gates, which is real and is a different question from how
// long a gate took. A duration that means one thing here and another there is worse than
// one that is missing — and a project handed over before the gate was ever opened has
// exactly that shape, so it reports nothing rather than the wrong thing.
//
// `decided_at` is set where the step is stored, so both ends come from the same clock:
// ours would be a second one, and two clocks make a duration that is not a duration.
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
  // A clock that stepped back would give a negative duration, which is not a fast gate:
  // it is a wrong number, and it is not reported.
  if (closed < since) return null;
  return { gate: opened.step, durationMs: closed - since };
}

// GET /users?uid= → the person, without the credential block.
//
// The project keeps `owner_uid` and no copy of its owner, so this is how a page that
// has something to say to the client learns where they are reached. `not_found` is an
// answer here like anywhere else: an account can have gone between the project being
// made and now.
export async function findUser(settings, uid) {
  return readJson(settings, `/users?uid=${encodeURIComponent(uid)}`, { operation: "find_user" });
}
