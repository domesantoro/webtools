// What this subsystem measures about itself: the whole `dims` of every new metric, and
// the case a counter could not carry — a list of nothing.
//
//   node --test tests/measurements.test.js

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DRIVER_UID,
  OTHER_UID,
  TOKEN,
  asDriver,
  ask,
  project,
  session,
  stack,
  stoppedAt,
} from "./stack.js";
import { routeLabel } from "../src/server.js";

const MINE = "8bf6975d-7eef-4900-ac14-fa668d18c219";

async function on(options, body) {
  const up = await stack(options);
  try {
    return await body(up);
  } finally {
    up.close();
  }
}

// One measurement of a metric, with everything it carried.
const only = (up, metric) => {
  const taken = up.settings.metrics.of(metric);
  assert.equal(taken.length, 1, `${metric}: ${taken.length} measurements`);
  return taken[0];
};

/* --------------------------------------------------------------- the lists */

test("the owner's three lists are three measurements", async () => {
  await on(
    {
      sso: { logged: true, session: session() },
      projects: [
        project({ id: "a", state: "DEVELOPMENT" }),
        project({ id: "b", state: "DEMO" }),
        project({ id: "c", state: "UNDERSPECIFIED", steps: [] }),
        project({ id: "d", state: "PREANALYSIS", steps: [] }),
        project({ id: "e", state: "FAILED", steps: stoppedAt("technical") }),
      ],
    },
    async (up) => {
      await ask(up, "/", { token: TOKEN });
      const lists = up.settings.metrics.of("projects.listed");
      assert.deepEqual(
        lists.map((one) => [one.dims.list, one.amounts.projects]),
        [
          ["owned_active", 2],
          ["owned_returned", 1],
          ["owned_stopped", 2],
        ]
      );
      // A list is not about one project: nothing names one here.
      assert.equal(
        lists.every((one) => !("project_id" in one)),
        true
      );
    }
  );
});

test("a list of zero is measured all the same", async () => {
  // The one thing a `count` could not carry: an empty list of orphans is the answer that
  // says the register is healthy, and it has to be a number like any other.
  await on({ sso: { logged: true, session: session({ driver: asDriver(2) }) } }, async (up) => {
    await ask(up, "/broken", { token: TOKEN });
    const lists = up.settings.metrics.of("projects.listed");
    assert.deepEqual(
      lists.map((one) => [one.dims.list, one.amounts.projects]),
      [
        ["orphan", 0],
        ["orphan_failed", 0],
      ]
    );
  });
});

test("the driver's tab measures its two lists apart", async () => {
  await on(
    {
      sso: { logged: true, session: session({ uid: OTHER_UID, driver: asDriver(1) }) },
      projects: [
        project({ id: "waiting-1", driverUid: DRIVER_UID, state: "DRIVER_VALIDATION" }),
        project({ id: "waiting-2", driverUid: DRIVER_UID, state: "DRIVER_VALIDATION" }),
        project({ id: "stopped-1", driverUid: DRIVER_UID, state: "FAILED", steps: stoppedAt("points") }),
      ],
    },
    async (up) => {
      await ask(up, "/driver", { token: TOKEN });
      const lists = up.settings.metrics.of("projects.listed");
      assert.deepEqual(
        lists.map((one) => [one.dims.list, one.amounts.projects]),
        [
          ["driver_review", 2],
          ["driver_failed", 1],
        ]
      );
    }
  );
});

test("the orphans and the orphans that stopped are two lists", async () => {
  await on(
    {
      sso: { logged: true, session: session({ driver: asDriver(2) }) },
      projects: [
        project({ id: "orphan-1", state: "DEMO" }),
        project({ id: "orphan-stopped", state: "FAILED_NO_DRIVERS", steps: stoppedAt("handover") }),
      ],
    },
    async (up) => {
      await ask(up, "/broken", { token: TOKEN });
      const lists = up.settings.metrics.of("projects.listed");
      assert.deepEqual(
        lists.map((one) => [one.dims.list, one.amounts.projects]),
        [
          ["orphan", 1],
          ["orphan_failed", 1],
        ]
      );
    }
  );
});

