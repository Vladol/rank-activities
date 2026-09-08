import { createHash } from 'node:crypto';

import { domainError } from '../../../../domain/shared/domain-error';
import { type Result, err, ok } from '../../../../domain/shared/result';
import type { Capability, MetricCode } from '../../../../domain/weather/metric';
import { metricsIn } from '../../../../domain/weather/weather-series';
import type { Coordinates, Horizon, SourceLimits, WeatherError } from '../../ports/contracts';
import { mapOpenMeteoResponse } from '../open-meteo/open-meteo.mapper';
import { parseOpenMeteoBody } from '../open-meteo/open-meteo.schema';
import { listFixtureFiles, readFixtureBody, readManifest } from './fixture-files';
import {
  type FixtureEntry,
  type FixtureManifest,
  coordinateKey,
  normaliseQuery,
} from './fixture-manifest';

/**
 * Resolves a request to a recorded response.
 *
 * The manifest is read once, at startup, and every fixture it names is opened
 * then: a fixture that has drifted from its manifest entry, a file nobody
 * declared and a declaration with no file all kill the process here rather
 * than surfacing as a missing metric at the first request.
 *
 * The address is the coordinates rounded to two decimals — the rounding the
 * cache key uses, and coarser than the provider's own grid (design.md,
 * Decision 3). There is no nearest-neighbour fallback: a test for Prague must
 * never quietly score against Lisbon's data.
 */
export interface ResolvedFixture {
  readonly entry: FixtureEntry;
  /** The recorded body, byte for byte. Rebasing and parsing happen downstream. */
  readonly body: string;
}

const HOURS_PER_DAY = 24;

export class FixtureRegistry {
  private constructor(
    private readonly entries: readonly FixtureEntry[],
    private readonly bodies: ReadonlyMap<string, string>,
    private readonly metrics: ReadonlyMap<Capability, readonly MetricCode[]>,
    private readonly limits: ReadonlyMap<Capability, SourceLimits>,
    readonly manifest: FixtureManifest,
  ) {}

  get fixtureCount(): number {
    return this.entries.length;
  }

  static load(dir?: string): FixtureRegistry {
    const manifest = dir === undefined ? readManifest() : readManifest(dir);
    const files = dir === undefined ? listFixtureFiles() : listFixtureFiles(dir);
    const declared = new Set(manifest.fixtures.map((entry) => entry.file));

    for (const file of files) {
      if (!declared.has(file)) {
        throw new Error(
          `The fixture file "${file}" has no manifest entry. ` +
            'Record it with scripts/record-fixture.ts rather than copying it in by hand.',
        );
      }
    }

    const bodies = new Map<string, string>();

    for (const entry of manifest.fixtures) {
      bodies.set(entry.name, readEntry(entry, dir));
    }

    return new FixtureRegistry(
      manifest.fixtures,
      bodies,
      metricsByCapability(manifest.fixtures, bodies),
      limitsByCapability(manifest.fixtures, bodies),
      manifest,
    );
  }

  /** Only the metrics the recordings really carry, never the whole dictionary. */
  metricsFor(capability: Capability): readonly MetricCode[] {
    return this.metrics.get(capability) ?? [];
  }

  /** Only the horizon the recordings really cover. */
  limitsFor(capability: Capability): SourceLimits {
    return this.limits.get(capability) ?? { maxForecastDays: 0, maxPastDays: 0 };
  }

  resolveSeries(
    capability: Capability,
    location: Coordinates,
    horizon: Horizon,
  ): Result<ResolvedFixture, WeatherError> {
    const key = coordinateKey(location.latitude, location.longitude);
    const candidates = this.entries.filter(
      (entry) =>
        entry.serves.includes(capability) &&
        entry.location !== undefined &&
        coordinateKey(entry.location.latitude, entry.location.longitude) === key,
    );

    if (candidates.length === 0) {
      return err(missing(capability, key));
    }

    const chosen = select(candidates, horizon);

    return chosen === undefined
      ? err(unresolved(capability, key, candidates, horizon))
      : ok({ entry: chosen, body: this.bodyOf(chosen) });
  }

