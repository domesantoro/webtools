// Which configuration fields are secret, and why they are.
//
// The secrets (API keys and the like) live in `webtools/configurator/secrets/`,
// one file per subsystem, outside git. `load_configuration.sh` deep-merges them
// onto the seed before writing the document into Mongo: the subsystem reads one
// configuration and does not know that a piece of it was secret.
//
// So a field is secret **because it comes from there**, not because of what it is
// called. What is read here is the shape of those files — the paths of their
// leaves — never their values: a `client_id` written in a secrets file is masked
// like a key, and an `api_key` written in `configuration/` is not masked, because
// it is in git and is not a secret at all.
//
// If the folder is not there — a fresh clone, a machine with no keys — nothing is
// known to be secret and nothing is masked. Absent is absent: the page says so, so
// that nobody reads an unmasked page as a page with no secrets in it.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { leafEntries } from "./leaves.js";

// → { available, reason, bySubsystem: Map<subsystem, Set<path>>, problems: [] }
//
// `available` says whether the folder was read; `reason` why it was not. A single
// unreadable file does not stop the rest: it ends up in `problems` and the page
// shows it, because a file that cannot be read is a subsystem whose secrets are
// not masked, and that has to be visible.
export async function readSecretPaths(directory) {
  let entries;
  try {
    entries = await readdir(directory);
  } catch (error) {
    return {
      available: false,
      reason: `${directory}: ${error.code ?? error.message}`,
      bySubsystem: new Map(),
      problems: [],
    };
  }

  const bySubsystem = new Map();
  const problems = [];
  for (const entry of entries.sort()) {
    // Only `<subsystem>.json`: `README.md` and the `*.json.example` files are in
    // git and say nothing about what is secret here.
    if (!entry.endsWith(".json")) continue;
    const subsystem = entry.slice(0, -".json".length);
    const file = path.join(directory, entry);
    try {
      const document = JSON.parse(await readFile(file, "utf8"));
      if (document === null || typeof document !== "object" || Array.isArray(document)) {
        problems.push(`${entry}: does not hold a JSON object`);
        continue;
      }
      bySubsystem.set(subsystem, new Set(leafEntries(document).map(([leaf]) => leaf)));
    } catch (error) {
      problems.push(`${entry}: ${error.message}`);
    }
  }
  return { available: true, reason: null, bySubsystem, problems };
}
