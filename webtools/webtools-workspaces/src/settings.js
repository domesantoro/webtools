// Settings, read at startup from the `workspaces` configuration in anagraphics
// (webtools/configurator/configuration/workspaces.json). No default values: if a
// field is missing, loadSettings throws ConfigurationError and the server does not
// start.

import os from "node:os";
import path from "node:path";

import { ConfigurationError, loadConfiguration } from "./commons/configuration_client.js";

export async function loadSettings() {
  const configuration = await loadConfiguration("workspaces");
  return {
    host: configuration.string("listen.host"),
    port: configuration.port("listen.port"),
    // An internal subsystem: it answers only callers from the pool's IPs. It is a
    // check on the connection's IP, not an authorisation.
    allowedIps: configuration.stringList("access.allowed_ips"),
    // The root of the workspaces. It sits outside the repo: these are the clients'
    // files, not code, and they must not end up in a commit.
    root: absoluteRoot(configuration.string("storage.root")),
    // A specification is text: 10 MB is already an awful lot.
    specMaxBytes: configuration.integer("storage.spec_max_bytes", { min: 1 }),
  };
}

// JSON does not expand `~`: it is done here, because the root sits in the home of
// whoever starts the server. A relative path would depend on the directory it was
// started from, and is not accepted.
function absoluteRoot(value) {
  const root = value === "~" || value.startsWith("~/") ? path.join(os.homedir(), value.slice(1)) : value;
  if (!path.isAbsolute(root)) {
    throw new ConfigurationError(`configuration of workspaces: storage.root must be absolute or start with ~/, found ${JSON.stringify(value)}`);
  }
  return root;
}
