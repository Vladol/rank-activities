import { describe, expect, it } from 'vitest';

import { validateEnv } from './env.schema';
import {
  budgetLimits,
  cacheAdapterName,
  capabilityLifetimes,
  placeNegativeLifetime,
  resilienceSettings,
} from './caching.config';

const env = (raw: Record<string, string> = {}) => validateEnv({ ...raw });

describe('the caching configuration', () => {
  it('binds the null adapter under test and the memory one elsewhere', () => {
    expect(cacheAdapterName(env({ NODE_ENV: 'test' }))).toBe('null');
    expect(cacheAdapterName(env({ NODE_ENV: 'development' }))).toBe('memory');
    expect(cacheAdapterName(env({ NODE_ENV: 'test', CACHE_ADAPTER: 'memory' }))).toBe('memory');
  });

  it('reads a lifetime per capability from the environment', () => {
    const lifetimes = capabilityLifetimes(
      env({ WEATHER_CACHE_TTL_SECONDS: '900', WEATHER_ARCHIVE_CACHE_TTL_SECONDS: '43200' }),
    );

    // Not a constant anywhere: the same code serves an hour, a quarter of one
    // and half a day because the environment said so.
    expect(lifetimes.forecast.ttlSeconds).toBe(900);
    expect(lifetimes.marine.ttlSeconds).toBe(3_600);
    expect(lifetimes.archive.ttlSeconds).toBe(43_200);
  });

  it('refuses a staleness limit that ends before freshness does', () => {
    expect(() =>
      env({ WEATHER_CACHE_TTL_SECONDS: '3600', WEATHER_CACHE_MAX_STALE_SECONDS: '600' }),
    ).toThrow(/stops being fresh/);
  });

  it('takes the budget from the source’s published windows', () => {
    expect(budgetLimits(env())).toEqual({ minute: 600, hour: 5_000, day: 10_000 });
    expect(budgetLimits(env({ OUTBOUND_BUDGET_PER_DAY: '2500' })).day).toBe(2_500);
  });

  it('keeps the negative lifetime short by default', () => {
    // Long enough to blunt an enumeration, short enough not to hold a
    // corrected typo (stage-six.md, section 9.3).
    expect(placeNegativeLifetime(env()).ttlSeconds).toBe(300);
  });

  it('reads the retry, breaker and concurrency settings', () => {
    const settings = resilienceSettings(env({ OUTBOUND_MAX_ATTEMPTS: '2' }));

    expect(settings.maxAttempts).toBe(2);
    expect(settings.timeoutMs).toBe(2_000);
    expect(settings.breaker.consecutiveFailures).toBe(5);
    expect(settings.concurrency.limit).toBe(8);
  });
});
