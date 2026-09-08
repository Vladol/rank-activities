import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema';
import type { HorizonLimits } from '../../domain/ranking/horizon';
import { ActivitiesModule } from '../activities/activities.module';
import { GeoModule } from '../geo/geo.module';
import { WeatherModule } from '../weather/weather.module';
import { RANKING_LIMITS, RankingService } from './ranking.service';

/**
 * The use case, and the one place the horizon range is read from
 * configuration. The service takes the range as a value rather than reading
 * the environment itself, so a test states the range it is testing instead of
 * setting a variable.
 */
@Module({
  imports: [ActivitiesModule, GeoModule, WeatherModule.forRoot()],
  providers: [
    {
      provide: RANKING_LIMITS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): HorizonLimits => ({
        defaultDays: config.get('FORECAST_DAYS_DEFAULT', { infer: true }),
        maxDays: config.get('FORECAST_DAYS_MAX', { infer: true }),
      }),
    },
    RankingService,
  ],
  exports: [RankingService],
})
export class RankingModule {}
