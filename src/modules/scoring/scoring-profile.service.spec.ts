import { describe, expect, it } from 'vitest';

import { DEFAULT_PROFILE } from '../../domain/scoring/scoring-profile';
import { readScoringProfile, scoringProfileSchema } from './scoring-profile.service';

describe('the seeded scoring profile', () => {
  it('is default at version 1, carrying the gap threshold and the neutral value', () => {
    expect(readScoringProfile()).toEqual({
      id: 'default',
      version: 1,
      gapThreshold: 0.3,
      neutralScore: 0.5,
    });
  });

  it('agrees with the profile the domain falls back to', () => {
    expect(readScoringProfile()).toEqual(DEFAULT_PROFILE);
  });

  it('refuses a threshold that is not a share', () => {
    expect(
      scoringProfileSchema.safeParse({ id: 'x', version: 1, gapThreshold: 2, neutralScore: 0.5 })
        .success,
    ).toBe(false);
  });

  it('refuses an unversioned profile, because a result must name the version it used', () => {
    expect(
      scoringProfileSchema.safeParse({ id: 'x', gapThreshold: 0.3, neutralScore: 0.5 }).success,
    ).toBe(false);
  });
});
