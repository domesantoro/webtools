"""The functional points: the list the client agrees to.

This is the only thing the analyst produces that somebody outside ever reads, and it
changes everything about how it is written — the rules are the ones the rounds of
questions already obey, because they are rules about the same person. Their own
language. No word from our trade. Never gendering the reader. Dry: a point says what
the person will be able to do, and nothing else.

**It runs on every project**, whatever the judgement proposed. The driver validates
every analysis, and a proposal to refuse is not a refusal: the person deciding has to
have the same thing in front of them either way, or the two outcomes are not
comparable and the cheaper one is simply the better documented one.

**The points are data, not a paragraph.** Each one is an element with a stable
identifier and its text, because of what happens to them next: the client validates
the analysis, and later the demo is accepted or refused against what was agreed. Both
of those work point by point — somebody has to be able to say "all of it except the
third" — and a list inside a paragraph cannot carry either.

**The identifiers are ours, not the model's.** We number the list as it arrives. A
model asked for identifiers gives two points the same one sooner or later, and two
points with one identifier is a demo nobody can accept by halves.

**This door also writes the project's description**: the one sentence that says what
the tool is for, which is what a person reads beside the project in a list. It is
written here and not by a door of its own because it is a sentence for the same reader,
in the same language, under the same rules, out of the same material — a second call
would be a second cost for one more line.
"""

import re
from pathlib import Path

from webtools_analyst.functional_points_ai.contract import material, unusable
from webtools_analyst.functional_points_ai.webtools_functional_points_ai import (
    write_points as ask,
)
from webtools_analyst.measured_ai import ANALYSIS_POINTS, report_interaction, report_unusable

POLICIES = Path(__file__).resolve().parent.parent / "policies"

# No `minItems`, no `maxItems`, no `minLength`: constrained output answers 400 to
# them. How many points there are is the material's business anyway, not a number we
# would have picked.
SCHEMA = {
    "type": "object",
    "properties": {
        # What the tool is for, in one sentence. In `required` so that the constrained
        # output always sends one — an empty one is dealt with below, and it is a
        # different thing from a key that is not there.
        "description": {"type": "string"},
        "points": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["description", "points"],
    "additionalProperties": False,
}

REQUEST = (
    "Above you have the material the client produced and then, as the last thing before this "
    "message, the technical analysis written from it. Write the description and the list of "
    "functional points now."
)

_BANNER = re.compile(r"^\s*<!--[\s\S]*?-->\s*")
# The front matter of the pre-specification, and the language line inside it. Only the
# front matter: a line saying `language: fr` further down is body, which is to say it
# is something the client typed.
_FRONT_MATTER = re.compile(r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", re.S)
_LANGUAGE = re.compile(r"^language:[ \t]*([A-Za-z-]+)[ \t]*$", re.M)

_policies: dict[str, str] = {}


def read_policy(name: str) -> str:
    if name not in _policies:
        text = (POLICIES / f"{name}.md").read_text(encoding="utf-8")
        _policies[name] = _BANNER.sub("", text)
    return _policies[name]


def language_of(specification: str) -> str | None:
    """The language the client wrote in, read off the pre-specification's front matter.

    None when the front matter does not say. It is not guessed from the text and
    there is no language to fall back on: a list the client has to agree to, handed to
    them in a language they did not write in, is worse than no list. The caller stops.
    """
    front_matter = _FRONT_MATTER.match(specification)
    if front_matter is None:
        return None
    found = _LANGUAGE.search(front_matter.group(1))
    return found.group(1) if found else None


def material_of(specification: str, chat) -> list[dict]:
    """The material, as messages carrying their roles.

    The same shape the other two doors are given: who spoke is a field of each
    message, never something written inside its text.
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


def numbered(points) -> list[dict]:
    """The points as elements, with the identifiers we give them.

    Blank entries are dropped before numbering, so the identifiers have no holes in
    them: `p2` missing from a list of five would look to whoever reads it like a point
    that was removed.
    """
    written = [str(point).strip() for point in (points if isinstance(points, list) else [])]
    return [{"id": f"p{n}", "text": text} for n, text in enumerate((p for p in written if p), 1)]


def write(settings, *, specification: str, chat, analysis: str, project_id=None) -> dict:
    """One run of this door. The envelope comes back whatever happened."""
    door = settings.analysis.points
    language = language_of(specification)
    if language is None:
        # Nothing was consumed: this is found before the call. It is still an answer
        # in the contract's words, because every ending has to be something the run
        # above can act on, and `rejected` is the one that means "ours to fix, and
        # asking again changes nothing".
        print("[functional_points] the pre-specification does not say which language to write in")
        from webtools_analyst.functional_points_ai.contract import no_answer

        return no_answer(provider=door.ai.provider, failure="rejected")

    instructions = read_policy(door.policy)
    elapsed = settings.metrics.timer()
    answer = ask(
        door.ai,
        instructions=instructions,
        material=material_of(specification, chat),
        analysis=analysis,
        request=REQUEST,
        language=language,
        schema=SCHEMA,
    )
    report_interaction(
        settings,
        phase=ANALYSIS_POINTS,
        answer=answer,
        duration_ms=elapsed(),
        project_id=project_id,
    )
    if not answer["ok"]:
        return answer

    points = numbered((answer["output"] or {}).get("points"))
    if not points:
        # Inside the schema, and empty. A tool with nothing the client can do with it
        # is not something to put in front of them for agreement.
        print("[functional_points] the list came back empty")
        # It answered inside the schema and the list is empty. `ai.call` has already
        # gone out saying the provider completed, which it did: this is the door's own
        # verdict, and nothing else records it.
        report_unusable(
            settings,
            phase=ANALYSIS_POINTS,
            answer=answer,
            reason="empty_points",
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

    description = described((answer["output"] or {}).get("description"))
    if description is None:
        # **An empty description does not make this door unusable, and an empty list of
        # points does.** The reason the list does is written above — a tool the client
        # can do nothing with is not something to put in front of them for agreement —
        # and a missing label is not that: throwing away fifty-nine valid points, paid
        # for, because one sentence came back blank would be the worse fault of the two.
        # It is dropped, the project stays without a description, and whoever lists it
        # renders the row without one — which they have to do anyway, for every project
        # that has not been analysed yet.
        print("[functional_points] the description came back empty: the project stays without one")

    # How many things the client is being asked to agree to, and in which language.
    # The demo is later checked against this same list, point by point.
    #
    # `described` is on this measurement and not on one of its own: the label came out of
    # this same call, so it is a property of the points being written and not a second
    # event. Without it, the paragraph above would be a silence — the row would render
    # without a label and nothing anywhere would say how often that happens.
    settings.metrics.measure(
        "points.written",
        dims={"language": language, "described": "yes" if description else "no"},
        amounts={"points": len(points)},
        **({"project_id": project_id} if project_id else {}),
    )
    output = {"language": language, "points": points}
    # Absent is absent: a project with no description carries no field, not an empty one.
    if description is not None:
        output["description"] = description
    return {**answer, "policy": door.policy, "output": output}


def described(description) -> str | None:
    """The description as it will be stored, or None when there is none to store.

    A string of spaces is not a sentence, and neither is something that came back as a
    number or a list: all of them are the same answer here — there is nothing to show
    beside this project.
    """
    if not isinstance(description, str):
        return None
    stripped = description.strip()
    return stripped or None
