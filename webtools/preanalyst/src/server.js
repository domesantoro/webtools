// Server HTTP della pre-analisi.
//
//   GET  /                     la pagina con il form
//                              con ?rejected={id}: la modale della richiesta rifiutata
//   POST /submit               il form: nasce il progetto, la pre-specifica e la prevalidazione
//   GET  /analysis/{id}        la pagina dell'analisi (per ora vuota)
//   GET  /projects/{id}/rejection.pdf   i dati del form dopo un rifiuto
//   POST /upload               una specifica già pronta, per un progetto esistente
//   GET  /login-done, /session-fragment, /logout   il giro dell'accesso
//   POST /locale               cambia la lingua (cookie comune) e torna alla pagina
//   tutto il resto             i file statici di public/

import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ambassadorOf, resolveAmbassador } from "./ambassador.js";
import {
  addPipelineStep,
  createProject,
  deleteProject,
  findDriver,
  findProject,
  listDrivers,
} from "./anagraphics.js";
import { FrontMatterError, isProjectId, parse } from "./commons/spec_front_matter.js";
import {
  claimTicket,
  clearSessionCookie,
  currentSession,
  logoutUrl,
  saveSessionLocale,
  sessionCookie,
  ticketFrom,
} from "./commons/sso_client.js";
import { driverLinkOfProject, NONE, resolveDriverLink, withoutOwnLink } from "./driver_link.js";
import {
  renderAccessFragments,
  renderAnalysis,
  renderLoginDone,
  renderMessage,
  renderPage,
} from "./page.js";
import { readAnswers, renderPrespec } from "./prespec.js";
import { prevalidate, verdict } from "./prevalidator.js";
import { linkTermsOf } from "./project_driver.js";
import { writeRejectionPdf } from "./rejection_pdf.js";
import { latestSpec, storeSpec } from "./workspaces.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function send(response, status, contentType, body) {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}

function redirect(response, location, headers = {}) {
  response.writeHead(303, { location, "cache-control": "no-store", ...headers });
  response.end();
}

// Quanto manca alla scadenza della sessione. Il cookie non deve sopravvivere
// alla sessione che rappresenta, quindi la durata non si decide qui: si legge.
function secondsUntil(moment) {
  const scadenza = Date.parse(moment ?? "");
  if (Number.isNaN(scadenza)) return 0;
  return Math.max(0, Math.floor((scadenza - Date.now()) / 1000));
}

// `/login-done`: qui arriva la **finestra del login**, non la pagina di partenza.
// Si scambia il biglietto, si mette il cookie e si rende una paginetta che avvisa
// la finestra di partenza e si chiude da sola (`public/sso_popup.js`).
//
// Il ritorno non avviene sulla pagina della pre-analisi di proposito: ci
// arriverebbe la finestra sbagliata, aprendo una seconda copia del form e
// lasciando quella vera convinta che non sia entrato nessuno.
async function finishLogin(url, settings, response, ui, ticket) {
  const html = (ok) => send(response, 200, "text/html; charset=utf-8", renderLoginDone(ui, { ok }));

  if (!ticket) {
    // Qualcuno è arrivato qui a mano, senza passare dal login.
    return html(false);
  }

  const claimed = await claimTicket(settings, ticket);
  if (!claimed.ok || !claimed.logged) {
    console.warn("[preanalyst] biglietto non valido al ritorno dal login");
    return html(false);
  }

  const durata = secondsUntil(claimed.session.expires_at);
  if (durata === 0) {
    console.warn("[preanalyst] sessione già scaduta al ritorno dal login");
    return html(false);
  }

  console.log(`[preanalyst] entrato ${claimed.session.username}`);
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "set-cookie": sessionCookie(settings, claimed.session.token, durata),
  });
  return response.end(renderLoginDone(ui, { ok: true }));
}

