// Client HTTP verso webtools-workspaces, che conserva i file dei progetti.
//
// Stesso contratto del client di anagraphics: niente eccezioni verso il
// chiamante, ma { ok: true, data } oppure { ok: false, reason, code }.
//
//   reason "rejected"     → 400 o 413: il file non va bene, riprovare non serve
//   reason "unavailable"  → servizio irraggiungibile, timeout, 5xx, 403, JSON rotto

// POST /projects/{id}/specs → { project_id, version }.
// L'origine la decide chi chiama, dal canale da cui il file è arrivato: il
// servizio la scrive nel front matter sopra a quello che il file dichiara.
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
    console.error(`[workspaces] POST ${path}: risposta non JSON (HTTP ${response.status})`);
    return { ok: false, reason: "unavailable" };
  }

  if (response.ok) return { ok: true, data: body };
  console.error(`[workspaces] POST ${path}: HTTP ${response.status} ${body?.error ?? "?"}`);
  if (response.status === 400 || response.status === 413) {
    return { ok: false, reason: "rejected", code: body?.error };
  }
  return { ok: false, reason: "unavailable", code: body?.error };
}
