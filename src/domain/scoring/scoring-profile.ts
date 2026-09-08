import { type Score01, clamp01 } from '../shared/branded';

/**
 * The profile of docs/development-flow/stage-five.md, section 7.4: the two
 * numbers that belong to the product rather than to any activity, plus the
 * identity that makes a past computation reproducible.
 *
 * Per-user weight overrides are deliberately not here. They are the later
 * change; what this one owes the contract is that the pair
 * (definitionVersion, profileVersion) already travels with every result, so
 * adding them later does not change the shape of an answer.
 */
export interface ScoringProfile {
  readonly id: string;
  readonly version: number;
  /** The share of holes in a day beyond which a required metric is not judged. */
  readonly gapThreshold: Score01;
  /**
   * What a degraded feature scores. 0.5 rather than 0, because "no data" is
   * not the same statement as "bad"; a product that disagrees moves the number,
   * not the code.
   */
  readonly neutralScore: Score01;
}

export const DEFAULT_PROFILE: ScoringProfile = {
  id: 'default',
  version: 1,
  gapThreshold: clamp01(0.3),
  neutralScore: clamp01(0.5),
};
