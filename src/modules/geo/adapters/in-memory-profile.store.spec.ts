import { describe, expect, it } from 'vitest';

import { APPLICABILITY_RULES_VERSION } from '../../../domain/activity/applicability.registry';
import type { LocationId } from '../../../domain/shared/branded';
import type { LocationProfile } from '../../../domain/location/location-profile';
import { InMemoryLocationProfileStore } from './in-memory-profile.store';

const PRAGUE = '50.09,14.42' as LocationId;
const LISBON = '38.73,-9.15' as LocationId;

function profile(locationId: LocationId, computedAt = '2026-09-08T00:00:00.000Z'): LocationProfile {
  return {
    locationId,
    rulesVersion: APPLICABILITY_RULES_VERSION,
    computedAt,
    evidence: {
      marineCoverage: { allNullProbeDates: ['2026-09-08'], lastProbedOn: '2026-09-08', covered: false },
    },
  };
}

describe('the in-memory profile store', () => {
  it('has nothing for a location it has never seen', async () => {
    const store = new InMemoryLocationProfileStore();

    expect(await store.find(PRAGUE)).toBeUndefined();
  });

  it('reads back the profile it was given, evidence and all', async () => {
    const store = new InMemoryLocationProfileStore();
    await store.save(profile(PRAGUE));

    expect(await store.find(PRAGUE)).toEqual(profile(PRAGUE));
  });

  it('keeps locations apart by their identity', async () => {
    const store = new InMemoryLocationProfileStore();
    await store.save(profile(PRAGUE));

    expect(await store.find(LISBON)).toBeUndefined();
  });

  it('replaces a profile rather than accumulating versions of it', async () => {
    const store = new InMemoryLocationProfileStore();
    await store.save(profile(PRAGUE, '2026-09-08T00:00:00.000Z'));
    await store.save(profile(PRAGUE, '2026-09-09T00:00:00.000Z'));

    expect((await store.find(PRAGUE))?.computedAt).toBe('2026-09-09T00:00:00.000Z');
    expect(store.size).toBe(1);
  });

  it('loses everything when the process does, which is why 08 is a prerequisite', async () => {
    const store = new InMemoryLocationProfileStore();
    await store.save(profile(PRAGUE));

    // A restart is a new store. An unconfirmed probe never reaches its second
    // day this way (design.md, "Risks / Trade-offs"): the durable
    // implementation arrives with `08-add-data-persistence`.
    expect(await new InMemoryLocationProfileStore().find(PRAGUE)).toBeUndefined();
  });
});
