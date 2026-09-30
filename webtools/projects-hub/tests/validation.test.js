// The driver's gate: the two buttons, the confirmation, and what gets written.
//
//   node --test tests/validation.test.js
//
// A real server of ours, with anagraphics answering from a fake that appends the step and
// moves the state in one write, the way the real route does. What these tests are about
// is who may decide, what stops a decision from being written, and what the project
// carries afterwards.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DRIVER_UID,
  OTHER_DRIVER_UID,
  OWNER,
  STEP_WAITED_MS,
  TOKEN,
  asDriver,
  ask,
  handedOver,
  project,
  session,
  stack,
} from "./stack.js";

const MINE = "8bf6975d-7eef-4900-ac14-fa668d18c219";

const readable = (html) => html.replaceAll("&#39;", "'").replaceAll("&amp;", "&");

async function on(options, body) {
  const up = await stack(options);
  try {
    return await body(up);
  } finally {
    up.close();
  }
}

// A driver logged in, with one project of theirs waiting for a decision.
function waiting({ state = "DRIVER_VALIDATION", driverUid = DRIVER_UID, steps = handedOver() } = {}) {
  return {
    sso: { logged: true, session: session({ driver: asDriver(1) }) },
    projects: [project({ id: MINE, state, driverUid, steps })],
  };
}

const form = (fields) => new URLSearchParams(fields).toString();

const decide = (up, path, fields) =>
  ask(up, path, { method: "POST", token: TOKEN, body: form(fields) });

/* --------------------------------------------------------------- the two buttons */

test("a project waiting for the driver carries both buttons", async () => {
  await on(waiting(), async (up) => {
    const page = readable(await (await ask(up, "/driver", { token: TOKEN })).text());
    assert.match(page, new RegExp(`action="/projects/${MINE}/validation"`));
    assert.match(page, /name="decision" value="approve"/);
    assert.match(page, /name="decision" value="reject"/);
  });
});

test("a project of theirs that has stopped carries neither", async () => {
  // The gate decides in one state. A project in `FAILED` is on the same page, in the
  // other list, and nothing there is a decision to take.
  await on(waiting({ state: "FAILED" }), async (up) => {
    const page = await (await ask(up, "/driver", { token: TOKEN })).text();
    assert.equal(page.includes('value="approve"'), false);
    assert.equal(page.includes('value="reject"'), false);
  });
});

test("the client is never offered the buttons on their own project", async () => {
  await on(
    {
      sso: { logged: true, session: session() },
      projects: [project({ id: MINE, state: "DRIVER_VALIDATION", driverUid: DRIVER_UID })],
    },
    async (up) => {
      const page = await (await ask(up, "/")).text();
      assert.equal(page.includes('value="approve"'), false);
    }
  );
});

test("the level that sees other people's projects is not offered them either", async () => {
  // `/broken` lists projects nobody supervises, so that one can be found. Finding one is
  // not deciding about it: the analysis was handed to a person, and the step carries
  // their name.
  await on(
    {
      sso: { logged: true, session: session({ driver: asDriver(2) }) },
      projects: [project({ id: MINE, state: "DRIVER_VALIDATION", driverUid: null })],
    },
    async (up) => {
      const page = await (await ask(up, "/broken", { token: TOKEN })).text();
      assert.equal(page.includes('value="approve"'), false);
    }
  );
});

/* --------------------------------------------------------- who may ask, and about what */

test("somebody who is not a driver gets a 404, and nothing is written", async () => {
  await on(
    {
      sso: { logged: true, session: session() },
      projects: [project({ id: MINE, driverUid: DRIVER_UID, steps: handedOver() })],
    },
    async (up) => {
      const answer = await decide(up, `/projects/${MINE}/validation`, { decision: "approve" });
      assert.equal(answer.status, 404);
      assert.equal(up.settings.metrics.of("gate.decided").length, 0);
    }
  );
});

test("another driver's project is a 404", async () => {
  await on(waiting({ driverUid: OTHER_DRIVER_UID }), async (up) => {
    const answer = await decide(up, `/projects/${MINE}/validation/confirm`, {
      decision: "approve",
    });
    assert.equal(answer.status, 404);
    assert.equal(up.settings.metrics.of("gate.decided").length, 0);
  });
});

