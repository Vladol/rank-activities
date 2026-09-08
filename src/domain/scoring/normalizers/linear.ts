import { type Score01, clamp01 } from '../../shared/branded';

export interface LinearParams {
  readonly from: number;
  readonly to: number;
}

/**
 * "The more, the better": 0 at `from`, 1 at `to`
 * (docs/development-flow/stage-five.md, section 2).
 *
 * `from === to` is division by zero rather than a limiting case, and the
 * registry's parameter schema refuses it.
 */
export function linear(value: number, params: LinearParams): Score01 {
  return clamp01((value - params.from) / (params.to - params.from));
}
