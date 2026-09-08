import { z } from 'zod';

import { CAPABILITIES } from '../../domain/weather/metric';
import { isMetricCode, type MetricCode } from '../../domain/weather/metric';
import type {
  MetricValues,
  Provenance,
  SeriesChannel,
  WeatherSeries,
} from '../../domain/weather/weather-series';
import type { PlaceCandidate } from '../../modules/weather/ports/place-lookup.port';

/**
 * How one cached type crosses the process boundary and comes back.
 *
 * `encode` names every field it keeps, rather than handing the value over
 * whole: that is what makes a method, a `Map` or a `Date` impossible to store
 * by accident instead of merely discouraged (design.md, Decision 4).
 *
 * `decode` answers `undefined` for anything it does not recognise. A payload
 * written by an older shape is a miss, never a partially-read value — and a
 * miss is a state the caller already handles.
 */
export interface Codec<T> {
  readonly name: string;
  encode(value: T): unknown;
  decode(raw: unknown): T | undefined;
}

const metricValues = z.array(z.number().nullable());

const channelSchema = z.object({
  time: z.array(z.string()),
  values: z.record(z.string(), metricValues),
});

const provenanceSchema = z.object({
  sourceId: z.string(),
  capability: z.enum(CAPABILITIES),
  gridPoint: z.object({
    latitude: z.number(),
    longitude: z.number(),
    elevationMetres: z.number(),
  }),
  fetchedAt: z.string(),
  stale: z.boolean(),
  metrics: z.array(z.string()),
  timezone: z.string().optional(),
});

const seriesSchema = z.object({
  hourly: channelSchema,
  daily: channelSchema,
  provenance: z.array(provenanceSchema).min(1),
});

/**
 * The mapped series, not the vendor's body: a hit must not pay for validation
 * and unit conversion a second time (design.md, Decision 3).
 */
export const weatherSeriesCodec: Codec<WeatherSeries> = {
  name: 'weather-series',
  encode: (series) => ({
    hourly: encodeChannel(series.hourly),
    daily: encodeChannel(series.daily),
    provenance: series.provenance.map(encodeProvenance),
  }),
  decode: (raw) => {
    const parsed = seriesSchema.safeParse(raw);

    if (!parsed.success) {
      return undefined;
    }

    const hourly = decodeChannel(parsed.data.hourly);
    const daily = decodeChannel(parsed.data.daily);

    if (hourly === undefined || daily === undefined) {
      return undefined;
    }

    return {
      hourly,
      daily,
      provenance: parsed.data.provenance.map((entry) => decodeProvenance(entry)),
    };
  },
};

const candidateSchema = z.object({
  sourcePlaceId: z.string(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  elevationMetres: z.number(),
  timezone: z.string(),
  population: z.number().optional(),
  countryCode: z.string().optional(),
  admin1: z.string().optional(),
});

/**
 * What the lookup source offered, including the empty list. The empty list is
 * the negative entry: "we asked and there was nothing" is a fact worth
 * remembering, and remembering it is what keeps a flood of invented names off
 * the source (spec, "Absent locations are remembered").
 */
export const placeCandidatesCodec: Codec<readonly PlaceCandidate[]> = {
  name: 'place-candidates',
  encode: (candidates) => candidates.map(encodeCandidate),
  decode: (raw) => {
    const parsed = z.array(candidateSchema).safeParse(raw);

    return parsed.success ? parsed.data.map((entry) => withoutUndefined(entry)) : undefined;
  },
};

/**
 * Every codec this build has. The round-trip suite reads it, so a cached type
 * whose codec was added without a sample fails the suite rather than shipping
 * untested.
 */
type AnyCodec = {
  readonly name: string;
  encode(value: never): unknown;
  decode(raw: unknown): unknown;
};

export const CACHE_CODECS = {
  'weather-series': weatherSeriesCodec,
  'place-candidates': placeCandidatesCodec,
} as const satisfies Record<string, AnyCodec>;

function encodeChannel(target: SeriesChannel): unknown {
  return {
    time: [...target.time],
    values: Object.fromEntries(
      Object.entries(target.values).flatMap(([code, series]) =>
        series === undefined ? [] : [[code, [...series]]],
      ),
    ),
  };
}

/**
 * A metric name we no longer know is dropped rather than carried: the series
 * would otherwise claim a channel nothing can read. A channel whose axis and
 * values disagree is refused outright — that is our own bug, and it must not
 * come back from the cache as an off-by-one in the scoring.
 */
function decodeChannel(raw: z.infer<typeof channelSchema>): SeriesChannel | undefined {
  const values: Partial<Record<MetricCode, MetricValues>> = {};

  for (const [code, series] of Object.entries(raw.values)) {
    if (!isMetricCode(code)) {
      continue;
    }

    if (series.length !== raw.time.length) {
      return undefined;
    }

    values[code] = series;
  }

  return { time: raw.time, values };
}

function encodeProvenance(entry: Provenance): unknown {
  return {
    sourceId: entry.sourceId,
    capability: entry.capability,
    gridPoint: {
      latitude: entry.gridPoint.latitude,
      longitude: entry.gridPoint.longitude,
      elevationMetres: entry.gridPoint.elevationMetres,
    },
    fetchedAt: entry.fetchedAt,
    stale: entry.stale,
    metrics: [...entry.metrics],
    ...(entry.timezone === undefined ? {} : { timezone: entry.timezone }),
  };
}

function decodeProvenance(raw: z.infer<typeof provenanceSchema>): Provenance {
  return {
    sourceId: raw.sourceId,
    capability: raw.capability,
    gridPoint: raw.gridPoint,
    fetchedAt: raw.fetchedAt,
    stale: raw.stale,
    metrics: raw.metrics.filter((code): code is MetricCode => isMetricCode(code)),
    ...(raw.timezone === undefined ? {} : { timezone: raw.timezone }),
  };
}

function encodeCandidate(candidate: PlaceCandidate): unknown {
  return {
    sourcePlaceId: candidate.sourcePlaceId,
    name: candidate.name,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    elevationMetres: candidate.elevationMetres,
    timezone: candidate.timezone,
    ...(candidate.population === undefined ? {} : { population: candidate.population }),
    ...(candidate.countryCode === undefined ? {} : { countryCode: candidate.countryCode }),
    ...(candidate.admin1 === undefined ? {} : { admin1: candidate.admin1 }),
  };
}

/**
 * `JSON.parse` never produces an `undefined` value, but zod's optionals leave
 * the key absent rather than present-and-undefined, and a structural
 * comparison in the round-trip test distinguishes the two.
 */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
