// From the configuration documents to what the page shows.
//
// Everything decided here is decided for **any** configuration document, not for
// the ones this system happens to have today: which subsystems exist, which
// branches they hold and how deep they go come out of the documents themselves.
// The two conventions used are the project's own, written in CLAUDE.md, not the
// shape of a particular file: amounts are integers in cents in fields ending in
// `_cents`, and durations are in fields ending in `_seconds` or `_ms`. They are
// used only to add a reading hint **beside** the value, never to replace it: what
// is stored is shown as it is stored.
//
// The page has no arithmetic and no logic of its own: it walks these structures.

import { isBranch, leafEntries } from "./leaves.js";

// --- values ---------------------------------------------------------------

function trim(number) {
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function humanDuration(seconds) {
  for (const [size, unit] of [[86400, "d"], [3600, "h"], [60, "min"]]) {
    if (seconds >= size) return `${trim(seconds / size)} ${unit}`;
  }
  // Under a minute the number of seconds already reads: a hint would add nothing.
  return null;
}

// A hint beside the value, or nothing. Nothing is the ordinary answer: the naming
// conventions hold for part of the fields, so a field without one is shown bare
// and no hint is invented for it.
export function readingHint(key, value) {
  if (!Number.isInteger(value)) return null;
  if (key.endsWith("_cents")) return `${(value / 100).toFixed(2)} €`;
  if (key.endsWith("_seconds")) return humanDuration(value);
  if (key.endsWith("_ms")) return value >= 1000 ? (humanDuration(value / 1000) ?? `${trim(value / 1000)} s`) : null;
  return null;
}

// → { type, text, items, hint, secret }. `type` is what the template branches on;
// every JSON type a configuration can hold has one, the empty cases included:
// an empty list and an absent list are different facts and read differently.
export function describeValue(key, value, { secret = false } = {}) {
  const described = { type: null, text: null, items: null, hint: null, secret };
  if (secret) {
    // The value is not shown and does not leave this process. Its length is,
    // because that is what tells a key that is there from a placeholder — and a
    // length is not a length unless the thing has one.
    return { ...described, type: "secret", text: typeof value === "string" ? `${value.length} characters` : null };
  }
  if (value === null) return { ...described, type: "null", text: "null" };
  if (typeof value === "boolean") return { ...described, type: "boolean", text: value ? "true" : "false" };
  if (typeof value === "number") return { ...described, type: "number", text: String(value), hint: readingHint(key, value) };
  if (typeof value === "string") {
    return value === "" ? { ...described, type: "empty-string" } : { ...described, type: "string", text: value };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return { ...described, type: "empty-list" };
    return { ...described, type: "list", items: value.map((item) => (item === null ? "null" : String(item))) };
  }
  // A plain object with nothing in it: buildRows sends the ones with something in
  // them down another way.
  return { ...described, type: "empty-object" };
}

// --- one document ---------------------------------------------------------

// The document flattened into rows to print, in the document's own order. Depth is
// carried on the row: the template indents, it does not recurse.
//
// `subsystem` is left out: it is the name of the section the rows are under, not a
// field of it.
export function buildRows(document, secretPaths = new Set()) {
  const rows = [];

  const walk = (value, key, path, depth) => {
    if (secretPaths.has(path)) {
      rows.push({ depth, key, path, kind: "leaf", value: describeValue(key, value, { secret: true }) });
      return;
    }
    if (isBranch(value)) {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        rows.push({ depth, key, path, kind: "leaf", value: describeValue(key, value) });
        return;
      }
      rows.push({ depth, key, path, kind: "branch", size: entries.length });
      for (const [childKey, childValue] of entries) {
        walk(childValue, childKey, `${path}.${childKey}`, depth + 1);
      }
      return;
    }
    // A list with objects inside it is not one value to print on a line: each item
    // is opened, by position. A list of strings or numbers stays one value.
    if (Array.isArray(value) && value.some(isBranch)) {
      rows.push({ depth, key, path, kind: "branch", size: value.length });
      value.forEach((item, index) => walk(item, `[${index}]`, `${path}.${index}`, depth + 1));
      return;
    }
    rows.push({ depth, key, path, kind: "leaf", value: describeValue(key, value) });
  };

  for (const [key, value] of Object.entries(document)) {
    if (key === "subsystem") continue;
    walk(value, key, key, 0);
  }
  return rows;
}

