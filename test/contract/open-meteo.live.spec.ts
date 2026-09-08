import { describe, expect, it } from 'vitest';

import type { Capability, MetricCode } from '../../src/domain/weather/metric';
import { openMeteoPlaceLookup, openMeteoSeriesSource } from '../../src/modules/weather/adapters/open-meteo/live-sources';
import type { Horizon, SeriesRequest } from '../../src/modules/weather/ports/contracts';
import { divergence } from './divergence';

/**
 * The one test in this repository that reaches the network.
 *
 * It exists because a fixture proves something about the live API only for as
 * long as the live API still answers that way, and nothing else in the suite
 * can notice that it stopped. It asks through the real source, so what
 * validates the response is the very schema the adapter uses in production —
 * not a looser one written for the occasion, which would pass exactly when the
 * adapter would fail.
 *
 * It is excluded from `npm test` and `npm run test:e2e` and runs on a
 * schedule. Running it with everything else would make every build depend on a
 * third party's uptime and spend the daily quota on pull requests, and FR-23 —
 * development and the full suite without a network — would become false. A red
 * scheduled run is a task; a red build is a blocked team
 * (design.md, Decision 7).
 *
 *   npm run test:contract
 *
 * Four requests, one per seam. Three limits apply and the daily one is twelve
 * times stricter than the hourly, so this run is deliberately the smallest
 * thing that can still notice a change.
 */
const LISBON = { latitude: 38.72, longitude: -9.15 };

const SHORT: Horizon = { kind: 'forecast', forecastDays: 2 };

/** A window well inside the archive's five-day lag behind reality. */
const PAST: Horizon = { kind: 'window', startDate: '2025-01-08', endDate: '2025-01-09' };

async function askLive(
  capability: Capability,
  metrics: readonly MetricCode[],
  horizon: Horizon,
): Promise<void> {
  const source = openMeteoSeriesSource(capability);
  const request: SeriesRequest = {
    capability,
    location: LISBON,
    metrics,
    horizon,
    timezone: 'auto',
  };

  try {
    const answered = await source.fetch(request);

    expect(
      answered.ok,
      answered.ok
        ? ''
        : divergence(
            String(answered.error.context?.variable ?? answered.error.context?.firstPath ?? capability),
            `${answered.error.code}: ${answered.error.message}`,
          ),
    ).toBe(true);

    if (!answered.ok) {
      return;
    }

    // Every metric asked for came back, in canonical units, on a real axis.
    expect(answered.value.hourly.time.length, divergence(capability, 'the hourly axis is empty')).
      toBeGreaterThan(0);
  } finally {
    await source.close();
  }
}

describe('the live Open-Meteo API still answers what the adapter reads', () => {
  it('serves a forecast the adapter accepts', async () => {
    await askLive('forecast', ['temperature_2m', 'wind_speed_10m', 'precipitation'], SHORT);
  }, 30_000);

  it('serves marine data the adapter accepts', async () => {
    await askLive('marine', ['wave_height', 'wave_period'], SHORT);
  }, 30_000);

  it('serves an archive window the adapter accepts', async () => {
    await askLive('archive', ['temperature_2m'], PAST);
  }, 30_000);

  it('serves a place lookup the adapter accepts', async () => {
    const lookup = openMeteoPlaceLookup();

    try {
      const found = await lookup.lookup({ name: 'Lisbon', count: 3 });

      expect(
        found.ok,
        found.ok ? '' : divergence('the lookup envelope', `${found.error.code}: ${found.error.message}`),
      ).toBe(true);
      expect(found.ok && found.value.length, divergence('results', 'Lisbon matched nothing')).
        toBeGreaterThan(0);
    } finally {
      await lookup.close();
    }
  }, 30_000);
});
