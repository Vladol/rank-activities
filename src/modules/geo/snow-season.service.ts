import { Inject, Injectable } from '@nestjs/common';

import {
  COLD_SEASON_WINDOWS,
  type ColdSeasonWindow,
  heuristicSeasonLikely,
} from '../../domain/location/cold-season';
import type { ColdSeasonSample, SnowSeasonEvidence } from '../../domain/location/location-profile';
import type { ResolvedLocation } from '../../domain/location/resolved-location';
import { type WeatherSeries, isAllAbsent, valuesOf } from '../../domain/weather/weather-series';
import type { SeriesPort } from '../weather/ports/series.port';
import { ARCHIVE_PORT } from '../weather/ports/tokens';

/** Daily totals: one number per day, about 1.2 KB for a month (stage-three.md, 5.2). */
const SNOW_METRIC = 'snowfall';

/**
 * Gathers what the climate archive says about snow at a location.
 *
 * It gathers; it does not judge. Whether the centimetres it found clear the
 * threshold a declaration names is `snowSeasonVerdict`'s question, and keeping
 * the two apart is what lets a threshold change re-judge stored evidence
 * without fetching it again (design.md, Decision 4).
 */
@Injectable()
export class SnowSeasonService {
  constructor(@Inject(ARCHIVE_PORT) private readonly archive: SeriesPort<'archive'>) {}

  async evidence(location: ResolvedLocation, today: string): Promise<SnowSeasonEvidence | undefined> {
    const samples: ColdSeasonSample[] = [];

    for (const window of COLD_SEASON_WINDOWS) {
      const sample = await this.read(location, window);

      if (sample !== undefined) {
        samples.push(sample);
      }
    }

    if (samples.length > 0) {
      return {
        basis: 'archive',
        coldSeasonSnowfallCm: Math.max(...samples.map((sample) => sample.snowfallCm)),
        samples,
      };
    }

    // Nothing was read. The fallback is declared, marked, and unavailable
    // without an elevation — raw coordinates carry none, and inventing one
    // would be the silent degradation the spec forbids.
    return location.elevationMetres === null
      ? undefined
      : {
          basis: 'elevation',
          seasonLikely: heuristicSeasonLikely(
            location.elevationMetres,
            location.coordinates.latitude,
          ),
          elevationMetres: location.elevationMetres,
          latitude: location.coordinates.latitude,
          attemptedOn: today,
        };
  }

  /**
   * One window. A window the source cannot answer is dropped rather than
   * failing the whole reading: a place with only one of the two months on
   * record is still decided by that month.
   */
  private async read(
    location: ResolvedLocation,
    window: ColdSeasonWindow,
  ): Promise<ColdSeasonSample | undefined> {
    const answered = await this.archive.fetch({
      capability: 'archive',
      location: location.coordinates,
      metrics: [SNOW_METRIC],
      horizon: { kind: 'window', ...window },
      timezone: location.timezone,
    });

    if (!answered.ok) {
      return undefined;
    }

    const total = totalSnowfall(answered.value);

    return total === undefined ? undefined : { ...window, snowfallCm: total };
  }
}

/**
 * The daily totals summed. A single empty day counts as nothing, but a month
 * that is *entirely* empty is not a month without snow: the archive answers a
 * point it does not cover exactly as the marine endpoint does, with a complete
 * grid and no value in it. Summing that to zero would settle "no snow season"
 * on what may be an outage — the same confident falsehood the two-phase probe
 * exists to prevent. A metric the response omitted altogether is no reading for
 * the same reason.
 */
function totalSnowfall(series: WeatherSeries): number | undefined {
  const daily = valuesOf(series.daily, SNOW_METRIC);

  if (daily === undefined || isAllAbsent(series.daily, SNOW_METRIC)) {
    return undefined;
  }

  const total = daily.reduce<number>((sum, value) => sum + (value ?? 0), 0);

  // ERA5 reports centimetres to one decimal; summing 31 of them in binary
  // floating point ends in 96.50000000000001 without this.
  return Math.round(total * 100) / 100;
}
