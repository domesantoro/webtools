// HTTP client towards webtools-workspaces, which stores the project files.
//
// Same contract as the anagraphics client: no exceptions towards the caller, but
// { ok: true, data } or { ok: false, reason, code }.
//
//   reason "rejected"     → 400 or 413: the file is no good, retrying does not help
//   reason "unavailable"  → service unreachable, timeout, 5xx, 403, broken JSON

// POST /projects/{id}/specs → { project_id, version }.
// The origin is decided by the caller, from the channel the file arrived through:
// the service writes it into the front matter, over whatever the file declares.
export async function storeSpec(settings, projectId, text, { origin, uploadedBy }) {
  const path = `/projects/${encodeURIComponent(projectId)}/specs`;
  let response;
  try {
    response = await fetch(`${settings.workspacesUrl}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "text/markdown; charset=utf-8",
        "x-spec-origin": origin,
        "x-uploaded-by": uploadedBy,
      },
      body: text,
      signal: AbortSignal.timeout(settings.workspacesTimeoutMs),
    });
  } catch (error) {
    console.error(`[workspaces] POST ${path}: ${error.name} ${error.message}`);
    return { ok: false, reason: "unavailable" };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    console.error(`[workspaces] POST ${path}: response is not JSON (HTTP ${response.status})`);
    return { ok: false, reason: "unavailable" };
  }

  if (response.ok) return { ok: true, data: body };
  console.error(`[workspaces] POST ${path}: HTTP ${response.status} ${body?.error ?? "?"}`);
  if (response.status === 400 || response.status === 413) {
    return { ok: false, reason: "rejected", code: body?.error };
  }
  return { ok: false, reason: "unavailable", code: body?.error };
}

// GET /projects/{id}/specs/latest → the .md of the last specification stored.
// It is for whoever has to read again what the user sent: the rejection page
// turns it into a PDF. The caller has already checked whose project it is:
// workspaces stores and does not decide.
export async function latestSpec(settings, projectId) {
  const path = `/projects/${encodeURIComponent(projectId)}/specs/latest`;
  let response;
  try {
    response = await fetch(`${settings.workspacesUrl}${path}`, {
      headers: { accept: "text/markdown" },
      signal: AbortSignal.timeout(settings.workspacesTimeoutMs),
    });
  } catch (error) {
    console.error(`[workspaces] GET ${path}: ${error.name} ${error.message}`);
    return { ok: false, reason: "unavailable" };
  }

  if (response.status === 404) return { ok: false, reason: "not_found" };
  if (!response.ok) {
    console.error(`[workspaces] GET ${path}: HTTP ${response.status}`);
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, data: await response.text() };
}
