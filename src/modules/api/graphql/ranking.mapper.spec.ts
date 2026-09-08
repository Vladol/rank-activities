import { describe, expect, it } from 'vitest';

import { clamp01, featureId, toScore100, weight } from '../../../domain/shared/branded';
import type { ActivityOutcome } from '../../../domain/ranking/activity-outcome';
import { RANKING_SCOPE, type RankingAnswer } from '../../../domain/ranking/ranking-answer';
import { rankDay } from '../../../domain/ranking/rank';
import { locationId } from '../../../domain/shared/coordinates';
import { toOutcomeModel, toRankingAnswerModel } from './ranking.mapper';
import {
  ContributionStatusModel,
  FeatureRoleModel,
  NoDataOutcomeModel,
  NotApplicableOutcomeModel,
  OutcomeKindModel,
  RankedOutcomeModel,
} from './ranking.models';

const ranked: ActivityOutcome = {
  kind: 'ranked',
  score: toScore100(clamp01(0.82)),
  breakdown: [
    {
      featureId: featureId('waveHeight'),
      metric: 'wave_height',
      role: 'additive',
      status: 'used',
      raw: { value: 1.4, unit: 'm', sampleCount: 24, missingCount: 0 },
      normalized: clamp01(0.9),
      weight: weight(0.34),
      contribution: clamp01(0.306),
      gateFactor: null,
    },
    {
      featureId: featureId('waterComfort'),
      metric: 'sea_surface_temperature',
      role: 'additive',
      status: 'excluded',
      raw: null,
      normalized: clamp01(0),
      weight: null,
      contribution: null,
      gateFactor: null,
    },
  ],
  definitionVersion: 1,
  profileId: 'default',
  profileVersion: 1,
};

const inapplicable: ActivityOutcome = { kind: 'not_applicable', reason: 'NO_COASTLINE_NEARBY' };

const missing: ActivityOutcome = {
  kind: 'no_data',
  reason: 'MARINE_UNAVAILABLE',
  missingMetrics: ['wave_height'],
  retryable: true,
};

function answer(): RankingAnswer {
  return {
    location: {
      id: locationId({ latitude: 38.73, longitude: -9.15 }),
      coordinates: { latitude: 38.73, longitude: -9.15 },
      timezone: 'Europe/Lisbon',
      elevationMetres: 48,
      place: { name: 'Lisbon', sourcePlaceId: '2267057', countryCode: 'PT', admin1: 'Lisbon' },
    },
    timezone: 'Europe/Lisbon',
    requestedDays: 1,
    days: [
      {
        date: '2026-09-08',
        complete: true,
        hoursCounted: 24,
        ranking: rankDay([
          { activity: 'surfing', outcome: ranked },
          { activity: 'ski', outcome: inapplicable },
        ]),
      },
    ],
    undated: [],
    fetchedAt: '2026-09-08T09:00:00.000Z',
    stale: false,
    profileId: 'default',
    profileVersion: 1,
    scope: RANKING_SCOPE,
  };
}

describe('exposing an answer without letting a domain type across', () => {
  it('publishes exactly the fields the contract names, and no others', () => {
    const model = toRankingAnswerModel(answer());

    expect(Object.keys(model).toSorted()).toEqual([
      'days',
      'fetchedAt',
      'location',
      'profileId',
      'profileVersion',
      'requestedDays',
      'scope',
      'stale',
      'timezone',
      'undated',
    ]);
  });

  it('does not carry a domain field that nobody published', () => {
    // Renaming or adding a field in the core changes one line in the mapper and
    // nothing a client sees. A spread would have published this one.
    const withExtra = { ...answer(), secretInternalField: 'must not appear' } as RankingAnswer;

    expect(Object.keys(toRankingAnswerModel(withExtra))).not.toContain('secretInternalField');
  });

  it('keeps the three outcomes three distinct types on the wire', () => {
    expect(toOutcomeModel(ranked)).toBeInstanceOf(RankedOutcomeModel);
    expect(toOutcomeModel(inapplicable)).toBeInstanceOf(NotApplicableOutcomeModel);
    expect(toOutcomeModel(missing)).toBeInstanceOf(NoDataOutcomeModel);
  });

  it('gives a refusal no score field, whatever a client asks for', () => {
    for (const outcome of [inapplicable, missing]) {
      expect(Object.keys(toOutcomeModel(outcome))).not.toContain('score');
    }
  });

  it('resolves the human text from the code, and returns a key rather than a sentence', () => {
    const model = toOutcomeModel(inapplicable) as NotApplicableOutcomeModel;

    expect(model.reason).toBe('NO_COASTLINE_NEARBY');
    expect(model.messageKey).toBe('reason.no_coastline_nearby');
  });

  it('says whether retrying may help, and what could not be obtained', () => {
    const model = toOutcomeModel(missing) as NoDataOutcomeModel;

    expect(model.retryable).toBe(true);
    expect(model.missingMetrics).toEqual(['wave_height']);
    expect(model.kind).toBe(OutcomeKindModel.NO_DATA);
  });

  it('keeps a dropped feature visible in the breakdown rather than omitting it', () => {
    const model = toOutcomeModel(ranked) as RankedOutcomeModel;
    const dropped = model.breakdown.find((entry) => entry.featureId === 'waterComfort');

    expect(dropped?.status).toBe(ContributionStatusModel.EXCLUDED);
    expect(dropped?.raw).toBeNull();
    expect(dropped?.weight).toBeNull();
    // A client can tell a low contribution from an absent one.
    expect(model.breakdown.find((entry) => entry.featureId === 'waveHeight')?.raw).toMatchObject({
      value: 1.4,
      unit: 'm',
    });
    expect(model.breakdown[0]?.role).toBe(FeatureRoleModel.ADDITIVE);
  });

  it('separates the ranked results from the ones that take no part in the ordering', () => {
    const day = toRankingAnswerModel(answer()).days[0];

    expect(day?.ranked.map((entry) => entry.activity)).toEqual(['surfing']);
    expect(day?.notRanked.map((entry) => entry.activity)).toEqual(['ski']);
  });

  it('carries the accountability metadata and the scope statement', () => {
    const model = toRankingAnswerModel(answer());

    expect(model.location).toMatchObject({ name: 'Lisbon', countryCode: 'PT', admin1: 'Lisbon' });
    expect(model.timezone).toBe('Europe/Lisbon');
    expect(model.fetchedAt).toBe('2026-09-08T09:00:00.000Z');
    expect(model.stale).toBe(false);
    expect(model.profileVersion).toBe(1);
    expect(model.scope).toMatchObject({ code: 'WEATHER_ONLY', messageKey: 'scope.weather_only' });
  });

  it('reports no administrative context for a point that had none', () => {
    const raw = answer();
    const model = toRankingAnswerModel({
      ...raw,
      location: { ...raw.location, place: null, elevationMetres: null },
    });

    expect(model.location.name).toBeNull();
    expect(model.location.countryCode).toBeNull();
    expect(model.location.latitude).toBe(38.73);
  });
});