test("a project that has not reached this gate is a 404", async () => {
  await on(waiting({ state: "ANALYSIS" }), async (up) => {
    const answer = await decide(up, `/projects/${MINE}/validation/confirm`, {
      decision: "approve",
    });
    assert.equal(answer.status, 404);
  });
});

test("a project that has already been through this gate is a 404", async () => {
  // The state is what says so, and it has moved: the second press of a button, or the
  // same form posted twice, finds a project that is no longer here.
  await on(waiting({ state: "CLIENT_VALIDATION" }), async (up) => {
    const answer = await decide(up, `/projects/${MINE}/validation/confirm`, {
      decision: "approve",
    });
    assert.equal(answer.status, 404);
    assert.equal(up.settings.metrics.of("gate.decided").length, 0);
  });
});

test("a project that does not exist answers like one that is somebody else's", async () => {
  await on(waiting(), async (up) => {
    const answer = await decide(up, "/projects/made-up/validation", { decision: "approve" });
    assert.equal(answer.status, 404);
  });
});

test("a decision that is neither of the two is a 404", async () => {
  await on(waiting(), async (up) => {
    const answer = await decide(up, `/projects/${MINE}/validation/confirm`, {
      decision: "maybe",
    });
    assert.equal(answer.status, 404);
    assert.equal(up.settings.metrics.of("gate.decided").length, 0);
  });
});

/* ------------------------------------------------------------- the confirmation */

test("the confirmation says what approving does, and decides nothing", async () => {
  await on(waiting(), async (up) => {
    const answer = await decide(up, `/projects/${MINE}/validation`, { decision: "approve" });
    assert.equal(answer.status, 200);
    const page = readable(await answer.text());
    assert.match(page, /passa al cliente|goes to the client/);
    assert.match(page, new RegExp(`action="/projects/${MINE}/validation/confirm"`));
    // No box: an approval is the sentence and the button.
    assert.equal(page.includes("<textarea"), false);
    // Nothing was written, and nothing counted.
    assert.equal(up.settings.metrics.of("gate.decided").length, 0);
    assert.equal(up.asked.anagraphics.some((one) => one.startsWith("POST")), false);
  });
});

test("the confirmation of a refusal carries the box, required and bounded", async () => {
  await on(waiting(), async (up) => {
    const page = readable(
      await (await decide(up, `/projects/${MINE}/validation`, { decision: "reject" })).text()
    );
    assert.match(page, /<textarea[^>]*name="reason"/);
    assert.match(page, /required/);
    assert.match(page, new RegExp(`maxlength="${up.settings.rejectionReasonMaxChars}"`));
    assert.equal(up.settings.metrics.of("gate.decided").length, 0);
  });
});

/* ------------------------------------------------------------------ the decision */

test("approving moves the project to the client and writes the step", async () => {
  await on(waiting(), async (up) => {
    const answer = await decide(up, `/projects/${MINE}/validation/confirm`, {
      decision: "approve",
    });
    assert.equal(answer.status, 200);

    const written = up.projects[0].pipeline;
    assert.equal(written.state, "CLIENT_VALIDATION");
    const last = written.steps[written.steps.length - 1];
    assert.equal(last.step, "driver_validation");
    assert.equal(last.result, "passed");
    assert.equal(last.data.driver_uid, DRIVER_UID);
    // An approval carries no motivation: there is no field to fill in, and an empty one
    // would read as one that was asked for and not given.
    assert.equal("reason" in last.data, false);
  });
});

test("refusing with a motivation closes the request and keeps the sentence", async () => {
  await on(waiting(), async (up) => {
    const answer = await decide(up, `/projects/${MINE}/validation/confirm`, {
      decision: "reject",
      reason: "  Il perimetro è quello di un gestionale, non di un webtool.  ",
    });
    assert.equal(answer.status, 200);

    const written = up.projects[0].pipeline;
    assert.equal(written.state, "REJECTED");
    const last = written.steps[written.steps.length - 1];
    assert.equal(last.step, "driver_validation");
    assert.equal(last.result, "rejected");
    // Trimmed: the spaces somebody happened to leave around a sentence are not part of it.
    assert.equal(last.data.reason, "Il perimetro è quello di un gestionale, non di un webtool.");
  });
});

