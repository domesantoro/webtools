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
import { isResolved, OWN_LINK } from "./referral.js";

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
function hiddenFields(referral, params, driversAvailable) {
  const campi = [];
  if (params.discountCode) campi.push({ name: "discount", value: params.discountCode });
  if (driversAvailable && isResolved(referral)) {
    campi.push({ name: "driver", value: referral.driver.uid });
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

// I due pezzi che dipendono da chi è entrato. Sono gli stessi macro usati dalla
// pagina, quindi quella appena caricata e quella aggiornata dal browser non
// possono divergere.
// I pezzi da rimpiazzare dopo il login, ognuno col selettore del contenitore.
// Non si rimpiazza la colonna destra intera: dentro c'è il blocco del
// caricamento, e rifarlo butterebbe via il file che l'utente ha già scelto.
export function renderAccessFragments(access, settings, colonna) {
  const dati = accessData(access, settings);
  const aside = asideData(colonna);
  return {
    logged: dati.logged,
    fragments: {
      "[data-sso-header]": env.render("fragments/access_header.njk", { access: dati }),
      "[data-sso-gate]": env.render("fragments/access_gate.njk", { access: dati }),
      "[data-sso-driver]": env.render("fragments/driver.njk", { aside }),
    },
  };
}

// La colonna destra: il box del driver e, solo per un driver, il blocco del
// lavoro autonomo. Può essere vuota — chi arriva senza link e non è un driver
// non ha niente da vedere lì — e in quel caso la pagina resta a una colonna.
function asideData({ referral, params, showDriverBox, driversAvailable, isDriver }) {
  const ownLink = referral.state === OWN_LINK;
  // Un link proprio non si mostra: il box sparisce e a dirlo è il blocco del
  // lavoro autonomo, che per un driver c'è comunque.
  const boxShow = showDriverBox && !ownLink;
  const resolved = driversAvailable && isResolved(referral);

  return {
    driver_box: {
      show: boxShow,
      drivers_available: driversAvailable,
      resolved,
      referral,
      // L'avviso ha senso solo se c'è una casella da segnare e qualcosa di
      // valido da non applicare: un driver che guarda un riferimento a un altro
      // driver, riconosciuto. Su uno sconto scaduto non c'è niente da ignorare.
      can_be_ignored: boxShow && isDriver && resolved,
      hidden: hiddenFields(referral, params, driversAvailable),
    },
    driver_work: {
      show: isDriver,
      own_link: ownLink,
    },
  };
}

export function renderLoginDone({ ok }) {
  return env.render("login_done.njk", { title: "Accesso", noindex: true, ok });
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

export function renderPage({
  referral,
  params,
  showDriverBox,
  driversAvailable,
  isDriver,
  access,
  settings,
}) {
  return env.render("page.njk", {
    title: "Pre-analisi",
    description:
      "L'ingresso della pre-analisi: si racconta che cosa serve e noi capiamo se possiamo risolverlo.",
    home_link: "/",
    sections: SECTIONS,
    access: accessData(access, settings),
    aside: asideData({ referral, params, showDriverBox, driversAvailable, isDriver }),
    upload: {
      max_mb: Math.round(settings.uploadMaxBytes / (1024 * 1024)),
      accept: settings.uploadAccept,
    },
  });
}
