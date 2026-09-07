import { describe, expect, it } from 'vitest';

import { ok } from '../../../domain/shared/result';
import { channel, createSeries } from '../../../domain/weather/weather-series';
import type { Horizon, SeriesRequest, SourceLimits } from './contracts';
import { guardLimits, validateHorizon } from './limits';
import type { SeriesPort } from './series.port';

const LIMITS: SourceLimits = { maxForecastDays: 16, maxPastDays: 92, earliestDate: '1940-01-01' };

function request(horizon: Horizon): SeriesRequest {
  return {
    capability: 'forecast',
    location: { latitude: 38.72, longitude: -9.15 },
    metrics: ['temperature_2m'],
    horizon,
    timezone: 'auto',
  };
}

/** A port that records every call, so "no outbound call" is an assertion rather than a hope. */
function countingPort(): SeriesPort & { calls: SeriesRequest[] } {
  const calls: SeriesRequest[] = [];

  return {
    calls,
    sourceId: 'counting',
    capability: 'forecast',
    limits: LIMITS,
    supports: () => true,
    fetch(incoming) {
      calls.push(incoming);

      return Promise.resolve(
        ok(
          createSeries({
            hourly: channel(['2026-09-07T00:00'], { temperature_2m: [18.4] }),
            provenance: [
              {
                sourceId: 'counting',
                capability: 'forecast',
                gridPoint: { latitude: 38.75, longitude: -9.125, elevationMetres: 26 },
                fetchedAt: '2026-09-07T10:00:00Z',
                stale: false,
                metrics: ['temperature_2m'],
              },
            ],
          }),
        ),
      );
    },
  };
}

describe('validateHorizon', () => {
  it('accepts a horizon inside the declared maximum', () => {
    expect(validateHorizon(request({ kind: 'forecast', forecastDays: 7 }), LIMITS).ok).toBe(true);
    expect(validateHorizon(request({ kind: 'forecast', forecastDays: 16 }), LIMITS).ok).toBe(true);
  });

  it('rejects a forecast horizon beyond it with our own code, not the source reason', () => {
    // stage-three.md 2.3: on forecast_days=30 the source answers 400 with
    // "Allowed range 0 to 16. Given 16." — a reason that is factually wrong.
    const result = validateHorizon(request({ kind: 'forecast', forecastDays: 30 }), LIMITS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('HORIZON_TOO_LARGE');
      expect(result.error.context).toEqual({ requested: 30, allowed: 16, unit: 'forecastDays' });
    }
  });

  it('rejects too much history', () => {
    const result = validateHorizon(
      request({ kind: 'forecast', forecastDays: 7, pastDays: 120 }),
      LIMITS,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.context).toEqual({ requested: 120, allowed: 92, unit: 'pastDays' });
    }
  });

  it('rejects a window that starts before the source has data', () => {
    const result = validateHorizon(
      request({ kind: 'window', startDate: '1900-01-01', endDate: '1900-01-31' }),
      LIMITS,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('HORIZON_TOO_LARGE');
    }
  });

  it('accepts a window inside the source record', () => {
    expect(
      validateHorizon(
        request({ kind: 'window', startDate: '2026-01-01', endDate: '2026-01-31' }),
        LIMITS,
      ).ok,
    ).toBe(true);
  });

  it('is returned rather than thrown', () => {
    expect(() => validateHorizon(request({ kind: 'forecast', forecastDays: 99 }), LIMITS)).not.toThrow();
  });

  it('rejects a window that ends before it starts, whatever the source declares', () => {
    const result = validateHorizon(
      request({ kind: 'window', startDate: '2026-01-31', endDate: '2026-01-01' }),
      { maxForecastDays: 16, maxPastDays: 92 },
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('HORIZON_TOO_LARGE');
  });

  it('accepts a single-day window', () => {
    expect(
      validateHorizon(request({ kind: 'window', startDate: '2026-01-01', endDate: '2026-01-01' }), {
        maxForecastDays: 16,
        maxPastDays: 92,
      }).ok,
    ).toBe(true);
  });
});

describe('guardLimits', () => {
  it('makes no call at all when the horizon is too long', async () => {
    const port = countingPort();
    const guarded = guardLimits(port);

    const result = await guarded.fetch(request({ kind: 'forecast', forecastDays: 30 }));

    expect(port.calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('HORIZON_TOO_LARGE');
  });

  it('passes an acceptable request through untouched', async () => {
    const port = countingPort();
    const incoming = request({ kind: 'forecast', forecastDays: 7 });

    const result = await guardLimits(port).fetch(incoming);

    expect(port.calls).toEqual([incoming]);
    expect(result.ok).toBe(true);
  });

  it('keeps the identity of a port whose fields are prototype getters', async () => {
    // A Nest adapter is a class; spreading it would drop every accessor.
    class ClassPort implements SeriesPort {
      get sourceId(): string {
        return 'class-based';
      }
      get capability(): 'forecast' {
        return 'forecast';
      }
      get limits(): SourceLimits {
        return LIMITS;
      }
      supports(): boolean {
        return true;
      }
      fetch(): ReturnType<SeriesPort['fetch']> {
        return countingPort().fetch(request({ kind: 'forecast', forecastDays: 1 }));
      }
    }

    const guarded = guardLimits(new ClassPort());

    expect(guarded.sourceId).toBe('class-based');
    expect(guarded.capability).toBe('forecast');
    expect(guarded.limits).toEqual(LIMITS);
    expect((await guarded.fetch(request({ kind: 'forecast', forecastDays: 30 }))).ok).toBe(false);
  });

  it('keeps the identity of the port it wraps', () => {
    const guarded = guardLimits(countingPort());

    expect(guarded.sourceId).toBe('counting');
    expect(guarded.capability).toBe('forecast');
    expect(guarded.supports('temperature_2m')).toBe(true);
  });
});