// I pezzi della pagina che dipendono da chi è entrato, già resi dai template.
// Li chiede il browser dopo un login fatto nella finestra a parte, e li mette al
// posto di quelli vecchi: il form non viene toccato, e non si ricarica niente.
//
// Il browser manda anche i parametri dell'indirizzo (`?discount=`, `?driver=`)
// perché la colonna destra dipende da quelli: dopo il login può cambiare, per
// esempio se chi è entrato è il driver del link.
async function serveAccessFragments(request, url, settings, response, ui) {
  const stato = await pageState(request, url, settings);
  const body = JSON.stringify(renderAccessFragments(ui, stato.access, settings, stato));
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

/* ------------------------------------------------------- il caricamento */

// Il corpo intero, oppure `null` se supera il limite: in quel caso ha già
// risposto `tooLarge`. Prima si risponde, poi si chiude: chiudendo subito il
// client non leggerebbe mai il motivo, e si vedrebbe solo una connessione caduta.
async function readBody(request, response, maxBytes, tooLarge) {
  const pezzi = [];
  let ricevuti = 0;
  for await (const pezzo of request) {
    ricevuti += pezzo.length;
    if (ricevuti > maxBytes) {
      // `connection: close` perché il resto, che sta ancora arrivando, non lo si
      // vuole né leggere né aspettare.
      response.once("finish", () => request.destroy());
      tooLarge();
      return null;
    }
    pezzi.push(pezzo);
  }
  return Buffer.concat(pezzi);
}

// `POST /upload` — una specifica già pronta, per un progetto che esiste già.
//
// Il file arriva **nel corpo così com'è**, con il nome in `X-File-Name`: per un
// file solo non serve un form multipart, e senza multipart non serve niente per
// smontarlo. Il tipo dichiarato non si guarda: si guarda il contenuto.
//
// Il file deve essere testo UTF-8 con il `project_id` nel front matter, e il
// progetto deve essere di chi carica. Un progetto di un altro risponde come uno
// inesistente: così non si scopre quali id esistono. Se qualcosa non va, il
// file non si conserva.
//
// Le risposte seguono il contratto delle API del progetto, stato HTTP più codice
// stabile: qui non si parla a una persona ma al JavaScript della pagina.
async function receiveUpload(request, settings, response) {
  const rispondi = (status, payload, headers = {}) => {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
      ...headers,
    });
    response.end(body);
  };
  const errore = (status, code) => rispondi(status, { error: code });

  // Caricare è un'azione, non una lettura: serve essere dentro.
  const accesso = await currentSession(settings, request);
  if (!accesso.ok) return errore(503, "SSO_UNAVAILABLE");
  if (!accesso.logged) return errore(401, "NOT_LOGGED");

  const nome = fileName(request);
  if (!nome) return errore(400, "MISSING_FILE_NAME");

  const corpo = await readBody(request, response, settings.uploadMaxBytes, () =>
    rispondi(413, { error: "FILE_TOO_LARGE" }, { connection: "close" })
  );
  if (corpo === null) return;
  if (corpo.length === 0) return errore(400, "EMPTY_FILE");

  let testo;
  try {
    // `fatal`: un byte non valido è un errore, non un carattere sostituito in
    // silenzio. Un PDF o un Word finiscono qui.
    testo = new TextDecoder("utf-8", { fatal: true }).decode(corpo);
  } catch {
    return errore(400, "NOT_UTF8");
  }

  let dati;
  try {
    dati = parse(testo).data;
  } catch (error) {
    if (error instanceof FrontMatterError) return errore(400, "INVALID_FRONT_MATTER");
    throw error;
  }
  const projectId = dati?.project_id;
  if (projectId === undefined || projectId === null) return errore(400, "MISSING_PROJECT_ID");
  if (!isProjectId(projectId)) return errore(400, "INVALID_PROJECT_ID");

  const progetto = await findProject(settings, projectId);
  if (!progetto.ok && progetto.reason === "not_found") return errore(404, "PROJECT_NOT_FOUND");
  if (!progetto.ok) return errore(503, "ANAGRAPHICS_UNAVAILABLE");
  if (progetto.data.owner_uid !== accesso.session.uid) {
    console.warn(
      `[preanalyst] ${accesso.session.username} ha caricato una specifica per il progetto ` +
        `di un altro (${projectId}): rifiutata`
    );
    return errore(404, "PROJECT_NOT_FOUND");
  }

  // L'origine la decide il canale: un file caricato è sempre di terzi, anche se
  // nel suo front matter dichiara altro.
  const salvato = await storeSpec(settings, projectId, testo, {
    origin: "third_party",
    uploadedBy: accesso.session.uid,
  });
  if (!salvato.ok && salvato.reason === "rejected") return errore(400, salvato.code);
  if (!salvato.ok) return errore(503, "WORKSPACES_UNAVAILABLE");

  console.log(
    `[preanalyst] specifica caricata da ${accesso.session.username}: ${nome} ` +
      `(${corpo.length} byte) → progetto ${projectId}, versione ${salvato.data.version}`
  );
  return rispondi(201, {
    received: true,
    name: nome,
    project_id: projectId,
    version: salvato.data.version,
  });
}

