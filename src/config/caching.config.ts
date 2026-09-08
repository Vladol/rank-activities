import type { Lifetime } from '../common/cache/freshness';
import type { Capability } from '../domain/weather/metric';
import type { BudgetLimits } from '../modules/weather/outbound-budget/outbound-budget.service';
import type { Env } from './env.schema';

/**
 * The environment read once, into the shapes the caching and resilience layer
 * actually takes. Nothing downstream touches `process.env` or an env key by
 * name, so a renamed variable fails here rather than as a silent default in
 * the middle of a decorator.
 */

export type CacheAdapterName = 'memory' | 'null';

export interface CacheBounds {
  readonly maxEntries: number;
  readonly maxBytes: number;
}

/**
 * `null` under `test` unless something says otherwise: a fixture that stopped
 * being read must not hide behind a hit left by an earlier test
 * (stage-four.md, section 5.4).
 */
export function cacheAdapterName(env: Env): CacheAdapterName {
  return env.CACHE_ADAPTER ?? (env.NODE_ENV === 'test' ? 'null' : 'memory');
}

export function cacheBounds(env: Env): CacheBounds {
  return { maxEntries: env.CACHE_MAX_ENTRIES, maxBytes: env.CACHE_MAX_BYTES };
}

export function capabilityLifetimes(env: Env): Readonly<Record<Capability, Lifetime>> {
  return {
    forecast: {
      ttlSeconds: env.WEATHER_CACHE_TTL_SECONDS,
      maxStaleSeconds: env.WEATHER_CACHE_MAX_STALE_SECONDS,
    },
    marine: {
      ttlSeconds: env.WEATHER_MARINE_CACHE_TTL_SECONDS,
      maxStaleSeconds: env.WEATHER_MARINE_CACHE_MAX_STALE_SECONDS,
    },
    archive: {
      ttlSeconds: env.WEATHER_ARCHIVE_CACHE_TTL_SECONDS,
      maxStaleSeconds: env.WEATHER_ARCHIVE_CACHE_MAX_STALE_SECONDS,
    },
  };
}

export function placeLifetime(env: Env): Lifetime {
  return {
    ttlSeconds: env.GEOCODING_CACHE_TTL_SECONDS,
    maxStaleSeconds: env.GEOCODING_CACHE_TTL_SECONDS,
  };
}

export function placeNegativeLifetime(env: Env): Lifetime {
  return {
    ttlSeconds: env.GEOCODING_NEGATIVE_TTL_SECONDS,
    maxStaleSeconds: env.GEOCODING_NEGATIVE_TTL_SECONDS,
  };
}

export function budgetLimits(env: Env): BudgetLimits {
  return {
    minute: env.OUTBOUND_BUDGET_PER_MINUTE,
    hour: env.OUTBOUND_BUDGET_PER_HOUR,
    day: env.OUTBOUND_BUDGET_PER_DAY,
  };
}

export interface ResilienceSettings {
  readonly maxAttempts: number;
  readonly backoff: { readonly initialDelayMs: number; readonly maxDelayMs: number };
  readonly timeoutMs: number;
  readonly breaker: { readonly consecutiveFailures: number; readonly halfOpenAfterMs: number };
  readonly concurrency: { readonly limit: number; readonly queue: number };
}

export function resilienceSettings(env: Env): ResilienceSettings {
  return {
    maxAttempts: env.OUTBOUND_MAX_ATTEMPTS,
    backoff: {
      initialDelayMs: env.OUTBOUND_RETRY_INITIAL_DELAY_MS,
      maxDelayMs: env.OUTBOUND_RETRY_MAX_DELAY_MS,
    },
    timeoutMs: env.OUTBOUND_TIMEOUT_MS,
    breaker: {
      consecutiveFailures: env.BREAKER_CONSECUTIVE_FAILURES,
      halfOpenAfterMs: env.BREAKER_HALF_OPEN_AFTER_MS,
    },
    concurrency: { limit: env.OUTBOUND_CONCURRENCY, queue: env.OUTBOUND_CONCURRENCY_QUEUE },
  };
}
