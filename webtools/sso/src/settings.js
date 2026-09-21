// Impostazioni lette dalle variabili d'ambiente, con default per lo sviluppo locale.

export function loadSettings() {
  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 8300),
    // Sottosistema interno: risponde solo a chi chiama da questa macchina.
    // È un controllo sull'IP della connessione, non un'autorizzazione: dice da
    // dove arriva la richiesta, non per conto di chi.
    allowedIps: split(process.env.ALLOWED_IPS ?? "127.0.0.1,::1"),
    // Utenti, credenziali, sessioni e biglietti stanno tutti lì: il sso non ha database.
    anagraphicsUrl: process.env.ANAGRAPHICS_URL ?? "http://127.0.0.1:8100",
    anagraphicsTimeoutMs: Number(process.env.ANAGRAPHICS_TIMEOUT_MS ?? 5000),
    // Durata di una sessione, dal login. Non si allunga da sola a ogni lettura:
    // chi è entrato otto ore fa rifà il login, anche se ha lavorato tutto il giorno.
    sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 8 * 60 * 60),
    // Il cookie del sso: dice a questo server che quel browser è già entrato,
    // così il secondo sottosistema non richiede la password. Il nome deve essere
    // diverso da quello dei sottosistemi: i cookie ignorano la porta, quindi su
    // 127.0.0.1 stanno tutti nello stesso mucchio e due cookie con lo stesso
    // nome si sovrascriverebbero a vicenda.
    cookieName: process.env.COOKIE_NAME ?? "webtools_sso",
    // Il biglietto vive un minuto: il tempo di un redirect, non di più.
    ticketTtlSeconds: Number(process.env.TICKET_TTL_SECONDS ?? 60),
    // Dove si può rimandare il browser dopo il login. Senza questo elenco,
    // chiunque potrebbe costruire un link `…/ui/login?next=http://sito-finto`
    // e usare la nostra pagina di login come trampolino.
    allowedNext: split(
      process.env.ALLOWED_NEXT ?? "http://127.0.0.1:8200,http://localhost:8200"
    ),
  };
}

function split(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
