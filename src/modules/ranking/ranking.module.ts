import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema';
import type { HorizonLimits } from '../../domain/ranking/horizon';
import { DATABASE, type Database } from '../../infrastructure/db/database';
import { ActivitiesModule } from '../activities/activities.module';
import { GeoModule } from '../geo/geo.module';
import { WeatherModule } from '../weather/weather.module';
import {
  AUDIT_OPTIONS,
  AUDIT_WRITER,
  AuditBufferService,
  type AuditBufferOptions,
} from './audit/audit-buffer.service';
import { AUDIT_PORT } from './audit/audit.port';
import { type AuditWriter, DbAuditWriter } from './audit/audit-writer';
import { RANKING_LIMITS, RankingService } from './ranking.service';

/**
 * The use case, and the one place the horizon range is read from
 * configuration. The service takes the range as a value rather than reading
 * the environment itself, so a test states the range it is testing instead of
 * setting a variable.
 *
 * The audit is bound to a writer when a store is configured and to nothing when
 * not. Either way the service calls the same port and never waits for it.
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
    {
      provide: AUDIT_WRITER,
      useFactory: (db: Database | undefined): AuditWriter | undefined =>
        db === undefined ? undefined : new DbAuditWriter(db),
      inject: [{ token: DATABASE, optional: true }],
    },
    {
      provide: AUDIT_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): AuditBufferOptions => ({
        flushIntervalMs: config.get('AUDIT_FLUSH_INTERVAL_SECONDS', { infer: true }) * 1000,
        maxRecords: config.get('AUDIT_BUFFER_MAX_RECORDS', { infer: true }),
      }),
    },
    AuditBufferService,
    { provide: AUDIT_PORT, useExisting: AuditBufferService },
    RankingService,
  ],
  exports: [RankingService, AUDIT_PORT, AuditBufferService],
})
export class RankingModule {}