  resolveLookup(name: string): Result<ResolvedFixture, WeatherError> {
    const query = normaliseQuery(name);
    const entry = this.entries.find(
      (candidate) => candidate.serves.includes('lookup') && candidate.query === query,
    );

    return entry === undefined
      ? err(
          domainError('TRANSPORT_FAILURE', 'no lookup fixture was recorded for this place name', {
            query,
            hint: `node scripts/record-fixture.ts geocoding-${query} "<url>"`,
          }),
        )
      : ok({ entry, body: this.bodyOf(entry) });
  }

  private bodyOf(entry: FixtureEntry): string {
    return this.bodies.get(entry.name) ?? '';
  }
}

/**
 * Coordinates name the place; where more than one recording of that place
 * exists, the requested window says which one. Chamonix has a January and a
 * July archive recording, and the two are the whole point of the
 * "season is not applicability" case.
 *
 * Where several recordings cover the window, the tightest one wins. Chamonix
 * also has a whole-January climate recording that carries snowfall alone, and
 * answering a seven-day scoring question with it would be picking by manifest
 * order — which is a property of the file, not of the question.
 */
function select(candidates: readonly FixtureEntry[], horizon: Horizon): FixtureEntry | undefined {
  if (horizon.kind === 'window') {
    return candidates
      .filter(
        (entry) =>
          entry.window !== undefined &&
          entry.window.startDate <= horizon.startDate &&
          horizon.endDate <= entry.window.endDate,
      )
      .toSorted((left, right) => spanOf(left) - spanOf(right))[0];
  }

  // A rolling forecast is answered by a recording made against the live
  // forecast, which is what such a request would really have hit.
  const rolling = candidates.filter((entry) => entry.window === undefined);

  if (rolling.length === 1) {
    return rolling[0];
  }

  // Failing that, by the one archive recording of the place — the rebaser puts
  // it onto today. Two of them is an ambiguity, and picking either would answer
  // a January question with July data; the caller has to name a window.
  return rolling.length === 0 && candidates.length === 1 ? candidates[0] : undefined;
}

/** How many days a recording covers; a rolling recording is treated as unbounded. */
function spanOf(entry: FixtureEntry): number {
  return entry.window === undefined
    ? Number.POSITIVE_INFINITY
    : Date.parse(entry.window.endDate) - Date.parse(entry.window.startDate);
}

function missing(capability: Capability, key: string): WeatherError {
  return domainError(
    'TRANSPORT_FAILURE',
    `no ${capability} fixture is recorded for the coordinates "${key}"`,
    {
      capability,
      key,
      hint: 'node scripts/record-fixture.ts <name> "<url>"',
    },
  );
}

/**
 * Nothing at this place answers this horizon: either no recording covers the
 * window, or several could and none of them is the obvious one. Both name what
 * was recorded, so the caller can pick a window instead of being handed
 * whichever fixture happened to sort first.
 */
function unresolved(
  capability: Capability,
  key: string,
  candidates: readonly FixtureEntry[],
  horizon: Horizon,
): WeatherError {
  const recorded = candidates
    .map((entry) =>
      entry.window === undefined
        ? entry.name
        : `${entry.name} ${entry.window.startDate}..${entry.window.endDate}`,
    )
    .join(', ');

  return domainError(
    'TRANSPORT_FAILURE',
    horizon.kind === 'window'
      ? `no ${capability} fixture at "${key}" covers the window that was asked for`
      : `more than one ${capability} fixture is recorded at "${key}"; ask for one of their windows`,
    { capability, key, recorded },
  );
}

/**
 * Reads one fixture and checks it against what was recorded about it. A body
 * that no longer hashes to its manifest entry is a hand edit, which is the one
 * thing a fixture must never be (spec `weather-mock-data`, "Fixtures are
 * verbatim recordings").
 */