// Il nome arriva codificato nell'header, perché un header porta solo ASCII e un
// nome di file può avere accenti. Si tiene solo l'ultima parte: un nome con dei
// percorsi dentro è un tentativo, non un nome.
function fileName(request) {
  const grezzo = request.headers["x-file-name"];
  if (!grezzo) return null;
  let nome;
  try {
    nome = decodeURIComponent(grezzo);
  } catch {
    return null;
  }
  nome = nome.split(/[/\\]/).pop().trim();
  return nome && nome !== "." && nome !== ".." ? nome.slice(0, 200) : null;
}

// "Esci" esce da tutto: prima si toglie il cookie nostro, poi si manda il
// browser al sso, che chiude la sessione condivisa e toglie il suo. Da lì in
// avanti nessun sottosistema riconosce più quel token.
function leave(settings, response) {
  return redirect(response, logoutUrl(settings, `${settings.publicUrl}/`), {
    "set-cookie": clearSessionCookie(settings),
  });
}

/* ------------------------------------------------------- l'invio del form */

function sendMessage(response, ui, status, kind) {
  send(response, status, "text/html; charset=utf-8", renderMessage(ui, kind));
}

// `POST /submit` — il form della pre-analisi.
//
// Nell'ordine: il progetto nasce in anagraphics, le risposte diventano la
// pre-specifica, la pre-specifica va nel workspace del progetto, il browser va
// alla pagina dell'analisi. Il `303` fa sì che ricaricare quella pagina non
// rimandi il form.
//
// Due protezioni:
// - `submission_id`, generato quando la pagina è stata resa: lo stesso form
//   mandato due volte (doppio clic, ricarica) trova il progetto già nato;
// - se la pre-specifica non si riesce a scrivere, il progetto si cancella: un
//   progetto senza pre-specifica non ha niente da cui partire.
async function receiveForm(request, settings, response, ui) {
  const accesso = await currentSession(settings, request);
  if (!accesso.ok) return sendMessage(response, ui, 503, "unavailable");
  if (!accesso.logged) return sendMessage(response, ui, 401, "not_logged");

  const corpo = await readBody(request, response, settings.formMaxBytes, () =>
    send(response, 413, "text/html; charset=utf-8", renderMessage(ui, "too_large"))
  );
  if (corpo === null) return;
  const form = new URLSearchParams(corpo.toString("utf8"));

  const submissionId = form.get("submission_id") ?? "";
  if (!isProjectId(submissionId)) return sendMessage(response, ui, 400, "invalid");

  const { answers, missing } = readAnswers(form, settings.answerMaxChars);
  if (missing.length > 0) return sendMessage(response, ui, 400, "missing");

  // Una riscrittura: chi è tornato indietro perché serviva qualche dettaglio in
  // più rimanda il form con l'id del suo progetto. Si riparte da quello invece
  // di crearne un altro, così i giri restano contati in un posto solo.
  const ripresa = await resumedProject(settings, form, accesso.session);
  if (ripresa) {
    return await writeAndPrevalidate(settings, response, ui, {
      projectId: ripresa.projectId,
      answers,
      session: accesso.session,
      attempts: ripresa.attempts,
    });
  }

  // Tutto ciò che arriva dai campi nascosti si ricontrolla su anagraphics.
  const ownDriverUid = accesso.session.data?.driver_uid ?? null;
  const autonomous = Boolean(ownDriverUid) && form.get("autonomous_work") === "yes";
  const link = await linkTermsOf(settings, form, ownDriverUid, autonomous);
  if (!link.ok) return sendMessage(response, ui, 503, "unavailable");
  const ambassador = await ambassadorOf(settings, form, ownDriverUid);
  if (!ambassador.ok) return sendMessage(response, ui, 503, "unavailable");

  const { review, billing } = projectTerms({ ownDriverUid, autonomous, link, ambassadorUid: ambassador.uid });
  const creato = await createProject(settings, {
    ownerUid: accesso.session.uid,
    submissionId,
    review,
    billing,
  });
  if (!creato.ok && creato.reason === "rejected") return sendMessage(response, ui, 400, "invalid");
  if (!creato.ok) return sendMessage(response, ui, 503, "unavailable");
  const projectId = creato.data.project_id;

  // 200 invece di 201: questo invio era già arrivato, e il progetto c'è già.
  // La pre-specifica non si riscrive: si va dove si sarebbe andati la prima volta.
  if (creato.status === 200) {
    console.log(`[preanalyst] invio ripetuto da ${accesso.session.username}: progetto ${projectId}`);
    return redirect(response, `/analysis/${projectId}`);
  }

  return await writeAndPrevalidate(settings, response, ui, {
    projectId,
    answers,
    session: accesso.session,
    attempts: 0,
  });
}

