// Client HTTP verso webtools_anagraphics.
//
// Non solleva eccezioni verso il chiamante: ogni lettura restituisce
// { ok: true, data } oppure { ok: false, reason }, perché la pagina deve
// sapere *come* è andata male, non solo che è andata male.
//
//   reason "not_found"    → l'API ha risposto 404 con il suo codice d'errore
//   reason "unavailable"  → servizio irraggiungibile, timeout, 5xx, 403, JSON rotto
//
// Le risposte d'errore di anagraphics sono { "error": "<CODICE>" }: si confronta
// il codice, mai il testo.

async function readJson(settings, path) {
  const url = `${settings.anagraphicsUrl}${path}`;
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(settings.anagraphicsTimeoutMs),
    });
  } catch (error) {
    // Servizio spento, DNS, rete, timeout del client.
    console.error(`[anagraphics] ${path}: ${error.name} ${error.message}`);
    return { ok: false, reason: "unavailable" };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    console.error(`[anagraphics] ${path}: risposta non JSON (HTTP ${response.status})`);
    return { ok: false, reason: "unavailable" };
  }

  if (response.ok) return { ok: true, data: body };

  if (response.status === 404) {
    return { ok: false, reason: "not_found", code: body?.error };
  }
  // 403 IP_NOT_ALLOWED, 503 DATABASE_UNAVAILABLE, 500 INTERNAL_ERROR: per la
  // pagina sono tutti la stessa cosa, ma nel log deve restare il codice vero.
  console.error(`[anagraphics] ${path}: HTTP ${response.status} ${body?.error ?? "?"}`);
  return { ok: false, reason: "unavailable", code: body?.error };
}

// GET /drivers → [{ uid, screen_name }, …]. La lista non contiene username.
export async function listDrivers(settings) {
  const result = await readJson(settings, "/drivers");
  if (!result.ok) return result;
  return { ok: true, data: result.data.drivers ?? [] };
}

// GET /discounts/{code} → { discount_code, driver: { uid, screen_name }, percentage }
export async function findDiscount(settings, discountCode) {
  return readJson(settings, `/discounts/${encodeURIComponent(discountCode)}`);
}
