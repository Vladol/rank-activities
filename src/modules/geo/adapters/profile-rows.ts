import type {
  LocationProfile,
  MarineCoverageEvidence,
  SnowSeasonEvidence,
} from '../../../domain/location/location-profile';
import type { LocationId } from '../../../domain/shared/branded';

/**
 * The translation between what the domain calls evidence and what the store
 * calls rows. It is a pure module, so the mapping is tested without a database
 * and the adapter is left with nothing but I/O.
 */

/** One recorded probe. `allNull` is null when the probe itself failed. */
export interface ProbeRow {
  readonly localDate: string;
  readonly allNull: boolean | null;
}

/**
 * The marine evidence, read out of the probe rows rather than stored beside
 * them. Two representations of one fact drift; the rows are the fact, and the
 * primary key over `(location, local date)` is what makes them trustworthy.
 */
export function marineEvidenceFrom(rows: readonly ProbeRow[]): MarineCoverageEvidence | undefined {
  if (rows.length === 0) {
    return undefined;
  }

  const dates = rows.map((row) => row.localDate).toSorted();

  return {
    // Coverage observed is coverage settled, whenever it was observed.
    covered: rows.some((row) => row.allNull === false),
    allNullProbeDates: rows.filter((row) => row.allNull === true).map((row) => row.localDate).toSorted(),
    // The last day a probe was *attempted*, which is what paces the next one.
    lastProbedOn: dates.at(-1) ?? '',
  };
}

/**
 * The probe rows an evidence record implies.
 *
 * A day carrying an all-null answer is `true`; the last attempted day that is
 * not one of those is a probe that either found coverage or failed, and those
 * two are told apart by `covered`. Rows already in the store are left alone —
 * a published probe is as immutable as a published version, and the store's
 * primary key says so.
 */
export function probeRowsFrom(evidence: MarineCoverageEvidence): readonly ProbeRow[] {
  const allNull = evidence.allNullProbeDates.map((localDate) => ({ localDate, allNull: true }));

  if (evidence.allNullProbeDates.includes(evidence.lastProbedOn)) {
    return allNull;
  }

  return [
    ...allNull,
    { localDate: evidence.lastProbedOn, allNull: evidence.covered ? false : null },
  ];
}

/**
 * Whether a snow season was observed here at all, and on what basis.
 *
 * It is a projection of the evidence for querying, never read back: the verdict
 * an activity reaches depends on the threshold that activity declares, and
 * freezing a verdict into a column is what `04-add-location-applicability`
 * Decision 4 chose not to do. What the column can say without a threshold is
 * whether snow was seen, which is a fact about the place.
 *
 * `undefined` for both halves is the third state: nothing has been gathered.
 */
export function snowSeasonProjection(evidence: SnowSeasonEvidence | undefined): {
  readonly snowSeason: boolean | null;
  readonly snowSeasonSource: 'archive' | 'heuristic' | null;
} {
  if (evidence === undefined) {
    return { snowSeason: null, snowSeasonSource: null };
  }

  return evidence.basis === 'archive'
    ? { snowSeason: evidence.coldSeasonSnowfallCm > 0, snowSeasonSource: 'archive' }
    : { snowSeason: evidence.seasonLikely, snowSeasonSource: 'heuristic' };
}

/** The stored evidence, minus the marine half, which lives in the probe rows. */
export type StoredEvidence = Omit<LocationProfile['evidence'], 'marineCoverage'>;

export function storedEvidenceOf(profile: LocationProfile): StoredEvidence {
  const { marineCoverage: _marineCoverage, ...rest } = profile.evidence;

  return rest;
}

export function profileFrom(
  locationId: LocationId,
  row: { evidence: unknown; rulesVersion: number; computedAt: Date },
  probes: readonly ProbeRow[],
): LocationProfile {
  const marine = marineEvidenceFrom(probes);

  return {
    locationId,
    rulesVersion: row.rulesVersion,
    computedAt: row.computedAt.toISOString(),
    evidence: {
      ...(row.evidence as StoredEvidence),
      ...(marine === undefined ? {} : { marineCoverage: marine }),
    },
  };
}
