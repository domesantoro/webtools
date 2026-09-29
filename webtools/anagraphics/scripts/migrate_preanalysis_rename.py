"""Migration: the rounds of questions are the pre-analysis, in the data too.

    set -a; source ../configurator/bootstrap.env; set +a
    .venv/bin/python -m scripts.migrate_preanalysis_rename [--dry-run]

(from the anagraphics directory: Mongo is named by the bootstrap variables, as for
load_configuration.sh)

The word *analysis* named two things: the rounds of questions inside the preanalyst,
and the document the analyst subsystem produces out of them. The rounds are renamed to
what they are — the pre-analysis — and three things already written in Mongo carry a
name that no longer exists:

- **projects** in the state `ANALYSIS` (or in `SPECIFICATION`, the intermediate name of
  the same day). There is no separate state for the rounds any more: a project is born
  in `PREANALYSIS` and stays there through the form, the prevalidation that passes and
  the rounds that follow, because there is no earlier moment to have a state for and
  the rounds *are* the pre-analysis. Which of the two moments a project is at is read
  off the steps, where the prevalidation either has decided or has not;
- **steps** named `analysis` (or `specification`): `PipelineStepName` has neither any
  more, so the open step of those projects could not be updated;
- the **preanalyst's configuration**, whose branches are renamed: the turns go to
  `preanalysis` and the two doors towards a model go to `preanalyst`.

The configuration is migrated here and not by `load_configuration.sh` because that
script adds only what is missing and deletes nothing: run on its own it would leave
the document with both shapes, and the old branches carry values that were changed
in operation — the turns included, and the price per million tokens that
configurator-fe wrote. Those values are **moved**, not reseeded: what is running is
what is running, and a migration that quietly took a limit back to the file's value
would be a worse defect than the rename it serves.

Idempotent in all three: what already has the new name is left alone. A document
that has both shapes is not touched either — it is reported, because that is a state
this script cannot resolve without choosing for somebody.
"""

import sys

from pymongo import MongoClient

from webtools_anagraphics import db
from webtools_anagraphics.settings import mongo_target

OLD_STATES = ("ANALYSIS", "SPECIFICATION")
NEW_STATE = "PREANALYSIS"
OLD_STEPS = ("analysis", "specification")
NEW_STEP = "preanalysis"
SUBSYSTEM = "preanalyst"


def migrate_projects(projects, dry_run: bool) -> int:
    """The state and the step name, on every project that still carries the old ones.

    The two are counted apart because they are two different facts: a project can
    sit in `ANALYSIS` with no step (one born before the step existed), and a project
    that has moved on still carries the step it took.
    """
    touched = 0
    for project in projects.find(
        {"$or": [{"pipeline.state": {"$in": list(OLD_STATES)}},
                 {"pipeline.steps.step": {"$in": list(OLD_STEPS)}}]},
        {"_id": 0, "project_id": 1, "pipeline": 1},
    ):
        pipeline = project.get("pipeline") or {}
        steps = pipeline.get("steps") or []
        changes: dict[str, object] = {}
        if pipeline.get("state") in OLD_STATES:
            changes["pipeline.state"] = NEW_STATE
        for index, step in enumerate(steps):
            if step.get("step") in OLD_STEPS:
                changes[f"pipeline.steps.{index}.step"] = NEW_STEP
        if not changes:
            continue
        print(f"  {project['project_id']}: {', '.join(sorted(changes))}")
        touched += 1
        if not dry_run:
            projects.update_one({"project_id": project["project_id"]}, {"$set": changes})
    return touched


def migrate_configuration(configuration, dry_run: bool) -> int:
    """The preanalyst's branches renamed: `preanalysis` for the turns, `preanalyst`
    for the two doors towards a model.

    They are two branches because they are two subjects. `preanalysis` says how many
    rounds of questions there are and when the page starts saying they are running
    out; `preanalyst` holds the two doors — the engine that conducts the conversation
    and the engine that judges whether it is finished — each with its own provider,
    model, timeout, attempts, policy and key.

    **Where the old values come from.** A document can carry either of two old
    shapes, and both are handled: the original `analysis` + `analyst`, and the single
    `specification` branch of the run of 2026-09-28 that merged them. Whichever is
    there, everything it holds travels across, including what is in no seed: the
    price per million tokens configurator-fe writes inside a provider object.

    The policy names are the one thing rewritten rather than moved: the files they
    name were renamed, and a configuration pointing at `analysis-v1` would stop the
    subsystem from starting, which is the right behaviour and not a state to leave
    behind.
    """
    document = configuration.find_one({"subsystem": SUBSYSTEM})
    if document is None:
        print(f"  no configuration for '{SUBSYSTEM}': nothing to migrate.")
        return 0

    # Whichever old shape is there. `specification` held both subjects at once, so it
    # is a source for either of them.
    merged = document.get("specification")
    turns_from = document.get("analysis") or merged
    doors_from = document.get("analyst") or merged
    if turns_from is None and doors_from is None:
        print(f"  the configuration of '{SUBSYSTEM}' is already renamed.")
        return 0
    if document.get("preanalysis") is not None or document.get("preanalyst") is not None:
        print(
            f"  the configuration of '{SUBSYSTEM}' has both shapes: the new branches exist "
            "and so does an old one. Left untouched: which of the two is the one that "
            "counts is not this script's to decide."
        )
        return 0

    preanalysis = {}
    for field in ("max_turns", "warn_from_turn"):
        if isinstance(turns_from, dict) and field in turns_from:
            preanalysis[field] = turns_from[field]

    preanalyst = {}
    if isinstance(doors_from, dict):
        for engine, policy in (("conversation", "preanalysis-v1"),
                               ("validation", "preanalysis-validation-v1")):
            if engine not in doors_from:
                continue
            moved = dict(doors_from[engine])
            if moved.get("policy") != policy:
                print(f"    {engine}.policy: {moved.get('policy')!r} → {policy!r}")
                moved["policy"] = policy
            preanalyst[engine] = moved

    print(f"  {SUBSYSTEM}: 'preanalysis' {sorted(preanalysis)}, 'preanalyst' {sorted(preanalyst)}")
    if not dry_run:
        configuration.update_one(
            {"subsystem": SUBSYSTEM},
            {
                "$set": {"preanalysis": preanalysis, "preanalyst": preanalyst},
                "$unset": {"analysis": "", "analyst": "", "specification": ""},
            },
        )
    return 1


def main() -> int:
    dry_run = "--dry-run" in sys.argv[1:]

    mongo_uri, mongo_db = mongo_target()
    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
    database = client[mongo_db]

    print(f"projects in '{mongo_db}':")
    projects = migrate_projects(database[db.PROJECTS], dry_run)
    if projects == 0:
        print("  no project carries the old names.")

    print(f"configuration in '{mongo_db}':")
    configurations = migrate_configuration(database[db.CONFIGURATION], dry_run)

    verb = "to migrate" if dry_run else "migrated"
    print(f"{projects} projects and {configurations} configuration documents {verb} in '{mongo_db}'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
