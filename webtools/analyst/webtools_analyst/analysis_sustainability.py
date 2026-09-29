"""The judgement of sustainability: is this a small tool that can be built in one pass?

Its reader is us. It is sent the material **and** the technical analysis just written,
and it exists as a door of its own for a reason already written down in this
repository: nobody is a fair judge of their own work.

**The criterion is not invented here.** It is the one the prevalidation already
applies, in `webtools/configurator/policies/scope-v1.md`: a request runs out when
building it honestly would take far more work, far more decisions or far more unknowns
than a single small tool, and that policy lists the signals. What this door adds is
not a new standard but better material to apply it to — a request that has been
through the rounds of questions, and an analysis written from it, instead of a form.

**What it returns is a proposal, never a refusal.** The analyst does not write
`REJECTED`. Whatever the verdict, the project goes on to a person, who can disagree
with it — which is why the answer carries the numbers and the reasoning and not only
the conclusion. A refusal nobody downstream can weigh is not a proposal.

**Where the axes live.** Here, in `AXES`, because this file builds the schema the
model must answer in and checks that no score is missing or out of range: the shape of
the answer belongs to the code, and it cannot be read out of a Markdown file that is
configuration and can be redeployed under a running server. The policy says what each
axis *means*, in words, and a test asserts that it names every one of them — which is
what keeps the two from drifting apart, rather than pretending there is only one place.
"""

import re
from pathlib import Path

from webtools_analyst.analysis_sustainability_ai.contract import material, unusable
from webtools_analyst.analysis_sustainability_ai.webtools_analysis_sustainability_ai import (
    judge as ask,
)
from webtools_analyst.measured_ai import ANALYSIS_SUSTAINABILITY, report_interaction, report_unusable

POLICIES = Path(__file__).resolve().parent.parent / "policies"

# The five axes. Each is one of the ways `scope-v1` says a request runs out, and each
# is a number from 0 to 1 where **1 is comfortably inside the perimeter** and a low
# number is the thing that runs out. They are not a new criterion: they are that
# policy's signals, grouped so that an answer can say *in what respect* something is
# too big, which is what a person needs in order to disagree with the proposal.
AXES = ("people", "integrations", "constraints", "surface", "settled")

VERDICTS = ("take_on", "refuse")

# No `minimum`, no `maximum`, no `minLength` and no recursive schema: constrained
# output answers 400 to all of them. The range of every number is checked below,
# after the answer has arrived.
SCHEMA = {
    "type": "object",
    "properties": {
        "scores": {
            "type": "object",
            "properties": {axis: {"type": "number"} for axis in AXES},
            "required": list(AXES),
            "additionalProperties": False,
        },
        "verdict": {"type": "string", "enum": list(VERDICTS)},
        "confidence": {"type": "number"},
        "reason": {"type": "string"},
    },
    "required": ["scores", "verdict", "confidence", "reason"],
    "additionalProperties": False,
}

REQUEST = (
    "Above you have the material the client produced and then, as the last thing before this "
    "message, the technical analysis written from it by another engine. Judge it now."
)

_BANNER = re.compile(r"^\s*<!--[\s\S]*?-->\s*")
_policies: dict[str, str] = {}


def read_policy(name: str) -> str:
    if name not in _policies:
        text = (POLICIES / f"{name}.md").read_text(encoding="utf-8")
        _policies[name] = _BANNER.sub("", text)
    return _policies[name]


def material_of(specification: str, chat) -> list[dict]:
    """The material, as messages carrying their roles.

    The same shape the technical analysis is given, and for the same reason: who spoke
    is a field of each message, never something written inside its text, so a client
    cannot put words into our engine's mouth by typing them.
    """
    entries = [{"role": "client", "text": f"# Pre-specification\n\n{specification}"}]
    for entry in chat or []:
        text = str(entry.get("text") or "")
        if text == "":
            continue
        entries.append(
            {"role": "client" if entry.get("role") == "client" else "preanalyst", "text": text}
        )
    return material(entries)


