import type { Capability, MetricCode } from './metric';

/**
 * The node a source actually answered for. Open-Meteo snaps a request onto its
 * grid and reports the node it used, which can sit a few kilometres and a few
 * hundred metres of elevation away from the request
 * (docs/development-flow/stage-three.md, section 2.1).
 */
export interface GridPoint {
  readonly latitude: number;
  readonly longitude: number;
  readonly elevationMetres: number;
}

/** What one source contributed, and under what circumstances. */
export interface Provenance {
  readonly sourceId: string;
  readonly capability: Capability;
  readonly gridPoint: GridPoint;
  /** When the data was obtained, as an ISO instant. */
  readonly fetchedAt: string;
  readonly stale: boolean;
  readonly metrics: readonly MetricCode[];
  /**
   * The IANA zone the source put the axis on. It is the honest answer to
   * "which time zone are these dates in?" for a request made by coordinates,
   * where nothing but the source ever knew: we asked for `auto`, and this is
   * what `auto` turned out to be (stage-three.md, section 2.2).
   */
  readonly timezone?: string;
}

/**
 * One value per slot of the channel's time axis. `null` is a slot the source
 * reported as empty: absence travels as absence, never as zero, the previous
 * value or an interpolation.
 */
export type MetricValues = readonly (number | null)[];

/**
 * A time axis and the metrics recorded against it. Hourly and daily are
 * separate channels because the source keeps them on separate axes.
 */
export interface SeriesChannel {
  readonly time: readonly string[];
  readonly values: Readonly<Partial<Record<MetricCode, MetricValues>>>;
}

export interface WeatherSeries {
  readonly hourly: SeriesChannel;
  readonly daily: SeriesChannel;
  readonly provenance: readonly Provenance[];
}

const EMPTY_CHANNEL: SeriesChannel = { time: [], values: {} };

/**
 * Builds a channel, refusing values that do not line up with the axis. A
 * length mismatch is our own bug, not a source failure, so it fails loudly
 * here rather than becoming a silent off-by-one in the scoring.
 */
export function channel(
  time: readonly string[],
  values: Readonly<Partial<Record<MetricCode, MetricValues>>>,
): SeriesChannel {
  for (const [code, series] of Object.entries(values)) {
    if (series !== undefined && series.length !== time.length) {
      throw new Error(
        `Metric "${code}" has ${series.length} values against a time axis of ${time.length}.`,
      );
    }
  }

  return { time, values };
}

export function createSeries(input: {
  readonly hourly?: SeriesChannel;
  readonly daily?: SeriesChannel;
  readonly provenance: readonly Provenance[];
}): WeatherSeries {
  if (input.provenance.length === 0) {
    throw new Error('A series must carry the provenance of every source that contributed to it.');
  }

  return {
    hourly: input.hourly ?? EMPTY_CHANNEL,
    daily: input.daily ?? EMPTY_CHANNEL,
    provenance: input.provenance,
  };
}

/**
 * The same series, with every contribution declaring whether it is stale.
 *
 * Staleness is a property of when the data was obtained rather than of the
 * data, so it is stamped on the provenance and nowhere else: `fetchedAt` stays
 * the honest moment the source answered, which is what makes a stale answer
 * readable instead of merely marked.
 */
export function markStale(series: WeatherSeries, stale: boolean): WeatherSeries {
  if (series.provenance.every((entry) => entry.stale === stale)) {
    return series;
  }

  return {
    hourly: series.hourly,
    daily: series.daily,
    provenance: series.provenance.map((entry) => ({ ...entry, stale })),
  };
}

export function hasMetric(target: SeriesChannel, code: MetricCode): boolean {
  return target.values[code] !== undefined;
}

export function valuesOf(target: SeriesChannel, code: MetricCode): MetricValues | undefined {
  return target.values[code];
}

/**
 * `null` for a slot the source left empty, `undefined` for a slot that is not
 * on the axis at all. The two are different questions and get different
 * answers.
 */
export function valueAt(
  target: SeriesChannel,
  code: MetricCode,
  index: number,
): number | null | undefined {
  return target.values[code]?.[index];
}

/**
 * True when the metric is present and every one of its slots is empty — the
 * marine-over-land case, which is evidence about the location rather than an
 * outage. False when the metric was never returned at all.
 */
export function isAllAbsent(target: SeriesChannel, code: MetricCode): boolean {
  const series = target.values[code];

  return series !== undefined && series.every((value) => value === null);
}

export function provenanceOf(series: WeatherSeries, sourceId: string): Provenance | undefined {
  return series.provenance.find((entry) => entry.sourceId === sourceId);
}

export function metricsIn(target: SeriesChannel): readonly MetricCode[] {
  return Object.keys(target.values) as MetricCode[];
}
