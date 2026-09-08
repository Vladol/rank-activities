import { type Score01, clamp01 } from '../../shared/branded';

export interface InverseParams {
  readonly from: number;
  readonly to: number;
}

/**
 * "The less, the better": 1 at `from`, 0 at `to`.
 *
 * A separate code rather than `linear` with inverted bounds: inverted bounds
 * read as a typo, whereas two codes make the declaration's intent explicit and
 * turn the declared monotonicity into a testable property
 * (docs/development-flow/stage-five.md, section 2).
 */
export function inverse(value: number, params: InverseParams): Score01 {
  return clamp01((params.to - value) / (params.to - params.from));
}
