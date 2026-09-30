// What the lists are made of. Nothing here talks to anybody: it takes the projects
// anagraphics answered with and says which list each one belongs to, and what a
// stopped project stopped on.
//
// The three lists of states below are this subsystem's rules, and they live here
// rather than in anagraphics because that is where they belong: anagraphics applies
// the filter it is given and decides nothing — the same division by which it stores
// `review.preset` without applying the rule that sets it. They travel to it as a
// query.

import { GATE } from "./validation.js";

// From this level upwards a person sees the projects **other people** are not
// supervising. It is in the code and not in the configuration because it is an
// authorisation rule, and that is where this repository already keeps them:
// `MIN_SUPERVISING_LEVEL = 1` sits in the code in both places that apply it
// (webtools/drivers-pool/webtools_drivers_pool/main.py, and
// webtools/preanalyst/src/driver_link.js), with the reason written beside it. The day
// the threshold moves, it moves under review and not by editing a document.
//
// This is the first thing in the system that reads level 2.
export const MIN_BROKEN_PROJECTS_LEVEL = 2;

// The states in which a project is **owed** a driver.
//
// A driver reaches a project at one of two moments: from a link at birth
// (`review.preset: true`), or from the analyst's handover once the analysis is
// written. So a project in `PREANALYSIS`, `PREVALIDATION`, `UNDERSPECIFIED` or
// `ANALYSIS` with no driver is not broken — it is a project that has not got there
// yet, and that is the ordinary case.
//
// `REJECTED` is out as well: a refusal is closed, and nobody is owed to a refusal.
export const STATES_OWED_A_DRIVER = [
  "DRIVER_VALIDATION",
  "CLIENT_VALIDATION",
  "DEVELOPMENT",
  "ALPHA_TEST",
  "DEMO",
  "PAID",
  "FAILED",
  "FAILED_NO_DRIVERS",
];

// The two states a run can be left in, and they are the two lists of stopped
// projects. `FAILED` is a run that did not get to the end; `FAILED_NO_DRIVERS` is one
// that did and found nobody to hand the analysis to.
export const FAILED_STATES = ["FAILED", "FAILED_NO_DRIVERS"];

// The one state that is a driver's own work waiting to be done.
export const DRIVER_REVIEW_STATES = ["DRIVER_VALIDATION"];

/* ---------------------------------------------- the owner's three lists */

// The client's own page splits their projects three ways, because the three call for
// three different things from them: nothing, an answer, or a look at what went wrong.
//
// **Stopped** is not only a run that broke. A project left in `PREANALYSIS` is one whose
// pre-analysis was never finished — the form was sent and the conversation abandoned —
// and from this page there is nothing to do about it, so it belongs here and not among
// the ones that are moving. A refusal is closed, which is another way of not moving.
export const OWNER_STOPPED_STATES = [
  "PREANALYSIS",
  "REJECTED",
  "FAILED",
  "FAILED_NO_DRIVERS",
];

// **The request came back**, because it said too little. It is the one list that asks
// the client for something, which is why it is its own and sits above the stopped ones.
export const OWNER_RETURNED_STATES = ["UNDERSPECIFIED"];

// Everything else is moving: somebody or something is working on it, and `PAID` is in
// here because a project that was paid for is finished and not stopped — a success is
// not a fault, and putting it under the failures would say it was one.

const failed = (project) => FAILED_STATES.includes(stateOf(project));

// The owner's three lists. Every project is in exactly one of them: the two named lists
// are checked, and what neither claims is moving. Written that way round on purpose —
// a state added to the pipeline tomorrow shows up among the active ones, which is a row
// somebody reads, instead of falling out of all three and disappearing from their page.
export function forOwner(projects) {
  const active = [];
  const returned = [];
  const stopped = [];
  for (const project of projects ?? []) {
    const state = stateOf(project);
    if (OWNER_RETURNED_STATES.includes(state)) returned.push(project);
    else if (OWNER_STOPPED_STATES.includes(state)) stopped.push(project);
    else active.push(project);
  }
  return { active, returned, stopped };
}

// The states in which the driver has **approved** the analysis, so the client may read
// the list of functionalities they are being asked to agree to.
//
// `DRIVER_VALIDATION` is deliberately not here: the analysis is written but nobody has
// checked it, and what the client would read is a draft nobody stands behind yet.
//
// `REJECTED` is not here either, and that is the same rule seen from the other side: an
// analysis the driver refused is one nobody stands behind at all, and the client is not
// shown the functionalities of a tool that is not going to be built.
//
// `CLIENT_VALIDATION` is where the driver's approval puts a project (src/validation.js),
// so this is the list that decides what that approval makes visible.
export const APPROVED_BY_DRIVER_STATES = [
  "CLIENT_VALIDATION",
  "DEVELOPMENT",
  "ALPHA_TEST",
  "DEMO",
  "PAID",
];

export function approvedByDriver(project) {
  return APPROVED_BY_DRIVER_STATES.includes(stateOf(project));
}

export function stateOf(project) {
  return project?.pipeline?.state ?? null;
}