// Where a subsystem listens, if it listens. Not all of them do — anagraphics'
// address is in the bootstrap, not in its configuration — so this is optional and
// nothing is put in its place. No scheme is added either: the configuration does
// not say one, and http would be a guess.
export function listenAddress(document) {
  const host = document.listen?.host;
  const port = document.listen?.port;
  if (typeof host === "string" && host && Number.isInteger(port)) return `${host}:${port}`;
  return null;
}

// --- across the documents --------------------------------------------------

// The leaves that several subsystems hold with the same value: the general
// matters, worked out from the documents rather than listed by hand.
//
// A path that two subsystems hold with different values is not shared and does not
// appear — that is a divergence, not a common value. A path that is secret
// anywhere is left out entirely: its value is not compared and not shown.
export function sharedValues(configurations, secretsBySubsystem = new Map()) {
  const seen = new Map();
  for (const document of configurations) {
    const secretPaths = secretsBySubsystem.get(document.subsystem) ?? new Set();
    for (const [path, value] of leafEntries(document)) {
      if (path === "subsystem") continue;
      const entry = seen.get(path) ?? { path, value, subsystems: [], same: true, secret: false };
      if (secretPaths.has(path)) entry.secret = true;
      if (JSON.stringify(entry.value) !== JSON.stringify(value)) entry.same = false;
      entry.subsystems.push(document.subsystem);
      seen.set(path, entry);
    }
  }
  return [...seen.values()]
    .filter((entry) => entry.subsystems.length > 1 && entry.same && !entry.secret)
    .map((entry) => ({
      path: entry.path,
      subsystems: entry.subsystems,
      value: describeValue(entry.path.split(".").at(-1), entry.value),
    }))
    .sort((first, second) => first.path.localeCompare(second.path));
}

// --- the whole page --------------------------------------------------------

function twoDigits(number) {
  return String(number).padStart(2, "0");
}

export function readingTime(date) {
  return (
    `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())} ` +
    `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}`
  );
}

function anchorOf(name) {
  return `subsystem-${name.replace(/[^A-Za-z0-9]+/g, "-")}`;
}

// `secrets` is what readSecretPaths gave, `environment` is process.env, `readAt` a
// Date. With `failure` set, everything else is empty: the page says what did not
// work instead of showing half a reading.
export function buildView({ configurations = [], secrets, environment = {}, readAt, failure = null }) {
  const bootstrap = Object.keys(environment)
    .filter((name) => name.startsWith("WEBTOOLS_"))
    .sort()
    .map((name) => ({ name, value: environment[name] }));

  const subsystems = configurations.map((document) => {
    const secretPaths = secrets.bySubsystem.get(document.subsystem) ?? new Set();
    const rows = buildRows(document, secretPaths);
    const present = new Set(leafEntries(document).map(([path]) => path));
    return {
      name: document.subsystem,
      anchor: anchorOf(document.subsystem),
      listen: listenAddress(document),
      leaves: rows.filter((row) => row.kind === "leaf").length,
      secrets: rows.filter((row) => row.value?.secret).length,
      // A field a secrets file declares and the document does not hold: the key is
      // on disk and has not reached Mongo. Worth seeing — it usually means
      // load_configuration.sh has not been run since the file was written.
      secretsNotInMongo: [...secretPaths].filter((path) => !present.has(path)).sort(),
      rows,
    };
  });

  const known = new Set(subsystems.map((subsystem) => subsystem.name));
  return {
    readAt: readingTime(readAt),
    failure,
    bootstrap,
    subsystems,
    shared: sharedValues(configurations, secrets.bySubsystem),
    secrets: {
      available: secrets.available,
      reason: secrets.reason,
      problems: secrets.problems,
      // A secrets file whose subsystem has no configuration at all.
      orphans: [...secrets.bySubsystem.keys()].filter((name) => !known.has(name)).sort(),
    },
  };
}
