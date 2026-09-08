import { describe, expect, it } from 'vitest';

import { FailingSeriesPort, recordingArchivePort, recordingMarinePort } from '../../../test/support/fake-series-port';
import { APPLICABILITY_RULES_VERSION } from '../../domain/activity/applicability.registry';
import { activityApplicability } from '../../domain/location/location-profile';
import type { ResolvedLocation } from '../../domain/location/resolved-location';
import { locationId } from '../../domain/shared/coordinates';
import { domainError } from '../../domain/shared/domain-error';
import { err } from '../../domain/shared/result';
import { SeedActivityCatalogue } from '../activities/seed-catalogue';
import { InMemoryLocationProfileStore } from './adapters/in-memory-profile.store';
import { LocationProfileService } from './location-profile.service';
import { MarineProbeService } from './marine-probe.service';
import { SnowSeasonService } from './snow-season.service';

const catalogue = SeedActivityCatalogue.load();

function at(latitude: number, longitude: number, elevationMetres: number | null, timezone: string): ResolvedLocation {
  return {
    id: locationId({ latitude, longitude }),
    coordinates: { latitude, longitude },
    timezone,
    elevationMetres,
    place: null,
  };
}

const PRAGUE = at(50.0875, 14.4213, 202, 'Europe/Prague');
const GENEVA = at(46.2044, 6.1432, 375, 'Europe/Zurich');
const LISBON = at(38.7167, -9.1333, 48, 'Europe/Lisbon');

const DAY_MS = 86_400_000;
const FIRST_DAY = Date.parse('2026-09-08T09:00:00Z');

function harness(options: { readonly marine?: ReturnType<typeof recordingMarinePort> } = {}) {
  const marine = options.marine ?? recordingMarinePort();
  const archive = recordingArchivePort();
  const store = new InMemoryLocationProfileStore();
  let now = FIRST_DAY;

  const service = new LocationProfileService(
    store,
    new MarineProbeService(marine),
    new SnowSeasonService(archive),
    catalogue,
    { now: () => now },
  );

  return {
    service,
    marine,
    archive,
    store,
    advance: (days: number) => {
      now += days * DAY_MS;
    },
  };
}

function verdictFor(profile: Parameters<typeof activityApplicability>[0], code: string) {
  const definition = catalogue.find(code);

  return definition === undefined ? undefined : activityApplicability(profile, definition);
}

describe('profiling a location', () => {
  it('records the evidence, its basis and the rules version that read it', async () => {
    const { service } = harness();
    const profile = await service.profileFor(LISBON);

    expect(profile.rulesVersion).toBe(APPLICABILITY_RULES_VERSION);
    expect(profile.computedAt).toBe(new Date(FIRST_DAY).toISOString());
    expect(profile.evidence.snowSeason).toMatchObject({ basis: 'archive' });
    expect(profile.evidence.marineCoverage).toMatchObject({ covered: true });
  });

  it('gathers evidence once and reuses it on the next request', async () => {
    const { service, marine, archive } = harness();

    await service.profileFor(LISBON);
    const after = { marine: marine.requests.length, archive: archive.requests.length };
    await service.profileFor(LISBON);

    expect(marine.requests).toHaveLength(after.marine);
    expect(archive.requests).toHaveLength(after.archive);
  });

  it('re-judges a profile the rules have moved past without fetching again', async () => {
    // Decision 4: the profile records what was observed, so a changed threshold
    // is re-applied to stored evidence. Discarding it would make every rules
    // bump re-read two archive months per location and reset every marine
    // candidacy, which is exactly what storing the evidence was for.
    const { service, store, archive, marine } = harness();
    const stale = await service.profileFor(LISBON);
    await store.save({ ...stale, rulesVersion: APPLICABILITY_RULES_VERSION - 1 });

    const before = { archive: archive.requests.length, marine: marine.requests.length };
    const fresh = await service.profileFor(LISBON);

    expect(fresh.rulesVersion).toBe(APPLICABILITY_RULES_VERSION);
    expect(fresh.evidence).toEqual(stale.evidence);
    expect(archive.requests).toHaveLength(before.archive);
    expect(marine.requests).toHaveLength(before.marine);
  });

  it('leaves the profile alone when a request changed nothing about it', async () => {
    // `computedAt` says when the evidence was computed, not when it was last
    // read. Refreshing it per request hides how old a heuristic guess is, and
    // becomes a write per request once the store is a database.
    const { service } = harness();
    const first = await service.profileFor(LISBON);
    const second = await service.profileFor(LISBON);

    expect(second).toEqual(first);
    expect(second.computedAt).toBe(first.computedAt);
  });

  it('gathers no evidence for activities that declare no rule', async () => {
    const { service } = harness();
    const profile = await service.profileFor(LISBON);

    expect(verdictFor(profile, 'outdoor-sightseeing')).toEqual({ kind: 'applicable' });
    expect(verdictFor(profile, 'indoor-sightseeing')).toEqual({ kind: 'applicable' });
  });
});

