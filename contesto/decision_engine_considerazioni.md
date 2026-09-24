# The Decision Engine — considerations and an architectural proposal

## Purpose

This document collects the considerations that came up on the opportunity of introducing into the
project a cross-cutting subsystem dedicated to decisions, provisionally called:

> **The Decision Engine**

The idea comes from a simple fact: many of the platform's subsystems do not have to generate
complex content, but do have continually to take small operative decisions:

- classifying;
- assigning a score;
- choosing a branch of the workflow;
- deciding whether to go on;
- establishing whether a review is needed;
- determining when to make a retry;
- working out whether a case is to be escalated;
- selecting the most suitable Driver or process.

The proposal is to centralise this kind of logic in a dedicated component, usable by the whole
platform.

---

# 1. The underlying idea

The Decision Engine must be **cross-cutting**.

It does not belong to a single phase of the workflow.

It must be able to be queried by:

- the Preanalysis;
- the Analysis;
- the Validation;
- the Driver Pool;
- the Dev Ecosystem;
- the Testing;
- the Demo;
- the Production;
- any future subsystems.

A conceptual diagram:

```text
Preanalysis ─────────┐
Analysis ────────────┤
Validation ──────────┤
Driver Pool ─────────┤
Dev Ecosystem ───────┼──> Decision Engine
Testing ─────────────┤
Demo ────────────────┤
Production ──────────┘
```

The Decision Engine does not replace these subsystems.

It helps them **decide what to do next**.

---

# 2. The role

The Decision Engine should receive:

1. a state;
2. a decision question;
3. possibly a set of admitted outputs;
4. criteria, policies or thresholds.

And it should return a structured decision.

An example:

```json
{
  "decision": "manual_review",
  "confidence": 0.84
}
```

A richer version:

```json
{
  "decision": "retry",
  "confidence": 0.91,
  "reason_code": "missing_required_output",
  "scores": {
    "completeness": 0.62,
    "consistency": 0.88
  }
}
```

The principle:

> **the Decision Engine decides; the other subsystems carry out.**

---

# 3. Kinds of decision

## Classification

Examples:

- is this project in scope?
- what kind of project is it?
- what class of complexity does it present?
- what category of Driver is needed?
- is the user's feedback a bug or a new request?

Possible outputs:

```text
IN_SCOPE
OUT_OF_SCOPE
NEEDS_REVIEW
```

---

## Scoring

Examples:

- how complete is this analysis?
- how clear is the scope?
- how risky is going on?
- how reliable is this test?
- how probable is it that the problem is due to incomplete specifications?

The output:

```json
{
  "score": 0.87
}
```

The scores can be used for operative thresholds.

A purely illustrative example:

```text
>= 0.85     → go on automatically
0.60–0.84   → escalate to a stronger model
< 0.60      → a manual review
```

The real thresholds will have to be validated empirically.

---

## Routing

Examples:

- which branch of the workflow must the project follow?
- must the failure go back to the development or to the analysis?
- which subsystem must receive the next task?
- which Driver is compatible?

An example:

```json
{
  "decision": "return_to_analysis"
}
```

---

## Escalation

The Decision Engine must also be able to decide that it is **not sure enough to decide
automatically**.

Possible escalations:

```text
a more powerful model
a manual review
a request for further information
blocking the workflow
```

---

## Selection

Examples:

- which Driver is the most suitable?
- which model to use?
- which development strategy to choose?
- which test to run?
- which review to activate?

The Decision Engine can therefore also become an intelligent router between different resources.
---

# 4. What it must NOT do

The Decision Engine must not become a second generalist system.

In particular it should NOT:

- conduct long conversations with the client;
- write complete specifications;
- develop code;
- produce extended documentation;
- carry out deep analyses;
- correct the project directly;
- replace the deterministic tests;
- handle payments or deploys directly;
- own all of the subsystems' operative logic.

Its task must stay small:

> **receiving a state and producing a structured decision.**

---

# 5. An architectural principle: provider-agnostic

The rest of the platform should NOT know which technology is taking the decision.

