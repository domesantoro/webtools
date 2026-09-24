// Impostazioni, lette all'avvio dalla configurazione `preanalyst` in anagraphics
// (webtools/configurator/configuration/preanalyst.json). Niente valori di
// default: se manca un campo, loadSettings lancia ConfigurationError e il server
// non parte.

import { loadConfiguration } from "./commons/configuration_client.js";
import { loadI18n } from "./commons/i18n/webtools_i18n.js";

export async function loadSettings() {
  const configuration = await loadConfiguration("preanalyst");
  return {
    host: configuration.string("listen.host"),
    port: configuration.port("listen.port"),
    // webtools_anagraphics accetta solo chiamate da IP noti: le richieste
    // partono da questo server, non dal browser dell'utente. L'indirizzo è
    // quello da cui è arrivata la configurazione.
    anagraphicsUrl: configuration.anagraphicsUrl,
    // Anagraphics può aspettare a lungo se Mongo non risponde: noi non possiamo
    // tenere l'utente fermo tanto, quindi tagliamo prima.
    anagraphicsTimeoutMs: configuration.integer("subsystems_infos.anagraphics.timeout_ms", { min: 1 }),
    // Il nostro indirizzo visto da fuori: ci torna il browser dopo il login, ed
    // è quello che dichiariamo al sso quando scambiamo il biglietto.
    publicUrl: configuration.httpUrl("public_url"),
    // I file dei progetti: le specifiche caricate e le pre-specifiche del form.
    workspacesUrl: configuration.httpUrl("subsystems_infos.workspaces.url"),
    workspacesTimeoutMs: configuration.integer("subsystems_infos.workspaces.timeout_ms", { min: 1 }),
    // Il sso: login, stato della sessione, logout. Vedi src/commons/sso_client.js.
    ssoUrl: configuration.httpUrl("subsystems_infos.sso.url"),
    ssoTimeoutMs: configuration.integer("subsystems_infos.sso.timeout_ms", { min: 1 }),
    // Il **nostro** cookie di sessione. Il nome deve essere diverso da quello
    // del sso: i cookie ignorano la porta, quindi su 127.0.0.1 finiscono tutti
    // nello stesso mucchio e due cookie con lo stesso nome si sovrascrivono.
    cookieName: configuration.string("session.cookie_name"),
    // Caricamento di un'analisi già pronta: un .md con il project_id nel front
    // matter. Il file si tiene in memoria finché non è verificato, quindi il
    // limite serve anche a questo.
    uploadMaxBytes: configuration.integer("upload.max_bytes", { min: 1 }),
    // Quello che il browser propone nella finestra di scelta: non è un
    // controllo, è una comodità. Il server non guarda il tipo né l'estensione:
    // guarda che il contenuto sia testo UTF-8 con un front matter valido.
    uploadAccept: configuration.string("upload.accept"),
    // Il sito vetrina: il blocco del lavoro autonomo rimanda alla sua pagina
    // "Lavora con noi". Solo http(s): il valore finisce in un href.
    frontGateUrl: configuration.httpUrl("subsystems_infos.front_gate.url"),
    // Il form della pre-analisi: tutte le risposte insieme. Ferma i corpi assurdi.
    formMaxBytes: configuration.integer("form.body_max_bytes", { min: 1 }),
    // Quanto testo si accetta in una risposta aperta. Un racconto lungo sta in
    // poche migliaia di caratteri: oltre è un incollaggio sbagliato, non una risposta.
    answerMaxChars: configuration.integer("form.answer_max_chars", { min: 1 }),
    // Il modulo IA: quale fornitore si usa e come lo si raggiunge. La chiave
    // arriva dai segreti (configurator/secrets/preanalyst.json), fusi nella
    // configurazione al caricamento: qui è un campo come gli altri, e se manca
    // il server non parte.
    ai: {
      provider: configuration.string("ai.provider"),
      timeoutMs: configuration.integer("ai.timeout_ms", { min: 1 }),
      providers: {
        anthropic: {
          model: configuration.string("ai.providers.anthropic.model"),
          maxTokens: configuration.integer("ai.providers.anthropic.max_tokens", { min: 1 }),
          apiKey: configuration.string("ai.providers.anthropic.api_key"),
        },
      },
    },
    // Il primo cancello: vedi src/prevalidator.js.
    prevalidation: {
      // Quale policy si usa. Il file sta in policies/, copia generata
      // dall'originale in configurator/policies/.
      policy: configuration.string("prevalidation.policy"),
      // Sopra questa probabilità di `run_out_certain` la richiesta si rifiuta.
      rejectThreshold: configuration.number("prevalidation.reject_threshold", { min: 0, max: 1 }),
      // Quanta pre-specifica si manda al modello. Rete di sicurezza: le risposte
      // aperte sono già limitate all'invio.
      specMaxChars: configuration.integer("prevalidation.spec_max_chars", { min: 1 }),
      // Quante volte la stessa richiesta può tornare indietro per mancanza di
      // dettagli. Oltre questo numero non si chiede più: si rifiuta.
      maxUnderspecifiedAttempts: configuration.integer("prevalidation.max_underspecified_attempts", {
        min: 0,
      }),
      // Se la motivazione estesa del rigetto finisce nel PDF anche per chi non è
      // un driver. I driver la vedono comunque.
      rejectionReasonInPdf: configuration.boolean("prevalidation.rejection_reason_in_pdf"),
    },
    // Lingue, cataloghi e cookie della lingua: vedi src/commons/i18n/webtools_i18n.js.
    i18n: loadI18n(configuration),
  };
}