describe('an inland location, probed twice', () => {
  it('is a candidate after one probe, and surfing is missing data rather than impossible', async () => {
    const { service, marine } = harness();
    const profile = await service.profileFor(PRAGUE);

    expect(marine.requests).toHaveLength(1);
    expect(profile.evidence.marineCoverage?.allNullProbeDates).toEqual(['2026-09-08']);
    expect(verdictFor(profile, 'surfing')).toEqual({
      kind: 'undecided',
      reason: 'MARINE_UNAVAILABLE',
    });
  });

  it('is not probed a second time on the same day', async () => {
    const { service, marine } = harness();

    await service.profileFor(PRAGUE);
    await service.profileFor(PRAGUE);

    expect(marine.requests).toHaveLength(1);
  });

  it('has no coastline once a probe on a later day agrees', async () => {
    const { service, marine, advance } = harness();
    await service.profileFor(PRAGUE);
    advance(1);
    const profile = await service.profileFor(PRAGUE);

    expect(marine.requests).toHaveLength(2);
    expect(verdictFor(profile, 'surfing')).toEqual({
      kind: 'not_applicable',
      reason: 'NO_COASTLINE_NEARBY',
    });
  });

  it('stops probing once the missing coastline is confirmed', async () => {
    const { service, marine, advance } = harness();
    await service.profileFor(PRAGUE);
    advance(1);
    await service.profileFor(PRAGUE);
    advance(1);
    await service.profileFor(PRAGUE);

    expect(marine.requests).toHaveLength(2);
  });
});

describe('a lake the wave model does not cover', () => {
  it('follows the same path and ends inapplicable once confirmed', async () => {
    const { service, advance } = harness();
    const first = await service.profileFor(GENEVA);

    expect(verdictFor(first, 'surfing')).toEqual({
      kind: 'undecided',
      reason: 'MARINE_UNAVAILABLE',
    });

    advance(1);
    const confirmed = await service.profileFor(GENEVA);

    expect(verdictFor(confirmed, 'surfing')).toEqual({
      kind: 'not_applicable',
      reason: 'NO_COASTLINE_NEARBY',
    });
  });
});

describe('a heuristic profile', () => {
  it('is retried against the archive the next day, and settles once it answers', async () => {
    const archive = recordingArchivePort();
    let now = FIRST_DAY;
    let reachable = false;
    const service = new LocationProfileService(
      new InMemoryLocationProfileStore(),
      new MarineProbeService(recordingMarinePort()),
      new SnowSeasonService({
        ...archive,
        fetch: (request) =>
          reachable
            ? archive.fetch(request)
            : Promise.resolve(err(domainError('TIMEOUT', 'no answer'))),
      }),
      catalogue,
      { now: () => now },
    );

    expect((await service.profileFor(LISBON)).evidence.snowSeason?.basis).toBe('elevation');

    reachable = true;
    now += DAY_MS;

    expect((await service.profileFor(LISBON)).evidence.snowSeason?.basis).toBe('archive');
  });

  it('is not retried more than once a day', async () => {
    const archive = recordingArchivePort();
    const service = new LocationProfileService(
      new InMemoryLocationProfileStore(),
      new MarineProbeService(recordingMarinePort()),
      new SnowSeasonService({
        ...archive,
        fetch: () => Promise.resolve(err(domainError('TIMEOUT', 'no answer'))),
      }),
      catalogue,
      { now: () => FIRST_DAY },
    );

    await service.profileFor(LISBON);
    await service.profileFor(LISBON);
    await service.profileFor(LISBON);

    expect(archive.requests).toHaveLength(0);
  });
});

describe('a marine source that is down', () => {
  it('creates no candidacy at all, however many times it is asked', async () => {
    const marine = new FailingSeriesPort('marine', domainError('TIMEOUT', 'no answer'));
    const store = new InMemoryLocationProfileStore();
    let now = FIRST_DAY;
    const service = new LocationProfileService(
      store,
      new MarineProbeService(marine),
      new SnowSeasonService(recordingArchivePort()),
      catalogue,
      { now: () => now },
    );

    await service.profileFor(PRAGUE);
    now += DAY_MS;
    const profile = await service.profileFor(PRAGUE);

    expect(profile.evidence.marineCoverage?.allNullProbeDates).toEqual([]);
    expect(verdictFor(profile, 'surfing')).toEqual({
      kind: 'undecided',
      reason: 'MARINE_UNAVAILABLE',
    });
  });

  it('is probed once a day while it is down, not once a request', async () => {
    const marine = new FailingSeriesPort('marine', domainError('TIMEOUT', 'no answer'));
    const service = new LocationProfileService(
      new InMemoryLocationProfileStore(),
      new MarineProbeService(marine),
      new SnowSeasonService(recordingArchivePort()),
      catalogue,
      { now: () => FIRST_DAY },
    );

    await service.profileFor(PRAGUE);
    await service.profileFor(PRAGUE);
    await service.profileFor(PRAGUE);

    expect(marine.requests).toHaveLength(1);
  });
});

describe('a coastal location', () => {
  it('is settled by the first probe that returns waves, and never probed again', async () => {
    const { service, marine, advance } = harness();
    await service.profileFor(LISBON);
    advance(2);
    const profile = await service.profileFor(LISBON);

    expect(marine.requests).toHaveLength(1);
    expect(verdictFor(profile, 'surfing')).toEqual({ kind: 'applicable' });
  });
});
