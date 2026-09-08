import { describe, expect, it } from 'vitest';

import type { LocationId } from '../shared/branded';
import { isReasonCode } from '../shared/reason-code';
import { APPLICABILITY_RULES_VERSION } from '../activity/applicability.registry';
import {
  type LocationProfile,
  type SnowSeasonEvidence,
  activityApplicability,
  isOutdated,
  marineCoverageVerdict,
  ruleVerdict,
  snowSeasonVerdict,
} from './location-profile';

const CHAMONIX = '45.92,6.87' as LocationId;

function archiveEvidence(coldSeasonSnowfallCm: number): SnowSeasonEvidence {
  return {
    basis: 'archive',
    coldSeasonSnowfallCm,
    samples: [{ startDate: '2025-01-01', endDate: '2025-01-31', snowfallCm: coldSeasonSnowfallCm }],
  };
}

function profile(overrides: Partial<LocationProfile> = {}): LocationProfile {
  return {
    locationId: CHAMONIX,
    rulesVersion: APPLICABILITY_RULES_VERSION,
    computedAt: '2026-09-08T00:00:00.000Z',
    evidence: {},
    ...overrides,
  };
}

describe('the snow-season verdict', () => {
  it('is applicable when the cold season clears the declared threshold', () => {
    const verdict = snowSeasonVerdict(archiveEvidence(96.5), { minColdMonthSnowfallCm: 20 });

    expect(verdict).toEqual({ kind: 'applicable' });
  });

  it('names the no-snow-season reason when it does not', () => {
    const verdict = snowSeasonVerdict(archiveEvidence(0), { minColdMonthSnowfallCm: 20 });

    expect(verdict).toEqual({ kind: 'not_applicable', reason: 'NO_SNOW_SEASON' });
  });

  it('reads the fallback verdict off the heuristic, never off a snowfall total it never saw', () => {
    // A heuristic profile has no centimetres to compare against the threshold.
    // Inventing one would make an unverified decision read as a verified one
    // (spec, "Missing evidence degrades explicitly, never silently").
    const evidence = {
      basis: 'elevation',
      seasonLikely: true,
      elevationMetres: 1041,
      latitude: 45.92,
      attemptedOn: '2026-09-08',
    } as const;

    expect(snowSeasonVerdict(evidence, { minColdMonthSnowfallCm: 20 })).toEqual({
      kind: 'applicable',
    });
    expect(JSON.stringify(evidence)).not.toContain('SnowfallCm');
  });

  it('lets the heuristic refuse as well as allow', () => {
    const verdict = snowSeasonVerdict(
      {
        basis: 'elevation',
        seasonLikely: false,
        elevationMetres: 48,
        latitude: 38.72,
        attemptedOn: '2026-09-08',
      },
      { minColdMonthSnowfallCm: 20 },
    );

    expect(verdict).toEqual({ kind: 'not_applicable', reason: 'NO_SNOW_SEASON' });
  });

  it('is undecided, and retryable, when nothing was observed at all', () => {
    expect(snowSeasonVerdict(undefined, { minColdMonthSnowfallCm: 20 })).toEqual({
      kind: 'undecided',
      reason: 'PROVIDER_UNAVAILABLE',
    });
  });
});

describe('the marine-coverage verdict', () => {
  it('is applicable once a probe has returned wave values', () => {
    const verdict = marineCoverageVerdict(
      { allNullProbeDates: [], lastProbedOn: '2026-09-08', covered: true },
      { confirmations: 2 },
    );

    expect(verdict).toEqual({ kind: 'applicable' });
  });

  it('is missing data, not geography, after a single all-null probe', () => {
    const verdict = marineCoverageVerdict(
      { allNullProbeDates: ['2026-09-07'], lastProbedOn: '2026-09-07', covered: false },
      { confirmations: 2 },
    );

    expect(verdict).toEqual({ kind: 'undecided', reason: 'MARINE_UNAVAILABLE' });
  });

  it('confirms the missing coastline on a second all-null probe from another day', () => {
    const verdict = marineCoverageVerdict(
      {
        allNullProbeDates: ['2026-09-07', '2026-09-08'],
        lastProbedOn: '2026-09-08',
        covered: false,
      },
      { confirmations: 2 },
    );

    expect(verdict).toEqual({ kind: 'not_applicable', reason: 'NO_COASTLINE_NEARBY' });
  });

  it('counts days, not probes: two all-null answers on one day confirm nothing', () => {
    const verdict = marineCoverageVerdict(
      {
        allNullProbeDates: ['2026-09-08', '2026-09-08'],
        lastProbedOn: '2026-09-08',
        covered: false,
      },
      { confirmations: 2 },
    );

    expect(verdict).toEqual({ kind: 'undecided', reason: 'MARINE_UNAVAILABLE' });
  });

  it('is undecided when the location has never been probed', () => {
    expect(marineCoverageVerdict(undefined, { confirmations: 2 })).toEqual({
      kind: 'undecided',
      reason: 'MARINE_UNAVAILABLE',
    });
  });
});

