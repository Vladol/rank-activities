import { type DynamicModule, Logger, Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema';
import { CAPABILITIES, type Capability } from '../../domain/weather/metric';
import { guardLimits } from './ports/limits';
import type { SeriesPort } from './ports/series.port';
import { CAPABILITY_PORT_TOKENS } from './ports/tokens';
import { MetricPlannerService } from './metric-planner.service';
import { SourceRouterService } from './source-router.service';
import {
  type BoundSources,
  IMPLEMENTED_SOURCES,
  type SourceRegistry,
  bindCapabilitySources,
  selectSourceNames,
} from './source-selection';

const BOUND_SOURCES = Symbol('BoundSources');

/**
 * Chooses a source per capability from configuration, reports the choice and
 * refuses to start when a configured source has no implementation. That is a
 * property of the seam rather than of any one source, which is why it lives
 * here and not in the change that adds the recorded sources
 * (design.md, Decision 6 of `01-add-weather-source-contract`).
 */
@Module({})
export class WeatherModule {
  static forRoot(registry: SourceRegistry = IMPLEMENTED_SOURCES): DynamicModule {
    const bound: Provider = {
      provide: BOUND_SOURCES,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): BoundSources => {
        const selection = selectSourceNames({
          WEATHER_PROVIDER: config.get('WEATHER_PROVIDER', { infer: true }),
          WEATHER_FORECAST_SOURCE: config.get('WEATHER_FORECAST_SOURCE', { infer: true }),
          WEATHER_MARINE_SOURCE: config.get('WEATHER_MARINE_SOURCE', { infer: true }),
          WEATHER_ARCHIVE_SOURCE: config.get('WEATHER_ARCHIVE_SOURCE', { infer: true }),
        });

        // Throws when a named source is not implemented: the process must not
        // come up serving data from a source nobody chose.
        const result = bindCapabilitySources(selection, registry);
        const logger = new Logger(WeatherModule.name);

        for (const line of result.log) {
          logger.log(line);
        }

        // Every bound port checks the request against its own declared limits
        // before anything leaves the process.
        return { ...result, ports: result.ports.map((port) => guardLimits(port)) };
      },
    };

    const capabilityPorts: Provider[] = CAPABILITIES.map((capability) => ({
      provide: CAPABILITY_PORT_TOKENS[capability],
      inject: [BOUND_SOURCES],
      useFactory: (sources: BoundSources): SeriesPort => portOf(sources, capability),
    }));

    const router: Provider = {
      provide: SourceRouterService,
      inject: [BOUND_SOURCES],
      useFactory: (sources: BoundSources) => new SourceRouterService(sources.ports),
    };

    return {
      module: WeatherModule,
      providers: [bound, ...capabilityPorts, router, MetricPlannerService],
      exports: [
        ...CAPABILITIES.map((capability) => CAPABILITY_PORT_TOKENS[capability]),
        SourceRouterService,
        MetricPlannerService,
      ],
    };
  }
}

function portOf(sources: BoundSources, capability: Capability): SeriesPort {
  const port = sources.ports.find((candidate) => candidate.capability === capability);

  if (port === undefined) {
    throw new Error(`No source was bound to the ${capability} capability.`);
  }

  return port;
}