The interface must stay stable.

Behind the Decision Engine there could be:

- Jev;
- Claude;
- OpenAI;
- Gemini;
- a traditional classifier;
- deterministic rules;
- static policies;
- a combination of several systems;
- an ensemble;
- a system built internally in the future.

A diagram:

```text
Analysis subsystem
        │
        ▼
Decision Engine API
        │
        ├── rules
        ├── Jev
        ├── frontier LLM
        └── manual escalation
```

This separation makes it possible to replace or compare technologies without changing all the
other components.

---

# 6. Jev / System One

Jev is interesting because it is designed for a kind of work different from free generation.

The paradigm is oriented towards:

- classifications;
- choice;
- scoring;
- structured decisions;
- routing;
- probabilistic evaluations.

The potential value is not replacing the frontier models used for complex analysis, development or
review.

The value is:

> **avoiding using an expensive generative model every time only a small decision is needed.**

Jev is therefore to be considered as a possible **provider of the Decision Engine**, not as a
compulsory foundation of the architecture.

---

# 7. Where it could be useful

## The Preanalysis

Possible decisions:

- is information missing?
- is the request clear enough?
- which question should be asked next?
- is the request plainly out of scale?

It should not conduct the whole conversation directly, but it can help decide the next branch.

---

## The Analysis Prevalidator

Possible checks:

- completeness;
- contradictions;
- compatibility with the scope;
- residual ambiguities;
- missing requirements;
- excessive risk.

---

## The Analysis Validation

The Analysis Engine produces the analysis.

The Decision Engine can evaluate it on several axes:

```text
completeness
consistency
testability
clarity
scope
risk
```

Every axis can produce a separate score.

---

## Scope validation

A particularly natural case.

An example:

```text
scope_score = 0.94 → go on
scope_score = 0.71 → a second check
scope_score = 0.42 → a manual review
```

---

## The Driver Pool

Possible uses:

- classifying the project;
- extracting the skills required;
- evaluating the Driver/project compatibility;
- creating a shortlist;
- reporting projects that require particular competences.

---

## The Dev Ecosystem

The Decision Engine must not write code.

It can decide:

- whether a failure is recoverable;
- whether to make a retry;
- whether to change strategy;
- whether to go back to the Analysis;
- whether to ask for a human review;
- whether to classify the problem as out-of-scope.

---

## The Alpha Test

The deterministic tests stay code.

Examples:

```text
unit tests
API tests
browser tests
assertions
schema validation
security scans
```

The Decision Engine can help when the evaluation is semantic.

An example:

> "Does the interface produced really satisfy the requirement described in the specification?"

---

## The Demo / the client's feedback

Possible classifications:

```text
a bug
a specification not respected
a new request
aesthetic feedback
an environment problem
a request that is not pertinent
```

This distinction is important to stop the demo automatically becoming an open development cycle.

---

## Production

Possible uses:

- classifying anomalies;
- choosing the kind of escalation;
- recognising deploy problems;
- telling an application bug from an infrastructure problem.

---

# 8. A hybrid Decision Engine

Not every decision should be entrusted to the AI.

A possible hierarchy:

```text
1. a deterministic rule
2. a specialised decision model
3. a frontier model
4. a manual review
```

An example:

```text
if test_exit_code != 0
    → failure

if failure_type can be determined by rules
    → automatic routing

otherwise
    → the AI Decision Engine

if the confidence is not enough
    → a frontier model

if it is still not enough
    → the Driver
```

This avoids using AI where a simple condition is better.

---

# 9. Confidence

Every non-deterministic decision should ideally produce a confidence too.

An example:

```json
{
  "decision": "in_scope",
  "confidence": 0.96
}
```

Or:

```json
{
  "decision": "in_scope",
  "confidence": 0.58
}
```

In the second case the system can choose not to trust the decision.

The confidence is an operative signal, not a mathematical guarantee of correctness.

It is to be calibrated on the real behaviour.

---

# 10. Typed outputs

A desirable characteristic is that the Decision Engine cannot answer freely.