test("a refusal with nothing written changes nothing and says what is missing", async () => {
  await on(waiting(), async (up) => {
    const answer = await decide(up, `/projects/${MINE}/validation/confirm`, {
      decision: "reject",
      reason: "   \n  ",
    });
    assert.equal(answer.status, 200);
    const page = readable(await answer.text());
    assert.match(page, /motivazione|motivation/);
    // The box is still there to type in, and the project has not moved.
    assert.match(page, /<textarea[^>]*name="reason"/);
    assert.equal(up.projects[0].pipeline.state, "DRIVER_VALIDATION");
    assert.equal(up.settings.metrics.of("gate.decided").length, 0);
  });
});

test("a motivation past the limit comes back in the box, and nothing is written", async () => {
  await on(waiting(), async (up) => {
    const tooLong = "a".repeat(up.settings.rejectionReasonMaxChars + 1);
    const answer = await decide(up, `/projects/${MINE}/validation/confirm`, {
      decision: "reject",
      reason: tooLong,
    });
    assert.equal(answer.status, 200);
    const page = await answer.text();
    assert.match(page, new RegExp(tooLong));
    assert.equal(up.projects[0].pipeline.state, "DRIVER_VALIDATION");
    assert.equal(up.settings.metrics.of("gate.decided").length, 0);
  });
});

test("the length is counted in characters and not in bytes", async () => {
  // The limit is about a sentence somebody has to read. A text of exactly the limit made
  // of characters that weigh four bytes each is inside it.
  await on(waiting(), async (up) => {
    const reason = "è".repeat(up.settings.rejectionReasonMaxChars);
    const answer = await decide(up, `/projects/${MINE}/validation/confirm`, {
      decision: "reject",
      reason,
    });
    assert.equal(answer.status, 200);
    assert.equal(up.projects[0].pipeline.state, "REJECTED");
  });
});

test("anagraphics not taking the step leaves the project alone and says so", async () => {
  await on({ ...waiting(), anagraphicsBroken: true }, async (up) => {
    const answer = await decide(up, `/projects/${MINE}/validation/confirm`, {
      decision: "approve",
    });
    assert.equal(answer.status, 503);
    assert.equal(up.settings.metrics.of("gate.decided").length, 0);
  });
});

/* ---------------------------------------------------------------- what is measured */

test("the decision is counted once, and so is how long it waited", async () => {
  await on(waiting(), async (up) => {
    await decide(up, `/projects/${MINE}/validation/confirm`, { decision: "approve" });

    const decided = up.settings.metrics.of("gate.decided");
    assert.equal(decided.length, 1);
    assert.deepEqual(decided[0].dims, { gate: "driver_validation", outcome: "passed" });
    assert.equal(decided[0].project_id, MINE);

    // The analyst opened this gate's step when it handed the project over; this is what
    // closed it, so what the duration says is the time the analysis spent on a person's
    // desk.
    const waited = up.settings.metrics.of("gate.duration");
    assert.equal(waited.length, 1);
    assert.deepEqual(waited[0].dims, { gate: "driver_validation" });
    assert.equal(waited[0].duration_ms, STEP_WAITED_MS);
  });
});

test("a refusal is counted with no reason on it", async () => {
  // `reason` is the **name** of a refusal, from a list somebody can act on. What a
  // driver writes is a sentence, and a dimension holding it would open a bucket per
  // refusal. It stays on the project, where it is read.
  await on(waiting(), async (up) => {
    await decide(up, `/projects/${MINE}/validation/confirm`, {
      decision: "reject",
      reason: "Fuori perimetro.",
    });
    const decided = up.settings.metrics.of("gate.decided");
    assert.equal(decided.length, 1);
    assert.deepEqual(decided[0].dims, { gate: "driver_validation", outcome: "rejected" });
  });
});