// Il progetto da riprendere, se il form ne porta uno valido.
//   → { projectId, attempts } oppure null
//
// Vale solo per un progetto che esiste, è di chi manda il form ed è fermo in
// `UNDERSPECIFIED`: un id qualunque nel campo nascosto non permette di
// riscrivere il progetto di un altro, né di rianimarne uno già rifiutato.
//
// `attempts` sono i giri già fatti, contati sui passi della pipeline: il
// registro dei passi è l'unico posto dove quel numero esiste, e non serve
// tenerlo da nessun'altra parte.
async function resumedProject(settings, form, session) {
  const projectId = form.get("project_id") ?? "";
  if (!isProjectId(projectId)) return null;

  const progetto = await findProject(settings, projectId);
  if (!progetto.ok) return null;
  if (progetto.data.owner_uid !== session.uid) {
    console.warn(
      `[preanalyst] ${session.username} ha riscritto il progetto di un altro (${projectId}): ignorato`
    );
    return null;
  }
  if (progetto.data.pipeline?.state !== "UNDERSPECIFIED") return null;

  return { projectId, attempts: underspecifiedAttempts(progetto.data) };
}

// Quante volte questa richiesta è già tornata indietro per mancanza di dettagli.
export function underspecifiedAttempts(progetto) {
  const passi = progetto.pipeline?.steps ?? [];
  return passi.filter((voce) => voce.result === "underspecified").length;
}

// La pre-specifica si rende, si conserva e si prevalida. È la parte comune fra
// il primo invio e la riscrittura di chi è tornato indietro (§16.6 del README):
// cambia solo da quale progetto si parte e quanti giri sono già stati fatti.
async function writeAndPrevalidate(settings, response, ui, { projectId, answers, session, attempts }) {
  const prespec = renderPrespec(projectId, answers, ui.locale);
  const salvato = await storeSpec(settings, projectId, prespec, {
    origin: "system",
    uploadedBy: session.uid,
  });
  if (!salvato.ok) {
    // Solo al primo giro il progetto si cancella: senza pre-specifica non ha
    // niente da cui partire. Chi ha già riscritto ha una versione buona alle
    // spalle, e buttarla via sarebbe peggio.
    if (attempts === 0) {
      const cancellato = await deleteProject(settings, projectId);
      console.error(
        `[preanalyst] pre-specifica non scritta per il progetto ${projectId}: ` +
          (cancellato.ok ? "progetto cancellato" : "PROGETTO RIMASTO SENZA PRE-SPECIFICA")
      );
    } else {
      console.error(`[preanalyst] riscrittura non conservata per il progetto ${projectId}`);
    }
    return sendMessage(response, ui, 503, "unavailable");
  }

  console.log(
    `[preanalyst] richiesta di ${session.username}: progetto ${projectId}, ` +
      `pre-specifica v${salvato.data.version}${attempts ? ` (giro ${attempts + 1})` : ""}`
  );

  const esito = await runPrevalidation(settings, projectId, prespec, attempts);

  if (esito === "rejected") return redirect(response, `/?rejected=${projectId}`);
  if (esito === "underspecified") {
    // Qui **non** si reindirizza: la pagina si rende con le risposte già dentro.
    // Chiedere qualche dettaglio in più e restituire un form vuoto sarebbe un
    // invito impossibile da accogliere. Il prezzo è che ricaricare rimanda il
    // form — vedi §16.7 del README.
    return await serveFormAgain(settings, response, ui, { projectId, answers, session });
  }
  return redirect(response, `/analysis/${projectId}`);
}

