import { type Score01, clamp01 } from '../../shared/branded';

export interface GaussianParams {
  readonly center: number;
  readonly sigma: number;
}

/**
 * A bell that never reaches zero — the soft alternative to a trapezoid, for
 * when the edges must not zero the feature out
 * (docs/development-flow/stage-five.md, section 2).
 *
 * `sigma > 0` is enforced by the registry's parameter schema; at zero the
 * exponent would be a division by zero rather than a narrow bell.
 */
export function gaussian(value: number, params: GaussianParams): Score01 {
  const offset = value - params.center;

  return clamp01(Math.exp(-(offset * offset) / (2 * params.sigma * params.sigma)));
}