test("a project handed over before this gate existed reports no duration", async () => {
  // Its last step is the analysis, decided: there is nothing open for the decision to
  // close. The decision is written and counted; the wait is not, because nothing knows
  // when it began. Absent is absent.
  await on(waiting({ steps: null }), async (up) => {
    await decide(up, `/projects/${MINE}/validation/confirm`, { decision: "approve" });
    assert.equal(up.settings.metrics.of("gate.decided").length, 1);
    assert.equal(up.settings.metrics.of("gate.duration").length, 0);
  });
});

/* ------------------------------------------------------------------- afterwards */

test("the tab says what was decided, because the row has gone", async () => {
  await on(waiting(), async (up) => {
    const page = readable(
      await (
        await decide(up, `/projects/${MINE}/validation/confirm`, { decision: "approve" })
      ).text()
    );
    assert.match(page, /Analisi approvata|analysis is approved/);
  });
});

test("the routes are counted under a label that carries no project id", async () => {
  await on(waiting(), async (up) => {
    await decide(up, `/projects/${MINE}/validation`, { decision: "approve" });
    await decide(up, `/projects/${MINE}/validation/confirm`, { decision: "approve" });
    const labels = up.settings.metrics.of("http.request").map((one) => one.dims.route);
    assert.equal(labels.includes("/projects/{id}/validation"), true);
    assert.equal(labels.includes("/projects/{id}/validation/confirm"), true);
    assert.equal(
      labels.some((one) => one.includes(MINE)),
      false
    );
  });
});

/* ------------------------------------------------- what the client is told about it */

test("a refusal is said to the client, with the sentence the driver wrote", async () => {
  await on(waiting(), async (up) => {
    await decide(up, `/projects/${MINE}/validation/confirm`, {
      decision: "reject",
      reason: "Il perimetro è quello di un gestionale.",
    });

    assert.deepEqual(up.said, [
      {
        form: "analysis-refused",
        body: {
          project_id: MINE,
          client: { uid: OWNER.uid, screen_name: OWNER.screen_name, username: OWNER.username },
          reason: "Il perimetro è quello di un gestionale.",
        },
      },
    ]);
  });
});

test("an approval says nothing to anybody", async () => {
  // It moves the project to the client's own gate, and that gate does not exist: a
  // message asking somebody to do something they have nowhere to do is worse than none.
  await on(waiting(), async (up) => {
    await decide(up, `/projects/${MINE}/validation/confirm`, { decision: "approve" });
    assert.deepEqual(up.said, []);
  });
});

test("a refusal that was not written tells nobody it was", async () => {
  await on({ ...waiting(), anagraphicsBroken: true }, async (up) => {
    const answer = await decide(up, `/projects/${MINE}/validation/confirm`, {
      decision: "reject",
      reason: "Non è un webtool.",
    });
    assert.equal(answer.status, 503);
    assert.deepEqual(up.said, []);
  });
});

test("a client nobody can read leaves the refusal exactly where it was", async () => {
  // The owner's account is not in anagraphics any more. The driver's decision is theirs
  // and it is taken: nothing about it depends on the client being reachable.
  await on({ ...waiting(), users: [] }, async (up) => {
    const answer = await decide(up, `/projects/${MINE}/validation/confirm`, {
      decision: "reject",
      reason: "Non è un webtool.",
    });
    assert.equal(answer.status, 200);
    assert.equal(up.projects[0].pipeline.state, "REJECTED");
    assert.deepEqual(up.said, []);
  });
});

test("a comm-center that is not answering does not undo the decision", async () => {
  await on({ ...waiting(), commCenterBroken: true }, async (up) => {
    const answer = await decide(up, `/projects/${MINE}/validation/confirm`, {
      decision: "reject",
      reason: "Non è un webtool.",
    });
    assert.equal(answer.status, 200);
    assert.equal(up.projects[0].pipeline.state, "REJECTED");
    const calls = up.settings.metrics.of("dependency.call");
    assert.equal(
      calls.some((one) => one.dims.target === "comm-center" && one.dims.outcome === "failed"),
      true
    );
  });
});
