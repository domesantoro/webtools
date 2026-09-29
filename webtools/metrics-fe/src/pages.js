// Which pages exist, what each one reads, and which template draws it.
//
// One entry per page. A page that is added is an entry, a view and a template, and
// nothing else in this subsystem has to know about it: the navigation, the routing
// and the period bar are all built from this list.
//
//   route       the address
//   label       what the navigation calls it
//   template    the file in templates/
//   usesPeriod  whether the two days apply to it. The bar is not shown where they do
//               not: a control that changes nothing is worse than no control.
//   view        the readings and the view, from the settings, the period and the
//               address's own parameters

import { readAll, readDaily, readProject, readQuestion, readVocabulary } from "./metrics_api.js";
import { buildDaily } from "./views/daily.js";
import { buildOverview } from "./views/overview.js";
import { buildProject } from "./views/project.js";
import { QUESTION_PAGES, buildQuestion } from "./views/questions.js";
import { buildVocabulary } from "./views/vocabulary.js";

// The page that leads with the three questions this front end exists to answer. It asks
// several questions at once because the three figures come from three different
// answers, and asking them one after the other would make the page as slow as their
// sum.
const overview = {
  route: "/",
  label: "Overview",
  template: "overview.njk",
  usesPeriod: true,
  async view(settings, period) {
    // Every question over this period, and the same ones over the period of the same
    // length before it: a figure on its own says how the system is, the two together
    // say how it is going.
    const asked = ["funnel", "cost", "preanalysis", "providers", "economics", "health"];
    const readings = await readAll({
      ...Object.fromEntries(asked.map((name) => [name, readQuestion(settings, name, period)])),
      ...Object.fromEntries(
        asked.map((name) => [`${name} (period before)`, readQuestion(settings, name, period.previous)])
      ),
      daily: readDaily(settings, period),
    });
    return { readings, ...buildOverview({ readings, settings, period }) };
  },
};

// One page per question metrics answers. The label is the question's own heading, so
// the navigation and the page cannot disagree about what it is called.
const questions = Object.entries(QUESTION_PAGES).map(([name, definition]) => ({
  route: `/${name}`,
  label: definition.heading,
  template: "question.njk",
  usesPeriod: true,
  async view(settings, period) {
    // The same question twice: over this period, and over the one of the same length
    // before it. A figure on its own says how the system is; the two together say how
    // it is going, which is what somebody opens a dashboard for.
    //
    // The reading of the period before is not allowed to take the page down with it:
    // it lands in `readings` under its own name, so a failure is reported as its own
    // failure and the figures of this period are still drawn.
    const readings = await readAll({
      [name]: readQuestion(settings, name, period),
      [`${name} (period before)`]: readQuestion(settings, name, period.previous),
      // What the economics page needs beyond its own question: the whole consumption
      // of the period, which `cost` answers and `economics` does not.
      ...(name === "economics" ? { cost: readQuestion(settings, "cost", period) } : {}),
    });
    const answerOf = (key) => (readings[key]?.ok ? readings[key].answer : null);
    return {
      readings,
      ...buildQuestion(name, answerOf(name), answerOf(`${name} (period before)`), {
        limit: settings.topRows,
        slices: settings.ringSlices,
        also: { cost: answerOf("cost") },
      }),
    };
  },
}));

const daily = {
  route: "/daily",
  label: "Buckets",
  template: "daily.njk",
  usesPeriod: true,
  async view(settings, period, parameters) {
    // One metric, or all of them. A name that metrics does not know is refused by
    // metrics, and the page says which name it was: correcting it here would show a
    // reading of something else under the name that was asked for.
    const chosen = parameters.get("metric") || null;
    const readings = await readAll({
      daily: readDaily(settings, period, chosen),
      vocabulary: readVocabulary(settings),
    });
    return { readings, ...buildDaily({ readings, settings, period, chosen }) };
  },
};

const project = {
  route: "/projects",
  label: "Project",
  template: "project.njk",
  // An accumulator is everything that project ever did, so the period does not
  // apply to it.
  usesPeriod: false,
  async view(settings, period, parameters) {
    const projectId = parameters.get("id") || null;
    if (!projectId) return { readings: {}, ...buildProject({ readings: {}, projectId: null }) };
    const readings = await readAll({
      project: readProject(settings, projectId),
      vocabulary: readVocabulary(settings),
    });
    return { readings, ...buildProject({ readings, projectId }) };
  },
};

const vocabulary = {
  route: "/vocabulary",
  label: "Vocabulary",
  template: "vocabulary.njk",
  usesPeriod: false,
  async view(settings) {
    const readings = await readAll({ vocabulary: readVocabulary(settings) });
    return { readings, ...buildVocabulary({ readings }) };
  },
};

export const PAGES = [overview, ...questions, daily, project, vocabulary];

export function pageAt(route) {
  return PAGES.find((page) => page.route === route) ?? null;
}

// The navigation, the same on every page. `current` is what the bar marks instead of
// offering it again.
export function navigation(route) {
  return PAGES.map((page) => ({
    route: page.route,
    label: page.label,
    // Whether the two days mean anything there, so the bar carries the period across
    // to the pages it applies to and not to the ones it does not.
    usesPeriod: page.usesPeriod,
    current: page.route === route,
  }));
}
