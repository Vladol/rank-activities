import { describe, expect, it } from 'vitest';

import { applicabilityPlan } from '../../src/domain/location/applicability-plan';
import type { RuleVerdict } from '../../src/domain/location/location-profile';
import type { ResolvedLocation } from '../../src/domain/location/resolved-location';
import { locationId } from '../../src/domain/shared/coordinates';
import { SeedActivityCatalogue } from '../../src/modules/activities/seed-catalogue';
import { recordedPlaceLookupSource, recordedSeriesSource } from '../../src/modules/weather/adapters/mock/recorded-sources';
import { MetricPlannerService } from '../../src/modules/weather/metric-planner.service';
import { InMemoryLocationProfileStore } from '../../src/modules/geo/adapters/in-memory-profile.store';
import { LocationProfileService } from '../../src/modules/geo/location-profile.service';
import { LocationResolverService } from '../../src/modules/geo/location-resolver.service';
import { MarineProbeService } from '../../src/modules/geo/marine-probe.service';
import { SnowSeasonService } from '../../src/modules/geo/snow-season.service';
import { InMemoryLocationStore } from '../../src/modules/geo/adapters/in-memory-location.store';
import { profiled } from '../support/profile';

/**
 * The acceptance cases of docs/development-flow/stage-two.md, section 12, that
 * concern applicability — one `it` per row, named after the row.
 *
 * The rows about scoring a place we have already decided is possible (a flat
 * sea scoring zero, a summer piste scoring zero) belong to `05-add-activity-ranking`.
 * What is asserted here is the half this change owns: that neither of them is
 * answered with `NotApplicable`.
 */
const catalogue = SeedActivityCatalogue.load();
const planner = new MetricPlannerService();

const DAY_MS = 86_400_000;

function at(latitude: number, longitude: number, elevationMetres: number, timezone: string): ResolvedLocation {
  return {
    id: locationId({ latitude, longitude }),
    coordinates: { latitude, longitude },
    timezone,
    elevationMetres,
    place: null,
  };
}

const PRAGUE = at(50.0875, 14.4213, 202, 'Europe/Prague');
const LISBON = at(38.7167, -9.1333, 48, 'Europe/Lisbon');
const CHAMONIX = at(45.9237, 6.8694, 1041, 'Europe/Paris');
const GENEVA = at(46.2044, 6.1432, 375, 'Europe/Zurich');
const ODESSA = at(46.4825, 30.7233, 61, 'Europe/Kyiv');
const QUITO = at(-0.1807, -78.4678, 2920, 'America/Guayaquil');
const PERISHER = at(-36.405, 148.4085, 1743, 'Australia/Sydney');

/**
 * Profiles a location over `days` consecutive days, which is what a two-phase
 * probe needs to reach a settled answer.
 */
async function settled(location: ResolvedLocation, days = 2) {
  const marine = recordedSeriesSource('marine');
  let now = Date.parse('2026-09-08T09:00:00Z');
  const service = new LocationProfileService(
    new InMemoryLocationProfileStore(),
    new MarineProbeService(marine),
    new SnowSeasonService(recordedSeriesSource('archive')),
    catalogue,
    new InMemoryLocationStore(),
    { now: () => now },
  );

  let profile = await profiled(service, location);

  for (let day = 1; day < days; day += 1) {
    now += DAY_MS;
    profile = await profiled(service, location);
  }

  const plan = applicabilityPlan(profile, catalogue.activities());

  return {
    plan,
    verdict: (code: string): RuleVerdict | undefined =>
      plan.outcomes.find((outcome) => outcome.definition.code === code)?.verdict,
    capabilities: () => {
      const planned = planner.plan({
        requirements: plan.requirements,
        location: location.coordinates,
        horizon: { kind: 'forecast', forecastDays: 7 },
        timezone: location.timezone,
      });

      return planned.ok ? planned.value.requests.map((request) => request.capability) : [];
    },
  };
}

