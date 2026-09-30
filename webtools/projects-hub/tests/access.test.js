// Who gets which page, and what happens when the sso cannot say who somebody is.
//
//   node --test tests/access.test.js

import assert from "node:assert/strict";
import { test } from "node:test";

import { DRIVER_UID, OTHER_UID, TOKEN, asDriver, ask, project, session, stack } from "./stack.js";

const PROJECT = "8bf6975d-7eef-4900-ac14-fa668d18c219";

async function on(options, body) {
  const up = await stack(options);
  try {
    return await body(up);
  } finally {
    up.close();
  }
}

/* ------------------------------------------------------- the three outcomes of a session */

test("logged in, the page is rendered", async () => {
  await on({ sso: { logged: true, session: session() } }, async (up) => {
    const answer = await ask(up, "/", { token: TOKEN });
    assert.equal(answer.status, 200);
    assert.match(await answer.text(), /<title>/);
  });
});

test("not logged in, the browser is sent to the sso's login", async () => {
  await on({ sso: { logged: false } }, async (up) => {
    const answer = await ask(up, "/");
    assert.equal(answer.status, 303);
    const where = new URL(answer.headers.get("location"));
    assert.equal(where.pathname, "/ui/login");
    // And back to the little route that closes the round trip, not to the page itself.
    assert.equal(where.searchParams.get("next"), `${up.base}/login-done`);
  });
});

test("the sso not answering is a 503 page and NEVER a redirect", async () => {
  // The loop `currentSession` is commented against: treating "we do not know" as a logout
  // would throw everybody at a login that is not reachable.
  await on({ sso: { broken: true } }, async (up) => {
    const answer = await ask(up, "/", { token: TOKEN });
    assert.equal(answer.status, 503);
    assert.equal(answer.headers.get("location"), null);
    assert.equal(up.settings.metrics.of("http.error")[0].dims.code, "SSO_UNAVAILABLE");
  });
});

/* --------------------------------------------------------------------- the tabs */

test("somebody who is not a driver gets 404 on /driver, not 403", async () => {
  // A thing you may not see does not exist, and a 403 tells you it does.
  await on({ sso: { logged: true, session: session() } }, async (up) => {
    assert.equal((await ask(up, "/driver", { token: TOKEN })).status, 404);
  });
});

test("a driver at level 1 gets 404 on /broken", async () => {
  await on({ sso: { logged: true, session: session({ driver: asDriver(1) }) } }, async (up) => {
    assert.equal((await ask(up, "/broken", { token: TOKEN })).status, 404);
  });
});

test("a driver at level 2 gets /broken", async () => {
  await on({ sso: { logged: true, session: session({ driver: asDriver(2) }) } }, async (up) => {
    assert.equal((await ask(up, "/broken", { token: TOKEN })).status, 200);
  });
});

test("a driver at level 0 has the driver tab and not the broken one", async () => {
  // Level 0 is registered and not yet interviewed: still a driver, still an ambassador.
  await on({ sso: { logged: true, session: session({ driver: asDriver(0) }) } }, async (up) => {
    assert.equal((await ask(up, "/driver", { token: TOKEN })).status, 200);
    assert.equal((await ask(up, "/broken", { token: TOKEN })).status, 404);
  });
});

test("the navigation offers exactly the tabs the routes allow", async () => {
  await on({ sso: { logged: true, session: session({ driver: asDriver(2) }) } }, async (up) => {
    const page = await (await ask(up, "/driver", { token: TOKEN })).text();
    for (const href of ['href="/"', 'href="/driver"', 'href="/broken"']) {
      assert.match(page, new RegExp(href.replace("/", "\\/")));
    }
  });
  await on({ sso: { logged: true, session: session() } }, async (up) => {
    const page = await (await ask(up, "/", { token: TOKEN })).text();
    assert.equal(page.includes('href="/driver"'), false);
    assert.equal(page.includes('href="/broken"'), false);
  });
});

/* ---------------------------------------------------------------- the documents */

const OWNED = [project({ id: PROJECT })];
const DOCUMENTS = { [`${PROJECT}/proposal`]: "# The points", [`${PROJECT}/analysis`]: "# The analysis" };

