import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { ACTIVITY_CATALOGUE } from '../src/modules/activities/ports/activity-catalogue.port';
import type { ActivityCataloguePort } from '../src/modules/activities/ports/activity-catalogue.port';
import { SCORING_PROFILE } from '../src/modules/scoring/tokens';
import type { ScoringProfile } from '../src/domain/scoring/scoring-profile';

/**
 * The application as it really starts. The unit tests read the seed files
 * directly; this one checks that `AppModule` binds them at all, and that a
 * plain `npm run start:dev` therefore has four activities to rank.
 */
describe('Activity catalogue (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('binds a catalogue holding the four declared activities', () => {
    const catalogue = app.get<ActivityCataloguePort>(ACTIVITY_CATALOGUE);

    expect(catalogue.activities().map((activity) => activity.code).toSorted()).toEqual([
      'indoor-sightseeing',
      'outdoor-sightseeing',
      'ski',
      'surfing',
    ]);
  });

  it('binds the profile every result will name', () => {
    expect(app.get<ScoringProfile>(SCORING_PROFILE)).toMatchObject({ id: 'default', version: 1 });
  });
});
