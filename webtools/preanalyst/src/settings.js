// Settings, read at startup from the `preanalyst` configuration in anagraphics
// (webtools/configurator/configuration/preanalyst.json). No default values: if a
// field is missing, loadSettings throws ConfigurationError and the server does not
// start.

import { loadConfiguration } from "./commons/configuration_client.js";
import { loadPrevalidatorAiSettings } from "./prevalidator_ai/webtools_prevalidator_ai.js";
import { loadPreanalystAiSettings } from "./preanalyst_ai/webtools_preanalyst_ai.js";
import { loadI18n } from "./commons/i18n/webtools_i18n.js";
import { loadMetrics } from "./commons/metrics/webtools_metrics_client.js";

export async function loadSettings() {
  const configuration = await loadConfiguration("preanalyst");
  return {
    host: configuration.string("listen.host"),
    port: configuration.port("listen.port"),
    // Where the measurements go. Nothing waits for it: see
    // src/commons/metrics/webtools_metrics_client.js.
    metrics: loadMetrics(configuration),
    // webtools_anagraphics only accepts calls from known IPs: the requests start
    // from this server, not from the user's browser. The address is the one the
    // configuration came from.
    anagraphicsUrl: configuration.anagraphicsUrl,
    // Anagraphics can wait a long time if Mongo does not answer: we cannot keep
    // the user standing still that long, so we cut earlier.
    anagraphicsTimeoutMs: configuration.integer("subsystems_infos.anagraphics.timeout_ms", { min: 1 }),
    // Our address as seen from outside: the browser comes back to it after the
    // login, and it is what we declare to the sso when exchanging the ticket.
    publicUrl: configuration.httpUrl("public_url"),
    // The project files: uploaded specifications and the form's pre-specifications.
    workspacesUrl: configuration.httpUrl("subsystems_infos.workspaces.url"),
    workspacesTimeoutMs: configuration.integer("subsystems_infos.workspaces.timeout_ms", { min: 1 }),
    // Where the analysis is written. The call only starts a run: it answers in
    // milliseconds and the work goes on for minutes, so this timeout is about the
    // trigger being taken, not about the analysis being written.
    analystUrl: configuration.httpUrl("subsystems_infos.analyst.url"),
    analystTimeoutMs: configuration.integer("subsystems_infos.analyst.timeout_ms", { min: 1 }),
    // Where what has to be said to a person is handed over. The rounds of questions say
    // everything else on the page itself, because the client is in front of it: what
    // goes through here is what the page cannot promise.
    commCenterUrl: configuration.httpUrl("subsystems_infos.comm_center.url"),
    commCenterTimeoutMs: configuration.integer("subsystems_infos.comm_center.timeout_ms", { min: 1 }),
    // The sso: login, session state, logout. See src/commons/sso_client.js.
    ssoUrl: configuration.httpUrl("subsystems_infos.sso.url"),
    ssoTimeoutMs: configuration.integer("subsystems_infos.sso.timeout_ms", { min: 1 }),
    // **Our** session cookie. The name must differ from the sso's: cookies ignore
    // the port, so on 127.0.0.1 they all end up in the same pile and two cookies
    // with the same name overwrite each other.
    cookieName: configuration.string("session.cookie_name"),
    // Uploading a ready-made specification: a .md with the project_id in the front
    // matter. The file is held in memory until it has been checked, so the limit
    // serves that too.
    uploadMaxBytes: configuration.integer("upload.max_bytes", { min: 1 }),
    // What the browser suggests in the file picker: not a check, a convenience.
    // The server looks at neither the type nor the extension: it looks that the
    // content is UTF-8 text with a valid front matter.
    uploadAccept: configuration.string("upload.accept"),
    // The showcase site: the autonomous-work block links to its "Work with us"
    // page. Only http(s): the value ends up in an href.
    frontGateUrl: configuration.httpUrl("subsystems_infos.front_gate.url"),
    // The pre-analysis form: every answer together. It stops absurd bodies.
    formMaxBytes: configuration.integer("form.body_max_bytes", { min: 1 }),
    // How much text is accepted in an open answer. A long story fits in a few
    // thousand characters: beyond that it is a wrong paste, not an answer.
    answerMaxChars: configuration.integer("form.answer_max_chars", { min: 1 }),
    // The first gate: see src/prevalidator.js.
    prevalidation: {
      // Its AI, which is its own structure: src/prevalidator_ai/. What a provider
      // needs is read by the provider itself, and only for the one selected.
      // Secrets included — the keys are merged into the configuration at load
      // time (configurator/secrets/preanalyst.json), so down there they are
      // fields like any other, and if one is missing the server does not start.
      ai: loadPrevalidatorAiSettings(configuration, "prevalidation"),
      // Which policy is used. The file lives in policies/, a copy generated from
      // the original in configurator/policies/.
      policy: configuration.string("prevalidation.policy"),
      // Above this probability of `run_out_certain` the request is refused.
      rejectThreshold: configuration.number("prevalidation.reject_threshold", { min: 0, max: 1 }),
      // How much of the pre-specification is sent to the model. A safety net: the
      // open answers are already limited at submission time.
      // How many times the same request may come back for want of detail. Past
      // this number no more is asked: it is refused.
      maxUnderspecifiedAttempts: configuration.integer("prevalidation.max_underspecified_attempts", {
        min: 0,
      }),
      // Whether the extended reason for the refusal ends up in the PDF for
      // non-drivers too. Drivers see it anyway.
      rejectionReasonInPdf: configuration.boolean("prevalidation.rejection_reason_in_pdf"),
    },
    // The rounds of questions in /preanalysis/{id}: see §14.3 of the
    // documentation. How many of them there are, and when the page starts saying
    // they are running out.
    preanalysis: {
      // How many turns — a question and its answer — are included. Once they are
      // gone, the field for writing disappears and buying more is offered.
      maxTurns: configuration.integer("preanalysis.max_turns", { min: 1 }),
      // From which turn we warn that they are running out. Before that nothing is
      // said: a counter that alarms from the first message makes people write
      // less, which is the opposite of what is needed here.
      warnFromTurn: configuration.integer("preanalysis.warn_from_turn", { min: 1 }),
    },
    // This subsystem's own doors towards a model, which are **not** the
    // prevalidator's: another structure, another door (src/preanalyst_ai/), another
    // provider, another key. One can run on one provider and the other on a
    // different one, and neither knows.
    //
    // Two engines, each with its own configuration: one conducts the conversation,
    // the validator judges whether what came out of it is a complete pre-analysis.
    // Neither is asked to grade itself.
    preanalyst: {
      conversation: {
        ai: loadPreanalystAiSettings(configuration, "preanalyst.conversation"),
        // Which policy it follows. The file lives in policies/, a copy
        // generated from the original in configurator/policies/.
        policy: configuration.string("preanalyst.conversation.policy"),
      },
      validation: {
        ai: loadPreanalystAiSettings(configuration, "preanalyst.validation"),
        policy: configuration.string("preanalyst.validation.policy"),
        // Every axis must be above this for a `pass` the model asked for to
        // become a `pass`: the weakest one decides. See
        // src/preanalysis_validator.js.
        passThreshold: configuration.number("preanalyst.validation.pass_threshold", { min: 0, max: 1 }),
      },
    },
    // Languages, catalogues and the language cookie: see src/commons/i18n/webtools_i18n.js.
    i18n: loadI18n(configuration),
  };
}