If the question is:

```text
Is this request compatible with the system?
```

the outputs admitted can only be:

```text
YES
NO
NEEDS_REVIEW
```

Not:

```text
"It depends, probably yes, but I would advise..."
```

Typed outputs:

- simplify the workflow;
- reduce parsing errors;
- make the decisions auditable;
- make changing provider easier;
- allow automatic tests.

---

# 11. A conceptual API

There is no need to choose a framework yet.

A possible shape:

```text
POST /decision
```

The input:

```json
{
  "decision_type": "scope_validation",
  "state": {},
  "allowed_outputs": [
    "accept",
    "reject",
    "manual_review"
  ],
  "policy": "scope-v1"
}
```

The output:

```json
{
  "decision": "manual_review",
  "confidence": 0.81,
  "metadata": {}
}
```

---

# 12. Policies

The decisions should not live in prompts scattered through the code.

It is worth introducing the concept of a **policy**.

Examples:

```text
scope-v1
analysis-quality-v2
dev-failure-routing-v1
driver-matching-v1
demo-feedback-v1
```

A policy can describe:

- the question;
- the possible outputs;
- the criteria;
- the thresholds;
- the escalation strategy;
- the preferred provider;
- the fallback.

This makes it possible to version the decision-making behaviour.

---

# 13. The decision log

Every important decision should be recorded.

Possible data:

```text
decision_id
project_id
subsystem
policy
input reference
decision
confidence
provider
model
timestamp
a human override, if any
the subsequent result
```

This will make it possible to understand:

- which decisions we get wrong most often;
- which policies work;
- how often the Driver corrects a decision;
- whether Jev works better or worse than a frontier model;
- which confidences are really reliable;
- which gates are useless.

---

# 14. The human override

The Driver must be able to correct an automatic decision when that is foreseen.

An example:

```text
Decision Engine:
OUT_OF_SCOPE — confidence 0.74

Driver:
override → IN_SCOPE
```

The override is to be recorded.

These data can become very useful for calibrating and improving the system.

---

# 15. Comparing providers

The provider-agnostic interface makes it possible to compare:

```text
Jev
vs
Claude
vs
OpenAI
vs
a deterministic rule
```

on the same decisions.

Useful metrics:

- accuracy;
- cost;
- latency;
- the rate of escalation;
- agreement with the Driver;
- critical errors.

---

# 16. The strategy advised for Jev

Jev should not become a compulsory structural dependency from the start.

The reasons:

- a very recent technology;
- a maturity to be checked;
- the real behaviour on our domain still unknown;
- initial benchmarks to be validated with data of our own.
The proposal is:

> to design the Decision Engine in a way compatible with Jev, without designing the platform
> around Jev.

Jev can therefore be:

- experimented with;
- compared;
- replaced;
- used for some policies only.

---

# 17. Reversible and irreversible decisions

## Easily reversible decisions

They can have more permissive automation thresholds.

Examples:

```text
a retry
a second review
ask for detail
select an additional test
```

## Decisions with strong consequences

They require a greater confidence or human intervention.

Examples:

```text
refuse a project
approve a scope definitively
assign an important project
conclude a dispute
```

---

# 18. The relationship with the Driver

The Driver is not replaced by the Decision Engine.

Ideally:

```text
trivial decisions
    → automatic

uncertain decisions
    → a stronger model

important/ambiguous decisions
    → the Driver
```

The Driver becomes the human level of escalation.

---

# 19. The relationship with the frontier models

The frontier models stay fundamental for:

- complex reasoning;
- analysis;
- design;
- development;
- difficult semantic review;
- a deep understanding of the context.

The Decision Engine avoids using these models for every single operative fork.

The conceptual formula:

> **a strong model produces → the Decision Engine judges/directs → the code carries out**

with an escalation to a strong model or a human when necessary.

---

# 20. The benefits expected

## A reduction of the AI cost

Many micro-decisions do not require a frontier model.

## A reduction of the latency

Simple decisions can be quick.

## Uniformity

The same policies can be applied by different subsystems.

