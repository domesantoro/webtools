"""What an interaction with a model cost, reported once, in the vocabulary's words.

The doors answer one envelope for every outcome: `{ok, provider, model, ended,
failure, attempts, spend, output}`. metrics' vocabulary asks for the same facts under
its own names. This file is the **only** place the two are put side by side, so the
mapping exists once and a door that gains an outcome is dealt with here and nowhere
else.

Nothing about a provider passes through: `ended` and `failure` are already our words
— the adapter translated whatever its SDK said before the envelope was built — and
`spend["kinds"]` carries the kinds under the names the adapter reports them by. They
are counted and never converted.

**Where the tokens are carried, and why only here.** An interaction is reported as
one `ai.call`, and that is the measurement that carries the tokens. It is tempting to
put them on the step's own metric as well, since a run is made of interactions — and
it would double the cost of the whole system: `/metrics/cost` sums **everything that
carries tokens**, so the same tokens under two names are counted twice. What a run
was is counted by its own metric and paid for by `ai.call`.
"""

import sys

# The phases of the pipeline, as the vocabulary closes them
# (`webtools/metrics/webtools_metrics/vocabulary.py`). They are here rather than at
# the call sites so that a door and the phase it belongs to cannot drift apart.
ANALYSIS_TECHNICAL = "analysis_technical"
ANALYSIS_SUSTAINABILITY = "analysis_sustainability"
ANALYSIS_POINTS = "analysis_points"


def report_model_call(settings, *, phase, answer, duration_ms, project_id=None) -> None:
    """One envelope, reported. `duration_ms` is how long we waited."""
    project = {"project_id": project_id} if project_id else {}

    # Nothing came back at all. `spend` is None and stays None: a zero would be a
    # claim we cannot make. Why nothing came back is a different question from how
    # an answer ended, and it is a different metric.
    if answer["ended"] == "no_answer":
        settings.metrics.measure(
            "ai.failed",
            dims={
                "phase": phase,
                "provider": answer["provider"],
                "reason": answer["failure"],
                # The model is known only sometimes: a call refused before a model
                # was chosen has none. Absent is absent — the dimension is optional
                # and nothing is put in its place.
                **({"model": answer["model"]} if answer["model"] else {}),
            },
            duration_ms=duration_ms,
            **project,
        )
        return

    # The model ran. In three of the four outcomes there is nothing to use, and what
    # it consumed is real all the same.
    if not isinstance(answer["provider"], str) or not isinstance(answer["model"], str):
        # `ai.call` is identified by its provider and its model: without them the
        # bucket would mean something else, and metrics refuses it by name. It is our
        # defect, so it is said out loud rather than sent and lost.
        print(
            f"[measured_ai] {phase} ended {answer['ended']} with no provider or model: not counted",
            file=sys.stderr,
        )
        return

    spend = answer.get("spend")
    settings.metrics.measure(
        "ai.call",
        dims={
            "phase": phase,
            "model": answer["model"],
            "provider": answer["provider"],
            "outcome": answer["ended"],
            # Whether what answered is what was asked for. `model` alone cannot say
            # it: a configuration whose primary model was changed and a primary
            # model that is being fallen back from every time produce the same
            # bucket, and they are not the same thing to know.
            "fell_back": "yes" if answer["fell_back"] else "no",
        },
        # The kinds are the adapter's. Nothing here lists them, and nothing adds
        # them up.
        **({"tokens": spend["kinds"]} if spend and spend.get("kinds") else {}),
        duration_ms=duration_ms,
        **project,
    )


def report_retries(settings, *, phase, answer, project_id=None) -> None:
    """How many times we asked again.

    It is ours, not the provider's: the ceiling is configured here and the adapter
    obeys it, so the number of attempts is a fact about a decision we made. One
    attempt is not a retry.
    """
    again = answer.get("attempts", 1) - 1
    if again <= 0:
        return
    settings.metrics.measure(
        "ai.retry",
        dims={"phase": phase, "provider": answer["provider"]},
        count=again,
        **({"project_id": project_id} if project_id else {}),
    )


def report_unusable(settings, *, phase, answer, reason, project_id=None) -> None:
    """The door could not use an answer the provider completed.

    It is a second measurement and not a dimension of the first, because the two are
    known at different moments. `ai.call` goes out as soon as the call comes back —
    that is when what it cost is known, and it is reported before anything has been
    decided about the answer, on purpose. By the time the door has read the answer and
    found it empty, that bucket has already been written.

    No tokens and no duration: the call that produced this answer reported both, and
    the same tokens under a second name would be counted twice.
    """
    if not isinstance(answer.get("provider"), str) or not isinstance(answer.get("model"), str):
        return
    settings.metrics.measure(
        "ai.unusable",
        dims={
            "phase": phase,
            "provider": answer["provider"],
            "model": answer["model"],
            "reason": reason,
        },
        **({"project_id": project_id} if project_id else {}),
    )


def report_interaction(settings, *, phase, answer, duration_ms, project_id=None) -> None:
    """Both, which is what every caller wants: one interaction, everything it is
    worth saying about it."""
    report_model_call(
        settings, phase=phase, answer=answer, duration_ms=duration_ms, project_id=project_id
    )
    report_retries(settings, phase=phase, answer=answer, project_id=project_id)
