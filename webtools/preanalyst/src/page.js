// I dati che vanno alla pagina.
//
// Qui non c'è HTML: sta in `templates/`, in file .njk resi da nunjucks. Questo
// file prepara i dati e basta — quali sezioni, com'è andata la provenienza dal
// link di un driver, chi è entrato.
//
// Perché un motore di template e non stringhe dentro il JavaScript: con
// l'autoescape acceso, ogni valore che finisce nell'HTML viene ripulito da solo.
// Scrivendo l'HTML a mano l'escape è disciplina, e qui i valori arrivano tutti
// da fuori — dall'URL e dal database.
//
// Il layout comune (`templates/commons/base.njk`) è una **copia generata** dal
// deployer: si modifica l'originale in `webtools/commons/templates/` e si
// rilancia `webtools/configurator/deploy.sh`.
//
// La pagina è resa dal server: il browser riceve l'HTML già completo e non parla
// mai con anagraphics, che accetta solo chiamate da IP noti.

import { fileURLToPath } from "node:url";

import nunjucks from "nunjucks";

import { loginUrl, registerUrl } from "./commons/sso_client.js";
import { SECTIONS } from "./questions.js";
import { DISCOUNT_DRIVER_DISABLED, isResolved, OWN_LINK } from "./driver_link.js";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

const env = nunjucks.configure(TEMPLATES_DIR, {
  // L'impostazione che conta: tutto ciò che si scrive con {{ }} passa
  // dall'escape. Per stampare HTML vero serve dirlo apposta con `| safe`.
  autoescape: true,
  noCache: false,
  // Niente trimBlocks: insieme ai `{%-` dei template ridurrebbe la pagina a
  // poche righe lunghissime, e l'HTML reso va letto anche da un essere umano.
  trimBlocks: false,
});

// Quello che è arrivato nell'URL non deve perdersi al primo invio: il codice
// sconto non sta in nessun campo visibile, quindi viaggia nascosto. Quando il
// driver è stato riconosciuto si manda il suo uid; quando non si è potuto
// risolvere niente, si rimanda indietro quello che era arrivato — se il guasto
// è nostro, non deve pagarlo l'utente.
function hiddenFields(driverLink, params, driversAvailable) {
  const campi = [];
  // Lo sconto di un driver non abilitato non si applica: non viaggia col form.
  if (params.discountCode && driverLink.state !== DISCOUNT_DRIVER_DISABLED) {
    campi.push({ name: "discount", value: params.discountCode });
  }
  if (driversAvailable && isResolved(driverLink)) {
    campi.push({ name: "driver", value: driverLink.driver.uid });
  } else if (!driversAvailable && params.driverUid) {
    campi.push({ name: "driver", value: params.driverUid });
  }
  return campi;
}

// Dove il sso rimanda il browser dopo il login: **non** la pagina di partenza,
// ma la paginetta che chiude il giro (`/login-done`). Ci arriva la finestra del
// login, che avvisa la pagina di partenza e si chiude. Mandarlo alla pagina di
// partenza aprirebbe una seconda copia della pre-analisi nella finestra
// sbagliata, lasciando quella vera convinta che non sia entrato nessuno.
function afterLogin(settings) {
  return `${settings.publicUrl}/login-done`;
}

// La sezione "Lavoro autonomo" della pagina "Lavora con noi" del sito vetrina.
function workWithUsUrl(settings) {
  return `${settings.frontGateUrl}/lavora-con-noi.html#lavoro-autonomo`;
}

// I pezzi che dipendono da chi è entrato. Sono gli stessi macro usati dalla
// pagina, quindi quella appena caricata e quella aggiornata dal browser non
// possono divergere.
// I pezzi da rimpiazzare dopo il login, ognuno col selettore del contenitore.
// Non si rimpiazza la colonna destra intera: dentro c'è il blocco del
// caricamento, e rifarlo butterebbe via il file che l'utente ha già scelto.
export function renderAccessFragments(ui, access, settings, colonna) {
  const dati = accessData(access, settings);
  const aside = asideData({ ...colonna, moreUrl: workWithUsUrl(settings) });
  return {
    logged: dati.logged,
    fragments: {
      "[data-sso-header]": env.render("fragments/access_header.njk", { ...ui, access: dati }),
      "[data-sso-driver]": env.render("fragments/driver.njk", { ...ui, aside }),
    },
  };
}

