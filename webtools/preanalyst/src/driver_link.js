// Il link di un driver, letto dall'URL: decide che cosa mostra il box del driver
// e quali campi nascosti viaggiano col form. Non decide niente del progetto: driver
// e sconti del progetto li scrive `projectTerms()` in server.js (`review`, `billing`).
//
// Due strade portano allo stesso posto — la scelta del driver già fatta e bloccata —
// ma non sono la stessa cosa:
//
//   ?discount=<codice UUID>   link di un driver CON codice sconto
//   ?driver=<uid UUID>        link di un driver SENZA sconto
//
// Se arrivano tutti e due vince `discount`, perché è l'unico che porta con sé un
// effetto economico: ignorarlo per seguire `driver` toglierebbe all'utente uno
// sconto a cui ha diritto. Il caso resta nel log, perché un link con entrambi i
// parametri è quasi sempre un errore di chi l'ha costruito.
//
// Gli esiti, e la pagina non ne conosce altri:
//
//   none                      nessun parametro: il box non si mostra affatto
//   discount_applied          sconto valido e driver riconosciuto e abilitato
//   discount_expired          la lettura dello sconto è fallita: sconto inapplicabile
//   discount_driver_missing   sconto letto, ma il suo driver non si trova più
//   discount_driver_disabled  sconto letto, ma il suo driver non è abilitato:
//                             né lo sconto né il driver si applicano
//   driver_applied            driver del link riconosciuto e abilitato, senza sconto
//   driver_unknown            driver del link non trovato
//   driver_disabled           driver del link trovato ma non abilitato
//   own_link                  il link è di chi lo sta usando: un driver non si
//                             manda un cliente da solo, quindi non si applica
//
// Un driver **non abilitato** (`enabled` diverso da true) esiste, ma non può
// seguire progetti di clienti: con lui il sistema non prosegue, e il progetto
// lo assegniamo noi.
//
// Il driver non si sceglie: o lo porta il link, o lo assegniamo noi.

import { findDiscount } from "./anagraphics.js";

export const NONE = "none";
export const DISCOUNT_APPLIED = "discount_applied";
export const DISCOUNT_EXPIRED = "discount_expired";
export const DISCOUNT_DRIVER_MISSING = "discount_driver_missing";
export const DRIVER_APPLIED = "driver_applied";
export const DRIVER_UNKNOWN = "driver_unknown";
export const DISCOUNT_DRIVER_DISABLED = "discount_driver_disabled";
export const DRIVER_DISABLED = "driver_disabled";
export const OWN_LINK = "own_link";

// Gli stati in cui il driver è stato riconosciuto: c'è un nome da mostrare e un
// uid da mandare avanti col form. Negli altri il driver lo assegniamo noi.
const RESOLVED = new Set([DISCOUNT_APPLIED, DRIVER_APPLIED]);

export function isResolved(driverLink) {
  return RESOLVED.has(driverLink.state);
}

async function fromDiscount(settings, discountCode, drivers) {
  const result = await findDiscount(settings, discountCode);
  if (!result.ok) {
    // Sia il codice inesistente sia il guasto tecnico: per l'utente lo sconto
    // non si applica e basta. La differenza resta nel log di anagraphics.js.
    return { state: DISCOUNT_EXPIRED, code: discountCode };
  }

  const discount = result.data;
  const driverUid = discount.driver?.uid;
  const known = drivers.find((driver) => driver.uid === driverUid);

  if (!known) {
    return {
      state: DISCOUNT_DRIVER_MISSING,
      code: discountCode,
      // Il nome arriva dalla copia ridondata dentro lo sconto: è l'unico
      // appiglio che resta all'utente per riconoscere chi contattare.
      driverName: discount.driver?.screen_name ?? null,
      driverUid: driverUid ?? null,
    };
  }

  if (known.enabled !== true) {
    return { state: DISCOUNT_DRIVER_DISABLED, code: discountCode, driver: known };
  }

  return {
    state: DISCOUNT_APPLIED,
    code: discountCode,
    driver: known,
    percentage: discount.percentage,
  };
}

function fromDriver(driverUid, drivers) {
  // Nessuna lettura in più: l'elenco dei driver è già stato caricato, e contiene
  // tutti i driver. Se l'uid non è lì dentro, non esiste da nessun'altra parte.
  const known = drivers.find((driver) => driver.uid === driverUid);
  if (!known) {
    return { state: DRIVER_UNKNOWN, driverUid };
  }
  if (known.enabled !== true) {
    return { state: DRIVER_DISABLED, driver: known };
  }
  return { state: DRIVER_APPLIED, driver: known };
}

// Un driver che compila la pre-analisi per sé non può usare il proprio link:
// né il proprio sconto, né il proprio uid. Sarebbe uno sconto che si fa da solo.
// I link **di altri driver** restano validi: quelli sono lavoro portato da loro.
//
// Il confronto si fa sull'uid del driver, non sullo username: l'uid non cambia
// mai, lo username sì.
export function withoutOwnLink(driverLink, ownDriverUid) {
  if (!ownDriverUid) return driverLink;

  const uid = driverLink.driver?.uid ?? driverLink.driverUid ?? null;
  if (uid !== ownDriverUid) return driverLink;

  return { state: OWN_LINK, code: driverLink.code ?? null };
}

export async function resolveDriverLink(settings, { discountCode, driverUid }, drivers) {
  if (discountCode) {
    if (driverUid) {
      console.warn(
        `[preanalyst] link con discount e driver insieme: vince discount ` +
          `(discount=${discountCode}, driver=${driverUid})`
      );
    }
    return fromDiscount(settings, discountCode, drivers);
  }
  if (driverUid) {
    return fromDriver(driverUid, drivers);
  }
  return { state: NONE };
}
