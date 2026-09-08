import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema';
import { DATABASE, type Database } from '../../infrastructure/db/database';
import { SCORING_PROFILE } from '../scoring/tokens';
import { readScoringProfile } from '../scoring/scoring-profile.service';
import { StoreActivityCatalogue } from './adapters/store-catalogue';
import type { ActivityCataloguePort } from './ports/activity-catalogue.port';
import { ACTIVITY_CATALOGUE } from './ports/activity-catalogue.port';
import { SeedActivityCatalogue } from './seed-catalogue';

/**
 * Binds the catalogue and the profile in force. Both are read once, at
 * startup, and both throw when what they read is invalid: an activity is data,
 * and data that cannot be trusted must stop the start rather than surface as a
 * wrong number later (spec `activity-catalog`).
 *
 * Which implementation the catalogue gets is a configuration choice with a
 * default that needs nothing: `files` is the source of truth, so the service
 * starts, loads and validates its rules with no store present (ADR 0007). A
 * deployment that wants a newly published version picked up without a restart
 * chooses `store`, and both are held to one contract suite.
 */
const logger = new Logger('ActivityCatalogue');

@Module({
  providers: [
    {
      provide: ACTIVITY_CATALOGUE,
      useFactory: async (
        config: ConfigService<Env, true>,
        db: Database | undefined,
      ): Promise<ActivityCataloguePort> => {
        const source = config.get('ACTIVITY_CATALOGUE_SOURCE', { infer: true });
        const catalogue =
          source === 'store' && db !== undefined
            ? await StoreActivityCatalogue.load(db, {
                lifetimeMs:
                  config.get('ACTIVITY_CATALOGUE_REFRESH_SECONDS', { infer: true }) * 1000,
              })
            : SeedActivityCatalogue.load();

        logger.log(
          `Loaded ${catalogue.activities().length} activity declarations from ${source}: ${catalogue
            .activities()
            .map((activity) => `${activity.code}@${activity.version}`)
            .join(', ')}`,
        );

        return catalogue;
      },
      inject: [ConfigService, { token: DATABASE, optional: true }],
    },
    {
      provide: SCORING_PROFILE,
      useFactory: () => readScoringProfile(),
    },
  ],
  exports: [ACTIVITY_CATALOGUE, SCORING_PROFILE],
})
export class ActivitiesModule {}
