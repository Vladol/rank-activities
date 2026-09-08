import { Inject, Injectable } from '@nestjs/common';

import type { ProbeOutcome } from '../../domain/location/location-profile';
import type { Coordinates } from '../../domain/shared/coordinates';
import { type WeatherSeries, hasMetric, isAllAbsent } from '../../domain/weather/weather-series';
import type { SeriesPort } from '../weather/ports/series.port';
import { MARINE_PORT } from '../weather/ports/tokens';

/** One variable over one day: about 700 bytes (stage-three.md, section 5.1). */
const PROBE_METRIC = 'wave_height';

/**
 * Asks the marine source whether it has anything to say about a point.
 *
 * The probe answers one question and does not interpret it: an all-null grid
 * is `uncovered`, which is evidence, not a conclusion. Turning two of those on
 * different days into `NO_COASTLINE_NEARBY` is the profile's job
 * (design.md, Decision 1).
 */
@Injectable()
export class MarineProbeService {
  constructor(@Inject(MARINE_PORT) private readonly marine: SeriesPort<'marine'>) {}

  async probe(location: Coordinates, timezone: 'auto' | string): Promise<ProbeOutcome> {
    const answered = await this.marine.fetch({
      capability: 'marine',
      location,
      metrics: [PROBE_METRIC],
      horizon: { kind: 'forecast', forecastDays: 1 },
      timezone,
    });

    // A fault is a fault. Reading it as "no waves here" is exactly the
    // confident falsehood the two-phase probe exists to prevent.
    return answered.ok ? { kind: reading(answered.value) } : { kind: 'failed' };
  }
}

/**
 * `uncovered` requires the metric to be *present and empty* in every channel
 * that carries it. A metric the response omitted altogether says nothing about
 * the place — it is a different response shape, and `isAllAbsent` answers false
 * for it by design (`weather-series.ts`).
 */
function reading(series: WeatherSeries): 'covered' | 'uncovered' | 'failed' {
  const channels = [series.hourly, series.daily].filter((one) => hasMetric(one, PROBE_METRIC));

  if (channels.length === 0) {
    return 'failed';
  }

  return channels.every((one) => isAllAbsent(one, PROBE_METRIC)) ? 'uncovered' : 'covered';
}