def read_scores(raw):
    """The five numbers, cleaned up.

    Anything that is not a number between 0 and 1 is not a score, and **one missing
    axis makes the whole judgement unusable**: a verdict resting on four axes out of
    five is not the verdict this policy describes, and quietly treating the fifth as
    absent would let the weakest one be the one nobody saw.
    """
    scores = {}
    for axis in AXES:
        value = (raw or {}).get(axis)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        if not 0 <= value <= 1:
            return None
        scores[axis] = float(value)
    weakest = min(AXES, key=lambda axis: scores[axis])
    return {"scores": scores, "weakest": weakest}


def decide(verdict, scores, threshold: float) -> str:
    """The proposal, on two conditions and not one.

    A `take_on` the model asked for but cannot support with its own numbers is not a
    take_on — the same rule the prevalidation and the pre-analysis' validator already
    obey.

    And **the weakest axis decides, not the average.** Being comfortable on four axes
    does not make up for the fifth: a tool that is small, has one user and touches no
    money is still out of reach if it has to talk to a system we do not control.
    """
    if verdict != "take_on":
        return "refuse"
    return "take_on" if all(scores[axis] > threshold for axis in AXES) else "refuse"


def judge(settings, *, specification: str, chat, analysis: str, project_id=None) -> dict:
    """One run of this door. The envelope comes back whatever happened."""
    door = settings.analysis.judgement
    instructions = read_policy(door.policy)

    elapsed = settings.metrics.timer()
    answer = ask(
        door.ai,
        instructions=instructions,
        material=material_of(specification, chat),
        analysis=analysis,
        request=REQUEST,
        schema=SCHEMA,
    )
    # The judgement is a second engine, on its own configuration and possibly its own
    # provider: what it costs is counted under its own phase and never folded into the
    # analysis'.
    report_interaction(
        settings,
        phase=ANALYSIS_SUSTAINABILITY,
        answer=answer,
        duration_ms=elapsed(),
        project_id=project_id,
    )
    if not answer["ok"]:
        return answer

    output = answer["output"] or {}
    read = read_scores(output.get("scores"))
    confidence = output.get("confidence")
    unreadable = (
        read is None
        or output.get("verdict") not in VERDICTS
        or isinstance(confidence, bool)
        or not isinstance(confidence, (int, float))
        or not 0 <= confidence <= 1
    )
    if unreadable:
        # It answered, and what came back is not a judgement. Turning it into one —
        # by dropping the axis that is missing, or reading an unknown verdict as a
        # refusal — would put a claim on the project that nothing supports.
        print("[analysis_sustainability] the judgement cannot be read")
        # It answered inside the schema and what came back is not a judgement.
        # `ai.call` has already gone out saying the provider completed, which it did:
        # this is the door's own verdict, and nothing else records it.
        report_unusable(
            settings,
            phase=ANALYSIS_SUSTAINABILITY,
            answer=answer,
            reason="unreadable_judgement",
            project_id=project_id,
        )
        return unusable(
            provider=answer["provider"],
            model=answer["model"],
            ended="unusable",
            spend=answer["spend"],
            attempts=answer["attempts"],
            fell_back=answer["fell_back"],
        )

    proposal = {
        "verdict": decide(output["verdict"], read["scores"], door.take_on_threshold),
        # What the model asked for, kept beside what we concluded. When the two
        # differ, the difference is the interesting part for whoever reads the
        # proposal: it says the model wanted to take the work on and its own
        # numbers did not let it.
        "asked_for": output["verdict"],
        "scores": read["scores"],
        "weakest": read["weakest"],
        "confidence": float(confidence),
        "reason": str(output.get("reason") or ""),
    }

    # The judgement itself, measured. It carries **no tokens**: what the call cost is
    # already on `ai.call` under this phase, and the same tokens under a second name
    # would be counted twice by whoever adds up the consumption. This one carries what
    # was proposed and the numbers it was proposed on, so the question "what are we
    # refusing, and on which axis" can be asked of a month instead of of a log.
    settings.metrics.measure(
        "analysis.judged",
        dims={
            "verdict": proposal["verdict"],
            "asked_for": proposal["asked_for"],
            "weakest": proposal["weakest"],
        },
        scores=proposal["scores"],
        confidence=proposal["confidence"],
        **({"project_id": project_id} if project_id else {}),
    )

    return {**answer, "policy": door.policy, "output": proposal}
