"""The closed vocabulary: which metrics exist, and what each one may carry.

A name that is not in this list is a `400`, not a new kind of number nobody will
ever query, in the same way as `PipelineStepName` in anagraphics: an invented name
must not be able to get into the data. The same holds one level down — a
dimension a metric does not declare, and a value a closed dimension does not
allow, are refused. A typo in a dimension splits a counter in two, and the half
nobody looks at is never missed.

Three kinds of dimension:

- **required**: part of the metric's identity. A measurement without it would be
  counted in a bucket that means something else, so it is refused;
- **optional**: it exists only in some cases — the reason of a refusal, the model
  of a call that never reached a provider. Absent is absent: the bucket simply has
  no such dimension, and nothing is put in its place;
- **open** (`None` instead of a set of values): the values cannot be listed in
  advance — a model's name, a route, a driver's uid. The key is still closed.

The values a measurement may carry are declared too: `count` is always allowed and
defaults to 1, the rest must be declared by the metric. A duration on a counter
that has no duration is a mistake by whoever sent it, and it is told so.
"""

from dataclasses import dataclass, field

# Who may send measurements. The subsystem is a field of the measurement, not a
# dimension: every metric has one, and repeating it in `dims` would be a second
# copy of the same fact.
SUBSYSTEMS = frozenset(
    {"front-gate", "preanalyst", "sso", "workspaces", "anagraphics", "configurator-fe", "metrics",
     "analyst", "drivers-pool", "comm-center", "projects-hub"}
)

# The phases that consume: the same words the pipeline uses, plus the two calls of
# the rounds of questions that are not a turn.
PHASES = frozenset(
    {
        "prevalidation",
        "preanalysis_opening",
        "preanalysis_turn",
        "preanalysis_validation",
        # One name per door of the analyst, so that what each call consumed can be
        # read apart from the others.
        "analysis_technical",
        "analysis_sustainability",
        "analysis_points",
        "development",
        "alpha_test",
        "demo",
    }
)

# The gates of the pipeline: `PipelineStepName` in anagraphics, word for word.
GATES = frozenset(
    {"prevalidation", "preanalysis", "analysis", "driver_validation", "client_validation",
     "development", "alpha_test", "demo", "payment"}
)

# How a step can end, as anagraphics stores it.
STEP_OUTCOMES = frozenset({"open", "passed", "rejected", "underspecified", "failed"})

BOOLEANS = frozenset({"yes", "no"})

# `scores` and `confidence` are the only values that are not whole things counted:
# they are fractions between 0 and 1. They are summed like everything else, and the
# `count` that comes with every measurement is their denominator — the day's average
# on an axis is `scores.<axis> / count`. Nothing here lists the axes: they belong to
# the subsystem that judges, and a second copy of that list would be one more thing
# to keep in step.
# `amounts` carries **quantities of the thing measured**, not occurrences of it: how
# many assumptions an analysis declared, how many points a list has, how many drivers
# there were to choose from. `count` cannot do this, and not by accident — it is how
# many times something happened, so it is at least one, while a quantity of zero is a
# real answer and often the interesting one. Summed like `tokens`, with the keys open,
# so the average per occurrence is `amounts.<name> / count`.
VALUE_FIELDS = frozenset({"duration_ms", "tokens", "bytes", "scores", "confidence", "amounts"})


@dataclass(frozen=True)
class Metric:
    """One name of the vocabulary."""

    required: dict[str, frozenset[str] | None] = field(default_factory=dict)
    optional: dict[str, frozenset[str] | None] = field(default_factory=dict)
    values: frozenset[str] = frozenset()
    # Whether a measurement of this metric may name a project. A measurement with a
    # project also lands in that project's accumulator; one without does not.
    project: bool = False


