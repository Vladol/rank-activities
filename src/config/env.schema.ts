import { z } from 'zod';

/**
 * Environment variable schema, validated at startup: a malformed env kills the
 * process immediately rather than surfacing `undefined` at runtime
 * (docs/development-flow/flow.md, section 6.1).
 */
const weatherSource = z.enum(['open-meteo', 'mock', 'record']);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),

  /**
   * Default weather source for every capability. `mock` runs on fixtures, with
   * no network access. A source that is named here but not implemented refuses
   * the start; nothing is ever substituted for it.
   */
  WEATHER_PROVIDER: weatherSource.default('mock'),

  /**
   * Per-capability overrides. Forecast, marine and archive are separate seams,
   * so each may be pointed at a different vendor without a code change
   * (`weather-sources`, "The active source is chosen explicitly").
   */
  WEATHER_FORECAST_SOURCE: weatherSource.optional(),
  WEATHER_MARINE_SOURCE: weatherSource.optional(),
  WEATHER_ARCHIVE_SOURCE: weatherSource.optional(),

  /**
   * Whether the recording mode may write over a fixture that already exists.
   * Recording is already an explicit choice; replacing evidence is a second
   * one, because a fixture is the record of what the API once answered
   * (spec `open-meteo-source`, "An existing fixture is not overwritten
   * silently").
   */
  WEATHER_RECORD_REPLACE: z.enum(['true', 'false']).default('false'),

  /** Default forecast horizon: past 7 days the ranking degrades into noise. */
  FORECAST_DAYS_DEFAULT: z.coerce.number().int().min(1).max(16).default(7),

  /**
   * The longest horizon a ranking request may ask for (FR-04 of
   * docs/development-flow/stage-two.md). It is a product ceiling rather than
   * the source's: an over-long request is refused here, before anything leaves
   * the process, because the source's own rejection has been recorded saying
   * something factually wrong (stage-three.md, section 2.3).
   */
  FORECAST_DAYS_MAX: z.coerce.number().int().min(1).max(16).default(7),

  /**
   * Which cache adapter is bound. Unset means `memory` everywhere except under
   * `test`, where it means `null`: a fixture that stopped being read must not
   * hide behind a hit left by the previous test
   * (stage-four.md, section 5.4).
   */
  CACHE_ADAPTER: z.enum(['memory', 'null']).optional(),

  /** Entries the in-memory store may hold, and the bytes it estimates them at. */
  CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(5000),
  CACHE_MAX_BYTES: z.coerce.number().int().positive().default(33_554_432),

  /**
   * Per-capability lifetimes, in seconds. Freshness ends on the boundary of
   * the interval rather than an interval after the question, so these describe
   * the source's own refresh cadence rather than our patience
   * (spec `source-caching`, "A lifetime ends on the boundary").
   */
  WEATHER_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  WEATHER_MARINE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  WEATHER_ARCHIVE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),

  /**
   * How old data may be and still be served, marked stale, when it cannot be
   * refreshed. Past it there is no answer to give: a forecast from yesterday
   * is worthless, while an archive that never changes is not.
   */
  WEATHER_CACHE_MAX_STALE_SECONDS: z.coerce.number().int().positive().default(10_800),
  WEATHER_MARINE_CACHE_MAX_STALE_SECONDS: z.coerce.number().int().positive().default(10_800),
  WEATHER_ARCHIVE_CACHE_MAX_STALE_SECONDS: z.coerce.number().int().positive().default(604_800),

  /** How long a resolved place name is reused, and how long an unresolved one is remembered. */
  GEOCODING_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  GEOCODING_NEGATIVE_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  /**
   * The outbound budget, one limit per window of the source's published table
   * (stage-three.md, section 7.4). The unit is an attempt, retries included.
   */
  OUTBOUND_BUDGET_PER_MINUTE: z.coerce.number().int().positive().default(600),
  OUTBOUND_BUDGET_PER_HOUR: z.coerce.number().int().positive().default(5000),
  OUTBOUND_BUDGET_PER_DAY: z.coerce.number().int().positive().default(10_000),

  /** How many calls may be out at once, and how many may wait for a slot. */
  OUTBOUND_CONCURRENCY: z.coerce.number().int().positive().default(8),
  OUTBOUND_CONCURRENCY_QUEUE: z.coerce.number().int().nonnegative().default(8),

  /** Per attempt, never per chain. Live p95 is 136 ms; two seconds is generous. */
  OUTBOUND_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),

  /** Attempts including the first, and the growth of the jittered delay between them. */
  OUTBOUND_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  OUTBOUND_RETRY_INITIAL_DELAY_MS: z.coerce.number().int().nonnegative().default(150),
  OUTBOUND_RETRY_MAX_DELAY_MS: z.coerce.number().int().nonnegative().default(5000),

  /**
   * Consecutive source faults that cut one source-and-capability pair off, and
   * how long before it is tried again.
   */
  BREAKER_CONSECUTIVE_FAILURES: z.coerce.number().int().positive().default(5),
  BREAKER_HALF_OPEN_AFTER_MS: z.coerce.number().int().positive().default(30_000),

  /**
   * Where the rules are read from. `files` is the default and the source of
   * truth (ADR 0007): the service starts, validates and ranks with no store at
   * all. `store` reads the published versions instead, which is what a
   * deployment chooses when it wants a newly published version picked up
   * without a restart; it requires DATABASE_URL.
   */
  ACTIVITY_CATALOGUE_SOURCE: z.enum(['files', 'store']).default('files'),

  /**
   * How long the in-process copy of the rules is trusted before the store is
   * asked whether a newer version exists. Read only when the catalogue source
   * is `store`. Rules change about once a month, so this is a cadence rather
   * than a consistency mechanism.
   */
  ACTIVITY_CATALOGUE_REFRESH_SECONDS: z.coerce.number().int().positive().default(300),

  /**
   * How long a computation record may wait in memory before a flush is
   * attempted, and how many may wait at once. Past the count the oldest are
   * dropped and counted: a buffer without a bound turns a store outage into an
   * out-of-memory kill, which costs the answers the buffer exists to protect.
   */
  AUDIT_FLUSH_INTERVAL_SECONDS: z.coerce.number().int().positive().default(5),
  AUDIT_BUFFER_MAX_RECORDS: z.coerce.number().int().positive().default(1000),

  DATABASE_URL: z.url().optional(),
  REDIS_URL: z.url().optional(),
})
  // A default outside the range would make every horizon-less request fail,
  // and it would fail at the first request rather than at the start.
  .refine((env) => env.FORECAST_DAYS_DEFAULT <= env.FORECAST_DAYS_MAX, {
    path: ['FORECAST_DAYS_DEFAULT'],
    message: 'the default horizon cannot exceed FORECAST_DAYS_MAX',
  })
  // Staleness that does not outlast freshness makes the stale path
  // unreachable: an entry would expire at the moment it stopped being fresh,
  // and "stale data is served as an answer" could never happen.
  .refine((env) => env.WEATHER_CACHE_MAX_STALE_SECONDS >= env.WEATHER_CACHE_TTL_SECONDS, {
    path: ['WEATHER_CACHE_MAX_STALE_SECONDS'],
    message: 'data cannot stop being servable before it stops being fresh',
  })
  .refine(
    (env) => env.WEATHER_MARINE_CACHE_MAX_STALE_SECONDS >= env.WEATHER_MARINE_CACHE_TTL_SECONDS,
    {
      path: ['WEATHER_MARINE_CACHE_MAX_STALE_SECONDS'],
      message: 'data cannot stop being servable before it stops being fresh',
    },
  )
  .refine(
    (env) => env.WEATHER_ARCHIVE_CACHE_MAX_STALE_SECONDS >= env.WEATHER_ARCHIVE_CACHE_TTL_SECONDS,
    {
      path: ['WEATHER_ARCHIVE_CACHE_MAX_STALE_SECONDS'],
      message: 'data cannot stop being servable before it stops being fresh',
    },
  )
  // Reading the rules from a store that was never configured is not a
  // degradation to recover from at runtime: it is a deploy that cannot work,
  // and it is cheaper to say so at startup.
  .refine((env) => env.ACTIVITY_CATALOGUE_SOURCE === 'files' || env.DATABASE_URL !== undefined, {
    path: ['ACTIVITY_CATALOGUE_SOURCE'],
    message: 'reading the rules from the store needs DATABASE_URL',
  });

export type Env = z.infer<typeof envSchema>;

/** Every variable the schema declares, so nothing has to enumerate them by hand. */
export const ENV_KEYS = Object.keys(envSchema.shape) as (keyof Env)[];

/**
 * The validated environment as one object, read back out of Nest's config.
 *
 * A factory that needs twenty settings would otherwise call `get` twenty times
 * and misspell one of them silently; here a renamed variable stops being a
 * value and starts being `undefined` in exactly one place.
 */
export function readEnv(config: {
  get(key: string, options: { infer: true }): unknown;
}): Env {
  return Object.fromEntries(
    ENV_KEYS.map((key) => [key, config.get(key, { infer: true })]),
  ) as Env;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return parsed.data;
}
