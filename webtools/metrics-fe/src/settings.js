// Settings, read at startup from the `metrics-fe` configuration in anagraphics
// (webtools/configurator/configuration/metrics-fe.json). No default values: if a
// field is missing, loadSettings throws ConfigurationError and the server does not
// start.

import { loadConfiguration } from "./commons/configuration_client.js";

export async function loadSettings() {
  const configuration = await loadConfiguration("metrics-fe");
  return {
    host: configuration.string("listen.host"),
    port: configuration.port("listen.port"),
    // Internal instrumentation: it answers only callers from the pool's IPs. It
    // is a check on the connection's IP, not an authorisation: it says where the
    // request comes from, not on whose behalf.
    allowedIps: configuration.stringList("access.allowed_ips"),
    // The only thing this server reads. Every figure on every page comes from
    // there, and nothing is computed from a second source.
    metricsUrl: configuration.httpUrl("subsystems_infos.metrics.url"),
    // A page asks metrics several questions at once, and a period of a year is a
    // read of hundreds of buckets: the timeout is the one of a page being drawn,
    // not of a measurement being sent.
    metricsTimeoutMs: configuration.integer("subsystems_infos.metrics.timeout_ms", { min: 1 }),
    // How long a period is when the address does not say. A period has to be some
    // length, and which length is worth opening a page on is a decision, so it is
    // configured rather than written here.
    defaultDays: configuration.integer("period.default_days", { min: 1 }),
    // The lengths the bar at the top offers in one click. A list, not a guess.
    presetsDays: configuration.integerList("period.presets_days", { min: 1 }),
    // How many rows a ranked table shows. Routes, models and dimension values are
    // open lists — there may be hundreds — and a page that prints all of them is
    // a page nobody reads. What is left out is counted and said.
    topRows: configuration.integer("limits.top_rows", { min: 1 }),
    // How many metrics get a line of their own in a chart over time. The rest are
    // named, not summed into an "other" that would add up occurrences of
    // different things.
    seriesMetrics: configuration.integer("limits.series_metrics", { min: 1 }),
    // How many slices a ring may have before the rest fold into one. There are as
    // many hues that have been checked to be told apart, and a slice past them would
    // be a colour nobody can distinguish from another.
    ringSlices: configuration.integer("limits.ring_slices", { min: 1 }),
  };
}