// Il form di nuovo, con dentro quello che l'utente aveva già scritto, perché la
// richiesta non diceva abbastanza per essere giudicata.
//
// Non è un reindirizzamento: la pagina si rende qui, in risposta al POST. Un
// `303` verso la home riporterebbe un form vuoto, e chiedere qualche dettaglio
// in più restituendo un foglio bianco è un invito che nessuno può accogliere.
//
// **La pagina resta la pagina**: la colonna destra è quella di prima — il box del
// driver, quello dell'ambassador, il blocco del lavoro autonomo per un driver, il
// caricamento di una specifica già pronta. Chi rivede il form deve ritrovarlo
// com'era, o sembra che qualcosa si sia rotto.
//
// Quello che cambia è che i box **si leggono e non si toccano**: le condizioni
// economiche del progetto si sono decise al primo invio e questo giro non le
// rilegge. Quindi niente campi nascosti che viaggiano col form, niente avviso
// «questo driver verrà ignorato», e la casella del lavoro autonomo mostra quello
// che è registrato, ferma.
//
// I parametri dell'indirizzo qui non ci sono — è la risposta a un `POST` — ma non
// servono: quello che portavano sta sul progetto, e da lì si rilegge
// (`driverLinkOfProject`).
async function serveFormAgain(settings, response, ui, { projectId, answers, session }) {
  // Che cosa si è deciso al primo invio. Se anagraphics non risponde si va
  // avanti lo stesso con la pagina: un dettaglio della colonna destra non vale
  // la richiesta dell'utente, che è già stata scritta.
  const progetto = await findProject(settings, projectId);
  const dati = progetto.ok ? progetto.data : null;
  const autonomous = Boolean(dati?.billing?.autonomous_work);

  // In un lavoro autonomo il driver è chi sta compilando, e il box non si mostra:
  // è quello che succede al primo invio, dove lo spegne il CSS della casella.
  const driverLink = dati && !autonomous ? await driverLinkOfProject(settings, dati) : { state: NONE };

  const ambassadorUid = dati?.billing?.ambassador_uid ?? null;
  const invito = ambassadorUid ? await findDriver(settings, ambassadorUid) : { ok: false };

  const html = renderPage(ui, {
    access: { logged: true, session, ssoAvailable: true },
    settings,
    params: {},
    driverLink,
    showDriverBox: driverLink.state !== NONE,
    driversAvailable: true,
    ambassador: invito.ok ? invito.data : null,
    isDriver: Boolean(session.data?.driver_uid),
    // La casella dice com'è il progetto, e non si può più cambiare: al secondo
    // giro nessuno rilegge `autonomous_work`, e una casella che non fa niente è
    // peggio che una casella ferma.
    autonomousWork: { checked: autonomous, locked: true },
    // Un id nuovo per il giro nuovo: questo è un altro invio, e la deduplica
    // degli invii lavora su quello.
    submissionId: randomUUID(),
    answers,
    resumed: { projectId },
    rejectedProjectId: null,
  });
  send(response, 200, "text/html; charset=utf-8", html);
}

// Dove porta la pipeline ognuna delle tre decisioni. Il passo dice due cose —
// com'è andato e dove si va — e chi le decide è questo cancello.
const STATE_AFTER = {
  passed: "ANALYSIS",
  rejected: "REJECTED",
  underspecified: "UNDERSPECIFIED",
};

// Il primo cancello: la pre-specifica passa dal prevalidator e l'esito si accoda
// alla pipeline del progetto. Restituisce che cosa si fa della richiesta —
// "passed", "rejected", "underspecified" — oppure "failed" se il controllo non
// è riuscito.
//
// Se il controllo non riesce — fornitore giù, risposta inutilizzabile — il
// progetto **resta**: il passo si segna `failed` e si va avanti. Una richiesta
// valida non si butta via perché un controllo non ha funzionato; il rifiuto è
// una decisione, non un guasto.
async function runPrevalidation(settings, projectId, prespec, attempts) {
  const esito = await prevalidate(settings, prespec);

  if (!esito.ok) {
    // Se il modello ha risposto — male, ma ha risposto — i token sono stati
    // pagati lo stesso, e finiscono sul passo insieme all'errore: il costo di un
    // tentativo andato storto è costo, e il PoC misura quello vero. Se invece il
    // fornitore non ha risposto affatto non c'è nessun `usage` da scrivere.
    const { usage, model } = esito;
    console.error(
      `[preanalyst] prevalidazione non riuscita per ${projectId}: ${esito.reason}` +
        (usage ? `; ${usage.input_tokens}+${usage.output_tokens} token spesi lo stesso` : "")
    );
    await savePipelineStep(settings, projectId, {
      step: "prevalidation",
      result: "failed",
      state: "PREVALIDATION",
      data: { error: esito.reason, ...(usage ? { usage, model } : {}) },
    });
    return "failed";
  }

  const { outcome, distribution } = esito.data;
  const decisione = verdict(distribution, outcome, {
    threshold: settings.prevalidation.rejectThreshold,
    attempts,
    maxAttempts: settings.prevalidation.maxUnderspecifiedAttempts,
  });

  console.log(
    `[preanalyst] prevalidazione di ${projectId}: ${outcome} ` +
      `(${distribution[outcome].toFixed(2)}) → ${decisione}` +
      `${esito.data.off_domain.flag ? ", fuori dominio" : ""}; ` +
      `${esito.data.usage.input_tokens}+${esito.data.usage.output_tokens} token`
  );

  await savePipelineStep(settings, projectId, {
    step: "prevalidation",
    result: decisione,
    state: STATE_AFTER[decisione],
    data: esito.data,
  });
  return decisione;
}

