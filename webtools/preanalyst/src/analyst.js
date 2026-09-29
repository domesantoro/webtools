// HTTP client towards webtools_analyst, which writes the analysis.
//
// Same contract as the other clients here: no exceptions towards the caller, but
// { ok: true, data } or { ok: false, reason, code }.
//
//   reason "rejected"     → 4xx: the project is not where a run can start, and asking
//                           again changes nothing until something else moves it
//   reason "unavailable"  → service unreachable, timeout, 5xx, 403, broken JSON
//
// One call is measured as a `dependency.call` towards `analyst`, with the outcomes the
// vocabulary closes.
//
// **It answers before the work is done.** A run is several model calls over minutes:
// `202` means the analyst has recorded that it has begun, not that there is an
// analysis. What happens next is read off the project, not waited for here.

// POST /projects/{id}/analysis → { project_id, started }.
export async function startAnalysis(settings, projectId) {
  const path = `/projects/${encodeURIComponent(projectId)}/analysis`;
  const elapsed = settings.metrics.timer();
  const report = (outcome) =>
    settings.metrics.measure("dependency.call", {
      dims: { target: "analyst", operation: "start_analysis", outcome },
      duration_ms: elapsed(),
    });

  let response;
  try {
    response = await fetch(`${settings.analystUrl}${path}`, {
      method: "POST",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(settings.analystTimeoutMs),
    });
  } catch (error) {
    console.error(`[analyst] POST ${path}: ${error.name} ${error.message}`);
    report(error.name === "TimeoutError" ? "timed_out" : "failed");
    return { ok: false, reason: "unavailable" };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    console.error(`[analyst] POST ${path}: response is not JSON (HTTP ${response.status})`);
    report("failed");
    return { ok: false, reason: "unavailable" };
  }

  if (response.ok) {
    report("ok");
    return { ok: true, data: body };
  }
  console.error(`[analyst] POST ${path}: HTTP ${response.status} ${body?.error ?? "?"}`);
  report(response.status === 404 ? "not_found" : "failed");
  if (response.status >= 400 && response.status < 500) {
    return { ok: false, reason: "rejected", code: body?.error };
  }
  return { ok: false, reason: "unavailable", code: body?.error };
}
