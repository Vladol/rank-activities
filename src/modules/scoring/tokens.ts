/**
 * The profile in force. A symbol rather than a string so that a second profile
 * source can never collide with this one by accident.
 */
export const SCORING_PROFILE: unique symbol = Symbol('ScoringProfile');