// Il passo non si perde in silenzio: se anagraphics non lo prende, resta nel log.
async function savePipelineStep(settings, projectId, step) {
  const salvato = await addPipelineStep(settings, projectId, step);
  if (!salvato.ok) {
    console.error(
      `[preanalyst] passo '${step.step}' non registrato sul progetto ${projectId}: ${salvato.reason}`
    );
  }
  return salvato;
}

// Driver e sconti sono dati del **progetto**, non della pre-specifica: vanno in
// `review` (chi lo supervisiona) e `billing` (i dati economici).
//
// - Lavoro autonomo: vale solo se chi manda il form è un driver. Il driver è lui
//   (preimpostato) e il codice sconto di un altro driver non si applica: le due
//   cose si escludono.
// - Altrimenti il driver del link, se c'era ed è valido, è preimpostato; senza
//   lo assegnerà il sistema (`driver_uid: null`, `preset: false`).
//
// Driver, sconto e ambassador arrivano già verificati: `linkTermsOf()` in
// src/project_driver.js e `ambassadorOf()` in src/ambassador.js.
function projectTerms({ ownDriverUid, autonomous, link, ambassadorUid }) {
  if (autonomous) {
    return {
      review: { driver_uid: ownDriverUid, preset: true },
      billing: {
        discount_code: null,
        autonomous_work: true,
        ambassador_uid: null,
      },
    };
  }
  return {
    review: { driver_uid: link.driverUid, preset: Boolean(link.driverUid) },
    billing: {
      discount_code: link.discountCode,
      autonomous_work: false,
      ambassador_uid: ambassadorUid,
    },
  };
}

// `GET /projects/{id}/rejection.pdf` — quello che l'utente aveva scritto nel
// form, da portarsi via dopo un rifiuto.
//
// Lo vede solo il proprietario, e solo per un progetto davvero rifiutato: un
// progetto di un altro risponde come uno inesistente.
//
// La **motivazione estesa** del rifiuto ci finisce dentro in due casi: se la
// configurazione dice di darla a tutti, oppure se chi scarica è un driver. È un
// dato interno: fuori da questi due casi il PDF non lo nomina nemmeno.
async function serveRejectionPdf(request, projectId, settings, response, ui) {
  const accesso = await currentSession(settings, request);
  if (!accesso.ok) return sendMessage(response, ui, 503, "unavailable");
  if (!accesso.logged) return sendMessage(response, ui, 401, "not_logged");
  if (!isProjectId(projectId)) return sendMessage(response, ui, 404, "not_found");

  const progetto = await findProject(settings, projectId);
  if (!progetto.ok && progetto.reason !== "not_found") return sendMessage(response, ui, 503, "unavailable");
  if (!progetto.ok || progetto.data.owner_uid !== accesso.session.uid) {
    return sendMessage(response, ui, 404, "not_found");
  }
  if (progetto.data.pipeline?.state !== "REJECTED") return sendMessage(response, ui, 404, "not_found");

  const specifica = await latestSpec(settings, projectId);
  if (!specifica.ok && specifica.reason === "not_found") return sendMessage(response, ui, 404, "not_found");
  if (!specifica.ok) return sendMessage(response, ui, 503, "unavailable");

  const isDriver = Boolean(accesso.session.data?.driver_uid);
  const mostraMotivazione = settings.prevalidation.rejectionReasonInPdf || isDriver;

  return writeRejectionPdf(response, {
    t: ui.t,
    spec: specifica.data,
    reason: mostraMotivazione ? rejectionReasonOf(progetto.data) : null,
    // Il nome del file: solo l'id, che è un UUID, quindi niente da ripulire.
    fileName: `webtools-${projectId}.pdf`,
  });
}

