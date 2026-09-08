import { describe, expect, it } from 'vitest';

import { rankSettled, rankingHarness } from '../../../test/support/ranking';
import {
  FailingSeriesPort,
  isMarineProbe,
  scriptedPort,
} from '../../../test/support/fake-series-port';
import { FakePlaceLookup, placeCandidate } from '../../../test/support/fake-place-lookup';
import { domainError } from '../../domain/shared/domain-error';
import type { RankingAnswer } from '../../domain/ranking/ranking-answer';
import { type Result, err } from '../../domain/shared/result';
import type { RankingError } from './ranking.service';

const LISBON = { kind: 'coordinates', coordinates: { latitude: 38.7167, longitude: -9.1333 } } as const;
const PRAGUE = { kind: 'coordinates', coordinates: { latitude: 50.0875, longitude: 14.4213 } } as const;

const OUTAGE = domainError('TRANSPORT_FAILURE', 'the host could not be reached');

function answered(result: Result<RankingAnswer, RankingError>): RankingAnswer {
  if (!result.ok) {
    throw new Error(`The ranking was expected to answer: ${result.error.code}`);
  }

  return result.value;
}

function outcomeFor(answer: RankingAnswer, dayIndex: number, activity: string) {
  const day = answer.days[dayIndex];

  if (day === undefined) {
    throw new Error(`The answer holds no day ${dayIndex}.`);
  }

  return [...day.ranking.ranked, ...day.ranking.notRanked].find(
    (entry) => entry.activity === activity,
  )?.outcome;
}

describe('validating the request before any outbound work', () => {
  it('refuses an over-long horizon without building a plan or making a call', async () => {
    const harness = rankingHarness({
      limits: { defaultDays: 7, maxDays: 7 },
      lookup: FakePlaceLookup.returning([placeCandidate()]),
    });

    const refused = await harness.service.rank({ location: LISBON, days: 10 });

    expect(refused.ok).toBe(false);
    expect(refused.ok ? undefined : refused.error.code).toBe('HORIZON_TOO_LARGE');
    expect(harness.requests()).toEqual([]);
    expect((harness.lookup as FakePlaceLookup).queries).toEqual([]);
  });

  it('returns no partial answer covering fewer days', async () => {
    const harness = rankingHarness({ limits: { defaultDays: 7, maxDays: 3 } });
    const refused = await harness.service.rank({ location: LISBON, days: 7 });

    expect(refused.ok).toBe(false);
  });

  it('honours a horizon within range', async () => {
    const harness = rankingHarness();
    const answer = answered(await harness.service.rank({ location: LISBON, days: 3 }));

    expect(answer.days).toHaveLength(3);
    expect(answer.requestedDays).toBe(3);
  });

  it('uses the configured default when no horizon is given, and states the days covered', async () => {
    const harness = rankingHarness({ limits: { defaultDays: 4, maxDays: 7 } });
    const answer = answered(await harness.service.rank({ location: LISBON }));

    expect(answer.requestedDays).toBe(4);
    expect(answer.days).toHaveLength(4);
  });
});

