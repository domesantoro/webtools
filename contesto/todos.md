# Todo

## A pool of cron'd scripts that report the faults — `sanity-checker` (2026-09-28)

**Nothing in this system notices when a project stops.** Every gate writes where it took the project
to, and nothing ever reads the register back to ask whether anything has been sitting in one place
for too long. A pipeline that halts halts in silence, and it is found when somebody happens to look.

What is needed is a `sanity-checker`: a pool of scripts run on a schedule, one per fault, each one
asking the data a question with a wrong answer. Not a service that watches: a set of checks that run
and report.

The fault that made this concrete, and the first one to write:

- **A project with an analysis and no driver.** The analyst writes the analysis, the judgement and
  the points, sets the state to `DRIVER_VALIDATION`, and then asks the drivers' pool for somebody to
  give it to. If the pool has nobody enabled to offer, or answers with drivers that no longer exist
  until the analyst's allowance of attempts runs out, the work is done and paid for and there is
  nobody to look at it.

  Since 2026-09-29 that project **says so**: the analyst appends a second step and puts it in
  `FAILED_NO_DRIVERS`, so it no longer sits in `DRIVER_VALIDATION` looking as though a person were
  reading it. What is still missing is the part this todo is about — **somebody asking**. Nothing
  reads the register back, so a project in that state waits until a human happens to look, and the
  check that finds it is now a query on one state rather than a reconstruction from the steps.

Others that the same pool should ask, from the same register:

- a step still `open` long after it was opened — a run that began and whose process died;
- a project in a state whose gate has not decided within any reasonable time;
- a project in `DRIVER_VALIDATION` whose driver is no longer `enabled`: the copy on the project does
  not carry `enabled` on purpose (`docs/subsystems/anagraphics/README.md`), so nothing notices by
  itself that the person it was given to has gone;
- the counters of the metrics clients: every subsystem can say how much of its own reporting it
  failed to send (`counters()` in the shared client), and nobody asks it — no route anywhere exposes
  it. Since 2026-09-29 metrics counts, on its own side, the measurements it **refuses**
  (`measurement.refused`), which is the other half of the same question: that says what arrived and
  was wrong, this would say what never arrived at all.

Where the report goes is part of the work and is not decided: there is no notification channel in
this repository (`contesto/analyst_considerations.md` §7).

## Measurements that nothing sends (2026-09-26, revised 2026-09-29)

The vocabulary (`webtools/metrics/webtools_metrics/vocabulary.py`) declares 37 metrics and 35 of them
are now sent. These two are not, and each is blocked by something real rather than forgotten. Until
they are sent, the pages of metrics-fe that would read them stay empty, which is what they are meant
to do — nothing is filled in with a zero.

`mongo.operation` was the third, and it is **done**: the Python metrics client had been written in
the meantime, which was the whole of what this entry said was missing, so anagraphics took it like
any other Python subsystem. It counts by a wrapper in `db.py` rather than by each function, and
`docs/subsystems/anagraphics/README.md` §4.4 says how.

- **`project.lead_time`** — a project from end to end, with `outcome` in `paid | rejected | open`. Two
  things are missing. `paid` does not exist in the flow yet (there is no payment step, see the fake
  purchase above), and the lead time of a project that is still **open** is not an event: it is a
  photograph of a duration that is still growing, and there is no moment at which to take it. It needs
  either a periodic pass over the open projects or the decision that only a project that has finished
  has a lead time. `rejected` could be sent today, from `addPipelineStep` in the preanalyst, where the
  gate's own duration is already measured — but sending one outcome of three would make a figure that
  looks like the lead time and is the lead time of the refusals only.

- **`tokens.charged`** — the tokens taken off a driver's credit at every step of an autonomous work,
  with `driver_uid`, `provider` and `model`. The flow does not exist: see "The driver's tokens" under
  the promises of the "Lavora con noi" page. It is the measurement that says whether autonomous work
  pays for itself, so it belongs with that work and not before it.

Two **values** of metrics that are otherwise sent are in the same position, and for the same kind of
reason. `preanalysis.closed`'s `abandoned` cannot be reached from the preanalyst: nothing happens
when somebody stops writing, so there is no moment at which to send it — it belongs with the
sanity-checker above, which is the thing that will read the register back. `process.started`'s
`configuration_missing` and `failed` cannot be sent by the subsystem they are about: one that could
not read its configuration has no metrics client to say so with, because the client is built out of
that same configuration. Whoever knows is the start script, which reads the log; either it sends
them, or the two values go the way `prespec.truncated` went.


## Mocks to dismantle

- **The fake purchase of turns** (opened on 2026-09-24). `POST /preanalysis/{id}/turns/buy` in the
  preanalyst makes nobody buy anything: it gives 10 turns to the user's credit
  (`FAKE_PURCHASE_TURNS` in `src/server.js`), with nobody paying. It is only there to make it
  possible to try the round of the exhausted turns from beginning to end. When the real payment is
  there, the route and the constant go away together, and the payment engine goes in their place —
  and the `turns.granted` it sends moves from `fake_purchase` to `purchase`, so the figure stays
  comparable across the change.

  (The chat's mock answer was the second entry here and is gone: the route calls the real engine.)

- **A configuration backoffice**: it must be able to change `webtools/configurator/bootstrap.env`
  too.

## Promises of the "Lavora con noi" page (2026-09-22)

Things the page describes and the system does not have yet:

- **Registration as a driver**, with the application to be enabled and the **interview**; whoever
  passes it goes to `enabled: true` in `drivers`.
- **The driver area**: generating the ambassador links (`?ambassador=`, every driver), the personal
  links (`?driver=`) and the discount codes (`discounts`) for the enabled drivers.
- **The driver's tokens**: the balance, topping it up, the charge at every step (pre-analysis,
  analysis, development) of the autonomous works, an email when they are not enough, blocking and
  unblocking the pipelines.
- **Deleting the code** of an autonomous work from our system, at the driver's request.
- **The costs and revenues calculator**: the driver's share, the system fee, 50% of the fee to the
  ambassador (`billing.ambassador_uid`) on the projects that went through.