function readEntry(entry: FixtureEntry, dir?: string): string {
  let body: string;

  try {
    body = dir === undefined ? readFixtureBody(entry.file) : readFixtureBody(entry.file, dir);
  } catch {
    throw new Error(
      `The manifest declares "${entry.name}" but ${entry.file} is not in the fixture directory.`,
    );
  }

  const sha256 = createHash('sha256').update(body).digest('hex');

  if (sha256 !== entry.sha256) {
    throw new Error(
      `The fixture "${entry.name}" no longer matches the body that was recorded. ` +
        'Re-record it with scripts/record-fixture.ts instead of editing it.',
    );
  }

  return body;
}

function successfulSeries(entries: readonly FixtureEntry[]): readonly FixtureEntry[] {
  return entries.filter(
    (entry) => !entry.serves.includes('lookup') && entry.status === 200 && entry.bytes > 0,
  );
}

/**
 * What each seam can be asked for, derived from the recordings rather than
 * declared by hand: a source that over-claims turns into a silently shortened
 * metric list (`series.port.ts`, on `supports`).
 */
function metricsByCapability(
  entries: readonly FixtureEntry[],
  bodies: ReadonlyMap<string, string>,
): ReadonlyMap<Capability, readonly MetricCode[]> {
  const found = new Map<Capability, Set<MetricCode>>();

  for (const entry of successfulSeries(entries)) {
    const parsed = parseOpenMeteoBody(bodies.get(entry.name) ?? '');

    if (!parsed.ok) {
      throw new Error(
        `The fixture "${entry.name}" does not parse as an Open-Meteo response: ${parsed.error.message}.`,
      );
    }

    for (const capability of entry.serves as readonly Capability[]) {
      const mapped = mapOpenMeteoResponse(parsed.value, {
        sourceId: 'registry',
        capability,
        fetchedAt: new Date(0).toISOString(),
      });

      if (!mapped.ok) {
        throw new Error(
          `The fixture "${entry.name}" does not map onto the domain: ${mapped.error.message}.`,
        );
      }

      const codes = found.get(capability) ?? new Set<MetricCode>();

      for (const code of [...metricsIn(mapped.value.hourly), ...metricsIn(mapped.value.daily)]) {
        codes.add(code);
      }

      found.set(capability, codes);
    }
  }

  return new Map([...found].map(([capability, codes]) => [capability, [...codes]]));
}

/** The horizon the recordings cover, so an over-long request fails before it is served. */
function limitsByCapability(
  entries: readonly FixtureEntry[],
  bodies: ReadonlyMap<string, string>,
): ReadonlyMap<Capability, SourceLimits> {
  const limits = new Map<Capability, { maxForecastDays: number; earliestDate?: string }>();

  for (const entry of successfulSeries(entries)) {
    const days = daysIn(bodies.get(entry.name) ?? '');

    for (const capability of entry.serves as readonly Capability[]) {
      const current = limits.get(capability) ?? { maxForecastDays: 0 };
      const earliest =
        entry.window === undefined
          ? current.earliestDate
          : minDate(current.earliestDate, entry.window.startDate);

      limits.set(capability, {
        maxForecastDays: Math.max(current.maxForecastDays, days),
        ...(earliest === undefined ? {} : { earliestDate: earliest }),
      });
    }
  }

  return new Map(
    [...limits].map(([capability, value]) => [
      capability,
      // Nothing was recorded with `past_days`, so no past day can be served.
      { ...value, maxPastDays: 0 },
    ]),
  );
}

function daysIn(body: string): number {
  const parsed = parseOpenMeteoBody(body);

  if (!parsed.ok) {
    return 0;
  }

  const daily = parsed.value.daily?.time.length;

  return daily ?? Math.floor((parsed.value.hourly?.time.length ?? 0) / HOURS_PER_DAY);
}

function minDate(left: string | undefined, right: string): string {
  return left === undefined || right < left ? right : left;
}
