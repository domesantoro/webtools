// Client HTTP verso webtools_anagraphics.
//
// Non solleva eccezioni verso il chiamante: ogni chiamata restituisce
// { ok: true, data } oppure { ok: false, reason }, perché la pagina deve
// sapere *come* è andata male, non solo che è andata male.
//
//   reason "not_found"    → l'API ha risposto 404 con il suo codice d'errore
//   reason "rejected"     → 400 o 409: la richiesta era sbagliata, riprovare non serve
//   reason "unavailable"  → servizio irraggiungibile, timeout, 5xx, 403, JSON rotto
//
// Le risposte d'errore di anagraphics sono { "error": "<CODICE>" }: si confronta
// il codice, mai il testo.

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
    // Servizio spento, DNS, rete, timeout del client.
    console.error(`[anagraphics] ${method} ${path}: ${error.name} ${error.message}`);
    return { ok: false, reason: "unavailable" };
  }

  // 204: niente corpo da leggere.
  if (response.status === 204) return { ok: true, data: null };

  let risposta;
  try {
    risposta = await response.json();
  } catch {
    console.error(`[anagraphics] ${method} ${path}: risposta non JSON (HTTP ${response.status})`);
    return { ok: false, reason: "unavailable" };
  }

  if (response.ok) return { ok: true, data: risposta, status: response.status };

  if (response.status === 404) {
    return { ok: false, reason: "not_found", code: risposta?.error };
  }
  if (response.status === 400 || response.status === 409) {
    console.error(`[anagraphics] ${method} ${path}: HTTP ${response.status} ${risposta?.error ?? "?"}`);
    return { ok: false, reason: "rejected", code: risposta?.error };
  }
  // 403 IP_NOT_ALLOWED, 503 DATABASE_UNAVAILABLE, 500 INTERNAL_ERROR: per la
  // pagina sono tutti la stessa cosa, ma nel log deve restare il codice vero.
  console.error(`[anagraphics] ${method} ${path}: HTTP ${response.status} ${risposta?.error ?? "?"}`);
  return { ok: false, reason: "unavailable", code: risposta?.error };
}

// GET /drivers → [{ uid, screen_name }, …]. La lista non contiene username.
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

// GET /projects/{id} → il progetto, con `owner_uid`.
export async function findProject(settings, projectId) {
  return readJson(settings, `/projects/${encodeURIComponent(projectId)}`);
}

// POST /projects → il progetto nuovo. Lo stesso `submission_id` una seconda
// volta restituisce il progetto già creato, non uno nuovo.
export async function createProject(settings, { ownerUid, submissionId, review, billing }) {
  return readJson(settings, "/projects", {
    method: "POST",
    body: { owner_uid: ownerUid, submission_id: submissionId, review, billing },
  });
}

// DELETE /projects/{id}: si usa solo per disfare un progetto rimasto a metà.
export async function deleteProject(settings, projectId) {
  return readJson(settings, `/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
}

// POST /projects/{id}/pipeline/steps → il progetto aggiornato.
// Accoda un passo alla pipeline e porta il progetto nello stato che il passo
// dice. Quando è successo lo mette anagraphics.
export async function addPipelineStep(settings, projectId, { step, result, state, data }) {
  return readJson(settings, `/projects/${encodeURIComponent(projectId)}/pipeline/steps`, {
    method: "POST",
    body: { step, result, state, data },
  });
}