// La motivazione scritta dal prevalidator, presa dall'ultimo passo che ha
// deciso. `off_domain.reason` si aggiunge se c'è: è l'altra metà del giudizio.
function rejectionReasonOf(progetto) {
  const passi = progetto.pipeline?.steps ?? [];
  const passo = [...passi].reverse().find((voce) => voce.step === "prevalidation" && voce.data?.reason);
  if (!passo) return null;
  const fuoriDominio = passo.data.off_domain?.flag ? passo.data.off_domain.reason : "";
  return [passo.data.reason, fuoriDominio].filter(Boolean).join("\n\n");
}

// `GET /analysis/{id}` — la pagina dell'analisi, per ora vuota. La vede solo chi
// possiede il progetto: per tutti gli altri il progetto non esiste.
async function serveAnalysis(request, projectId, settings, response, ui) {
  const accesso = await currentSession(settings, request);
  if (!accesso.ok) return sendMessage(response, ui, 503, "unavailable");
  if (!accesso.logged) return sendMessage(response, ui, 401, "not_logged");
  if (!isProjectId(projectId)) return sendMessage(response, ui, 404, "not_found");

  const progetto = await findProject(settings, projectId);
  if (!progetto.ok && progetto.reason !== "not_found") return sendMessage(response, ui, 503, "unavailable");
  if (!progetto.ok || progetto.data.owner_uid !== accesso.session.uid) {
    return sendMessage(response, ui, 404, "not_found");
  }

  const access = { logged: true, session: accesso.session, ssoAvailable: true };
  send(response, 200, "text/html; charset=utf-8", renderAnalysis(ui, { access, settings }));
}

// Tutto ciò che serve a disegnare la pagina: chi è entrato, da dove arriva.
// Sta in un posto solo perché lo usano sia la pagina intera sia i frammenti che
// il browser chiede dopo il login: le due strade devono vedere la stessa cosa.
async function pageState(request, url, settings) {
  // Chi sta guardando la pagina. Tre esiti, e sono tre cose diverse: loggato,
  // non loggato, oppure "non lo sappiamo" perché il sso non risponde. L'ultimo
  // non si tratta come un logout.
  const accesso = await currentSession(settings, request);
  const access = {
    logged: accesso.ok ? accesso.logged : false,
    session: accesso.ok ? accesso.session : null,
    ssoAvailable: accesso.ok,
  };

  // Chi è entrato è anche un driver? L'uid del suo documento in `drivers` viene
  // dalla sessione, fotografato al login.
  const ownDriverUid = access.logged ? (access.session.data?.driver_uid ?? null) : null;

  const params = {
    discountCode: url.searchParams.get("discount"),
    driverUid: url.searchParams.get("driver"),
    ambassadorUid: url.searchParams.get("ambassador"),
  };

  // Il box del driver si vede solo a chi è arrivato dal link di un driver.
  // Per tutti gli altri non c'è nessuna scelta da fare, quindi non c'è box e
  // non serve nemmeno chiedere l'elenco ad anagraphics.
  const showDriverBox = Boolean(params.discountCode || params.driverUid);
  // L'ambassador conta solo senza link di un driver (src/ambassador.js).
  const ambassadorAsked = Boolean(params.ambassadorUid) && !showDriverBox;

  let drivers = [];
  let driversAvailable = true;
  let driverLink = { state: NONE };

  if (showDriverBox) {
    const driversResult = await listDrivers(settings);
    driversAvailable = driversResult.ok;
    drivers = driversResult.ok ? driversResult.data : [];
    // Senza elenco non si può risolvere niente: il box lo dice e la pre-analisi
    // continua lo stesso, perché scegliere il driver è facoltativo.
    driverLink = driversResult.ok ? await resolveDriverLink(settings, params, drivers) : { state: NONE };
    // Un driver non si manda un cliente da solo: il proprio sconto e il proprio
    // link non valgono. Quelli di altri driver sì.
    driverLink = withoutOwnLink(driverLink, ownDriverUid);
  }

  // Senza elenco dei driver l'ambassador non si può verificare: il box non c'è.
  let ambassador = null;
  if (ambassadorAsked) {
    const driversResult = await listDrivers(settings);
    ambassador = driversResult.ok ? resolveAmbassador(params, driversResult.data, ownDriverUid) : null;
  }

  return {
    access,
    params,
    driverLink,
    showDriverBox,
    driversAvailable,
    ambassador,
    isDriver: Boolean(ownDriverUid),
    rejectedProjectId: await rejectedProject(request, url, settings, access),
  };
}

