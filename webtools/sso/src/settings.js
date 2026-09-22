// Impostazioni, lette all'avvio dalla configurazione `sso` in anagraphics
// (webtools/configurator/configuration/sso.json). Niente valori di default: se
// manca un campo, loadSettings lancia ConfigurationError e il server non parte.

import { loadConfiguration } from "./commons/configuration_client.js";
import { loadI18n } from "./commons/i18n/webtools_i18n.js";

export async function loadSettings() {
  const configuration = await loadConfiguration("sso");
  return {
    host: configuration.string("listen.host"),
    port: configuration.port("listen.port"),
    // Sottosistema interno: risponde solo a chi chiama dagli IP del pool.
    // È un controllo sull'IP della connessione, non un'autorizzazione: dice da
    // dove arriva la richiesta, non per conto di chi.
    allowedIps: configuration.stringList("access.allowed_ips"),
    // Utenti, credenziali, sessioni e biglietti stanno tutti lì: il sso non ha
    // database. L'indirizzo è quello da cui è arrivata la configurazione.
    anagraphicsUrl: configuration.anagraphicsUrl,
    anagraphicsTimeoutMs: configuration.integer("subsystems_infos.anagraphics.timeout_ms", { min: 1 }),
    // Durata di una sessione, dal login. Non si allunga da sola a ogni lettura:
    // chi è entrato otto ore fa rifà il login, anche se ha lavorato tutto il giorno.
    sessionTtlSeconds: configuration.integer("session.ttl_seconds", { min: 1 }),
    // Il cookie del sso: dice a questo server che quel browser è già entrato,
    // così il secondo sottosistema non richiede la password. Il nome deve essere
    // diverso da quello dei sottosistemi: i cookie ignorano la porta, quindi su
    // 127.0.0.1 stanno tutti nello stesso mucchio e due cookie con lo stesso
    // nome si sovrascriverebbero a vicenda.
    cookieName: configuration.string("session.cookie_name"),
    // Il biglietto vive il tempo di un redirect, non di più.
    ticketTtlSeconds: configuration.integer("ticket.ttl_seconds", { min: 1 }),
    // Dove si può rimandare il browser dopo il login. Senza questo elenco,
    // chiunque potrebbe costruire un link `…/ui/login?next=http://sito-finto`
    // e usare la nostra pagina di login come trampolino.
    allowedNext: configuration.httpUrlList("login.allowed_next"),
    // Il corpo più grande accettato da login, scambio del biglietto e form.
    bodyMaxBytes: configuration.integer("limits.body_max_bytes", { min: 1 }),
    // Lingue, cataloghi e cookie della lingua: vedi src/commons/i18n/webtools_i18n.js.
    i18n: loadI18n(configuration),
  };
}

// L'indirizzo a cui tornare dopo il login è deciso da chi ci manda qui, quindi
// non ci si fida: deve cominciare per uno degli indirizzi ammessi. Se non va
// bene si torna al primo della lista, e la cosa finisce nel log.
export function safeNext(settings, next) {
  const fallback = settings.allowedNext[0] ?? "/";
  if (!next) return fallback;
  const ammesso = settings.allowedNext.some(
    (base) => next === base || next.startsWith(`${base}/`)
  );
  if (ammesso) return next;
  console.warn(`[sso] next fuori dagli indirizzi ammessi, ignorato: ${next}`);
  return fallback;
}