## Auditability

Every decision can be recorded and reconstructed.

## Replaceability

The provider can change without rewriting the workflow.

## Testability

The policies become testable components.

## Evolution

The system can improve on the basis of its own decision logs.

---

# 21. The risks

## Excessive centralisation

The Decision Engine must not become a "mega brain" that knows everything.

It must receive the minimum context necessary.

## Policies that are too generic

A policy of the kind:

> "decide what to do"

is wrong.

Small, well-bounded decisions are better.

## Excessive trust in the confidence

The confidence is to be calibrated empirically.

## AI where code is enough

If a deterministic rule solves the problem, the rule is to be used.

## Vendor lock-in

It is to be avoided through an abstract interface.

---

# 22. The design principle

The Decision Engine should work on decisions that are:

- small;
- explicit;
- typed;
- versioned;
- observable;
- reversible where possible;
- accompanied by a confidence;
- provided with an escalation.

Not:

> "understand everything and tell me what to do"

but:

> "given this state, choose one of the three admitted actions according to this policy."

---

# 23. A possible logical structure

```text
Decision Engine

├── API
├── Policy Registry
├── Rule Engine
├── Provider Router
│   ├── Jev
│   ├── Frontier LLM
│   └── other providers
├── Confidence / Threshold Layer
├── Escalation Manager
├── Decision Log
└── Metrics
```

This is a conceptual structure, not an implementation decision.

---

# 24. The connection with the general stack

The project's general architectural choice remains:

> **JavaScript/Node as the platform's backbone, Python only in the AI/agentic subsystems where it
> is really useful, PostgreSQL as the shared central state.**

The Decision Engine should therefore be able to be exposed naturally to the rest of the platform
through JavaScript/Node.

Jev's JavaScript SDK, if there is one, can make the integration simpler, but it must not determine
the architecture.

---

# 25. The implementation strategy advised

## Phase 1

Define an abstract interface for the decisions.

Implement a few real policies.

For example:

```text
scope_validation
analysis_validation
dev_failure_routing
dev_failure_routing
```

## Phase 2

Use a simple provider or a frontier model to begin with.

Record every decision.

## Phase 3

Integrate Jev as an alternative provider.

A possible shadow mode:

```text
the main provider → the operative decision
Jev → a decision recorded but not applied
```

## Phase 4

Compare the results.

Measure:

```text
agreement
errors
cost
latency
confidence
the Driver's overrides
```

## Phase 5

Entrust to Jev only the policies on which it shows enough reliability.

---

# 26. A first set of candidate policies

## scope_validation

The input:

- the analysis;
- the requirements;
- the constraints.

The output:

```text
ACCEPT
REJECT
MANUAL_REVIEW
```

---

## analysis_validation

The input:

- the specification produced;
- the initial context.

The output:

```text
PASS
REANALYZE
MANUAL_REVIEW
```

Plus some scores, possibly:

```text
completeness
consistency
testability
```

---

## dev_failure_routing

The input:

- the error;
- the project's state;
- the tests' output;
- the history of the retries.

The output:

```text
RETRY
RETURN_TO_ANALYSIS
MANUAL_REVIEW
OUT_OF_SCOPE
```

These three policies cross very different points of the workflow and make it possible to
understand quickly whether the concept works.

---

# 27. Conclusion

The proposal is to introduce formally a new cross-cutting subsystem:

> **the Decision Engine**

Its task is not to produce work, but to govern the workflow's small forks.

It must be:

- provider-agnostic;
- usable by every subsystem;
- based on typed decisions;
- provided with a confidence and an escalation;
- observable;
- testable;
- replaceable;
- able to be integrated with deterministic rules;
- compatible with frontier models;
- potentially compatible with Jev/System One.

Jev looks particularly interesting as a possible implementation of a part of the engine, because
its paradigm is close to the platform's needs of classification, scoring and routing.

The architectural choice advised is:

> **building the Decision Engine as a stable component of the platform and treating Jev as one of
> the possible providers, not as the foundation of the whole system.**
