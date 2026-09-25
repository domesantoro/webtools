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

// → { ok: true, configurations } | { ok: false, error }
//
// It does not throw: whoever asked wants a page that says what went wrong, not a
// stack trace. A configurator's front end that cannot reach anagraphics is exactly
// the moment somebody is looking at it.
export async function readConfigurations(settings) {
  const url = `${settings.anagraphicsUrl}/configuration`;

  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(settings.anagraphicsTimeoutMs),
    });
  } catch (error) {
    return { ok: false, error: `GET ${url}: ${error.name} ${error.message}` };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: `GET ${url}: the answer is not JSON (HTTP ${response.status})` };
  }
  if (!response.ok) {
    return { ok: false, error: `GET ${url}: HTTP ${response.status} ${body?.error ?? "?"}` };
  }

  const configurations = body?.configurations;
  if (!Array.isArray(configurations)) {
    return { ok: false, error: `GET ${url}: the answer has no 'configurations' list` };
  }
  for (const document of configurations) {
    if (document === null || typeof document !== "object" || Array.isArray(document)) {
      return { ok: false, error: `GET ${url}: a configuration is not an object` };
    }
    if (typeof document.subsystem !== "string" || !document.subsystem) {
      return { ok: false, error: `GET ${url}: a configuration has no 'subsystem'` };
    }
  }
  return { ok: true, configurations };
}
