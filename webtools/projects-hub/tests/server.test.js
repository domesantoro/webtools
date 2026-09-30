// The routes, end to end: a real server of ours with anagraphics, the sso and workspaces
// answering from fakes.
//
//   node --test tests/server.test.js

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DRIVER_UID,
  OTHER_DRIVER_UID,
  OTHER_UID,
  TICKET,
  TOKEN,
  asDriver,
  ask,
  project,
  session,
  stack,
  stoppedAt,
} from "./stack.js";

const MINE = "8bf6975d-7eef-4900-ac14-fa668d18c219";

// The pages are rendered with autoescaping on, so an apostrophe arrives as `&#39;`. That
// is the escaping doing its job, and a test that wants to read a sentence undoes it here
// rather than writing the entity into every expectation.
const readable = (html) => html.replaceAll("&#39;", "'").replaceAll("&amp;", "&");

async function on(options, body) {
  const up = await stack(options);
  try {
    return await body(up);
  } finally {
    up.close();
  }
}

/* ------------------------------------------------------------ the login round trip */

test("the round trip: login, ticket, cookie, and back to the first tab", async () => {
  await on({ sso: { logged: false, session: session() } }, async (up) => {
    // 1. No cookie: off to the sso.
    const sentAway = await ask(up, "/");
    assert.equal(sentAway.status, 303);
    assert.match(sentAway.headers.get("location"), /\/ui\/login\?next=/);

    // 2. The sso sends the browser back with a ticket. It is exchanged server to server.
    const back = await ask(up, `/login-done?ticket=${TICKET}`);
    assert.equal(back.status, 303);
    assert.equal(back.headers.get("location"), "/");
    const cookie = back.headers.get("set-cookie");
    assert.match(cookie, new RegExp(`^${up.settings.cookieName}=${TOKEN};`));
    // HttpOnly and SameSite=Lax, and a life no longer than the session's.
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Max-Age=3\d\d\d/);
    // The token never travelled through the address: the ticket did.
    assert.equal(sentAway.headers.get("location").includes(TOKEN), false);
  });
});

test("a ticket that is not one is a 404 and sets no cookie", async () => {
  await on({ sso: { logged: false } }, async (up) => {
    const answer = await ask(up, "/login-done?ticket=made-up");
    assert.equal(answer.status, 404);
    assert.equal(answer.headers.get("set-cookie"), null);
  });
});

test("arriving at /login-done by hand, with no ticket, is a 404", async () => {
  await on({ sso: { logged: false } }, async (up) => {
    assert.equal((await ask(up, "/login-done")).status, 404);
  });
});

test("a session that has already expired does not become a cookie", async () => {
  await on({ sso: { session: session({ expiresInSeconds: 0 }) } }, async (up) => {
    const answer = await ask(up, `/login-done?ticket=${TICKET}`);
    assert.equal(answer.status, 404);
    assert.equal(answer.headers.get("set-cookie"), null);
  });
});

test("/logout takes our cookie away and goes on to the sso's", async () => {
  await on({ sso: { logged: true, session: session() } }, async (up) => {
    const answer = await ask(up, "/logout", { token: TOKEN });
    assert.equal(answer.status, 303);
    assert.match(answer.headers.get("location"), /\/ui\/logout\?next=/);
    assert.match(answer.headers.get("set-cookie"), /Max-Age=0/);
  });
});

/* ------------------------------------------------------------------- the owner's tab */

