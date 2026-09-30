"""The fourth door, used: the README of the project that now exists.

It is asked **last**, once every file is written and checked, and that is the whole
reason it is a door of its own rather than one more file of the plan. What it has to say
— what the tool is for, what has to be installed, what has to be configured, how it is
started — is only true once the project is there and the stack's commands are known. A
README written in the middle of the loop would describe the plan, which is not what
somebody installing the tool is holding.

**It is written in the client's language**, which arrives as a fact from the project's
analysis step and is never inferred from the text. It is the only thing the developer
produces that a person outside reads.

**Its failure does not fail the build.** The project is built, checked and paid for;
throwing that away over a README would cost the whole build again to recover one
document. The caller records that it is missing and goes on — and because a missing
README is then a silence, it is also a number: `readme.written` is absent, and
`build.finished` says `documented: no`.
"""

import sys

from webtools_developer import policies
from webtools_developer.build_readme_ai.contract import unusable
from webtools_developer.build_readme_ai.webtools_build_readme_ai import write_readme as ask
from webtools_developer.measured_ai import (
    DEVELOPMENT_README,
    report_interaction,
    report_unusable,
)

# The name the file is written under. It is not configuration: it is the name whoever
# opens a project looks for, in every stack there is.
NAME = "README.md"

SCHEMA = {
    "type": "object",
    "properties": {"readme": {"type": "string"}},
    "required": ["readme"],
    "additionalProperties": False,
}

REQUEST = (
    "The project above is built and its checks have passed. Write its README.md now, "
    "whole, as Markdown."
)


def _log(message: str) -> None:
    print(f"[readme] {message}", file=sys.stderr)


def write(settings, *, analysis, points, plan, written, commands, language, project_id) -> dict:
    """The README, asked for. The envelope comes back whatever happened."""
    door = settings.doors.readme
    elapsed = settings.metrics.timer()
    answer = ask(
        door.ai,
        instructions=policies.read(door.policy),
        analysis=analysis,
        points=points,
        plan=plan,
        written=written,
        commands=commands,
        language=language,
        request=REQUEST,
        schema=SCHEMA,
    )
    report_interaction(
        settings,
        phase=DEVELOPMENT_README,
        answer=answer,
        duration_ms=elapsed(),
        project_id=project_id,
    )
    if not answer["ok"]:
        return answer

    text = str((answer["output"] or {}).get("readme") or "").strip()
    if not text:
        _log("the README came back empty")
        report_unusable(
            settings,
            phase=DEVELOPMENT_README,
            answer=answer,
            reason="empty_readme",
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

    # One newline at the end, whatever came back with none or with five. It is a
    # document a person opens and a tool diffs, and a text file that does not end in a
    # newline is the one thing every reader of one complains about. The source files are
    # **not** treated this way: their content is written exactly as it came, because
    # what is at the end of a source file can matter to the language it is written in.
    document = text + "\n"

    settings.metrics.measure(
        "readme.written",
        dims={"language": language},
        bytes=len(document.encode("utf-8")),
        project_id=project_id,
    )
    return {**answer, "policy": door.policy, "output": {"readme": document}}