// La colonna destra: il box del driver e, solo per un driver, il blocco del
// lavoro autonomo. Può essere vuota — chi arriva senza link e non è un driver
// non ha niente da vedere lì — e in quel caso la pagina resta a una colonna.
function asideData({
  driverLink,
  params,
  showDriverBox,
  driversAvailable,
  ambassador,
  isDriver,
  moreUrl,
  autonomousWork,
  locked,
}) {
  const ownLink = driverLink.state === OWN_LINK;
  // Un link proprio non si mostra: il box sparisce e a dirlo è il blocco del
  // lavoro autonomo, che per un driver c'è comunque.
  const boxShow = showDriverBox && !ownLink;
  const resolved = driversAvailable && isResolved(driverLink);

  return {
    driver_box: {
      show: boxShow,
      drivers_available: driversAvailable,
      resolved,
      link: driverLink,
      // L'avviso ha senso solo se c'è una casella da segnare e qualcosa di
      // valido da non applicare: un driver che guarda un riferimento a un altro
      // driver, riconosciuto. Su uno sconto scaduto non c'è niente da ignorare.
      // Con la casella ferma non c'è più niente da ignorare, e niente deve
      // viaggiare col form: i termini del progetto si sono decisi al primo invio
      // e questo giro non li rilegge.
      can_be_ignored: boxShow && isDriver && resolved && !locked,
      hidden: locked ? [] : hiddenFields(driverLink, params, driversAvailable),
    },
    // Chi ha invitato l'utente a usare webtools (src/ambassador.js). C'è solo
    // se l'ambassador è stato riconosciuto; con il lavoro autonomo segnato lo
    // spegne il CSS.
    ambassador_box: {
      show: Boolean(ambassador),
      driver: ambassador,
      // Quando il form si ripresenta il box si legge e basta: l'uid non
      // riparte col form, perché il progetto ce l'ha già.
      locked: Boolean(locked),
    },
    driver_work: {
      show: isDriver,
      own_link: ownLink,
      more_url: moreUrl,
      // Com'è messa la casella. Al primo invio è libera e vuota; quando il form
      // si ripresenta dice quello che il progetto ha già registrato e non si
      // tocca più, perché quella scelta è stata fatta (src/server.js).
      checked: Boolean(autonomousWork?.checked),
      locked: Boolean(autonomousWork?.locked),
    },
  };
}

// Le pagine di esito dell'invio e dell'analisi, quando qualcosa non va.
// Una frase su che cosa è successo, una su che cosa fare: i testi stanno nei
// cataloghi, sotto `preanalyst.messages.<tipo>.title` e `.text`.
//
// `ui`, in ogni pagina resa qui, è quello che dà `settings.i18n.pageContext(…)`:
// lingua, `t` e selettore della lingua, che il layout comune usa su ogni pagina.
export function renderMessage(ui, kind) {
  const message = {
    title: ui.t(`preanalyst.messages.${kind}.title`),
    text: ui.t(`preanalyst.messages.${kind}.text`),
  };
  return env.render("message.njk", { ...ui, title: message.title, noindex: true, home_link: "/", message });
}

// La pagina dell'analisi: per ora solo il guscio, con chi è entrato in testata.
export function renderAnalysis(ui, { access, settings }) {
  return env.render("analysis.njk", {
    ...ui,
    title: ui.t("preanalyst.analysis.title"),
    noindex: true,
    home_link: "/",
    access: accessData(access, settings),
  });
}

export function renderLoginDone(ui, { ok }) {
  return env.render("login_done.njk", { ...ui, title: ui.t("preanalyst.login_done.title"), noindex: true, ok });
}

