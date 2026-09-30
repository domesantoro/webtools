// HTTP client towards webtools-workspaces, which holds the project files.
//
// Same contract as the anagraphics client: no exceptions towards the caller, but
// { ok: true, data } or { ok: false, reason }.
//
//   reason "not_found"    → there is no document of that kind for that project
//   reason "unavailable"  → unreachable, timed out, 5xx, 403, anything else
//
// Every call is measured as a `dependency.call` towards `workspaces`, with the four
// outcomes the vocabulary closes: `ok`, `failed`, `timed_out` — we gave up waiting,
// which is not the same as nothing being there — and `not_found`, which is an answer.
//
// **It stores and does not decide.** Workspaces sits behind its own pool of IPs and
// knows nothing about who is asking: whose document this is, and whether that person may
// have it, is settled before the call (src/server.js).

// GET /projects/{id}/documents/{kind}/latest → the .md of the last version stored.
export async function latestDocument(settings, projectId, kind) {
  const path = `/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(kind)}/latest`;
  const elapsed = settings.metrics.timer();
  const report = (outcome) =>
    settings.metrics.measure("dependency.call", {
      dims: { target: "workspaces", operation: "latest_document", outcome },
      duration_ms: elapsed(),
    });

  let response;
  try {
    response = await fetch(`${settings.workspacesUrl}${path}`, {
      headers: { accept: "text/markdown" },
      signal: AbortSignal.timeout(settings.workspacesTimeoutMs),
    });
  } catch (error) {
    console.error(`[workspaces] GET ${path}: ${error.name} ${error.message}`);
    report(error.name === "TimeoutError" ? "timed_out" : "failed");
    return { ok: false, reason: "unavailable" };
  }

  if (response.status === 404) {
    // A project whose analysis was never written, or never got that far. It answered,
    // and that is the answer.
    report("not_found");
    return { ok: false, reason: "not_found" };
  }
  if (!response.ok) {
    console.error(`[workspaces] GET ${path}: HTTP ${response.status}`);
    report("failed");
    return { ok: false, reason: "unavailable" };
  }
  report("ok");
  return { ok: true, data: await response.text() };
}