describe('the verdict a profile gives for one rule', () => {
  it('reads the rule its evidence was recorded under', () => {
    const stored = profile({
      evidence: {
        snowSeason: archiveEvidence(96.5),
      },
    });

    expect(ruleVerdict(stored, { rule: 'snowSeason', params: { minColdMonthSnowfallCm: 20 } })).toEqual(
      { kind: 'applicable' },
    );
  });

  it('is undecided for a rule the profile holds no evidence for', () => {
    expect(
      ruleVerdict(profile(), { rule: 'marineCoverage', params: { confirmations: 2 } }),
    ).toEqual({ kind: 'undecided', reason: 'MARINE_UNAVAILABLE' });
  });

  it('names every outcome with a reason the client already knows', () => {
    const verdict = ruleVerdict(profile(), { rule: 'snowSeason', params: {} });

    expect(verdict.kind === 'applicable' || isReasonCode(verdict.reason)).toBe(true);
  });
});

describe('a rules version change', () => {
  it('leaves a profile computed under the version in force current', () => {
    expect(isOutdated(profile())).toBe(false);
  });

  it('marks a profile computed under an earlier version outdated', () => {
    expect(isOutdated(profile({ rulesVersion: APPLICABILITY_RULES_VERSION - 1 }))).toBe(true);
  });

  it('marks a profile computed under a later version outdated too, rather than trusting it', () => {
    expect(isOutdated(profile({ rulesVersion: APPLICABILITY_RULES_VERSION + 1 }))).toBe(true);
  });
});

describe('the verdict for a whole activity', () => {
  const ski = { code: 'ski', applicability: [{ rule: 'snowSeason', params: { minColdMonthSnowfallCm: 20 } }] };
  const sightseeing = { code: 'outdoor-sightseeing', applicability: [] };
  const amphibious = {
    code: 'amphibious',
    applicability: [
      { rule: 'snowSeason', params: { minColdMonthSnowfallCm: 20 } },
      { rule: 'marineCoverage', params: { confirmations: 2 } },
    ],
  };

  it('is applicable everywhere for an activity that declares no rule', () => {
    expect(activityApplicability(profile(), sightseeing)).toEqual({ kind: 'applicable' });
  });

  it('is the verdict of the single rule an activity declares', () => {
    const stored = profile({
      evidence: { snowSeason: archiveEvidence(0) },
    });

    expect(activityApplicability(stored, ski)).toEqual({
      kind: 'not_applicable',
      reason: 'NO_SNOW_SEASON',
    });
  });

  it('lets a settled impossibility outrank a rule that is merely undecided', () => {
    const stored = profile({
      evidence: { snowSeason: archiveEvidence(0) },
    });

    // Nothing is known about the coast; the snow season is settled and absent.
    expect(activityApplicability(stored, amphibious)).toEqual({
      kind: 'not_applicable',
      reason: 'NO_SNOW_SEASON',
    });
  });

  it('stays undecided while any rule it needs is undecided', () => {
    const stored = profile({
      evidence: { snowSeason: archiveEvidence(96.5) },
    });

    expect(activityApplicability(stored, amphibious)).toEqual({
      kind: 'undecided',
      reason: 'MARINE_UNAVAILABLE',
    });
  });

  it('is applicable only when every rule it declares is', () => {
    const stored = profile({
      evidence: {
        snowSeason: archiveEvidence(96.5),
        marineCoverage: { allNullProbeDates: [], lastProbedOn: '2026-09-08', covered: true },
      },
    });

    expect(activityApplicability(stored, amphibious)).toEqual({ kind: 'applicable' });
  });
});
