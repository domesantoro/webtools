// Impostazioni lette dalle variabili d'ambiente, con default per lo sviluppo locale.

export function loadSettings() {
  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 8200),
    // webtools_anagraphics accetta solo chiamate da IP noti: le richieste
    // partono da questo server, non dal browser dell'utente.
    anagraphicsUrl: process.env.ANAGRAPHICS_URL ?? "http://127.0.0.1:8100",
    // Anagraphics aspetta fino a 30 s se Mongo non risponde: noi non possiamo
    // tenere l'utente fermo tanto, quindi tagliamo prima.
    anagraphicsTimeoutMs: Number(process.env.ANAGRAPHICS_TIMEOUT_MS ?? 5000),
    // Il nostro indirizzo visto da fuori: ci torna il browser dopo il login, ed
    // è quello che dichiariamo al sso quando scambiamo il biglietto.
    publicUrl: process.env.PUBLIC_URL ?? "http://127.0.0.1:8200",
    // Il sso: login, stato della sessione, logout. Vedi src/commons/sso_client.js.
    ssoUrl: process.env.SSO_URL ?? "http://127.0.0.1:8300",
    ssoTimeoutMs: Number(process.env.SSO_TIMEOUT_MS ?? 5000),
    // Il **nostro** cookie di sessione. Il nome deve essere diverso da quello
    // del sso: i cookie ignorano la porta, quindi su 127.0.0.1 finiscono tutti
    // nello stesso mucchio e due cookie con lo stesso nome si sovrascrivono.
    cookieName: process.env.COOKIE_NAME ?? "webtools_preanalyst",
    // Caricamento di un'analisi già pronta. Il file per ora si conta e si butta
    // (§ documentazione): il limite serve comunque, o il primo file sbagliato
    // tiene occupata la memoria del server per niente.
    uploadMaxBytes: Number(process.env.UPLOAD_MAX_BYTES ?? 10 * 1024 * 1024),
    // Quello che il browser propone nella finestra di scelta: non è un
    // controllo, è una comodità. Il server non guarda il tipo.
    uploadAccept: process.env.UPLOAD_ACCEPT ?? ".pdf,.doc,.docx,.odt,.md,.txt,.rtf",
  };
}