/* ------------------------------------------------------------- the links made */

test("an ambassador's link is counted, with no percentage put in its place", async () => {
  await on({ sso: { logged: true, session: session({ driver: asDriver(0) }) } }, async (up) => {
    await ask(up, "/links", { token: TOKEN, method: "POST", body: "kind=ambassador" });
    const measured = only(up, "driver_link.issued");
    // Absent is absent: this kind has no percentage, and nothing is invented for it.
    assert.deepEqual(measured.dims, { kind: "ambassador" });
  });
});

test("a driver's link with no discount is counted without a percentage", async () => {
  await on({ sso: { logged: true, session: session({ driver: asDriver(1) }) } }, async (up) => {
    await ask(up, "/links", { token: TOKEN, method: "POST", body: "kind=driver&percentage=" });
    assert.deepEqual(only(up, "driver_link.issued").dims, { kind: "driver" });
  });
});

test("a code created and a code reused are two different numbers", async () => {
  // One of them wrote a document and the other did not.
  await on({ sso: { logged: true, session: session({ driver: asDriver(1) }) } }, async (up) => {
    await ask(up, "/links", { token: TOKEN, method: "POST", body: "kind=driver&percentage=3" });
    await ask(up, "/links", { token: TOKEN, method: "POST", body: "kind=driver&percentage=3" });
    assert.deepEqual(
      up.settings.metrics.of("driver_link.issued").map((one) => one.dims),
      [
        { kind: "discount_created", percentage: "3" },
        { kind: "discount_reused", percentage: "3" },
      ]
    );
  });
});

test("a link refused is not a link made", async () => {
  await on({ sso: { logged: true, session: session({ driver: asDriver(0) }) } }, async (up) => {
    // A driver at level 0 may not hand out a driver's link.
    await ask(up, "/links", { token: TOKEN, method: "POST", body: "kind=driver&percentage=3" });
    assert.deepEqual(up.settings.metrics.of("driver_link.issued"), []);
  });
});

/* --------------------------------------------------------- the documents served */

test("a document served carries the kind, the capacity, its size and the project", async () => {
  await on(
    {
      sso: { logged: true, session: session() },
      projects: [project({ id: MINE })],
      documents: { [`${MINE}/proposal`]: "# The points" },
    },
    async (up) => {
      await ask(up, `/projects/${MINE}/documents/proposal`, { token: TOKEN });
      const measured = only(up, "document.served");
      assert.deepEqual(measured.dims, { kind: "proposal", as: "owner" });
      assert.equal(measured.bytes, Buffer.byteLength("# The points"));
      assert.equal(measured.project_id, MINE);
    }
  );
});

test("the capacity is the narrowest true one", async () => {
  // A driver reading a project of their own is its driver and not an administrator: an
  // administrator opening the wreckage and a driver starting work are the two readings
  // this number exists to tell apart.
  await on(
    {
      sso: { logged: true, session: session({ uid: OTHER_UID, driver: asDriver(2) }) },
      projects: [project({ id: MINE, driverUid: DRIVER_UID })],
      documents: { [`${MINE}/analysis`]: "# The analysis" },
    },
    async (up) => {
      await ask(up, `/projects/${MINE}/documents/analysis`, { token: TOKEN });
      assert.equal(only(up, "document.served").dims.as, "driver");
    }
  );
});

test("level 2 reading somebody else's project is counted as that", async () => {
  await on(
    {
      sso: { logged: true, session: session({ uid: OTHER_UID, driver: asDriver(2) }) },
      projects: [project({ id: MINE })],
      documents: { [`${MINE}/analysis`]: "# The analysis" },
    },
    async (up) => {
      await ask(up, `/projects/${MINE}/documents/analysis`, { token: TOKEN });
      assert.equal(only(up, "document.served").dims.as, "prj_admin");
    }
  );
});

