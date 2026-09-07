import { describe, expect, it } from 'vitest';

import { validateEnv } from './env.schema';

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

  it('rejects a malformed DATABASE_URL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });
});