// Le domande di `src/questions.js` con i loro testi nella lingua della pagina.
// `hint` e `placeholder` ci sono solo se il catalogo li ha.
//
// `answers` sono le risposte già date, quando il form si ripresenta a chi è
// tornato indietro (src/server.js): ogni campo si porta dietro quello che c'era.
// Al primo invio è vuoto e i campi nascono vuoti.
function localizedSections(ui, answers) {
  const optional = (key) => (ui.has(key) ? ui.t(key) : null);
  return SECTIONS.map((section) => {
    const base = `preanalyst.questions.sections.${section.id}`;
    return {
      ...section,
      legend: ui.t(`${base}.legend`),
      hint: optional(`${base}.hint`),
      fields: section.fields.map((field) => {
        const key = `preanalyst.questions.fields.${field.name}`;
        return {
          ...field,
          label: ui.t(`${key}.label`),
          hint: optional(`${key}.hint`),
          placeholder: optional(`${key}.placeholder`),
          options: field.options?.map(([code]) => [code, ui.t(`${key}.options.${code}`)]),
          ...answered(field, answers[field.name]),
        };
      }),
    };
  });
}

// Che cosa aveva risposto l'utente a una domanda, nella forma che serve al
// template: `value` per i campi di testo, `selected` per le scelte — sempre un
// elenco di codici, anche per un radio, così il template fa una cosa sola.
function answered(field, value) {
  if (field.kind === "radio" || field.kind === "checkbox") {
    const codici = Array.isArray(value) ? value : value ? [value] : [];
    return { selected: codici };
  }
  return { value: typeof value === "string" ? value : "" };
}

// I messaggi del caricamento (public/upload.js): il browser non ha cataloghi,
// li riceve dalla pagina già nella lingua giusta. Un codice d'errore senza testo
// cade su `failed`.
const UPLOAD_ERRORS = [
  "NOT_LOGGED",
  "FILE_TOO_LARGE",
  "EMPTY_FILE",
  "MISSING_FILE_NAME",
  "NOT_UTF8",
  "INVALID_FRONT_MATTER",
  "MISSING_PROJECT_ID",
  "INVALID_PROJECT_ID",
  "PROJECT_NOT_FOUND",
  "SSO_UNAVAILABLE",
  "ANAGRAPHICS_UNAVAILABLE",
  "WORKSPACES_UNAVAILABLE",
];

function uploadMessages(ui) {
  const status = ["finish_login", "in_progress", "done", "failed"];
  return {
    ...Object.fromEntries(status.map((name) => [name, ui.t(`preanalyst.upload.status.${name}`)])),
    errors: Object.fromEntries(UPLOAD_ERRORS.map((code) => [code, ui.t(`preanalyst.upload.errors.${code}`)])),
  };
}

function accessData(access, settings) {
  const next = afterLogin(settings);
  return {
    logged: access.logged,
    sso_available: access.ssoAvailable,
    name: access.logged
      ? (access.session.data?.screen_name ?? access.session.username)
      : null,
    login_url: loginUrl(settings, next),
    register_url: registerUrl(settings, next),
  };
}

export function renderPage(ui, {
  driverLink,
  params,
  showDriverBox,
  driversAvailable,
  ambassador,
  isDriver,
  access,
  settings,
  submissionId,
  rejectedProjectId,
  answers = {},
  resumed = null,
  autonomousWork = null,
}) {
  return env.render("page.njk", {
    ...ui,
    submission_id: submissionId,
    title: ui.t("preanalyst.page.title"),
    description: ui.t("preanalyst.page.description"),
    home_link: "/",
    sections: localizedSections(ui, answers),
    // Il secondo giro: la richiesta è tornata indietro perché diceva troppo
    // poco. La pagina lo dice in testa al form e si porta dietro il progetto,
    // così la riscrittura non ne fa nascere un altro.
    resumed: resumed ? { project_id: resumed.projectId } : null,
    access: accessData(access, settings),
    aside: asideData({
      driverLink,
      params,
      showDriverBox,
      driversAvailable,
      ambassador,
      isDriver,
      moreUrl: workWithUsUrl(settings),
      autonomousWork,
      locked: Boolean(autonomousWork?.locked),
    }),
    upload: {
      max_mb: Math.round(settings.uploadMaxBytes / (1024 * 1024)),
      accept: settings.uploadAccept,
      messages: uploadMessages(ui),
    },
    // La modale del rifiuto c'è solo per chi ci è appena stato mandato da
    // `/submit`. `rejectedProjectId` arriva già verificato: progetto esistente,
    // di chi guarda, davvero rifiutato (src/server.js).
    rejection: rejectedProjectId
      ? {
          pdf_url: `/projects/${encodeURIComponent(rejectedProjectId)}/rejection.pdf`,
          home_url: settings.frontGateUrl,
        }
      : null,
  });
}
