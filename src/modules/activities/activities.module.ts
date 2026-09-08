import { Logger, Module } from '@nestjs/common';

import { SCORING_PROFILE } from '../scoring/tokens';
import { readScoringProfile } from '../scoring/scoring-profile.service';
import { ACTIVITY_CATALOGUE } from './ports/activity-catalogue.port';
import { SeedActivityCatalogue } from './seed-catalogue';

/**
 * Binds the catalogue and the profile in force. Both are read once, at
 * startup, and both throw when what is on disk is invalid: an activity is
 * data, and data that cannot be trusted must stop the start rather than
 * surface as a wrong number later (spec `activity-catalog`).
 */
const logger = new Logger('ActivityCatalogue');

@Module({
  providers: [
    {
      provide: ACTIVITY_CATALOGUE,
      useFactory: (): SeedActivityCatalogue => {
        const catalogue = SeedActivityCatalogue.load();

        logger.log(
          `Loaded ${catalogue.activities().length} activity declarations: ${catalogue
            .activities()
            .map((activity) => `${activity.code}@${activity.version}`)
            .join(', ')}`,
        );

        return catalogue;
      },
    },
    {
      provide: SCORING_PROFILE,
      useFactory: () => readScoringProfile(),
    },
  ],
  exports: [ACTIVITY_CATALOGUE, SCORING_PROFILE],
})
export class ActivitiesModule {}
