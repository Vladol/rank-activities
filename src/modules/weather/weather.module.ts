import { type DynamicModule, Logger, Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CACHE, type CachePort, NullCache } from '../../common/cache/cache.port';
import { guardCache } from '../../common/cache/guard-cache';
import { MemoryCache } from '../../common/cache/memory-cache.adapter';
import { METRICS, MetricsRegistry } from '../../common/metrics/metrics.registry';
import {
  budgetLimits,
  cacheAdapterName,
  cacheBounds,
  capabilityLifetimes,
  placeLifetime,
  placeNegativeLifetime,
  resilienceSettings,
} from '../../config/caching.config';
import { type Env, readEnv } from '../../config/env.schema';
import { CAPABILITIES, type Capability } from '../../domain/weather/metric';
import {
  RECORDED_SOURCE_PREFIX,
  recordedFixtureCount,
} from './adapters/mock/recorded-sources';
import { type SourceWrappingOptions, wrapPlaceLookup, wrapSource } from './decorators/wrap-source';
import { OutboundBudgetService } from './outbound-budget/outbound-budget.service';
import { guardLimits } from './ports/limits';
import type { PlaceLookupPort } from './ports/place-lookup.port';
import type { SeriesPort } from './ports/series.port';
import { CAPABILITY_PORT_TOKENS, PLACE_LOOKUP_PORT } from './ports/tokens';
import { MetricPlannerService } from './metric-planner.service';
import { SourceRouterService } from './source-router.service';
import {
  type BoundSources,
  IMPLEMENTED_PLACE_LOOKUPS,
  IMPLEMENTED_SOURCES,
  type PlaceLookupRegistry,
  type SourceRegistry,
  bindCapabilitySources,
  bindPlaceLookup,
  selectSourceNames,
} from './source-selection';

const BOUND_SOURCES = Symbol('BoundSources');

/** The cache, budget and metrics settings, read from the environment once. */
const WRAPPING = Symbol('SourceWrapping');

/**
 * One dynamic module per configuration.
 *
 * Nest identifies a dynamic module by the object `forRoot` returned, so two
 * callers asking for the same configuration would otherwise get two modules:
 * two sets of ports, the binding log printed twice, and a root that configured
 * a source silently ignored by the second importer. Every module that needs a
 * weather port imports `WeatherModule.forRoot()`, so this has to hold.
 */
const built = new Map<SourceRegistry, Map<PlaceLookupRegistry, DynamicModule>>();

/**
 * Chooses a source per capability from configuration, reports the choice and
 * refuses to start when a configured source has no implementation. That is a
 * property of the seam rather than of any one source, which is why it lives
 * here and not in the change that adds the recorded sources
 * (design.md, Decision 6 of `01-add-weather-source-contract`).
 */
