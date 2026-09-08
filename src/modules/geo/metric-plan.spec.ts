import { describe, expect, it } from 'vitest';

import { recordingArchivePort, recordingMarinePort } from '../../../test/support/fake-series-port';
import { applicabilityPlan } from '../../domain/location/applicability-plan';
import type { LocationProfile } from '../../domain/location/location-profile';
import type { ResolvedLocation } from '../../domain/location/resolved-location';
import { locationId } from '../../domain/shared/coordinates';
import type { Capability } from '../../domain/weather/metric';
import { SeedActivityCatalogue } from '../activities/seed-catalogue';
import { MetricPlannerService } from '../weather/metric-planner.service';
import { InMemoryLocationProfileStore } from './adapters/in-memory-profile.store';
import { LocationProfileService } from './location-profile.service';
import { MarineProbeService } from './marine-probe.service';
import { SnowSeasonService } from './snow-season.service';

const catalogue = SeedActivityCatalogue.load();
const planner = new MetricPlannerService();

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

async function profileAndPlan(location: ResolvedLocation, days = 1) {
  const marine = recordingMarinePort();
  const archive = recordingArchivePort();
  let now = Date.parse('2026-09-08T09:00:00Z');
  const service = new LocationProfileService(
    new InMemoryLocationProfileStore(),
    new MarineProbeService(marine),
    new SnowSeasonService(archive),
    catalogue,
    { now: () => now },
  );

  let profile: LocationProfile = await service.profileFor(location);

  for (let day = 1; day < days; day += 1) {
    now += 86_400_000;
    profile = await service.profileFor(location);
  }

  const plan = applicabilityPlan(profile, catalogue.activities());
  const planned = planner.plan({
    requirements: plan.requirements,
    location: location.coordinates,
    horizon: { kind: 'forecast', forecastDays: 7 },
    timezone: location.timezone,
  });

  return { profile, plan, planned, marine, archive };
}

function metricsOf(planned: ReturnType<MetricPlannerService['plan']>, capability: Capability) {
  return planned.ok
    ? (planned.value.requests.find((request) => request.capability === capability)?.metrics ?? [])
    : [];
}

describe('what an inapplicable activity costs to evaluate', () => {
  it('removes the metrics only it needs from the plan', async () => {
    // Lisbon has no snow season, so ski is out and its own metrics go with it.
    const { plan, planned } = await profileAndPlan(LISBON);

    expect(plan.applicable.map((definition) => definition.code)).not.toContain('ski');
    expect(metricsOf(planned, 'forecast')).not.toContain('snow_depth');
    expect(metricsOf(planned, 'forecast')).not.toContain('freezing_level_height');
    // The activities that remain still get everything they declare.
    expect(metricsOf(planned, 'forecast')).toContain('apparent_temperature');
  });

  it('removes an entire capability nothing applicable needs', async () => {
    // Prague is inland: no applicable activity declares a wave metric, so the
    // marine host is not called at all.
    const { planned } = await profileAndPlan(PRAGUE, 2);

    expect(planned.ok ? planned.value.requests.map((one) => one.capability) : []).not.toContain(
      'marine',
    );
  });

  it('keeps a capability an applicable activity does need', async () => {
    const { planned } = await profileAndPlan(LISBON);

    expect(metricsOf(planned, 'marine')).toContain('wave_height');
  });

  it('withholds an activity that is merely undecided from the plan too', async () => {
    // One all-null probe: surfing is missing data, not impossible. Either way
    // there is nothing to score, so nothing is fetched for it.
    const { plan, planned } = await profileAndPlan(PRAGUE);

    expect(plan.outcomes.find((one) => one.definition.code === 'surfing')?.verdict).toEqual({
      kind: 'undecided',
      reason: 'MARINE_UNAVAILABLE',
    });
    expect(metricsOf(planned, 'marine')).toEqual([]);
  });

  it('reports the inapplicable activity with a machine-readable reason instead of a score', async () => {
    const { plan } = await profileAndPlan(LISBON);

    expect(plan.outcomes.find((one) => one.definition.code === 'ski')?.verdict).toEqual({
      kind: 'not_applicable',
      reason: 'NO_SNOW_SEASON',
    });
    expect(JSON.stringify(plan.outcomes)).not.toContain('"score"');
  });
});

describe('an activity that declares no applicability rule', () => {
  it('is applicable and still has every metric it declares requested', async () => {
    const { plan, planned } = await profileAndPlan(PRAGUE);

    expect(plan.applicable.map((definition) => definition.code)).toEqual(
      expect.arrayContaining(['indoor-sightseeing', 'outdoor-sightseeing']),
    );
    expect(metricsOf(planned, 'forecast')).toContain('visibility');
  });

  it('causes no outbound evidence call of its own', async () => {
    // Two rules are declared by two activities, and exactly two seams are
    // touched: one marine probe and the archive windows. Sightseeing adds none.
    const { marine, archive } = await profileAndPlan(PRAGUE);

    expect(marine.requests).toHaveLength(1);
    expect(archive.requests.map((request) => request.capability)).toEqual(['archive', 'archive']);
  });
});
