// Reading webtools_metrics. The only source of everything the pages show.
//
//   GET /metrics/<question>?from=&to=   one of the questions metrics answers
//   GET /metrics/daily?from=&to=&metric= the buckets the aggregates are computed from
//   GET /metrics/projects/{id}          one project's accumulator
//   GET /vocabulary                     what may be sent
//
// **Nothing here throws.** A dashboard is opened precisely when something is not
// answering, so a metrics that is down has to become a sentence on the page and
// not a stack trace in a log. Every outcome is a real answer:
//
//   unreachable   nothing came back: no connection, or it took too long
//   refused       it answered, with a status that is not a success, and a code
//   not_json      it answered something that is not JSON
//   malformed     it is JSON, and it is not what the route promises
//   not_found     the thing asked for is not there (a project id nobody used)
//
// They are five because they call for five different things to be done, and one
// word for all of them is how a dashboard stops knowing what happens to it.
//
// The fifth is not like the other four: `not_found` is a **definite answer** —
// metrics answered, and what it said is that there is no such thing. So it carries
// `isAnswer`, and the page that asked is the one that says it, instead of the page's
// banner reporting a reading it could not use. A project nobody ever measured is not
// a metrics that failed.
//
// **The shape is checked here, at the boundary.** Below `from`/`to`/`days`/
// `truncated` nothing is required: a question that measured nothing answers a
// payload with keys missing, and a key that is missing is missing — the views put
// nothing in its place.

export const UNREACHABLE = "unreachable";
export const REFUSED = "refused";
export const NOT_JSON = "not_json";
export const MALFORMED = "malformed";
export const NOT_FOUND = "not_found";

function failure(reason, detail, extra = {}) {
  return { ok: false, reason, detail, ...extra };
}

// One GET, with every outcome named. `check` is the contract of that route: it
// returns null when the body keeps the route's promise, and the sentence saying
// what is wrong when it does not.
async function get(settings, path, parameters, check) {
  const query = parameters ? `?${new URLSearchParams(parameters)}` : "";
  const url = `${settings.metricsUrl}${path}${query}`;

  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(settings.metricsTimeoutMs),
    });
  } catch (error) {
    return failure(UNREACHABLE, `GET ${url}: ${error.name} ${error.message}`);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return failure(NOT_JSON, `GET ${url}: the answer is not JSON (HTTP ${response.status})`);
  }
  // The stable code metrics answers errors with. It is what says **which**
  // mistake it was, so it is carried up as it arrived, not folded into the status.
  const code = typeof body?.error === "string" ? body.error : null;
  if (!response.ok) {
    const notFound = response.status === 404;
    return failure(notFound ? NOT_FOUND : REFUSED, `GET ${url}: HTTP ${response.status} ${code ?? "?"}`, {
      status: response.status,
      code,
      isAnswer: notFound,
    });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return failure(MALFORMED, `GET ${url}: the answer is not an object`);
  }
  const wrong = check(body);
  if (wrong) return failure(MALFORMED, `GET ${url}: ${wrong}`);
  return { ok: true, answer: body };
}

// What every answer about a period carries. Without these four a figure cannot be
// used: a number without its period is not a measurement, and a number that does
// not say whether the rows ran out is half a truth told as a whole one.
function periodContract(body) {
  for (const field of ["from", "to"]) {
    if (typeof body[field] !== "string" || !body[field]) return `the answer has no '${field}'`;
  }
  if (!Number.isInteger(body.days)) return "the answer has no 'days'";
  if (typeof body.truncated !== "boolean") return "the answer has no 'truncated'";
  return null;
}

export function readQuestion(settings, question, period) {
  return get(settings, `/metrics/${question}`, { from: period.from, to: period.to }, periodContract);
}

// The buckets themselves. `metric` narrows them to one name; without it they are
// every metric of the period, which is what a picture over time is drawn from.
export function readDaily(settings, period, metric = null) {
  const parameters = { from: period.from, to: period.to };
  if (metric) parameters.metric = metric;
  return get(settings, "/metrics/daily", parameters, (body) => {
    const wrong = periodContract(body);
    if (wrong) return wrong;
    return Array.isArray(body.rows) ? null : "the answer has no 'rows' list";
  });
}

// One project's accumulator. Not a period: an accumulator is everything that
// project ever did.
export function readProject(settings, projectId) {
  return get(settings, `/metrics/projects/${encodeURIComponent(projectId)}`, null, (body) =>
    typeof body.project_id === "string" && body.project_id ? null : "the answer has no 'project_id'"
  );
}

// What may be sent. Read for two reasons: to say which metrics exist even when
// none of them has been measured yet, and to turn a stored field name back into
// the metric's real name (a project's document holds `preanalysis_turn`, and only
// this list says it is `preanalysis.turn`).
export function readVocabulary(settings) {
  return get(settings, "/vocabulary", null, (body) => {
    if (!Array.isArray(body.subsystems)) return "the answer has no 'subsystems' list";
    if (body.metrics === null || typeof body.metrics !== "object" || Array.isArray(body.metrics)) {
      return "the answer has no 'metrics' object";
    }
    return null;
  });
}

// Several readings at once. A page asks two or three questions, and asking them
// one after the other would make it as slow as their sum for no reason. Each
// answer keeps its own outcome: one question that failed does not take the page
// down with it.
export async function readAll(readings) {
  const names = Object.keys(readings);
  const results = await Promise.all(names.map((name) => readings[name]));
  return Object.fromEntries(names.map((name, index) => [name, results[index]]));
}
