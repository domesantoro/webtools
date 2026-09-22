// Il filesystem dei workspace.
//
//   <root>/<project_id>/specs/spec-v001.md
//                            spec-v002.md   ← vale l'ultima
//
// Qui si conserva e basta: che il progetto esista, e di chi sia, lo verifica
// chi chiama. Il workspace di un progetto nasce alla prima specifica.

import { randomUUID } from "node:crypto";
import { link, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { isProjectId, stamp } from "./commons/spec_front_matter.js";

export const ORIGINS = ["system", "third_party"];

const SPEC_FILE = /^spec-v(\d{3,})\.md$/;

// Oltre questo numero di scritture concorrenti sullo stesso progetto qualcosa
// non va: meglio un errore che un ciclo senza fine.
const MAX_ATTEMPTS = 20;

// Il controllo del formato è anche la difesa dai percorsi: un id che lo passa
// non contiene né `/` né `..`, quindi non può uscire dalla radice.
export { isProjectId };

function specsDir(root, projectId) {
  if (!isProjectId(projectId)) throw new Error(`project_id non valido: ${projectId}`);
  return path.join(root, projectId, "specs");
}

function fileName(version) {
  return `spec-v${String(version).padStart(3, "0")}.md`;
}

async function versions(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => SPEC_FILE.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
}

// Scrive una nuova versione della specifica e ne restituisce il numero.
//
// I campi di sistema (origine, versione, chi, quando) si scrivono nella chiave
// riservata del front matter, sopra a qualunque cosa il file dichiarasse lì.
//
// Il file finale nasce **già completo**: si scrive un temporaneo e lo si
// collega al nome della versione con `link`, che fallisce se quel nome esiste.
// Due scritture concorrenti non possono prendersi lo stesso numero, e chi legge
// l'ultima versione non trova mai un file a metà.
export async function writeSpec(root, projectId, text, { origin, uploadedBy, now = new Date() }) {
  const dir = specsDir(root, projectId);
  // Prima si controlla il front matter, poi si tocca il disco: un file rifiutato
  // non deve lasciare nemmeno la cartella del progetto.
  stamp(text, {});
  await mkdir(dir, { recursive: true });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const existing = await versions(dir);
    const version = (existing.at(-1) ?? 0) + 1;
    const content = stamp(text, {
      origin,
      version,
      received_at: now.toISOString(),
      uploaded_by: uploadedBy,
    });

    const temporary = path.join(dir, `.incoming-${randomUUID()}.tmp`);
    await writeFile(temporary, content, { flag: "wx" });
    try {
      await link(temporary, path.join(dir, fileName(version)));
      return { version };
    } catch (error) {
      // Un'altra scrittura ha preso questo numero: si riprova con il successivo.
      if (error.code !== "EEXIST") throw error;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  throw new Error(`troppe scritture concorrenti sul progetto ${projectId}`);
}

// L'ultima versione, oppure `null` se il progetto non ha specifiche.
export async function latestSpec(root, projectId) {
  const dir = specsDir(root, projectId);
  const version = (await versions(dir)).at(-1);
  if (version === undefined) return null;
  return { version, text: await readFile(path.join(dir, fileName(version)), "utf8") };
}
