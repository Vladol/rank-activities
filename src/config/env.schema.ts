import { z } from 'zod';

/**
 * Environment variable schema, validated at startup: a malformed env kills the
 * process immediately rather than surfacing `undefined` at runtime
 * (docs/development-flow/flow.md, section 6.1).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),

  /** Weather source. `mock` runs on fixtures, with no network access. */
  WEATHER_PROVIDER: z.enum(['open-meteo', 'mock', 'record']).default('mock'),

  /** Default forecast horizon: past 7 days the ranking degrades into noise. */
  FORECAST_DAYS_DEFAULT: z.coerce.number().int().min(1).max(16).default(7),

  /** Forecast cache TTL in seconds, aligned with the Open-Meteo refresh rate (section 2.2). */
  WEATHER_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  DATABASE_URL: z.url().optional(),
  REDIS_URL: z.url().optional(),
});

export type Env = z.infer<typeof envSchema>;

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
