// Reading the configuration of every subsystem from anagraphics.
//
//   GET /configuration → { configurations: [ …one document per subsystem… ] }
//
// It is the only source: the list of the subsystems that exist is in Mongo, not
// here. A subsystem that no longer has a seed file in
// `webtools/configurator/configuration/` is in that list all the same, and it must
// be shown — what lives is the collection, not the files.
//
// The shape of the answer is checked here, at the boundary with anagraphics: a
// body that is not what the route promises is a failure with a message, not a page
// rendered from half a reply.
//
// **Both calls are measured**, once each, as a `dependency.call` — the same
// convention as the clients of the preanalyst, the analyst, the drivers' pool and
// the sso. `operation` is a stable word, never the path: a path here carries a
// subsystem's name, and while that list is short today it is not this file's to fix
// the size of.
//
// There are only two calls and no shared `request()` between them: they check
// different shapes and answer different things, and the duplication is two lines of
// measurement rather than a wrapper that would have to take both shapes.

function reported(settings, operation) {
  const elapsed = settings.metrics.timer();
  return (outcome) =>
    settings.metrics.measure("dependency.call", {
      dims: { target: "anagraphics", operation, outcome },
      duration_ms: elapsed(),
    });
}

// → { ok: true, configurations } | { ok: false, error }
//
// It does not throw: whoever asked wants a page that says what went wrong, not a
// stack trace. A configurator's front end that cannot reach anagraphics is exactly
// the moment somebody is looking at it.
export async function readConfigurations(settings) {
  const url = `${settings.anagraphicsUrl}/configuration`;
  const report = reported(settings, "read_configurations");

  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(settings.anagraphicsTimeoutMs),
    });
  } catch (error) {
    // We gave up waiting, or there was nothing at the other end: two facts, and in a
    // log they look alike.
    report(error.name === "TimeoutError" ? "timed_out" : "failed");
    return { ok: false, error: `GET ${url}: ${error.name} ${error.message}` };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    report("failed");
    return { ok: false, error: `GET ${url}: the answer is not JSON (HTTP ${response.status})` };
  }
  if (!response.ok) {
    report(response.status === 404 ? "not_found" : "failed");
    return { ok: false, error: `GET ${url}: HTTP ${response.status} ${body?.error ?? "?"}` };
  }

  const configurations = body?.configurations;
  if (!Array.isArray(configurations)) {
    // It answered and what came back is not what the route promises. That is a
    // failure of the call, not a page with nothing on it.
    report("failed");
    return { ok: false, error: `GET ${url}: the answer has no 'configurations' list` };
  }
  for (const document of configurations) {
    if (document === null || typeof document !== "object" || Array.isArray(document)) {
      report("failed");
      return { ok: false, error: `GET ${url}: a configuration is not an object` };
    }
    if (typeof document.subsystem !== "string" || !document.subsystem) {
      report("failed");
      return { ok: false, error: `GET ${url}: a configuration has no 'subsystem'` };
    }
  }
  report("ok");
  return { ok: true, configurations };
}

// Writing one provider object's price.
//
//   PUT /configuration/{subsystem}/pricing
//   { provider_path, currency, cents_per_million_tokens: { <kind>: <hundredths> } }
//
// That route writes the `pricing` key of a provider object and nothing else:
// this front end cannot change any other field, and the check on which paths are
// provider objects is anagraphics', not this page's — the document is there, not
// here.
//
// → { ok: true, pricing } | { ok: false, error }
//
// It does not throw either: a write that did not happen is a sentence on the
// page, next to the form it came from. `error` is the stable code anagraphics
// answered with wherever there is one, because that is what says **which**
// mistake it was.
export async function writePricing(settings, { subsystem, providerPath, currency, centsPerMillionTokens }) {
  const url = `${settings.anagraphicsUrl}/configuration/${encodeURIComponent(subsystem)}/pricing`;
  const report = reported(settings, "write_pricing");

  let response;
  try {
    response = await fetch(url, {
      method: "PUT",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        provider_path: providerPath,
        currency,
        cents_per_million_tokens: centsPerMillionTokens,
      }),
      signal: AbortSignal.timeout(settings.anagraphicsTimeoutMs),
    });
  } catch (error) {
    report(error.name === "TimeoutError" ? "timed_out" : "failed");
    return { ok: false, error: `${error.name} ${error.message}` };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    report("failed");
    return { ok: false, error: `the answer is not JSON (HTTP ${response.status})` };
  }
  if (!response.ok) {
    // A `404` here is a subsystem or a provider path that is not there — an answer,
    // and the page says which. It is not anagraphics failing.
    report(response.status === 404 ? "not_found" : "failed");
    return { ok: false, error: `HTTP ${response.status} ${body?.error ?? "?"}` };
  }
  // The route answers with what it wrote. A body without it is an answer that
  // does not keep its promise, and it is not read as a write that happened.
  if (body?.pricing === null || typeof body?.pricing !== "object") {
    report("failed");
    return { ok: false, error: "the answer has no 'pricing'" };
  }
  report("ok");
  return { ok: true, pricing: body.pricing };
}