test("the owner's tab asks for their projects and shows them in their words", async () => {
  await on(
    {
      sso: { logged: true, session: session() },
      projects: [project({ id: MINE, description: "Le presenze agli allenamenti" })],
    },
    async (up) => {
      const page = readable(await (await ask(up, "/", { token: TOKEN, locale: "it" })).text());
      // Asked for by owner, and by nothing else. No `state` filter: the three lists are a
      // partition of everything they own.
      assert.deepEqual(up.asked.anagraphics, [`GET /projects?owner_uid=${session().uid}`]);
      assert.match(page, /Le presenze agli allenamenti/);
      // The client's map of states, not the driver's.
      assert.match(page, /L'analisi è in revisione/);
      // No name anywhere in the flow yet: the placeholder.
      assert.match(page, /Progetto senza nome/);
      // Under review, so **neither** document is offered: see the test below.
      assert.equal(page.includes("/documents/"), false);
    }
  );
});

test("the owner's projects are split into three lists, in order", async () => {
  await on(
    {
      sso: { logged: true, session: session() },
      // Told apart by their descriptions: a project id is only ever on the page inside a
      // document's address, and two of these three have no document to offer.
      projects: [
        project({ id: "a", state: "DEVELOPMENT", description: "quello che si muove" }),
        project({ id: "b", state: "UNDERSPECIFIED", steps: [], description: "quello tornato" }),
        project({ id: "c", state: "PREANALYSIS", steps: [], description: "quello abbandonato" }),
      ],
    },
    async (up) => {
      const page = readable(await (await ask(up, "/", { token: TOKEN, locale: "it" })).text());
      const at = (text) => {
        const where = page.indexOf(text);
        assert.notEqual(where, -1, `not on the page: ${text}`);
        return where;
      };
      // Active first, what came back second, what stopped last.
      assert.ok(at("Attivi") < at("Serve più dettaglio"), "active before returned");
      assert.ok(at("Serve più dettaglio") < at("Progetti fermi"), "returned before stopped");
      // And each project under the heading it belongs to.
      assert.ok(at("quello che si muove") > at("Attivi") && at("quello che si muove") < at("Serve più dettaglio"));
      assert.ok(at("quello tornato") > at("Serve più dettaglio") && at("quello tornato") < at("Progetti fermi"));
      assert.ok(at("quello abbandonato") > at("Progetti fermi"));
    }
  );
});

test("a project left in pre-analysis reads as a generic error, among the stopped ones", async () => {
  await on(
    {
      sso: { logged: true, session: session() },
      projects: [project({ id: MINE, state: "PREANALYSIS", steps: [] })],
    },
    async (up) => {
      const page = readable(await (await ask(up, "/", { token: TOKEN, locale: "it" })).text());
      assert.match(page, /Errore generico/);
      assert.equal(page.includes("Pre-analisi da completare"), false);
      // It is in the stopped list, and the active one says it is empty.
      assert.ok(page.indexOf("Errore generico") > page.indexOf("Progetti fermi"));
      assert.match(page, /Nessun progetto attivo/);
      // No description, no download, and nothing in their place: not even the paragraph
      // they would have gone in.
      assert.equal(page.includes("project-description"), false);
      assert.equal(page.includes("project-documents"), false);
      assert.equal(page.includes("/documents/"), false);
    }
  );
});

test("an owner with no projects gets one sentence, not three empty lists", async () => {
  await on({ sso: { logged: true, session: session() }, projects: [] }, async (up) => {
    const page = readable(await (await ask(up, "/", { token: TOKEN, locale: "it" })).text());
    assert.match(page, /Non hai ancora progetti/);
    assert.equal(page.includes("Progetti fermi"), false);
  });
});

/* ------------------------------------- when the client is offered the list */

test("the client is NOT offered the functionalities while the analysis is under review", async () => {
  // What they would open is a draft nobody stands behind yet.
  await on(
    {
      sso: { logged: true, session: session() },
      projects: [project({ id: MINE, state: "DRIVER_VALIDATION" })],
      documents: { [`${MINE}/proposal`]: "# The points" },
    },
    async (up) => {
      const page = readable(await (await ask(up, "/", { token: TOKEN, locale: "it" })).text());
      assert.equal(page.includes("/documents/"), false);
      assert.equal(page.includes("Leggi le funzionalità"), false);
    }
  );
});

test("the client is offered them once the driver has approved", async () => {
  await on(
    {
      sso: { logged: true, session: session() },
      projects: [project({ id: MINE, state: "CLIENT_VALIDATION" })],
      documents: { [`${MINE}/proposal`]: "# The points" },
    },
    async (up) => {
      const page = readable(await (await ask(up, "/", { token: TOKEN, locale: "it" })).text());
      assert.match(page, new RegExp(`/projects/${MINE}/documents/proposal`));
      // Their own words for it, not the driver's.
      assert.match(page, /Leggi le funzionalità del tuo sistema/);
      assert.equal(page.includes("Scarica i punti"), false);
      // And never the analysis, whatever the state.
      assert.equal(page.includes(`/documents/analysis`), false);
    }
  );
});

test("the driver is offered both exactly while it is under review", async () => {
  // Reviewing it is the work: the same file is offered to one and not to the other.
  await on(
    {
      sso: { logged: true, session: session({ uid: OTHER_UID, driver: asDriver(1) }) },
      projects: [project({ id: MINE, driverUid: DRIVER_UID, state: "DRIVER_VALIDATION" })],
    },
    async (up) => {
      const page = readable(await (await ask(up, "/driver", { token: TOKEN, locale: "it" })).text());
      assert.match(page, new RegExp(`/projects/${MINE}/documents/proposal`));
      assert.match(page, new RegExp(`/projects/${MINE}/documents/analysis`));
      // The driver's words, not the client's.
      assert.match(page, /Scarica i punti/);
      assert.equal(page.includes("del tuo sistema"), false);
    }
  );
});

/* ------------------------------------------------------------------ the driver's tab */

test("the driver's tab asks for the two lists at once and partitions them", async () => {
  await on(
    {
      sso: { logged: true, session: session({ uid: OTHER_UID, driver: asDriver(1) }) },
      projects: [
        project({ id: "waiting-1", driverUid: DRIVER_UID, state: "DRIVER_VALIDATION" }),
        project({ id: "stopped-1", driverUid: DRIVER_UID, state: "FAILED", steps: stoppedAt("technical") }),
        // Not this driver's, and in a state neither list holds.
        project({ id: "elsewhere", driverUid: OTHER_DRIVER_UID, state: "DEMO" }),
      ],
    },
    async (up) => {
      const page = readable(await (await ask(up, "/driver", { token: TOKEN, locale: "it" })).text());
      const asked = up.asked.anagraphics[0];
      assert.match(asked, new RegExp(`driver_uid=${DRIVER_UID}`));
      for (const state of ["DRIVER_VALIDATION", "FAILED", "FAILED_NO_DRIVERS"]) {
        assert.match(asked, new RegExp(`state=${state}`));
      }
      assert.match(page, /Aspetta che tu validi l'analisi/);
      // The reason it stopped, from the last step.
      assert.match(page, /L'analisi tecnica non è tornata/);
      assert.equal(page.includes("elsewhere"), false);
    }
  );
});

test("a driver is offered both documents of a project waiting for them", async () => {
  await on(
    {
      sso: { logged: true, session: session({ uid: OTHER_UID, driver: asDriver(1) }) },
      projects: [project({ id: MINE, driverUid: DRIVER_UID })],
    },
    async (up) => {
      const page = await (await ask(up, "/driver", { token: TOKEN })).text();
      assert.match(page, new RegExp(`/projects/${MINE}/documents/proposal`));
      assert.match(page, new RegExp(`/projects/${MINE}/documents/analysis`));
    }
  );
});

test("the autonomous-work flag is shown where it is set", async () => {
  await on(
    {
      sso: { logged: true, session: session({ uid: OTHER_UID, driver: asDriver(1) }) },
      projects: [project({ id: MINE, driverUid: DRIVER_UID, billing: { autonomous_work: true } })],
    },
    async (up) => {
      const page = readable(await (await ask(up, "/driver", { token: TOKEN, locale: "it" })).text());
      assert.match(page, /Lavoro autonomo/);
    }
  );
});

/* ------------------------------------------------------------------- the broken tab */

test("the broken tab asks only for the projects a driver is owed to", async () => {
  await on(
    {
      sso: { logged: true, session: session({ driver: asDriver(2) }) },
      projects: [
        project({ id: "orphan-1", state: "DRIVER_VALIDATION" }),
        project({ id: "orphan-stopped", state: "FAILED_NO_DRIVERS", steps: stoppedAt("handover") }),
        // Has a driver: not here.
        project({ id: "supervised", state: "DEMO", driverUid: DRIVER_UID }),
        // Has not got there yet: not broken.
        project({ id: "early", state: "PREANALYSIS", steps: [] }),
      ],
    },
    async (up) => {
      const page = readable(await (await ask(up, "/broken", { token: TOKEN, locale: "it" })).text());
      const asked = up.asked.anagraphics[0];
      assert.match(asked, /without_driver=true/);
      // The states that have not got there yet are not even asked for.
      for (const state of ["PREANALYSIS", "PREVALIDATION", "UNDERSPECIFIED", "ANALYSIS", "REJECTED"]) {
        assert.equal(asked.includes(`state=${state}`), false, state);
      }
      assert.match(page, /orphan-1/);
      assert.match(page, /orphan-stopped/);
      assert.equal(page.includes("supervised"), false);
      assert.equal(page.includes("early"), false);
      // The handover's own reason, in a sentence.
      assert.match(page, /non c'è un driver a cui darla/);
    }
  );
});

test("no orphans at all says so twice, once for each list", async () => {
  await on({ sso: { logged: true, session: session({ driver: asDriver(2) }) } }, async (up) => {
    const page = readable(await (await ask(up, "/broken", { token: TOKEN, locale: "it" })).text());
    assert.match(page, /Ogni progetto a cui un driver è dovuto ce l'ha/);
    assert.match(page, /Nessuno di loro si è fermato/);
  });
});

/* ----------------------------------------------------------------------- the links */

test("the ambassador's link is made and shown, and nothing is written", async () => {
  await on({ sso: { logged: true, session: session({ driver: asDriver(0) }) } }, async (up) => {
    const answer = await ask(up, "/links", { token: TOKEN, method: "POST", body: "kind=ambassador" });
    assert.equal(answer.status, 200);
    const page = await answer.text();
    assert.match(page, new RegExp(`\\?ambassador=${DRIVER_UID}`));
    assert.deepEqual(up.created, []);
  });
});

test("a driver's link without a discount carries the uid", async () => {
  await on({ sso: { logged: true, session: session({ driver: asDriver(1) }) } }, async (up) => {
    const answer = await ask(up, "/links", { token: TOKEN, method: "POST", body: "kind=driver&percentage=" });
    const page = await answer.text();
    assert.match(page, new RegExp(`\\?driver=${DRIVER_UID}`));
    assert.deepEqual(up.created, []);
  });
});

test("a driver's link with a percentage creates a code and carries the code alone", async () => {
  await on({ sso: { logged: true, session: session({ driver: asDriver(1) }) } }, async (up) => {
    const page = await (
      await ask(up, "/links", { token: TOKEN, method: "POST", body: "kind=driver&percentage=3" })
    ).text();
    assert.deepEqual(
      up.created.map((one) => one.percentage),
      [3]
    );
    assert.match(page, /\?discount=made-3/);
    // The code already says whose it is: the driver's uid is nowhere in the link, and the
    // two parameters never travel together — in the preanalyst `discount` wins over
    // `driver`, so a second one would be a parameter nothing reads.
    assert.equal(page.includes(`?driver=${DRIVER_UID}`), false);
    assert.equal(page.includes("driver="), false);
  });
});

test("the same percentage a second time reuses the code and writes nothing", async () => {
  await on(
    {
      sso: { logged: true, session: session({ driver: asDriver(1) }) },
      discounts: [
        { discount_code: "e8013cf2", driver: { uid: DRIVER_UID, screen_name: "Dome" }, percentage: 5 },
      ],
    },
    async (up) => {
      const page = await (
        await ask(up, "/links", { token: TOKEN, method: "POST", body: "kind=driver&percentage=5" })
      ).text();
      assert.match(page, /\?discount=e8013cf2/);
      assert.deepEqual(up.created, []);
    }
  );
});

test("a percentage outside the configured range gives the plain link and no code", async () => {
  await on({ sso: { logged: true, session: session({ driver: asDriver(1) }) } }, async (up) => {
    const page = await (
      await ask(up, "/links", { token: TOKEN, method: "POST", body: "kind=driver&percentage=50" })
    ).text();
    assert.match(page, new RegExp(`\\?driver=${DRIVER_UID}`));
    assert.equal(page.includes("discount="), false);
    assert.deepEqual(up.created, []);
  });
});

test("a driver who may not supervise is offered no driver's link and refused one", async () => {
  await on({ sso: { logged: true, session: session({ driver: asDriver(0) }) } }, async (up) => {
    const page = await (await ask(up, "/driver", { token: TOKEN })).text();
    assert.equal(page.includes('value="driver"'), false);
    const asked = await ask(up, "/links", { token: TOKEN, method: "POST", body: "kind=driver&percentage=3" });
    assert.equal(asked.status, 404);
    assert.deepEqual(up.created, []);
  });
});

test("somebody who is not a driver cannot make a link", async () => {
  await on({ sso: { logged: true, session: session() } }, async (up) => {
    const answer = await ask(up, "/links", { token: TOKEN, method: "POST", body: "kind=ambassador" });
    assert.equal(answer.status, 404);
  });
});

test("a kind of link that does not exist is a 404", async () => {
  await on({ sso: { logged: true, session: session({ driver: asDriver(2) }) } }, async (up) => {
    assert.equal(
      (await ask(up, "/links", { token: TOKEN, method: "POST", body: "kind=affiliate" })).status,
      404
    );
  });
});

test("anagraphics refusing to store the code is said, not swallowed", async () => {
  await on(
    { sso: { logged: true, session: session({ driver: asDriver(1) }) }, anagraphicsBroken: true },
    async (up) => {
      const answer = await ask(up, "/links", { token: TOKEN, method: "POST", body: "kind=driver&percentage=3" });
      assert.equal(answer.status, 503);
      assert.equal(up.settings.metrics.of("http.error")[0].dims.code, "ANAGRAPHICS_UNAVAILABLE");
    }
  );
});

/* -------------------------------------------------------------------- the plumbing */

test("the language is changed and the browser comes back to the page", async () => {
  await on({ sso: { logged: true, session: session() } }, async (up) => {
    const answer = await ask(up, "/locale", {
      token: TOKEN,
      method: "POST",
      body: "locale=it&return_to=/driver",
    });
    assert.equal(answer.status, 303);
    assert.equal(answer.headers.get("location"), "/driver");
    assert.match(answer.headers.get("set-cookie"), /webtools_locale=it/);
  });
});

test("a language that is not offered is refused with its own code", async () => {
  await on({ sso: { logged: true, session: session() } }, async (up) => {
    const answer = await ask(up, "/locale", { token: TOKEN, method: "POST", body: "locale=fr" });
    assert.equal(answer.status, 400);
    assert.equal(up.settings.metrics.of("http.error")[0].dims.code, "INVALID_LOCALE");
  });
});

test("the static files are served and nothing above public/ is", async () => {
  await on({}, async (up) => {
    const styles = await ask(up, "/styles.css");
    assert.equal(styles.status, 200);
    assert.equal(styles.headers.get("content-type"), "text/css; charset=utf-8");
    assert.equal((await ask(up, "/../package.json")).status, 404);
  });
});

test("a method nothing answers is a 405", async () => {
  await on({ sso: { logged: true, session: session() } }, async (up) => {
    assert.equal((await ask(up, "/", { token: TOKEN, method: "DELETE" })).status, 405);
  });
});

test("an address nothing answers is a 404", async () => {
  await on({ sso: { logged: true, session: session() } }, async (up) => {
    assert.equal((await ask(up, "/invented", { token: TOKEN })).status, 404);
  });
});
