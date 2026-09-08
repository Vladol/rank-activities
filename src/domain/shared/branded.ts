/**
 * Brands over the numbers this service passes around
 * (docs/development-flow/stage-five.md, section 7.2).
 *
 * The point is not type gymnastics. `score` and `weight` are both numbers, both
 * in [0, 1], and `combine(value, weight)` swaps them silently. With brands it
 * does not compile.
 */
declare const brand: unique symbol;

type Brand<T, B> = T & { readonly [brand]: B };

/** The engine's internal scale. */
export type Score01 = Brand<number, 'Score01'>;

/** The scale the client sees. One conversion, in one place: `toScore100`. */
export type Score100 = Brand<number, 'Score100'>;

/** A contributing feature's share, normalised so the shares sum to one. */
export type Weight = Brand<number, 'Weight'>;

/** The stable key a feature carries into the breakdown. It never changes. */
export type FeatureId = Brand<string, 'FeatureId'>;

/**
 * The only way into `Score01`. Clamping is unconditional: an unclamped
 * normaliser is not a different curve, it is a source of scores outside [0, 1]
 * that break the breakdown invariant (stage-five.md, section 2).
 */
export function clamp01(value: number): Score01 {
  if (Number.isNaN(value)) {
    throw new Error('A score cannot be NaN. The aggregation returns null for an absent value.');
  }

  return Math.min(1, Math.max(0, value)) as Score01;
}

export function toScore100(value: Score01): Score100 {
  return (value * 100) as Score100;
}

export function weight(value: number): Weight {
  return value as Weight;
}

export function featureId(value: string): FeatureId {
  return value as FeatureId;
}