// `?rejected={id}` — ci arriva chi ha appena mandato il form e si è visto
// rifiutare la richiesta. Il parametro vale solo se il progetto esiste, è di chi
// guarda ed è davvero rifiutato: in tutti gli altri casi si ignora e la pagina è
// quella di sempre. Così l'indirizzo non si può usare per far comparire un
// rifiuto a qualcun altro, né per scoprire quali progetti esistono.
async function rejectedProject(request, url, settings, access) {
  const projectId = url.searchParams.get("rejected");
  if (!projectId || !isProjectId(projectId) || !access.logged) return null;

  const progetto = await findProject(settings, projectId);
  if (!progetto.ok) return null;
  if (progetto.data.owner_uid !== access.session.uid) return null;
  if (progetto.data.pipeline?.state !== "REJECTED") return null;
  return projectId;
}

async function servePage(request, url, settings, response, ui) {
  const stato = await pageState(request, url, settings);
  // Un id per questo form: se lo stesso invio arriva due volte, il progetto resta uno.
  const html = renderPage(ui, { ...stato, settings, submissionId: randomUUID() });
  send(response, 200, "text/html; charset=utf-8", html);
}

async function serveStatic(pathname, response) {
  // Solo file dentro public/: path.normalize toglie i "..".
  const relative = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const file = path.join(PUBLIC_DIR, relative);
  if (!file.startsWith(PUBLIC_DIR)) {
    return send(response, 403, "text/plain; charset=utf-8", "Vietato");
  }

  let info;
  try {
    info = await stat(file);
  } catch {
    return send(response, 404, "text/plain; charset=utf-8", "Non trovato");
  }
  if (!info.isFile()) {
    return send(response, 404, "text/plain; charset=utf-8", "Non trovato");
  }

  response.writeHead(200, {
    "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
    "content-length": info.size,
  });
  createReadStream(file).pipe(response);
}

// Il selettore della lingua, in testata su ogni pagina. Scrive il cookie comune
// e torna alla pagina da cui è partito: gli altri sottosistemi leggono lo stesso
// cookie, quindi cambiano lingua anche loro alla prossima pagina.
async function changeLocale(request, settings, response) {
  const change = await settings.i18n.readChange(request);
  if (!change.ok) {
    const body = JSON.stringify({ error: change.code });
    response.writeHead(change.status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    });
    return response.end(body);
  }
  // Chi è entrato la ritrova al prossimo login. Se il sso non risponde la lingua
  // cambia lo stesso: il cookie basta per le pagine.
  const salvata = await saveSessionLocale(settings, request, change.locale);
  if (!salvata.ok) console.error("[preanalyst] lingua non salvata nella sessione: il sso non risponde");
  return redirect(response, change.location, { "set-cookie": change.cookie });
}

export function createServer(settings) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    // Lingua e selettore per le pagine. Le pagine rese in risposta a un POST non
    // si riaprono con un GET: il cambio di lingua da lì torna alla pre-analisi.
    const ui = settings.i18n.pageContext(request, url, request.method === "GET" ? {} : { returnTo: "/" });

    try {
      if (request.method === "POST" && url.pathname === "/upload") {
        return await receiveUpload(request, settings, response);
      }
      if (request.method === "POST" && url.pathname === "/submit") {
        return await receiveForm(request, settings, response, ui);
      }
      if (request.method === "POST" && url.pathname === "/locale") {
        return await changeLocale(request, settings, response);
      }
      if (request.method !== "GET") {
        return send(response, 405, "text/plain; charset=utf-8", "Metodo non ammesso");
      }

      if (url.pathname === "/") {
        return await servePage(request, url, settings, response, ui);
      }
      if (url.pathname === "/login-done") {
        return await finishLogin(url, settings, response, ui, ticketFrom(url));
      }
      if (url.pathname === "/session-fragment") {
        return await serveAccessFragments(request, url, settings, response, ui);
      }
      if (url.pathname === "/logout") {
        return leave(settings, response);
      }
      const analisi = /^\/analysis\/([^/]+)$/.exec(url.pathname);
      if (analisi) {
        return await serveAnalysis(request, analisi[1], settings, response, ui);
      }
      const rigetto = /^\/projects\/([^/]+)\/rejection\.pdf$/.exec(url.pathname);
      if (rigetto) {
        return await serveRejectionPdf(request, rigetto[1], settings, response, ui);
      }
      return await serveStatic(url.pathname, response);
    } catch (error) {
      console.error(`[preanalyst] errore su ${url.pathname}: ${error.stack ?? error}`);
      if (!response.headersSent) {
        send(response, 500, "text/plain; charset=utf-8", "Errore interno");
      }
    }
  });
}
