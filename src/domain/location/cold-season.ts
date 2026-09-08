/**
 * Which windows of the climate archive decide whether a place has a snow
 * season, and the fallback used when the archive cannot be read.
 *
 * Both candidate cold months are examined and the larger snowfall wins
 * (design.md, Decision 2). Inferring the cold month from the sign of the
 * latitude would be correct nearly everywhere and would still be an assumption
 * laid on top of the data; one extra request, once in a location's lifetime,
 * buys an answer that assumes nothing.
 */
export interface ColdSeasonWindow {
  readonly startDate: string;
  readonly endDate: string;
}

/**
 * A completed year of ERA5. The archive for a past year does not change, so a
 * profile computed from it is computed once and stays valid — which is what
 * makes this a climate question rather than a weather one
 * (docs/development-flow/stage-three.md, section 5.2).
 */
export const COLD_SEASON_REFERENCE_YEAR = 2025;

export const COLD_SEASON_WINDOWS: readonly ColdSeasonWindow[] = [
  { startDate: '2025-01-01', endDate: '2025-01-31' },
  { startDate: '2025-07-01', endDate: '2025-07-31' },
];

/**
 * The declared fallback, used only when no window could be read and always
 * recorded as the basis of the decision.
 *
 * Either condition is enough, and that is deliberate. Elevation alone misses
 * Tromso, which skis from 14 m; latitude alone misses Chamonix. Taking either
 * over-reports — Quito passes on elevation and has no season — and that is the
 * bias to have: a wrong "possible" costs a low score, a wrong "impossible" is
 * a falsehood about a place, and the profile says it is a guess either way.
 */
export const HEURISTIC_ELEVATION_METRES = 800;

export const HEURISTIC_LATITUDE_DEGREES = 55;

export function heuristicSeasonLikely(elevationMetres: number, latitude: number): boolean {
  return (
    elevationMetres >= HEURISTIC_ELEVATION_METRES ||
    Math.abs(latitude) >= HEURISTIC_LATITUDE_DEGREES
  );
}
