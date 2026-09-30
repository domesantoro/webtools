// HTTP client towards webtools_comm_center: telling a client their request is closed.
//
// Same contract as the other clients here: no exceptions towards the caller, but
// { ok: true } or { ok: false, reason, code }.
//
//   reason "rejected"     → 400 or 422: the communication was missing something, and
//                           asking again with the same body changes nothing
//   reason "unavailable"  → service unreachable, timeout, 5xx, 403, broken JSON
//
// **A failure here undoes nothing.** The decision is written on the project and it is
// the driver's, taken and recorded; what is missing is the telling. Rolling a gate back
// because a message did not leave would make one person's decision depend on another
// subsystem answering.
//
// `202` from that side means taken, not delivered.

async function tell(settings, path, { operation, body }) {
  const elapsed = settings.metrics.timer();
  const report = (outcome) =>
    settings.metrics.measure("dependency.call", {
      dims: { target: "comm-center", operation, outcome },
      duration_ms: elapsed(),
    });

  let response;
  try {
    response = await fetch(`${settings.commCenterUrl}${path}`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(settings.commCenterTimeoutMs),
    });
  } catch (error) {
    console.error(`[comm-center] POST ${path}: ${error.name} ${error.message}`);
    report(error.name === "TimeoutError" ? "timed_out" : "failed");
    return { ok: false, reason: "unavailable" };
  }

  if (response.ok) {
    report("ok");
    return { ok: true };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  console.error(`[comm-center] POST ${path}: HTTP ${response.status} ${payload?.error ?? "?"}`);
  report("failed");
  if (response.status === 400 || response.status === 422) {
    return { ok: false, reason: "rejected", code: payload?.error };
  }
  return { ok: false, reason: "unavailable", code: payload?.error };
}

// POST /communications/analysis-refused — a driver read the analysis and closed the
// request.
//
// The motivation travels with it because it is the whole of what the client is owed at
// this gate: a refusal that arrived without it would be the communication sent empty,
// and the gate obliges the driver to write one (src/validation.js).
//
// `client` is the person as anagraphics answered with them — uid, screen name and the
// address — passed on as they came. The project keeps `owner_uid` and no copy of them,
// so whoever writes to a client reads them first.
export async function analysisRefused(settings, projectId, client, reason) {
  return tell(settings, "/communications/analysis-refused", {
    operation: "analysis_refused",
    body: {
      project_id: projectId,
      client: { uid: client.uid, screen_name: client.screen_name, username: client.username },
      reason,
    },
  });
}