describe('assembling the answer', () => {
  it('reports every catalogue activity exactly once per day', async () => {
    const harness = rankingHarness();
    const answer = answered(await rankSettled(harness, { location: LISBON, days: 3 }));

    for (const day of answer.days) {
      const activities = [...day.ranking.ranked, ...day.ranking.notRanked].map(
        (entry) => entry.activity,
      );

      expect(activities.toSorted()).toEqual([
        'indoor-sightseeing',
        'outdoor-sightseeing',
        'ski',
        'surfing',
      ]);
    }
  });

  it('labels each day by the location own local date, in order', async () => {
    const harness = rankingHarness();
    const answer = answered(await harness.service.rank({ location: LISBON, days: 3 }));
    const dates = answer.days.map((day) => day.date);

    expect(dates).toEqual(dates.toSorted());
    expect(dates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))).toBe(true);
  });

  it('declares per day whether it was computed from a complete local day', async () => {
    const harness = rankingHarness();
    const answer = answered(await harness.service.rank({ location: LISBON, days: 2 }));

    for (const day of answer.days) {
      expect(day.complete).toBe(true);
      expect(day.hoursCounted).toBe(24);
    }
  });

  it('carries the time zone, the moment the data was obtained and the profile version', async () => {
    const harness = rankingHarness();
    const answer = answered(await harness.service.rank({ location: LISBON, days: 2 }));

    expect(answer.timezone).toBe('Europe/Lisbon');
    expect(answer.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(answer.stale).toBe(false);
    expect(answer.profileId).toBe('default');
    expect(answer.profileVersion).toBeGreaterThan(0);
  });

  it('identifies the resolved place, country and region when the location came from a name', async () => {
    const harness = rankingHarness();
    const answer = answered(await harness.service.rank({ location: { kind: 'name', name: 'Lisbon' }, days: 2 }));

    expect(answer.location.place).toMatchObject({ name: 'Lisbon', countryCode: 'PT' });
  });

  it('states that the ranking judged the weather and nothing else', async () => {
    const harness = rankingHarness();
    const answer = answered(await harness.service.rank({ location: LISBON, days: 1 }));

    expect(answer.scope.code).toBe('WEATHER_ONLY');
    expect(answer.scope.i18n).toBe('scope.weather_only');
    expect(answer.scope.excludes).toContain('hazards');
  });

  it('reports staleness and the moment of collection from what the source said, not from a constant', async () => {
    // The mechanism that produces stale data is
    // `07-add-source-caching-and-resilience`; what this change owes is that the
    // answer declares it when it happens, and says so from the provenance
    // rather than from a hardcoded false.
    const collected = '2026-01-01T00:00:00.000Z';
    const harness = rankingHarness({
      forecast: scriptedPort('forecast', (_request, recorded) =>
        recorded().then((answer) =>
          answer.ok
            ? {
                ...answer,
                value: {
                  ...answer.value,
                  provenance: answer.value.provenance.map((entry) => ({
                    ...entry,
                    stale: true,
                    fetchedAt: collected,
                  })),
                },
              }
            : answer,
        ),
      ),
    });
    const answer = answered(await harness.service.rank({ location: LISBON, days: 1 }));

    expect(answer.stale).toBe(true);
    expect(answer.fetchedAt).toBe(collected);
    // And the request did not fail: stale data is delivered as stale.
    expect(answer.days).toHaveLength(1);
  });

  it('reports the oldest moment when parts of the answer were obtained at different times', async () => {
    const older = '2026-01-01T00:00:00.000Z';
    const harness = rankingHarness({
      marine: scriptedPort('marine', (request, recorded) =>
        isMarineProbe(request)
          ? undefined
          : recorded().then((answer) =>
              answer.ok
                ? {
                    ...answer,
                    value: {
                      ...answer.value,
                      provenance: answer.value.provenance.map((entry) => ({
                        ...entry,
                        fetchedAt: older,
                      })),
                    },
                  }
                : answer,
            ),
      ),
    });
    const answer = answered(await rankSettled(harness, { location: LISBON, days: 1 }));

    // An answer is only as fresh as its stalest ingredient.
    expect(answer.fetchedAt).toBe(older);
  });

  it('gives the same answer twice over unchanged data', async () => {
    const harness = rankingHarness();
    const first = answered(await harness.service.rank({ location: LISBON, days: 3 }));
    const second = answered(await harness.service.rank({ location: LISBON, days: 3 }));

    expect(summarise(second)).toEqual(summarise(first));
  });
});

