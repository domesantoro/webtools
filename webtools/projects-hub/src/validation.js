// The driver's gate: the rules by which an analysis is approved or refused.
//
// Nothing here talks to anybody. It says what the two decisions are in the pipeline's
// words, who may take them, on which projects, and what makes a refusal's motivation an
// acceptable one. The writing itself is `addPipelineStep` in src/anagraphics.js, and the
// pages are src/server.js — the same division `src/projects.js` already keeps.

// The step this gate writes. It is a name from anagraphics' closed list
// (`PipelineStepName`), and it is also the word `gate.decided` and `gate.duration` are
// counted under: one name for the gate, not three.
export const GATE = "driver_validation";

// Where a project has to be for this gate to decide anything. It is the **state** and
// never the presence of an open step: the analyst opens a `driver_validation` step when
// it hands the project over, but a project handed over before that step existed is
// waiting on a driver just the same, and a gate that read the steps would refuse to
// decide about it.
export const DECIDABLE_STATE = "DRIVER_VALIDATION";

export const APPROVE = "approve";
export const REJECT = "reject";

// The two decisions, each in the pipeline's words: how the step went, and where it takes
// the project. Two different things, which is why anagraphics stores them separately —
// the same outcome leads to different places at different gates.
//
// **Approving sends the project to the client**, not to the developer: the flow puts the
// client's own validation between the two, and `APPROVED_BY_DRIVER_STATES` in
// src/projects.js already reads `CLIENT_VALIDATION` as the first state in which the
// client may be shown the list of functionalities. Nothing is triggered by it today —
// the gate that asks the client does not exist — so what approving does is move the
// project and say so.
//
// **Refusing closes the request**: `REJECTED` is the terminus of every gate, and there is
// no route anywhere that takes a project out of it.
const DECISIONS = {
  [APPROVE]: { result: "passed", state: "CLIENT_VALIDATION", needsReason: false },
  [REJECT]: { result: "rejected", state: "REJECTED", needsReason: true },
};

// The decision this name stands for, or `null` for a word that is not one of the two.
// A word we do not know is not a third decision: it is somebody posting by hand, and the
// route turns it into the same 404 as everything else that is not there.
export function decisionOf(name) {
  return DECISIONS[name] ?? null;
}

// Whether this driver may decide about this project, as the project itself says.
//
// **Only the project's own driver**, and not the level that sees other people's projects.
// That level exists so that a project nobody supervises can be found (`/broken`), which
// is a different thing from taking somebody else's decision for them: the analysis was
// handed to one person, and the step will carry their name. An administrator who wants to
// decide takes the project first, which is a route that does not exist yet.
export function mayDecide(project, driverUid) {
  if (!driverUid) return false;
  if (project?.review?.driver?.uid !== driverUid) return false;
  return project?.pipeline?.state === DECIDABLE_STATE;
}

// The motivation of a refusal, as the driver typed it. Either the text, or the name of
// what is wrong with it — and the two things that can be wrong are different facts, so
// they are two names: there is nothing there, or there is too much of it.
//
// The text is trimmed before it is judged and before it is stored: a box holding three
// newlines is a box nobody wrote in, and storing the spaces somebody happened to leave
// around a sentence would put them in front of whoever reads it next.
//
// **The length is counted in characters, not in bytes**, because the limit is about a
// sentence a person has to read and not about what it weighs: the same sentence in two
// languages would otherwise be two different lengths. What the body weighs is a separate
// limit, and it is checked before this — by the time the text gets here it has already
// been read.
export function reasonFrom(text, maxChars) {
  const written = (text ?? "").trim();
  if (written === "") return { ok: false, wrong: "missing" };
  if (Array.from(written).length > maxChars) return { ok: false, wrong: "too_long" };
  return { ok: true, reason: written };
}

// What the step carries. A refusal carries the sentence the driver wrote, an approval
// carries nothing: there is no field to fill in, and an empty one would read as a
// motivation that was asked for and not given.
//
// `driver_uid` is on it because the project's copy of the driver can change — a project
// can be handed to somebody else — and the step is the register of who decided, which
// does not change afterwards.
export function stepData({ driverUid, reason = null }) {
  return { driver_uid: driverUid, ...(reason === null ? {} : { reason }) };
}
