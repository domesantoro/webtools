"""The technical analysis: the document the tool is built from.

Its reader is whoever builds — an AI developer under a driver's supervision — so it
is in English and precision matters more than tone. It is not the document the client
agrees to: that is the list of functional points, written for them, in their
language, by a door of its own.

What is sent is the whole of what the client produced: the pre-specification the form
made, and the rounds of questions that followed. Both **whole**. No field of this
subsystem's configuration caps either one, and nothing on the way in shortens them —
a document that decides what gets built, and in the metered tier what it costs, is
not one to trim quietly.

What comes back is the analysis and the model's own notes on what it had to assume.
Those notes are for the driver: they are the model's words about the material, never
a sentence the client dictated through it.
"""

import re
from pathlib import Path

from webtools_analyst.analysis_technical_ai.contract import material, unusable
from webtools_analyst.analysis_technical_ai.webtools_analysis_technical_ai import analyse as ask
from webtools_analyst.measured_ai import ANALYSIS_TECHNICAL, report_interaction, report_unusable

POLICIES = Path(__file__).resolve().parent.parent / "policies"

# No `minLength`, no `maxLength`, no `minimum`, no `multipleOf` and no recursive
# schema: constrained output answers 400 to all of them. What has to be true of the
# values is checked below, after the answer has arrived.
SCHEMA = {
    "type": "object",
    "properties": {
        "analysis": {"type": "string"},
        "assumptions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["analysis", "assumptions"],
    "additionalProperties": False,
}

# What is asked of the model once it has read the material. It is short on purpose:
# what to write is in the policy, which never changes and is therefore cached. This
# is only the turn that says "now", and it is also what makes the call legal — see
# the adapter.
REQUEST = "The material above is complete: the rounds of questions are over and there is nothing more to come. Write the technical analysis of it now."

_BANNER = re.compile(r"^\s*<!--[\s\S]*?-->\s*")
_policies: dict[str, str] = {}


def read_policy(name: str) -> str:
    """The policy, from the copy the deployer put here.

    Cached for the life of the process, which is the same thing the Node subsystems
    do: a policy changes by being edited in `webtools/configurator/policies/` and
    redeployed, and a deploy is followed by a restart.
    """
    if name not in _policies:
        text = (POLICIES / f"{name}.md").read_text(encoding="utf-8")
        _policies[name] = _BANNER.sub("", text)
    return _policies[name]


def material_of(specification: str, chat) -> list[dict]:
    """The material, as messages carrying their roles.

    The **pre-specification is the first message**, and the rounds of questions
    follow it in the order they happened.

    Who spoke is a field of each message and never something written inside its text.
    It used to be one document, with `**Client:**` and `**Analyst:**` in front of each
    turn, on the sibling engine. Those are ordinary characters: a client could type
    them inside their own message and put words in ours, because nothing else said
    who had spoken.
    """
    entries = [{"role": "client", "text": f"# Pre-specification\n\n{specification}"}]
    for entry in chat or []:
        text = str(entry.get("text") or "")
        if text == "":
            continue
        # The chat stores `client` and `system`; the second one is the engine that
        # asked the questions, which is this contract's `preanalyst`.
        entries.append(
            {"role": "client" if entry.get("role") == "client" else "preanalyst", "text": text}
        )
    return material(entries)


def analyse(settings, *, specification: str, chat, project_id=None) -> dict:
    """One run of this door. The envelope comes back whatever happened.

    Nothing raises towards the caller: a model that did not answer, answered badly or
    was cut short is one of the contract's endings, and every one of them has to be
    something the run above can act on.
    """
    door = settings.analysis.technical
    instructions = read_policy(door.policy)

    elapsed = settings.metrics.timer()
    answer = ask(
        door.ai,
        instructions=instructions,
        preferences=door.stack_preferences,
        material=material_of(specification, chat),
        request=REQUEST,
        schema=SCHEMA,
    )
    # Reported **before** the output is judged: the model ran, and what it consumed
    # is real whether or not we can use what came back.
    report_interaction(
        settings,
        phase=ANALYSIS_TECHNICAL,
        answer=answer,
        duration_ms=elapsed(),
        project_id=project_id,
    )
    if not answer["ok"]:
        return answer

    written = _read_output(answer["output"])
    if written is None:
        # It answered, inside the schema, with nothing in it. An empty analysis is
        # not an analysis, and calling it one would put an empty document in front of
        # whoever has to build from it.
        print("[analysis_technical] the analysis came back empty")
        # It answered inside the schema and said nothing. `ai.call` has already gone
        # out saying the provider completed, which it did: this is the door's own
        # verdict, and nothing else records it.
        report_unusable(
            settings,
            phase=ANALYSIS_TECHNICAL,
            answer=answer,
            reason="empty_analysis",
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

    # How long the document came out, and how much of the design nobody confirmed.
    # No tokens here: what the call cost is on `ai.call`, and the same tokens under a
    # second name would be counted twice.
    settings.metrics.measure(
        "analysis.written",
        bytes=len(written["analysis"].encode("utf-8")),
        amounts={"assumptions": len(written["assumptions"])},
        **({"project_id": project_id} if project_id else {}),
    )
    return {**answer, "policy": door.policy, "output": written}


def _read_output(output) -> dict | None:
    """The answer in this file's words, or None when there is nothing to use."""
    analysis = str((output or {}).get("analysis") or "").strip()
    if analysis == "":
        return None
    assumptions = (output or {}).get("assumptions")
    return {
        "analysis": analysis,
        # An assumption that is blank says nothing and would be shown to the driver
        # as an empty bullet.
        "assumptions": [
            str(item).strip()
            for item in (assumptions if isinstance(assumptions, list) else [])
            if str(item).strip() != ""
        ],
    }
