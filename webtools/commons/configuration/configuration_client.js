// Client della configurazione: legge da webtools_anagraphics la configurazione
// di un sottosistema, all'avvio.
//
//   GET /configuration/{subsystem} → { subsystem, …il documento strutturato… }
//
// ORIGINALE in webtools/commons/configuration/. Nei sottosistemi ce n'è una
// copia generata dal deployer (webtools/configurator/deploy.sh configuration):
// si modifica qui e si rilancia il deployer, mai la copia.
//
// Niente valori di default: un sottosistema senza configurazione, o con un
// campo mancante o sbagliato, non parte. `loadConfiguration` lancia
// ConfigurationError, e chi avvia il server scrive il messaggio ed esce.
//
// Dall'ambiente arrivano soltanto le due cose che non possono stare nella
// configurazione, perché servono a leggerla (webtools/configurator/bootstrap.env):
//
//   WEBTOOLS_ANAGRAPHICS_URL                 dove sta anagraphics
//   WEBTOOLS_CONFIGURATION_TIMEOUT_MS        quanto aspettarlo, in millisecondi

export class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigurationError";
  }
}

// Le variabili d'ambiente di avvio, controllate. `anagraphicsUrl` serve anche
// dopo: è lo stesso indirizzo per ogni chiamata ad anagraphics.
export function readBootstrap() {
  const anagraphicsUrl = process.env.WEBTOOLS_ANAGRAPHICS_URL;
  const timeout = process.env.WEBTOOLS_CONFIGURATION_TIMEOUT_MS;
  if (!anagraphicsUrl) throw new ConfigurationError("variabile d'ambiente WEBTOOLS_ANAGRAPHICS_URL mancante");
  if (!timeout) throw new ConfigurationError("variabile d'ambiente WEBTOOLS_CONFIGURATION_TIMEOUT_MS mancante");
  const timeoutMs = Number(timeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new ConfigurationError(`WEBTOOLS_CONFIGURATION_TIMEOUT_MS non è un intero positivo: ${timeout}`);
  }
  return { anagraphicsUrl: anagraphicsUrl.replace(/\/+$/, ""), timeoutMs };
}

// → un Configuration con i metodi per leggerne i campi. Lancia ConfigurationError.
export async function loadConfiguration(subsystem) {
  const { anagraphicsUrl, timeoutMs } = readBootstrap();
  const url = `${anagraphicsUrl}/configuration/${encodeURIComponent(subsystem)}`;

  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ConfigurationError(`GET ${url}: ${error.name} ${error.message}`);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new ConfigurationError(`GET ${url}: risposta non JSON (HTTP ${response.status})`);
  }
  if (!response.ok) {
    throw new ConfigurationError(`GET ${url}: HTTP ${response.status} ${body?.error ?? "?"}`);
  }
  return new Configuration(subsystem, body, anagraphicsUrl);
}

// Il documento letto, con un metodo per ogni tipo di campo. Il percorso è a
// punti (`subsystems_infos.sso.url`); un campo mancante o del tipo sbagliato lancia
// ConfigurationError con il percorso, così l'errore nel log dice dove guardare.
export class Configuration {
  constructor(subsystem, document, anagraphicsUrl) {
    this.subsystem = subsystem;
    this.document = document;
    this.anagraphicsUrl = anagraphicsUrl;
  }

  #fail(path, value, expected) {
    const found = value === undefined ? "mancante" : `trovato ${JSON.stringify(value)}`;
    return new ConfigurationError(`configurazione di ${this.subsystem}: ${path} deve essere ${expected}, ${found}`);
  }

  get(path) {
    let value = this.document;
    for (const key of path.split(".")) {
      value = value !== null && typeof value === "object" ? value[key] : undefined;
    }
    return value;
  }

  string(path) {
    const value = this.get(path);
    if (typeof value === "string" && value.length > 0) return value;
    throw this.#fail(path, value, "una stringa non vuota");
  }

  boolean(path) {
    const value = this.get(path);
    if (typeof value === "boolean") return value;
    throw this.#fail(path, value, "true o false");
  }

  integer(path, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
    const value = this.get(path);
    if (Number.isInteger(value) && value >= min && value <= max) return value;
    throw this.#fail(path, value, `un intero tra ${min} e ${max}`);
  }

  // Un numero con la virgola: soglie, probabilità, fattori. Gli importi **non**
  // passano di qui: quelli sono interi in centesimi.
  number(path, { min = -Infinity, max = Infinity } = {}) {
    const value = this.get(path);
    if (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max) return value;
    throw this.#fail(path, value, `un numero tra ${min} e ${max}`);
  }

  port(path) {
    return this.integer(path, { min: 1, max: 65535 });
  }

  stringList(path) {
    const value = this.get(path);
    if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item)) {
      return value;
    }
    throw this.#fail(path, value, "un elenco non vuoto di stringhe");
  }

  // Solo http o https: questi indirizzi finiscono in un href o in una fetch, e
  // un `javascript:` in un href è codice eseguito al clic. Senza la barra finale,
  // perché chi li usa ci attacca un percorso che comincia con `/`.
  httpUrl(path) {
    const value = this.get(path);
    try {
      const url = new URL(value);
      if (url.protocol === "http:" || url.protocol === "https:") return value.replace(/\/+$/, "");
    } catch {
      // Cade sotto: non è un indirizzo.
    }
    throw this.#fail(path, value, "un indirizzo http(s)");
  }

  httpUrlList(path) {
    return this.stringList(path).map((_, index) => this.httpUrl(`${path}.${index}`));
  }
}
