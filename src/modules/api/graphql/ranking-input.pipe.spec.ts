import { describe, expect, it } from 'vitest';

import { DomainFailure } from '../../../common/errors/domain-failure.error';
import type { HorizonLimits } from '../../../domain/ranking/horizon';
import { RankingInputPipe } from './ranking-input.pipe';
import type { RankingInputModel } from './ranking.args';

const LIMITS: HorizonLimits = { defaultDays: 3, maxDays: 7 };
const LISBON = { latitude: 38.7167, longitude: -9.1333 };

function read(input: RankingInputModel) {
  return new RankingInputPipe(LIMITS).transform(input);
}

function codeOf(input: RankingInputModel): string {
  try {
    read(input);
  } catch (thrown) {
    return thrown instanceof DomainFailure ? thrown.failure.code : 'NOT_A_DOMAIN_FAILURE';
  }

  return 'ACCEPTED';
}

describe('the door a ranking request comes through', () => {
  it('passes a legible request on as the query the domain states', () => {
    expect(read({ location: { name: 'Lisbon' }, days: 3 })).toEqual({
      location: { kind: 'name', name: 'Lisbon' },
      days: 3,
    });
  });

  it('leaves the horizon absent when the client named none, rather than deciding here', () => {
    // The default is the use case's to apply: two places that both know it
    // would be two places that can disagree about it.
    expect(read({ location: { name: 'Lisbon' } })).toEqual({
      location: { kind: 'name', name: 'Lisbon' },
    });
  });

  it('refuses an over-long horizon rather than shortening it', () => {
    expect(codeOf({ location: LISBON, days: 30 })).toBe('HORIZON_TOO_LARGE');
    expect(codeOf({ location: LISBON, days: 8 })).toBe('HORIZON_TOO_LARGE');
  });

  it('refuses a horizon that is not a whole number of days', () => {
    expect(codeOf({ location: LISBON, days: 0 })).toBe('HORIZON_TOO_LARGE');
    expect(codeOf({ location: LISBON, days: -1 })).toBe('HORIZON_TOO_LARGE');
    expect(codeOf({ location: LISBON, days: 2.5 })).toBe('HORIZON_TOO_LARGE');
  });

  it('accepts the whole of the range the contract publishes', () => {
    for (let days = 1; days <= LIMITS.maxDays; days += 1) {
      expect(codeOf({ location: LISBON, days }), String(days)).toBe('ACCEPTED');
    }
  });

  it('refuses a location before it looks at the horizon', () => {
    // Both are wrong; the one reported is the one that made the request
    // illegible, because a horizon for no place is not a question.
    expect(codeOf({ location: {}, days: 30 })).toBe('INVALID_LOCATION_INPUT');
  });

  it('refuses a point that is not on Earth with its own code', () => {
    expect(codeOf({ location: { latitude: 999, longitude: 0 } })).toBe('INVALID_COORDINATES');
  });
});
