// Impostazioni, lette all'avvio dalla configurazione `workspaces` in anagraphics
// (webtools/configurator/configuration/workspaces.json). Niente valori di
// default: se manca un campo, loadSettings lancia ConfigurationError e il server
// non parte.

import os from "node:os";
import path from "node:path";

import { ConfigurationError, loadConfiguration } from "./commons/configuration_client.js";

export async function loadSettings() {
  const configuration = await loadConfiguration("workspaces");
  return {
    host: configuration.string("listen.host"),
    port: configuration.port("listen.port"),
    // Sottosistema interno: risponde solo a chi chiama dagli IP del pool.
    // È un controllo sull'IP della connessione, non un'autorizzazione.
    allowedIps: configuration.stringList("access.allowed_ips"),
    // La radice dei workspace. Sta fuori dal repo: sono i file dei clienti, non
    // codice, e non devono finire in un commit.
    root: absoluteRoot(configuration.string("storage.root")),
    // Una specifica è testo: 10 MB sono già moltissimi.
    specMaxBytes: configuration.integer("storage.spec_max_bytes", { min: 1 }),
  };
}

// Il JSON non espande `~`: lo si fa qui, perché la radice sta nella home di chi
// avvia il server. Un percorso relativo dipenderebbe dalla cartella di avvio, e
// non si accetta.
function absoluteRoot(value) {
  const root = value === "~" || value.startsWith("~/") ? path.join(os.homedir(), value.slice(1)) : value;
  if (!path.isAbsolute(root)) {
    throw new ConfigurationError(`configurazione di workspaces: storage.root deve essere assoluto o cominciare con ~/, trovato ${JSON.stringify(value)}`);
  }
  return root;
}
