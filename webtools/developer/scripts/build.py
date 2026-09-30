"""Running a whole build on a real analysis, by hand.

    cd webtools/developer
    set -a; source ../configurator/bootstrap.env; set +a
    PYTHONPATH=. uv run python scripts/build.py <analysis.md> <points.json> [<project-id>]

The analysis is a Markdown file — a real one read out of workspaces
(`GET /projects/{id}/documents/analysis/latest`), or one written by hand. The points are
the sentences the client agreed to, as the analysis step keeps them::

    {"language": "it", "points": [{"id": "P1", "text": "…"}, …]}

or, just as acceptable, a bare list of strings.

**Nothing is written on any project.** The build runs, the files land under the builds
root in a directory named after the project identifier, and the outcome is printed. What
this skips is the run around it — the trigger, the step, the state, the driver — which
is `run.py` and needs anagraphics. What it does not skip is anything about the build
itself: the real configuration, the real doors, the real commands, the real sandbox.

It reads the **real** configuration from anagraphics and makes **real** calls, which
cost. A build is one call per file, so this is the most expensive script in the
repository: what it spent is printed at the end, by door and by kind, under the names the
provider reports them by — this file does not contain that list either.
"""

import json
import sys
from pathlib import Path

from webtools_developer import build
from webtools_developer.settings import load_settings


def _points(document) -> tuple[list[str], str]:
    """The agreed points and their language, out of either shape.

    A list of strings has no language in it, and nothing here guesses one: the language
    is a fact carried on the project, and a build that invented it would hand somebody
    installation instructions in a language nobody chose. So it has to be said.
    """
    if isinstance(document, list):
        return [str(point) for point in document], ""
    points = document.get("points") or []
    written = [point["text"] if isinstance(point, dict) else str(point) for point in points]
    return written, str(document.get("language") or "")


def _shown(result) -> None:
    print()
    print(f"--- {result.outcome}")
    print(f"    stack       {result.stack or '(none chosen)'}")
    print(f"    directory   {result.directory or '(none made)'}")
    print(f"    files       {len(result.written)}")
    print(f"    documented  {'yes' if result.documented else 'no'}")
    print(f"    attempts    {result.attempts}")
    print(f"    took        {result.duration_ms / 1000:.1f}s")
    if result.stopped_by:
        print()
        print("--- where it stopped")
        print(json.dumps(result.stopped_by, indent=2, ensure_ascii=False)[:4000])
    if result.notes:
        print()
        print("--- what the doors had to decide for themselves")
        for note in result.notes:
            print(f"    {note['file']}: {note['notes']}")
    print()
    print("--- what it consumed, by door and by kind")
    for door, entry in result.spend.as_recorded().items():
        kinds = "  ".join(f"{kind}={units}" for kind, units in (entry.get("kinds") or {}).items())
        print(f"    {door:<8} {entry['calls']} call(s)   {kinds or '(nothing reported)'}")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    analysis = Path(argv[0]).read_text(encoding="utf-8")
    points, language = _points(json.loads(Path(argv[1]).read_text(encoding="utf-8")))
    project_id = argv[2] if len(argv) > 2 else "a-build-by-hand"

    if not points:
        print("The points are the perimeter: a build with none has nothing to keep to.", file=sys.stderr)
        return 2
    if not language:
        print("Say which language the points are in: it is what the README is written in.", file=sys.stderr)
        return 2

    settings = load_settings()
    print(f"stacks      {', '.join(settings.stacks.names())}")
    print(f"builds root {settings.build.root}")
    print(f"project     {project_id}")
    print("This makes real calls, which cost. One per file.")
    print()

    result = build.run(
        settings,
        project_id=project_id,
        analysis=analysis,
        points=points,
        language=language,
        # Nothing is written on any project here: there is no open step to write into,
        # and inventing one would put a build by hand into a real project's history.
        record=lambda **changes: None,
    )
    _shown(result)
    return 0 if result.built else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