METRICS: dict[str, Metric] = {
    # ---------------------------------------------------------------- every subsystem
    "http.request": Metric(
        required={"route": None, "method": None, "status": None},
        values=frozenset({"duration_ms"}),
    ),
    "http.error": Metric(required={"code": None}),
    "http.refused_ip": Metric(),
    "dependency.call": Metric(
        required={
            "target": None,
            "operation": None,
            "outcome": frozenset({"ok", "failed", "timed_out", "not_found"}),
        },
        values=frozenset({"duration_ms"}),
    ),
    "mongo.operation": Metric(
        required={"collection": None, "operation": None, "outcome": frozenset({"ok", "failed"})},
        values=frozenset({"duration_ms"}),
    ),
    "process.started": Metric(
        required={"outcome": frozenset({"ok", "configuration_missing", "failed"})},
    ),
    # ------------------------------------------------------------------------- the AI
    # How an interaction with a model ended, in **our** words — the ones the
    # doors' contracts use. Not a provider's: a provider's reasons for stopping
    # are translated by its adapter and never reach here.
    "ai.call": Metric(
        required={
            "phase": PHASES,
            "model": None,
            "provider": None,
            "outcome": frozenset({"complete", "cut", "refused", "unusable"}),
            # Whether the model that answered is the model that was asked for. A
            # declined request may be re-run on another model inside the same call,
            # and then `model` is not what the configuration says. Without this the
            # two cases are the same bucket: a configuration whose primary model was
            # changed, and a primary model that is refusing everything and being
            # fallen back from. They cost different money and mean different things.
            "fell_back": BOOLEANS,
        },
        values=frozenset({"duration_ms", "tokens"}),
        project=True,
    ),
    # The door could not use an answer the provider completed.
    #
    # It is not `ai.call`'s `unusable`, and the difference is the point. `ai.call`
    # carries how the **provider** ended — it is reported the moment the call comes
    # back, before anything has been decided about the answer, because that is when
    # what it cost is known. This one carries how the **door** ended: the answer came
    # back whole, inside the schema, and what was in it was not a judgement, or not an
    # analysis, or not a message. Reading it off `ai.call` is impossible, because at
    # the moment `ai.call` is sent nobody has looked yet.
    #
    # It carries no tokens: the call that produced the answer already reported them,
    # and the same tokens under a second name would be counted twice.
    #
    # `reason` is the door's own word for what was wrong with it, and it is left open:
    # which ways an answer can be empty belongs to the door that reads it, and a
    # second copy of that list here would be one more thing to keep in step.
    "ai.unusable": Metric(
        required={"phase": PHASES, "provider": None, "model": None, "reason": None},
        project=True,
    ),
    # What the analyst proposed about a project, and the numbers it proposed it on.
    #
    # It carries **no tokens**: what the call cost is on `ai.call` under the phase
    # `analysis_sustainability`, and the same tokens under a second name would be
    # counted twice by whoever adds up the consumption. This one carries the
    # judgement.
    #
    # `verdict` is what we concluded and `asked_for` is what the model asked for. The
    # two are kept apart because the interesting case is when they differ: the model
    # wanted the work taken on and its own numbers did not let it. One dimension
    # would hide exactly that.
    #
    # `weakest` is an axis name and is left open: which axes exist is the analyst's,
    # written in its code and explained in its policy, and this file listing them too
    # would be a third place to keep in step.
    "analysis.judged": Metric(
        required={
            "verdict": frozenset({"take_on", "refuse"}),
            "asked_for": frozenset({"take_on", "refuse"}),
            "weakest": None,
        },
        values=frozenset({"scores", "confidence"}),
        project=True,
    ),
    # ---------------------------------------------------------------- the analysis
    # The document the tool gets built from. `bytes` is how long it came out;
    # `amounts.assumptions` is how many things the model had to take for granted,
    # which is the measure of how much of the design nobody confirmed — the judgement
    # reads that same list, and without this nothing keeps a record of it.
    "analysis.written": Metric(
        values=frozenset({"bytes", "amounts"}),
        project=True,
    ),
    # The list the client is asked to agree to, and the demo is later checked against.
    # `amounts.points` is how many things they are agreeing to; `language` is the one
    # they are written in, which is a fact carried on the material and never guessed.
    # `described` says whether the same call also managed to label the project — the
    # one sentence the lists of projects show beside the name. It is a dimension of
    # this measurement and not a metric of its own because it is a property of the
    # points being written, not a second event: the label comes out of the same call,
    # in the same answer. Without it, a description that came back empty is dropped and
    # nothing anywhere says how often that happens — the row simply renders without
    # one, and a silence is not a number.
    "points.written": Metric(
        required={"language": None, "described": BOOLEANS},
        values=frozenset({"amounts"}),
        project=True,
    ),
    # ----------------------------------------------------------------- the drivers
    # Which driver a project was given to, and on what grounds. `rule` is closed and
    # holds one value today: the choice is at random until the rules that should
    # decide are written down. A rule added there adds a line here, which is the
    # point — a pool that quietly changed how it chooses would change the meaning of
    # every figure read from this metric.
    "driver.chosen": Metric(
        required={"rule": frozenset({"random"})},
        # How many there were to choose from (`supervising`) and how many there were at
        # all (`registered`). Choosing among one is not choosing, and a pool that has
        # quietly come down to one person looks the same from outside as one that has
        # twenty.
        #
        # `supervising` was `enabled` until 0.12.0. Documents written before that day
        # carry the old name, so a reading that spans it adds up two names for one
        # thing: the counter splits on 2026-09-29.
        values=frozenset({"amounts"}),
        project=True,
    ),
    # What a driver's link did when somebody arrived on one. An ambassador's link, a
    # driver's personal link, a discount code: the nine states are the ones the code
    # already names, and five of them are the link **not** applying.
    #
    # Nothing else keeps this. `project.created` says `has_discount: no` both for
    # somebody who arrived with no link at all and for somebody whose code had
    # expired, and the project is written with `driver_uid: null` in either case, so
    # the difference cannot be recovered afterwards from anything. It is money: a
    # driver whose code stopped working loses their share and nobody finds out, on
    # either side.
    #
    # There is no project: the link is read while the page is being built, before
    # anything has been created, and most of these never become a project at all.
    # The other side of `driver_link.resolved`: a link **made**. That metric counts the
    # links somebody arrived on, and nothing counted the ones that were handed out, so a
    # driver who never made a link and a driver whose links nobody ever clicked looked
    # the same from here — and one of those two is a person to talk to.
    #
    # `discount_created` and `discount_reused` are kept apart because one of them writes
    # a document and the other does not: a driver ends up with at most a handful of
    # codes, and which of their requests made one is the difference between a write and
    # a read.
    #
    # The four are values of one dimension and not a `kind` plus an `outcome`, which is
    # the argument `driver_link.resolved` already makes for its own thirteen: the lists
    # share no value, so a second dimension would say twice what the first one says.
    #
    # `percentage` is open and optional: only the two kinds that carry a discount have
    # one, and absent is absent. It is not a closed list, because what percentages may
    # be chosen is read from a configuration, and a copy of that range here would be a
    # second limit nobody would keep in step.
    #
    # There is no project: a link is made before anything exists, and most of them never
    # become a project at all.
    "driver_link.issued": Metric(
        required={
            "kind": frozenset({"ambassador", "driver", "discount_created", "discount_reused"})
        },
        optional={"percentage": None},
    ),
    "driver_link.resolved": Metric(
        required={
            "state": frozenset(
                {
                    "none",
                    "discount_applied",
                    "discount_expired",
                    "discount_driver_missing",
                    "discount_driver_disabled",
                    "driver_applied",
                    "driver_unknown",
                    "driver_disabled",
                    "own_link",
                    # The ambassador's link is the same question — somebody arrived on
                    # somebody's link, did it work — with its own outcomes. Its states
                    # are prefixed rather than put under a dimension of their own: the
                    # two lists share no value, so a `kind` beside them would say twice
                    # what the name already says.
                    "ambassador_applied",
                    "ambassador_unknown",
                    "ambassador_own_link",
                    "ambassador_superseded",
                }
            )
        },
    ),
    # --------------------------------------------------------- the communications
    # One measurement per thing said to a person. `kind` is open — it is one name per
    # form of communication, and those are routes of the communications centre, not a
    # list this file should have to keep in step. `channel` is closed, and says `log`
    # because that is all there is: the day something is really sent, it is a line
    # here and it is meant to be.
    "communication.sent": Metric(
        required={"kind": None, "channel": frozenset({"log"})},
        project=True,
    ),
    # Nothing came back at all. The five reasons are five different things to do
    # about it, which is why they are not one word.
    "ai.failed": Metric(
        required={
            "phase": PHASES,
            "provider": None,
            "reason": frozenset(
                {"unreachable", "timed_out", "rate_limited", "unauthorised", "unknown_provider",
                 "rejected"}
            ),
        },
        optional={"model": None},
        values=frozenset({"duration_ms"}),
        project=True,
    ),
    "ai.retry": Metric(required={"phase": PHASES, "provider": None}, project=True),
    "preanalysis.validation": Metric(
        required={"outcome": frozenset({"accepted", "sent_back", "failed"})},
        values=frozenset({"duration_ms"}),
        project=True,
    ),
    # ------------------------------------------------------- the funnel and its timing
    "form.opened": Metric(),
    "form.submitted": Metric(
        required={"outcome": frozenset({"sent", "login_required", "refused"})},
        # Why it was refused, in the form's own words: a required answer left empty,
        # an answer past the limit, a body too large, a submission that cannot be
        # read, the sso not answering. Only a refusal has one — absent is absent —
        # and the five are five different things to do about it: one of them is a
        # question people cannot answer, another is a limit nobody was told about,
        # and the last is our own fault. Collapsed into one word they read as "the
        # form does not work".
        optional={"reason": None},
        values=frozenset({"duration_ms"}),
    ),
    "project.created": Metric(
        required={
            "autonomous_work": BOOLEANS,
            "has_discount": BOOLEANS,
            "has_ambassador": BOOLEANS,
        },
        project=True,
    ),
    "gate.decided": Metric(
        required={"gate": GATES, "outcome": STEP_OUTCOMES},
        # The refusal's own name (`non_sequitur`, `run_out_certain`, …). Only a
        # decision that refuses has one: absent is absent.
        optional={"reason": None},
        project=True,
    ),
    "gate.duration": Metric(
        required={"gate": GATES},
        values=frozenset({"duration_ms"}),
        project=True,
    ),
    "project.lead_time": Metric(
        required={"outcome": frozenset({"paid", "rejected", "open"})},
        values=frozenset({"duration_ms"}),
        project=True,
    ),
    "preanalysis.turn": Metric(
        # One turn the client asked for, answered or not, and how long they waited
        # for it. What it cost is on `ai.call`; this is the turn itself.
        #
        # `provider` is required because whatever carries tokens has to say **whose**
        # they are: two providers do not count the same kinds, and the same model
        # served by two of them is counted under two declarations. The adapter always
        # names itself, so a turn always has one.
        #
        # `model` is not, and the failed turns are why: when nothing came back at all
        # the call may have been refused before a model was ever chosen, and there is
        # no model to name. Absent is absent, and inventing the configured one would
        # be a claim that it was asked and did not answer.
        required={"provider": None, "outcome": frozenset({"answered", "failed"})},
        optional={"model": None},
        values=frozenset({"duration_ms", "tokens"}),
        project=True,
    ),
    "preanalysis.closed": Metric(
        required={"outcome": frozenset({"ready", "turns_exhausted", "abandoned"})},
        project=True,
    ),
    "underspecified.returned": Metric(required={"attempt": None}, project=True),
    # ------------------------------------------------------------ turns and tokens
    "turns.granted": Metric(
        required={"source": frozenset({"purchase", "fake_purchase", "included"})},
    ),
    "turns.spent": Metric(required={"phase": PHASES}, project=True),
    "tokens.charged": Metric(
        required={"driver_uid": None, "provider": None, "model": None},
        values=frozenset({"tokens"}),
        project=True,
    ),
    # Handing a project to the person who will supervise it. `gave_up` and
    # `nobody_supervising` are the two ways a project is left with an analysis and
    # nobody looking at it — the worst shape a stuck project can have, because
    # everything about it looks finished. `attempts` is how many times the pool had to
    # be asked.
    #
    # `nobody_supervising` was `nobody_enabled` until 0.12.0, when the driver's boolean
    # became a level: no stored document carried the old value, so there is no split to
    # read around here.
    "driver.handover": Metric(
        required={
            "outcome": frozenset({"assigned", "nobody_supervising", "gave_up", "unavailable"})
        },
        values=frozenset({"amounts"}),
        project=True,
    ),
    # ----------------------------------------------------------- the rest of the system
    # A configured value was changed while the system was running. It is not a
    # measurement of anything that happened to a project: it is the moment **after
    # which every other figure means something else**. A cost per demo that steps up
    # in the middle of a month, read without this, is a mystery; read with it, it is
    # a price that was changed on the Tuesday.
    #
    # `section` is the part of the configuration that changed, not the value and not
    # the path: what a price became is in the configuration, which is the thing that
    # is true, and copying it here would be a second answer to the same question that
    # can disagree with the first.
    "configuration.changed": Metric(
        required={"subsystem": None, "section": None},
    ),
    # A measurement the vocabulary refused.
    #
    # This is the one failure the closed list exists in order to create, and until now
    # it was the only one nobody could see: the sender counts it privately and nothing
    # reads that counter, metrics answers `400` and forgets. A subsystem quietly
    # sending a name that is refused looks exactly like a subsystem with nothing to
    # say.
    #
    # It carries the **code** and not the refused name: an invented metric name in an
    # open dimension would make a bucket per typo, which is the thing the closed list
    # is for. `sender` is who sent it, and it is absent when what was refused was the
    # sender's own name — there is then nothing trustworthy to record.
    "measurement.refused": Metric(
        required={
            "code": frozenset(
                {
                    "UNKNOWN_SUBSYSTEM",
                    "UNKNOWN_METRIC",
                    "UNKNOWN_DIMENSION",
                    "UNKNOWN_DIMENSION_VALUE",
                    "MISSING_DIMENSION",
                    "UNEXPECTED_VALUE",
                    "UNKNOWN_PROVIDER",
                    "UNKNOWN_TOKEN_KIND",
                }
            )
        },
        optional={"sender": SUBSYSTEMS},
    ),
    "login.attempt": Metric(
        required={"outcome": frozenset({"ok", "invalid", "unavailable"})},
        # **Whoever is trying is told none of this**: the four refusals answer one
        # word, on purpose, so that nobody can find out from the outside whether an
        # address is registered. Here they are told apart, because a count of a day
        # names nobody and the four are four different problems — a password nobody
        # set is a person who cannot get in and does not know why, and a deactivated
        # user trying every hour is not the same event as a wrong password.
        optional={
            "reason": frozenset(
                {"unknown_user", "deactivated", "credential_not_set", "wrong_password"}
            )
        },
        values=frozenset({"duration_ms"}),
    ),
    "session.opened": Metric(),
    "session.closed": Metric(required={"reason": frozenset({"logout", "expired", "revoked"})}),
    "spec.written": Metric(
        required={"origin": frozenset({"system", "third_party"})},
        values=frozenset({"bytes"}),
        project=True,
    ),
    # A document the system wrote for a project, and how big it came out. `kind` is
    # left open on purpose: which kinds of document exist belongs to workspaces, which
    # stores them, and a second copy of that list here would be one more thing to keep
    # in step. There is no `origin`: everything counted here was written by us.
    "document.written": Metric(
        required={"kind": None},
        values=frozenset({"bytes"}),
        project=True,
    ),
    # A document handed to a person, and in what capacity they were allowed to have it.
    # The twin of `document.written`, with `kind` left open for the same reason: which
    # kinds exist belongs to workspaces, which stores them.
    #
    # `as` is the half that is worth having. A client opening their own points is a step
    # of the funnel, a driver opening the analysis is work beginning, and somebody at
    # level 2 opening either is a person going through the wreckage: three readings of
    # one number, and nothing else tells them apart.
    #
    # Only a download that succeeded is counted. Workspaces not answering is already a
    # `dependency.call`, and a refusal is already an `http.error` with its own code:
    # counting either here would be one fact under two names.
    "document.served": Metric(
        required={"kind": None, "as": frozenset({"owner", "driver", "prj_admin"})},
        values=frozenset({"bytes"}),
        project=True,
    ),
    # ------------------------------------------------------- the lists of projects
    # How long a list of projects was when somebody opened it. `http.request` already
    # says which page was asked for and how long it took; what it cannot say is how much
    # was on it, and that is the number somebody will ask for — a review queue of two is
    # a different system from the same queue at forty, and a list of orphans that stops
    # being empty is the fault the register has never been read for.
    #
    # `amounts` and not `count`, for the reason the note above gives: a list of zero is a
    # true answer and often the interesting one, while `count` is at least one. The
    # average length is `amounts.projects / count`.
    #
    # There is no project: this measures a list, and a list is not about one project.
    # The client's own page splits their projects three ways — what is moving, what has
    # come back to them for want of detail, and what has stopped — so the three are three
    # values and not one. `owned` was the single value until 2026-09-30, when that page
    # became three lists: documents written before that day carry it, so a reading that
    # spans the change adds up a name that no longer exists and three that did not yet.
    # The counter splits on that date, as `driver.chosen`'s did on its own.
    "projects.listed": Metric(
        required={
            "list": frozenset(
                {
                    "owned_active",
                    "owned_returned",
                    "owned_stopped",
                    "driver_review",
                    "driver_failed",
                    "orphan",
                    "orphan_failed",
                }
            )
        },
        values=frozenset({"amounts"}),
    ),
}

# The metrics the funnel is drawn from, in the order of the flow. The read uses
# this list, so a gate added to the vocabulary is not silently left out of the
# picture.
FUNNEL = ("form.opened", "form.submitted", "project.created", "gate.decided")
