import type { Score01 } from '../../shared/branded';
import { clamp01 } from '../../shared/branded';
import { type GaussianParams, gaussian } from './gaussian';

export type InverseGaussianParams = GaussianParams;

/**
 * "The further from comfort, the better" — an upside-down bell
 * (docs/development-flow/stage-five.md, section 2).
 */
export function inverseGaussian(value: number, params: InverseGaussianParams): Score01 {
  return clamp01(1 - gaussian(value, params));
}
