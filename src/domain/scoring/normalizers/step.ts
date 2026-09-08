import { type Score01, clamp01 } from '../../shared/branded';

export interface StepPoint {
  readonly at: number;
  readonly value: number;
}

export interface StepParams {
  /** Ascending by `at`; the registry's schema refuses any other order. */
  readonly points: readonly StepPoint[];
  /** The value below the first point. */
  readonly below: number;
}

/**
 * Piecewise constant: the value of the last point whose `at` is at or below the
 * value. For ordinal and categorical quantities, where continuity is a fiction
 * (docs/development-flow/stage-five.md, section 2).
 */
export function step(value: number, params: StepParams): Score01 {
  let result = params.below;

  for (const point of params.points) {
    if (point.at > value) {
      break;
    }

    result = point.value;
  }

  return clamp01(result);
}