test("the owner is given the points and refused the analysis", async () => {
  // Their tab offers the points and only the points: the analysis is written for whoever
  // has to judge the work.
  await on(
    { sso: { logged: true, session: session() }, projects: OWNED, documents: DOCUMENTS },
    async (up) => {
      const points = await ask(up, `/projects/${PROJECT}/documents/proposal`, { token: TOKEN });
      assert.equal(points.status, 200);
      assert.equal(await points.text(), "# The points");
      assert.equal((await ask(up, `/projects/${PROJECT}/documents/analysis`, { token: TOKEN })).status, 404);
    }
  );
});

test("the project's driver is given both", async () => {
  await on(
    {
      sso: { logged: true, session: session({ uid: OTHER_UID, driver: asDriver(1) }) },
      projects: [project({ id: PROJECT, driverUid: DRIVER_UID })],
      documents: DOCUMENTS,
    },
    async (up) => {
      assert.equal((await ask(up, `/projects/${PROJECT}/documents/proposal`, { token: TOKEN })).status, 200);
      assert.equal((await ask(up, `/projects/${PROJECT}/documents/analysis`, { token: TOKEN })).status, 200);
    }
  );
});

test("somebody who is neither owner nor driver gets 404 on both", async () => {
  await on(
    {
      sso: { logged: true, session: session({ uid: OTHER_UID, driver: asDriver(1) }) },
      projects: OWNED,
      documents: DOCUMENTS,
    },
    async (up) => {
      assert.equal((await ask(up, `/projects/${PROJECT}/documents/proposal`, { token: TOKEN })).status, 404);
      assert.equal((await ask(up, `/projects/${PROJECT}/documents/analysis`, { token: TOKEN })).status, 404);
    }
  );
});

test("level 2 is given both on a project that is nobody's", async () => {
  await on(
    {
      sso: { logged: true, session: session({ uid: OTHER_UID, driver: asDriver(2) }) },
      projects: OWNED,
      documents: DOCUMENTS,
    },
    async (up) => {
      assert.equal((await ask(up, `/projects/${PROJECT}/documents/proposal`, { token: TOKEN })).status, 200);
      assert.equal((await ask(up, `/projects/${PROJECT}/documents/analysis`, { token: TOKEN })).status, 200);
    }
  );
});

test("a project that does not exist answers like one that is not yours", async () => {
  // One answer, so the address is of no use for finding out which ids exist.
  await on({ sso: { logged: true, session: session() }, projects: OWNED }, async (up) => {
    const missing = await ask(up, "/projects/does-not-exist/documents/proposal", { token: TOKEN });
    assert.equal(missing.status, 404);
  });
});

test("a kind of document that does not exist is a 404 and nothing is read", async () => {
  await on(
    { sso: { logged: true, session: session() }, projects: OWNED, documents: DOCUMENTS },
    async (up) => {
      assert.equal((await ask(up, `/projects/${PROJECT}/documents/invoice`, { token: TOKEN })).status, 404);
      assert.deepEqual(up.asked.workspaces, []);
    }
  );
});

test("a document nobody ever wrote is a 404 and not a broken service", async () => {
  await on({ sso: { logged: true, session: session() }, projects: OWNED, documents: {} }, async (up) => {
    assert.equal((await ask(up, `/projects/${PROJECT}/documents/proposal`, { token: TOKEN })).status, 404);
  });
});

test("workspaces not answering is a 503 with its own code", async () => {
  await on(
    { sso: { logged: true, session: session() }, projects: OWNED, workspacesBroken: true },
    async (up) => {
      const answer = await ask(up, `/projects/${PROJECT}/documents/proposal`, { token: TOKEN });
      assert.equal(answer.status, 503);
      assert.equal(up.settings.metrics.of("http.error")[0].dims.code, "WORKSPACES_UNAVAILABLE");
    }
  );
});

test("a download needs a session like every other page", async () => {
  await on({ sso: { logged: false }, projects: OWNED, documents: DOCUMENTS }, async (up) => {
    const answer = await ask(up, `/projects/${PROJECT}/documents/proposal`);
    assert.equal(answer.status, 303);
  });
});

/* --------------------------------------------------------------- anagraphics down */

test("anagraphics not answering is a 503 page on every tab", async () => {
  await on(
    { sso: { logged: true, session: session({ driver: asDriver(2) }) }, anagraphicsBroken: true },
    async (up) => {
      for (const path of ["/", "/driver", "/broken"]) {
        assert.equal((await ask(up, path, { token: TOKEN })).status, 503, path);
      }
      const codes = up.settings.metrics.of("http.error").map((one) => one.dims.code);
      assert.deepEqual(new Set(codes), new Set(["ANAGRAPHICS_UNAVAILABLE"]));
    }
  );
});
