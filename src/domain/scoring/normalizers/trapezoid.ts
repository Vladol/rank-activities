import { type Score01, clamp01 } from '../../shared/branded';

export interface TrapezoidParams {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

/**
 * A plateau with two ramps, for everything that has a *range* of ideal values:
 * temperature, wave height and period, snow depth
 * (docs/development-flow/stage-five.md, section 2).
 *
 * Degenerate parameters are meaningful and allowed: `a === b` is a step up,
 * `c === d` a cliff down. The comparison order below is what keeps either from
 * dividing by zero.
 */
export function trapezoid(value: number, params: TrapezoidParams): Score01 {
  const { a, b, c, d } = params;

  if (value < a) {
    return clamp01(0);
  }

  if (value < b) {
    return clamp01((value - a) / (b - a));
  }

  if (value <= c) {
    return clamp01(1);
  }

  if (value < d) {
    return clamp01((d - value) / (d - c));
  }

  return clamp01(0);
}
