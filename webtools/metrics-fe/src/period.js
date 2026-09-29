// The period every page is read over: two days, inclusive, as metrics keys its
// buckets — `YYYY-MM-DD` in UTC. A bucket belongs to the UTC day it was folded
// on, so a period in any other calendar would name days that do not exist in the
// data.
//
// It comes off the address (`?from=&to=`). When the address says nothing the
// period is the configured number of days ending today: a page has to be read over
// some length, and which length is worth opening is a decision — it is in the
// configuration, not here.
//
// A period that is not two days is not corrected into one that is. Guessing what
// somebody meant by `2026-13-40` is how a page shows a period nobody asked for.

export const INVALID_PERIOD = "INVALID_PERIOD";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MILLISECONDS_IN_A_DAY = 24 * 60 * 60 * 1000;

// A day as metrics writes it, from a moment. UTC, and only the date part.
export function dayOf(moment) {
  return moment.toISOString().slice(0, 10);
}

// → a Date at UTC midnight, or null. Strict: the text must be a day that exists,
// so `2026-02-31` is refused rather than rolled into March.
export function parseDay(text) {
  if (typeof text !== "string" || !DAY.test(text)) return null;
  const moment = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(moment.getTime())) return null;
  // Round-trip: a date that rolled over is not the day that was written.
  return dayOf(moment) === text ? moment : null;
}

export function addDays(day, count) {
  return dayOf(new Date(parseDay(day).getTime() + count * MILLISECONDS_IN_A_DAY));
}

// Inclusive, like `days_between` in metrics: a period from a day to itself is one
// day long, not none.
export function daysBetween(from, to) {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / MILLISECONDS_IN_A_DAY) + 1;
}

// The period of `days` days ending on `last`.
function ending(last, days) {
  return { from: addDays(last, -(days - 1)), to: last };
}

// → { ok: true, period } | { ok: false, code, from, to }
//
// `from` and `to` in the failure are what was written, so the page can say which
// of the two it could not read. `today` is a parameter because a period that ends
// today is a period that depends on when it is asked, and a test cannot wait for
// tomorrow.
export function readPeriod(parameters, settings, today = new Date()) {
  const written = { from: parameters.get("from"), to: parameters.get("to") };
  const asked = written.from !== null || written.to !== null;

  if (!asked) return { ok: true, period: build(ending(dayOf(today), settings.defaultDays), settings, today) };

  // Half a period is not a period: the two days are one fact, and inventing the
  // other would be a period nobody asked for.
  if (written.from === null || written.to === null) {
    return { ok: false, code: INVALID_PERIOD, ...written };
  }
  const from = parseDay(written.from);
  const to = parseDay(written.to);
  if (!from || !to || written.from > written.to) {
    return { ok: false, code: INVALID_PERIOD, ...written };
  }
  return { ok: true, period: build({ from: written.from, to: written.to }, settings, today) };
}

// The period, and the ways of getting to another one. The controls are part of the
// period because they are all worked out from its own length: a step back is as
// long as what is being looked at.
function build({ from, to }, settings, today) {
  const days = daysBetween(from, to);
  const day = dayOf(today);
  return {
    from,
    to,
    days,
    // Whether it ends today: a period that does not is a period somebody chose,
    // and the bar says so rather than looking like the one that opens by itself.
    endsToday: to === day,
    presets: settings.presetsDays.map((count) => ({
      days: count,
      ...ending(day, count),
      // The one being looked at, so the bar can mark it instead of offering it
      // again.
      current: count === days && to === day,
    })),
    // The same length, one length earlier. There is always an earlier period.
    previous: ending(addDays(from, -1), days),
    // And one later, unless it has not happened yet. A period in the future is a
    // page with nothing on it, and it is not offered.
    next: to < day ? ending(minimum(addDays(to, days), day), days) : null,
    today: day,
  };
}

function minimum(a, b) {
  return a < b ? a : b;
}
