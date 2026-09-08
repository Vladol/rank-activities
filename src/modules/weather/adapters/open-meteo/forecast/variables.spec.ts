import { describe, expect, it } from 'vitest';

import { metric } from '../../../../../domain/weather/metric';
import { MAPPABLE_METRICS } from '../open-meteo.mapper';
import { forecastVariables } from './variables';

describe('the forecast variable map', () => {
  it('names the vendor variable for an hourly metric', () => {
    const asked = forecastVariables(['temperature_2m']);

    expect(asked.ok).toBe(true);

    if (!asked.ok) {
      return;
    }

    expect(asked.value).toEqual({ hourly: ['temperature_2m'], daily: [] });
  });

  it('puts a daily-only metric on the daily axis', () => {
    const asked = forecastVariables(['daylight_duration']);

    expect(asked.ok).toBe(true);

    if (!asked.ok) {
      return;
    }

    expect(asked.value).toEqual({ hourly: [], daily: ['daylight_duration'] });
  });

  it('asks for a two-axis metric under the name each axis uses', () => {
    const asked = forecastVariables(['wind_speed_10m']);

    expect(asked.ok).toBe(true);

    if (!asked.ok) {
      return;
    }

    // The daily channel names an aggregate where the hourly one names the
    // quantity: one metric, two vendor spellings.
    expect(asked.value).toEqual({
      hourly: ['wind_speed_10m'],
      daily: ['wind_speed_10m_max'],
    });
  });

  it('orders the variables by the dictionary, not by the caller', () => {
    const asked = forecastVariables(['wind_speed_10m', 'temperature_2m', 'snowfall']);

    expect(asked.ok).toBe(true);

    if (!asked.ok) {
      return;
    }

    // A stable order makes the request URL a stable cache key in `07`.
    expect(asked.value.hourly).toEqual(['snowfall', 'temperature_2m', 'wind_speed_10m']);
  });

  it('refuses a metric another capability serves', () => {
    const asked = forecastVariables(['wave_height']);

    expect(asked.ok).toBe(false);

    if (asked.ok) {
      return;
    }

    expect(asked.error.code).toBe('UNSUPPORTED_METRIC');
    expect(asked.error.context?.metric).toBe('wave_height');
  });

  it('refuses a metric no series slot can carry', () => {
    // A slot is a number or a hole; sunrise is an ISO string.
    const asked = forecastVariables(['sunrise']);

    expect(asked.ok).toBe(false);
  });

  it('names a vendor variable for every forecast metric the mapper can read back', () => {
    const forecastMetrics = MAPPABLE_METRICS.filter(
      (code) => metric(code).capability === 'forecast',
    );

    for (const code of forecastMetrics) {
      const asked = forecastVariables([code]);

      expect(asked.ok, `no vendor variable is declared for ${code}`).toBe(true);
    }
  });
});