describe('stage two, section 12: the applicability cases', () => {
  it('Prague, continent: surfing is NotApplicable(NO_COASTLINE_NEARBY) and the marine host is not called', async () => {
    const prague = await settled(PRAGUE);

    expect(prague.verdict('surfing')).toEqual({
      kind: 'not_applicable',
      reason: 'NO_COASTLINE_NEARBY',
    });
    expect(prague.capabilities()).not.toContain('marine');
  });

  it('Lisbon, the main surf case: surfing is possible and ski is NotApplicable(NO_SNOW_SEASON)', async () => {
    const lisbon = await settled(LISBON);

    expect(lisbon.verdict('surfing')).toEqual({ kind: 'applicable' });
    expect(lisbon.verdict('ski')).toEqual({ kind: 'not_applicable', reason: 'NO_SNOW_SEASON' });
  });

  it('Chamonix in winter, the main ski case: ski is possible and surfing is NotApplicable', async () => {
    const chamonix = await settled(CHAMONIX);

    expect(chamonix.verdict('ski')).toEqual({ kind: 'applicable' });
    expect(chamonix.verdict('surfing')).toEqual({
      kind: 'not_applicable',
      reason: 'NO_COASTLINE_NEARBY',
    });
  });

  it('Chamonix in summer, season is not applicability: ski stays possible out of season', async () => {
    // The absence of snow today is the scoring's business, and it answers
    // Ranked(0, NO_SNOW_COVER) in `05-add-activity-ranking`. Applicability is a
    // property of the place and does not move with the calendar.
    const chamonix = await settled(CHAMONIX);

    expect(chamonix.verdict('ski')).toEqual({ kind: 'applicable' });
  });

  it('Geneva, a lake is not a sea: surfing is NotApplicable', async () => {
    const geneva = await settled(GENEVA);

    expect(geneva.verdict('surfing')).toEqual({
      kind: 'not_applicable',
      reason: 'NO_COASTLINE_NEARBY',
    });
  });

  it('Odessa in a flat calm, a flat sea is not an absent sea: surfing stays possible', async () => {
    const odessa = await settled(ODESSA);

    expect(odessa.verdict('surfing')).toEqual({ kind: 'applicable' });
    expect(odessa.capabilities()).toContain('marine');
  });

  it('Quito, elevation without snow: ski is NotApplicable(NO_SNOW_SEASON) despite 2 850 m', async () => {
    const quito = await settled(QUITO);

    expect(quito.verdict('ski')).toEqual({ kind: 'not_applicable', reason: 'NO_SNOW_SEASON' });
  });

  it('the southern hemisphere in July: ski is possible, decided by snowfall rather than by the month', async () => {
    // Stage two names Queenstown. The archive at the town centre, 322 m, records
    // 1.4 cm across July 2025 — the ski fields above it are a different point,
    // and stage two, section 11 keeps a location a point. Perisher, 1 743 m,
    // is the southern case the same rule finds: 127.7 cm in July, 0.0 in January.
    const perisher = await settled(PERISHER);

    expect(perisher.verdict('ski')).toEqual({ kind: 'applicable' });
  });

  it('sightseeing needs no evidence and is possible everywhere', async () => {
    for (const place of [PRAGUE, QUITO]) {
      const anywhere = await settled(place);

      expect(anywhere.verdict('indoor-sightseeing')).toEqual({ kind: 'applicable' });
      expect(anywhere.verdict('outdoor-sightseeing')).toEqual({ kind: 'applicable' });
    }
  });
});

describe('stage two, section 12: the location cases', () => {
  const resolver = new LocationResolverService(recordedPlaceLookupSource());

  it('"Moscow", an ambiguous name: the largest is chosen and the answer shows the country', async () => {
    const moscow = await resolver.resolve({ kind: 'name', name: 'Moscow' });

    expect(moscow.ok ? moscow.value.place : undefined).toMatchObject({
      name: 'Moscow',
      countryCode: 'RU',
      admin1: 'Moscow',
    });
    expect(moscow.ok ? moscow.value.coordinates.latitude : 0).toBeCloseTo(55.752, 3);
  });

  it('three spellings of one city: three requests, one point', async () => {
    // Stage two names Munich / München. The recorded München response is the
    // nginx 403 of stage-three.md, section 6 — a transport case, not a spelling
    // one — so the spellings are asserted on the city that has a recorded match.
    const resolved = await Promise.all(
      ['Lisbon', 'lisbon', '  LISBON  '].map((name) => resolver.resolve({ kind: 'name', name })),
    );

    expect(new Set(resolved.map((one) => (one.ok ? one.value.id : one.error.code)))).toEqual(
      new Set(['38.73,-9.15']),
    );
  });
});
