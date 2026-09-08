import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ENV_KEYS, validateEnv } from './env.schema';

describe('validateEnv', () => {
  it('applies defaults when nothing is set', () => {
    const env = validateEnv({});

    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.WEATHER_PROVIDER).toBe('mock');
    expect(env.FORECAST_DAYS_DEFAULT).toBe(7);
  });

  it('coerces numeric strings, since process.env only holds strings', () => {
    expect(validateEnv({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('fails fast on an out-of-range port instead of starting', () => {
    expect(() => validateEnv({ PORT: '70000' })).toThrow(/PORT/);
  });

  it('fails fast on an unknown weather provider', () => {
    expect(() => validateEnv({ WEATHER_PROVIDER: 'accuweather' })).toThrow(
      /WEATHER_PROVIDER/,
    );
  });

  it('leaves the per-capability source overrides unset by default', () => {
    const env = validateEnv({});

    expect(env.WEATHER_FORECAST_SOURCE).toBeUndefined();
    expect(env.WEATHER_MARINE_SOURCE).toBeUndefined();
    expect(env.WEATHER_ARCHIVE_SOURCE).toBeUndefined();
  });

  it('accepts a source override for one capability', () => {
    // Forecast from one vendor, marine from another, without a code change.
    expect(validateEnv({ WEATHER_MARINE_SOURCE: 'open-meteo' }).WEATHER_MARINE_SOURCE).toBe(
      'open-meteo',
    );
  });

  it('fails fast on an unknown source override', () => {
    expect(() => validateEnv({ WEATHER_ARCHIVE_SOURCE: 'accuweather' })).toThrow(
      /WEATHER_ARCHIVE_SOURCE/,
    );
  });

  it('rejects a malformed DATABASE_URL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });

  it('documents every variable it declares in .env.example', () => {
    // "A new variable means editing the schema and .env.example" (CLAUDE.md).
    // A rule that is only written down is a rule that is only sometimes
    // followed; this is the same rule, checked.
    const example = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
    const undocumented = ENV_KEYS.filter(
      (key) => !new RegExp(`^#?\\s*${key}=`, 'mu').test(example),
    );

    expect(undocumented).toEqual([]);
  });
});
