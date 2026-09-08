import type { LocationId } from './branded';

/**
 * A point, and the two things every consumer of one needs: whether it names a
 * place on Earth at all, and what that place is called internally.
 *
 * The identity is a pure function of the rounded coordinates
 * (design.md, Decision 3 of `04-add-location-applicability`). Deriving it here
 * rather than reading it back from a store is what lets a location be
 * identified before anything is stored, and what makes the same city yield the
 * same identity in two processes that share no state.
 */
export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Two decimals — about 1.1 km of latitude, which is finer than the provider's
 * own grid (docs/development-flow/stage-three.md, section 7.3). Two requests
 * that round the same are asking about the same place, and the source would
 * answer both from the same node.
 */
export const GRID_DECIMALS = 2;

const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;

/**
 * The rounded coordinate as text, with the negative zero folded away: `-0`,
 * and every value between -0.005 and 0, formats as `-0.00`, which would name a
 * second place at the same point.
 */
export function roundToGrid(value: number): string {
  const fixed = value.toFixed(GRID_DECIMALS);

  return fixed === `-${(0).toFixed(GRID_DECIMALS)}` ? (0).toFixed(GRID_DECIMALS) : fixed;
}

export function locationId(coordinates: Coordinates): LocationId {
  return `${roundToGrid(coordinates.latitude)},${roundToGrid(coordinates.longitude)}` as LocationId;
}

/**
 * Whether the pair names a point at all. Checked before any outbound call:
 * a latitude of 999 is our caller's mistake, and asking a source about it
 * would turn it into the source's failure (spec `location-applicability`,
 * "Invalid coordinates are rejected").
 */
export function isOnEarth(coordinates: Coordinates): boolean {
  return (
    isWithin(coordinates.latitude, MAX_LATITUDE) && isWithin(coordinates.longitude, MAX_LONGITUDE)
  );
}

function isWithin(value: number, bound: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= bound;
}