// The driver's two lists, out of the projects that driver supervises.
//
// **A project of theirs in another state is in neither**, and is not shown. It is
// read and dropped on purpose: the lists that will hold a project in `DEVELOPMENT`,
// `DEMO` or `PAID` belong to the gates that do not exist yet, and inventing a third
// list now would be a page built for work nothing can do.
//
// **A project they have just decided about leaves both lists**, for that same reason:
// approved it is `CLIENT_VALIDATION` and refused it is `REJECTED`, and neither is a
// state this page has a list for. So the tab says what was decided in a sentence of its
// own (`decided` in src/page.js) rather than letting a row disappear in silence.
export function forDriver(projects) {
  const waiting = [];
  const stopped = [];
  for (const project of projects ?? []) {
    if (DRIVER_REVIEW_STATES.includes(stateOf(project))) waiting.push(project);
    else if (failed(project)) stopped.push(project);
  }
  return { waiting, failed: stopped };
}

// The orphans, split between the ones that are merely unsupervised and the ones that
// have also stopped. What is asked for is already narrowed to the states that are
// owed a driver, so everything that arrives here belongs to one of the two.
export function orphans(projects) {
  const plain = [];
  const stopped = [];
  for (const project of projects ?? []) {
    if (failed(project)) stopped.push(project);
    else plain.push(project);
  }
  return { orphan: plain, orphanFailed: stopped };
}

// The states only the analysis gate leads to. Getting to any of them means the analysis
// was written and both documents were stored: `FAILED_NO_DRIVERS` is in the list because
// that is what the state says of itself — the work was done and what is missing is a
// person.
//
// `REJECTED` and `FAILED` are deliberately out: both are reachable from either side of
// the analysis, so the state alone does not say. For those the last step is asked
// instead (below).
const STATES_AFTER_ANALYSIS = [
  "DRIVER_VALIDATION",
  "CLIENT_VALIDATION",
  "DEVELOPMENT",
  "ALPHA_TEST",
  "DEMO",
  "PAID",
  "FAILED_NO_DRIVERS",
];

// Whether this project's documents — the analysis and the proposal — have been written.
//
// Two ways of knowing, and the first is the direct one: the step that closes the
// analysis carries what was stored (`data.documents`), and for a project that has just
// been analysed that is the last step, which is the one a list carries. When the last
// step is a later one — a handover that found nobody writes its own — the state answers
// instead.
//
// **A third way, and it is the driver's gate.** A project refused there is `REJECTED`
// with the refusal as its last step: the state says nothing, because `REJECTED` is
// reached from either side of the analysis, and the step carries no `documents` because
// the analyst already said where they are and a second copy of that would be a second
// answer. What the step does say is that this gate decided — and this gate is only
// reached once the two documents are stored, so a step of it is the proof.
//
// No page offers them on a refused project today: the client is not shown the
// functionalities of a tool nobody is going to build (`APPROVED_BY_DRIVER_STATES`), and
// a refused project is in none of the driver's lists. The question is still answered
// truthfully, because what is asked here is whether the documents exist and not whether
// somebody is being offered them — that is the page's question, and it is asked
// elsewhere.
export function hasDocuments(project) {
  const steps = project?.pipeline?.steps;
  const last = Array.isArray(steps) && steps.length > 0 ? steps[steps.length - 1] : null;
  if (last?.data?.documents) return true;
  if (last?.step === GATE) return true;
  return STATES_AFTER_ANALYSIS.includes(stateOf(project));
}

// Why a project stopped, or null when nothing says.
//
// **There is no `reason` field on a project.** A failure is written into the `data` of
// the step that failed, by whoever failed: the analyst's `_failed()` writes
// `data.failed_at` (`broken`, `no_specification`, `technical`, `judgement`, `points`,
// `documents`), and a handover that found nobody writes a second step of its own with
// `failed_at: "handover"`. So the last step is the one that says why — which is what
// makes the list's projection enough (`pipeline.steps` sliced to the last one), and why
// a row says the reason when there is one and not always.
//
// A word this subsystem has never heard of comes back as it is: a reason added to the
// pipeline tomorrow shows up as itself rather than disappearing, and whoever reads the
// page learns the fact before the catalogue learns the sentence.
export function whyItStopped(project) {
  const steps = project?.pipeline?.steps;
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const last = steps[steps.length - 1];
  if (last?.result !== "failed") return null;
  const reason = last?.data?.failed_at;
  return typeof reason === "string" && reason !== "" ? reason : null;
}

// The project as a row of a list needs it. The state is not turned into a sentence
// here: the two readers are asked two different questions, so the sentence is chosen
// by whoever renders the page (src/page.js).
//
// `name` and `description` are read where they are and are **not** invented. Nothing in
// the flow decides a project's name yet, so `name` is absent on every project there is,
// and the page shows a placeholder; `description` is absent on every project that was
// not analysed, which is every stopped one. Absent is absent, and nothing is put in its
// place.
export function rowOf(project) {
  return {
    project_id: project.project_id,
    name: project.name ?? null,
    description: project.description ?? null,
    state: stateOf(project),
    autonomous_work: project.billing?.autonomous_work === true,
    stopped_on: whyItStopped(project),
    has_documents: hasDocuments(project),
  };
}