test("a download refused is not a download served", async () => {
  await on(
    {
      sso: { logged: true, session: session() },
      projects: [project({ id: MINE })],
      documents: { [`${MINE}/analysis`]: "# The analysis" },
    },
    async (up) => {
      // The owner is not given the analysis.
      await ask(up, `/projects/${MINE}/documents/analysis`, { token: TOKEN });
      assert.deepEqual(up.settings.metrics.of("document.served"), []);
    }
  );
});

test("workspaces not answering is not a download served either", async () => {
  // It is already a `dependency.call`, and counting it here would be one fact under two
  // names.
  await on(
    { sso: { logged: true, session: session() }, projects: [project({ id: MINE })], workspacesBroken: true },
    async (up) => {
      await ask(up, `/projects/${MINE}/documents/proposal`, { token: TOKEN });
      assert.deepEqual(up.settings.metrics.of("document.served"), []);
      const called = up.settings.metrics.of("dependency.call").at(-1);
      assert.deepEqual(called.dims, { target: "workspaces", operation: "latest_document", outcome: "failed" });
    }
  );
});

/* ------------------------------------------------------------ every request */

test("every request is counted once, under a route and not a path", async () => {
  await on(
    {
      sso: { logged: true, session: session() },
      projects: [project({ id: MINE })],
      documents: { [`${MINE}/proposal`]: "# The points" },
    },
    async (up) => {
      await ask(up, `/projects/${MINE}/documents/proposal`, { token: TOKEN });
      const counted = up.settings.metrics.of("http.request");
      assert.equal(counted.length, 1);
      // A project id in a dimension would open a bucket per project.
      assert.deepEqual(counted[0].dims, {
        route: "/projects/{id}/documents/{kind}",
        method: "GET",
        status: "200",
      });
      assert.equal(typeof counted[0].duration_ms, "number");
    }
  );
});

test("the route labels are a list and not a pattern", () => {
  // A route added tomorrow is counted as `(other)` — a fact — instead of being guessed at.
  assert.equal(routeLabel("/"), "/");
  assert.equal(routeLabel("/driver"), "/driver");
  assert.equal(routeLabel("/broken"), "/broken");
  assert.equal(routeLabel("/links"), "/links");
  assert.equal(routeLabel("/projects/any-id/documents/proposal"), "/projects/{id}/documents/{kind}");
  assert.equal(routeLabel("/styles.css"), "(static)");
  assert.equal(routeLabel("/commons.css"), "(static)");
  assert.equal(routeLabel("/fonts/inter.woff2"), "(static)");
  assert.equal(routeLabel("/assets/mark.svg"), "(static)");
  assert.equal(routeLabel("/something-new"), "(other)");
});

test("every call to another subsystem is one dependency.call", async () => {
  await on(
    { sso: { logged: true, session: session() }, projects: [project({ id: MINE })] },
    async (up) => {
      await ask(up, "/", { token: TOKEN });
      assert.deepEqual(
        up.settings.metrics.of("dependency.call").map((one) => one.dims),
        [
          { target: "sso", operation: "read_session", outcome: "ok" },
          { target: "anagraphics", operation: "list_projects", outcome: "ok" },
        ]
      );
    }
  );
});

test("a page rendered asks the sso who is looking once, not twice", async () => {
  // `POST /links` renders the driver's tab again, and it goes through the page and not
  // through the route: asking a second time inside one request would be a second answer to
  // a question already answered.
  await on({ sso: { logged: true, session: session({ driver: asDriver(1) }) } }, async (up) => {
    await ask(up, "/links", { token: TOKEN, method: "POST", body: "kind=ambassador" });
    const sessions = up.settings.metrics
      .of("dependency.call")
      .filter((one) => one.dims.operation === "read_session");
    assert.equal(sessions.length, 1);
  });
});