@Module({})
export class WeatherModule {
  static forRoot(
    registry: SourceRegistry = IMPLEMENTED_SOURCES,
    lookups: PlaceLookupRegistry = IMPLEMENTED_PLACE_LOOKUPS,
  ): DynamicModule {
    const forRegistry = built.get(registry) ?? new Map<PlaceLookupRegistry, DynamicModule>();
    const cached = forRegistry.get(lookups);

    if (cached !== undefined) {
      return cached;
    }

    const metricsProvider: Provider = { provide: METRICS, useFactory: () => new MetricsRegistry() };

    /**
     * One adapter for the whole process. The `null` one is the test default,
     * so a fixture that stopped being read cannot hide behind a hit left by an
     * earlier test; every adapter is guarded, so its own failures are misses
     * rather than failed requests (design.md, Decision 9).
     */
    const cacheProvider: Provider = {
      provide: CACHE,
      inject: [ConfigService, METRICS],
      useFactory: (config: ConfigService<Env, true>, metrics: MetricsRegistry): CachePort => {
        const env = readEnv(config);
        const adapter =
          cacheAdapterName(env) === 'null' ? new NullCache() : new MemoryCache(cacheBounds(env));

        new Logger(WeatherModule.name).log(`cache adapter "${adapter.name}"`);

        return guardCache(adapter, metrics);
      },
    };

    const budgetProvider: Provider = {
      provide: OutboundBudgetService,
      inject: [ConfigService, METRICS],
      useFactory: (config: ConfigService<Env, true>, metrics: MetricsRegistry) =>
        new OutboundBudgetService({ limits: budgetLimits(readEnv(config)), metrics }),
    };

    const wrappingProvider: Provider = {
      provide: WRAPPING,
      inject: [ConfigService, CACHE, METRICS, OutboundBudgetService],
      useFactory: (
        config: ConfigService<Env, true>,
        store: CachePort,
        metrics: MetricsRegistry,
        outbound: OutboundBudgetService,
      ): SourceWrappingOptions => {
        const env = readEnv(config);

        return {
          cache: store,
          lifetimes: capabilityLifetimes(env),
          placeLifetime: placeLifetime(env),
          placeNegativeLifetime: placeNegativeLifetime(env),
          // The horizon every rolling request is widened to: the product
          // ceiling, because no request may ask for more and one entry then
          // answers every shorter question (design.md, Decision 2).
          maxForecastDays: env.FORECAST_DAYS_MAX,
          resilience: { budget: outbound, ...resilienceSettings(env) },
          metrics,
        };
      },
    };

    const bound: Provider = {
      provide: BOUND_SOURCES,
      inject: [ConfigService, WRAPPING],
      useFactory: (
        config: ConfigService<Env, true>,
        wrapped: SourceWrappingOptions,
      ): BoundSources => {
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

        // How many recordings are behind the seam is the one fact that makes a
        // mock run readable in the log (spec `weather-mock-data`, "Mock sources
        // are the development default"). The stronger claim — that nothing
        // reaches the network — is only made when every bound source is a
        // recorded one, so a mixed configuration never reads as offline.
        const recorded = result.ports.filter((port) =>
          port.sourceId.startsWith(RECORDED_SOURCE_PREFIX),
        );

        if (recorded.length > 0) {
          logger.log(
            `${recordedFixtureCount()} recorded fixtures loaded` +
              (recorded.length === result.ports.length
                ? '; no source reaches the network'
                : `; ${result.ports.length - recorded.length} capability(ies) still use a live source`),
          );
        }

        // Every bound port is wrapped by the same factory — cache,
        // deduplication, breaker, retry, budget and metrics are never written
        // into an adapter (`decorators/wrap-source.ts`) — and the limits guard
        // sits outside all of it. A request the source would refuse costs no
        // cache lookup and, more importantly, no unit of the outbound budget:
        // shedding legitimate traffic to pay for a call that was never going
        // to be made is the opposite of what the budget is for.
        return {
          ...result,
          ports: result.ports.map((port) => guardLimits(wrapSource(port, wrapped))),
        };
      },
    };

    const capabilityPorts: Provider[] = CAPABILITIES.map((capability) => ({
      provide: CAPABILITY_PORT_TOKENS[capability],
      inject: [BOUND_SOURCES],
      useFactory: (sources: BoundSources): SeriesPort => portOf(sources, capability),
    }));

    const placeLookup: Provider = {
      provide: PLACE_LOOKUP_PORT,
      inject: [ConfigService, WRAPPING],
      useFactory: (
        config: ConfigService<Env, true>,
        wrapped: SourceWrappingOptions,
      ): PlaceLookupPort => {
        const lookup = bindPlaceLookup(config.get('WEATHER_PROVIDER', { infer: true }), lookups);

        new Logger(WeatherModule.name).log(lookup.log);

        return wrapPlaceLookup(lookup.port, wrapped);
      },
    };

    const router: Provider = {
      provide: SourceRouterService,
      inject: [BOUND_SOURCES],
      useFactory: (sources: BoundSources) => new SourceRouterService(sources.ports),
    };

    const module: DynamicModule = {
      module: WeatherModule,
      providers: [
        metricsProvider,
        cacheProvider,
        budgetProvider,
        wrappingProvider,
        bound,
        ...capabilityPorts,
        placeLookup,
        router,
        MetricPlannerService,
      ],
      exports: [
        ...CAPABILITIES.map((capability) => CAPABILITY_PORT_TOKENS[capability]),
        PLACE_LOOKUP_PORT,
        SourceRouterService,
        MetricPlannerService,
        METRICS,
        CACHE,
        OutboundBudgetService,
      ],
    };

    forRegistry.set(lookups, module);
    built.set(registry, forRegistry);

    return module;
  }
}

function portOf(sources: BoundSources, capability: Capability): SeriesPort {
  const port = sources.ports.find((candidate) => candidate.capability === capability);

  if (port === undefined) {
    throw new Error(`No source was bound to the ${capability} capability.`);
  }

  return port;
}
