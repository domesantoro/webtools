// HTTP client towards webtools_comm_center: telling a client about turns they lost.
//
// Same contract as the other clients here: no exceptions towards the caller, but
// { ok: true } or { ok: false, reason, code }.
//
//   reason "rejected"     → 400 or 422: the communication was missing something, and
//                           asking again with the same body changes nothing
//   reason "unavailable"  → service unreachable, timeout, 5xx, 403, broken JSON
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

// POST /communications/turns-lost — turns were drawn from somebody's credit and did not
// arrive on the project, and giving them back did not work either.
//
// It is the one thing said here about money already taken, and the person is at the
// screen while it happens: what they get from the page is that the purchase did not go
// through. What this adds is the part the page cannot promise — that their credit is
// short and somebody has it written down.
//
// `client` is the user document as anagraphics answered with it when the turns were
// drawn. Nothing is read again for it: that answer is the person, and a second read
// would be a second answer to the same question.
export async function turnsLost(settings, projectId, client, turns) {
  return tell(settings, "/communications/turns-lost", {
    operation: "turns_lost",
    body: {
      project_id: projectId,
      client: { uid: client.uid, screen_name: client.screen_name, username: client.username },
      turns,
    },
  });
}