describe('containing a failure to the activities that depend on it', () => {
  it('costs one activity when the source serving it is unavailable', async () => {
    const harness = rankingHarness({ marine: new FailingSeriesPort('marine', OUTAGE) });
    const answer = answered(await harness.service.rank({ location: LISBON, days: 2 }));

    expect(outcomeFor(answer, 0, 'surfing')).toMatchObject({
      kind: 'no_data',
      reason: 'MARINE_UNAVAILABLE',
      retryable: true,
    });
    expect(outcomeFor(answer, 0, 'outdoor-sightseeing')).toMatchObject({ kind: 'ranked' });
    expect(outcomeFor(answer, 0, 'indoor-sightseeing')).toMatchObject({ kind: 'ranked' });
  });

  it('names the metrics that could not be obtained', async () => {
    // The probe answers, so the place is settled as coastal; it is the waves
    // themselves that fail to arrive. Without that, surfing would be undecided
    // and nothing would ever have been asked for.
    const harness = rankingHarness({
      marine: scriptedPort('marine', (request) =>
        isMarineProbe(request) ? undefined : Promise.resolve(err(OUTAGE)),
      ),
    });
    const answer = answered(await rankSettled(harness, { location: LISBON, days: 1 }));
    const surfing = outcomeFor(answer, 0, 'surfing');

    expect(surfing).toMatchObject({ kind: 'no_data', reason: 'MARINE_UNAVAILABLE' });
    expect(surfing?.kind === 'no_data' ? surfing.missingMetrics : []).toContain('wave_height');
  });

  it('still identifies the place and the time zone when every source is down', async () => {
    const harness = rankingHarness({
      forecast: new FailingSeriesPort('forecast', OUTAGE),
      marine: new FailingSeriesPort('marine', OUTAGE),
      archive: new FailingSeriesPort('archive', OUTAGE),
      lookup: FakePlaceLookup.returning([
        placeCandidate({ name: 'Lisbon', latitude: 38.7167, longitude: -9.1333, timezone: 'Europe/Lisbon' }),
      ]),
    });
    const answer = answered(await harness.service.rank({ location: { kind: 'name', name: 'Lisbon' }, days: 3 }));

    expect(answer.location.place?.name).toBe('Lisbon');
    expect(answer.timezone).toBe('Europe/Lisbon');
    expect(answer.fetchedAt).toBeNull();
    // No day can be labelled: a day is the location's local date and only a
    // source ever tells us one. The activities still answer.
    expect(answer.days).toEqual([]);
    expect(answer.undated.map((entry) => entry.activity).toSorted()).toEqual([
      'indoor-sightseeing',
      'outdoor-sightseeing',
      'ski',
      'surfing',
    ]);

    for (const entry of answer.undated) {
      expect(entry.outcome.kind).not.toBe('ranked');
    }

    // Every activity whose possibility here is not already settled reports
    // missing data and says that asking again may help. Ski is the exception
    // and it is not an outage: with the archive down, the snow rule falls back
    // to the elevation heuristic, and at sea level that is a settled answer
    // about the place (`04-add-location-applicability`, Decision 2).
    for (const code of ['indoor-sightseeing', 'outdoor-sightseeing', 'surfing']) {
      expect(answer.undated.find((entry) => entry.activity === code)?.outcome).toMatchObject({
        kind: 'no_data',
        retryable: true,
      });
    }
  });

  it('issues the planned calls together rather than one after another', async () => {
    const forecast = scriptedPort('forecast', (_request, recorded) => delay(40).then(recorded));
    const marine = scriptedPort('marine', () => undefined);
    const harness = rankingHarness({ forecast, marine });

    await rankSettled(harness, { location: LISBON, days: 1 });

    const marineStart = marine.startedAt.at(-1);
    const forecastEnd = forecast.finishedAt.at(-1);

    // Overlap, not merely "both happened": a sequential implementation would
    // start the marine call only after the forecast one had come back.
    expect(marineStart).toBeDefined();
    expect(forecastEnd).toBeDefined();
    expect(marineStart ?? 0).toBeLessThan(forecastEnd ?? 0);
  });

  it('does not let one failing item cancel the others', async () => {
    // A misbehaving adapter: the contract says a port answers, this one throws.
    const harness = rankingHarness({
      marine: scriptedPort('marine', (request) => {
        if (isMarineProbe(request)) {
          return undefined;
        }

        throw new Error('the adapter threw where the contract says it must not');
      }),
    });
    const answer = answered(await rankSettled(harness, { location: LISBON, days: 1 }));

    expect(answer.days).toHaveLength(1);
    expect(outcomeFor(answer, 0, 'surfing')).toMatchObject({ kind: 'no_data' });
    expect(outcomeFor(answer, 0, 'indoor-sightseeing')).toMatchObject({ kind: 'ranked' });
  });

  it('makes no marine call at a place with no coastline', async () => {
    const harness = rankingHarness();

    await rankSettled(harness, { location: PRAGUE, days: 2 });

    const answer = answered(await harness.service.rank({ location: PRAGUE, days: 2 }));

    expect(outcomeFor(answer, 0, 'surfing')).toEqual({
      kind: 'not_applicable',
      reason: 'NO_COASTLINE_NEARBY',
    });
  });
});

function summarise(answer: RankingAnswer) {
  return answer.days.map((day) => ({
    date: day.date,
    ranked: day.ranking.ranked.map((entry) => [
      entry.activity,
      entry.outcome.kind === 'ranked' ? entry.outcome.score : null,
      entry.outcome.kind === 'ranked' ? (entry.outcome.constraintViolated ?? null) : null,
    ]),
    notRanked: day.ranking.notRanked.map((entry) => [
      entry.activity,
      entry.outcome.kind === 'ranked' ? null : entry.outcome.reason,
    ]),
  }));
}

/** A source that takes its time before answering as it normally would. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
