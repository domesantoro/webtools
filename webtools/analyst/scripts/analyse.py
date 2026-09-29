"""Running the analyst's doors on real material, by hand.

    cd webtools/analyst
    set -a; source ../configurator/bootstrap.env; set +a
    PYTHONPATH=. uv run python scripts/analyse.py <pre-specification.md> [<transcript.json>]

The pre-specification is a Markdown file — a real one read out of workspaces, or one
written by hand. The transcript is optional and is the rounds of questions that
followed it, in the shape anagraphics stores them::

    [{"role": "client", "text": "…"}, {"role": "system", "text": "…"}]

**The order is fixed and is not a setting**: the technical analysis, then the judgement
of whether to propose taking the work on, then the functional points. All three, every
time. Judging first would mean arriving at the person who decides with a verdict and
nothing to check it against; the points come last because they are written from the
analysis, and they are written whatever the verdict was, because the driver validates
every analysis and the two outcomes have to be comparable in front of them.

It reads the **real** configuration from anagraphics and makes **real** calls, which
cost. What each one cost is printed, by kind, under the names the provider reports them
by: this file does not contain that list either.

This exists because the run that will call these doors — the trigger, the atomic write,
the documents — is not written yet, and a policy cannot be judged by reading it.
"""

import json
import sys
from pathlib import Path

from webtools_analyst.analysis_sustainability import judge
from webtools_analyst.analysis_technical import analyse
from webtools_analyst.functional_points import write
from webtools_analyst.settings import load_settings


def show(title: str, answer: dict) -> None:
    print(f"--- {title}")
    print(f"    provider   {answer['provider']}")
    print(f"    model      {answer['model']}")
    print(f"    ended      {answer['ended']}" + (f" ({answer['failure']})" if answer["failure"] else ""))
    print(f"    attempts   {answer['attempts']}" + ("  (fell back)" if answer["fell_back"] else ""))
    if answer["spend"]:
        spent = "  ".join(f"{kind}={units}" for kind, units in answer["spend"]["kinds"].items())
        print(f"    spend      {spent}")
    print()


def main(argv: list[str]) -> int:
    if not 1 <= len(argv) <= 2:
        print(__doc__, file=sys.stderr)
        return 2

    specification = Path(argv[0]).read_text(encoding="utf-8")
    chat = json.loads(Path(argv[1]).read_text(encoding="utf-8")) if len(argv) == 2 else []
    settings = load_settings()

    written = analyse(settings, specification=specification, chat=chat)
    show("technical analysis", written)
    if not written["ok"]:
        print("No analysis, so nothing to judge: see `ended` above.", file=sys.stderr)
        return 1

    judged = judge(
        settings, specification=specification, chat=chat, analysis=written["output"]["analysis"]
    )
    show("judgement of sustainability", judged)

    print(written["output"]["analysis"])
    print()
    print("--- assumptions ---")
    for assumption in written["output"]["assumptions"] or ["(none declared)"]:
        print(f"- {assumption}")
    print()

    if not judged["ok"]:
        print("No judgement: see `ended` above.", file=sys.stderr)
        return 1

    verdict = judged["output"]
    print("--- proposal ---")
    print(f"verdict     {verdict['verdict']}", end="")
    # What the model asked for, beside what we concluded. When they differ, the
    # difference is the interesting part: the model wanted to take the work on and its
    # own numbers did not let it.
    if verdict["verdict"] != verdict["asked_for"]:
        print(f"   (the model asked for {verdict['asked_for']})", end="")
    print()
    print(f"weakest     {verdict['weakest']}")
    print(f"confidence  {verdict['confidence']}")
    print("scores      " + "  ".join(f"{axis}={value}" for axis, value in verdict["scores"].items()))
    print()
    print(verdict["reason"])
    print()

    listed = write(
        settings, specification=specification, chat=chat, analysis=written["output"]["analysis"]
    )
    show("functional points", listed)
    if not listed["ok"]:
        print("No points: see `ended` above.", file=sys.stderr)
        return 1

    print(f"--- functional points ({listed['output']['language']}) ---")
    for point in listed["output"]["points"]:
        print(f"{point['id']}  {point['text']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
