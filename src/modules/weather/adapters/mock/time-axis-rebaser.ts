/**
 * Shifts a recorded response onto the current date.
 *
 * A fixture is recorded on one day and replayed on another, so a September
 * capture would otherwise describe a week that is already over. The shift is a
 * whole number of days applied to every date in the body: values, holes,
 * series length and the local time of day of each slot are untouched, and so
 * are `timezone`, `timezone_abbreviation` and `utc_offset_seconds`
 * (design.md, Decision 2).
 *
 * It is a pure function of the body and the date, so two reads on the same day
 * are byte-identical and it can be tested without a clock.
 */

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD`, optionally followed by `T` and a local time of day. */
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})(T.*)?$/;

/**
 * Which keys carry dates. Listed rather than detected, so that a string that
 * merely looks like a date — a place name, a model id — is never rewritten.
 */
const DATE_KEYS: readonly string[] = ['time', 'sunrise', 'sunset'];

/**
 * The local date at an offset, for the "current local date of the fixture's
 * location" the rebase is anchored on. The machine's own timezone never
 * enters into it.
 */
export function localDateAt(instant: number, utcOffsetSeconds: number): string {
  return new Date(instant + utcOffsetSeconds * 1000).toISOString().slice(0, 10);
}

export function rebaseTimeAxis(body: unknown, today: string): unknown {
  if (typeof body !== 'object' || body === null) {
    return body;
  }

  const firstDay = firstDayOf(body as Record<string, unknown>);

  if (firstDay === undefined) {
    return body;
  }

  const shiftDays = daysBetween(firstDay, today);

  return shiftDays === 0 ? body : shiftBody(body as Record<string, unknown>, shiftDays);
}

/**
 * The first day of the series: the daily axis when the response has one, and
 * the date of the first hourly slot otherwise. Both start at the same local
 * midnight, so either answers the same question.
 */
function firstDayOf(body: Record<string, unknown>): string | undefined {
  for (const key of ['daily', 'hourly'] as const) {
    const block = body[key];

    if (typeof block === 'object' && block !== null) {
      const time = (block as Record<string, unknown>).time;

      if (Array.isArray(time) && typeof time[0] === 'string') {
        return time[0].slice(0, 10);
      }
    }
  }

  return undefined;
}

function shiftBody(body: Record<string, unknown>, shiftDays: number): Record<string, unknown> {
  const shifted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    shifted[key] =
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? shiftBlock(value as Record<string, unknown>, shiftDays)
        : value;
  }

  return shifted;
}

function shiftBlock(block: Record<string, unknown>, shiftDays: number): Record<string, unknown> {
  const shifted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(block)) {
    shifted[key] =
      DATE_KEYS.includes(key) && Array.isArray(value)
        ? value.map((slot) => (typeof slot === 'string' ? shiftTimestamp(slot, shiftDays) : slot))
        : value;
  }

  return shifted;
}

/** The date part moved by whole days; everything after it left exactly as recorded. */
function shiftTimestamp(timestamp: string, shiftDays: number): string {
  const parts = TIMESTAMP.exec(timestamp);

  if (parts === null) {
    return timestamp;
  }

  const [, year, month, day, timeOfDay] = parts;
  const shifted = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)) + shiftDays * MS_PER_DAY,
  );

  return `${shifted.toISOString().slice(0, 10)}${timeOfDay ?? ''}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((dayNumber(to) - dayNumber(from)) / MS_PER_DAY);
}

function dayNumber(date: string): number {
  const parts = TIMESTAMP.exec(date);

  if (parts === null) {
    throw new Error(`"${date}" is not a date the rebaser can anchor on.`);
  }

  const [, year, month, day] = parts;

  return Date.UTC(Number(year), Number(month) - 1, Number(day));
}
