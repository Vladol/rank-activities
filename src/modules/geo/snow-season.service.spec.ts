import { describe, expect, it } from 'vitest';

import { FailingSeriesPort, recordingArchivePort } from '../../../test/support/fake-series-port';
import type { ResolvedLocation } from '../../domain/location/resolved-location';
import { domainError } from '../../domain/shared/domain-error';
import { err, ok } from '../../domain/shared/result';
import { channel } from '../../domain/weather/weather-series';
import type { SeriesPort } from '../weather/ports/series.port';
import { locationId } from '../../domain/shared/coordinates';
import { SnowSeasonService } from './snow-season.service';

function at(
  latitude: number,
  longitude: number,
  elevationMetres: number | null,
  timezone = 'auto',
): ResolvedLocation {
  return {
    id: locationId({ latitude, longitude }),
    coordinates: { latitude, longitude },
    timezone,
    elevationMetres,
    place: null,
  };
}

const CHAMONIX = at(45.9237, 6.8694, 1041, 'Europe/Paris');
const LISBON = at(38.7167, -9.1333, 48, 'Europe/Lisbon');
const TROMSO = at(69.6489, 18.9551, 14, 'Europe/Oslo');
const QUITO = at(-0.1807, -78.4678, 2920, 'America/Guayaquil');
const PERISHER = at(-36.405, 148.4085, 1743, 'Australia/Sydney');

const TODAY = '2026-09-08';

function service(port = recordingArchivePort()) {
  return { snow: new SnowSeasonService(port), port };
}

/** Every window answers 200 with a complete grid and no value in it. */
function allNullArchive(port: SeriesPort<'archive'>): SeriesPort<'archive'> {
  return {
    ...port,
    fetch: async (request) => {
      const answered = await port.fetch(request);

      if (!answered.ok) {
        return answered;
      }

      const daily = answered.value.daily;

      return ok({
        ...answered.value,
        daily: channel(daily.time, { snowfall: daily.time.map(() => null) }),
      });
    },
  };
}

/** The January window answers from the recordings; July always faults. */
function unreadableInJuly(port: SeriesPort<'archive'>): SeriesPort<'archive'> {
  return {
    ...port,
    fetch: (request) =>
      request.horizon.kind === 'window' && request.horizon.startDate.startsWith('2025-07')
        ? Promise.resolve(err(domainError('TIMEOUT', 'no answer within the budget')))
        : port.fetch(request),
  };
}

describe('reading the cold season from the archive', () => {
  it('examines both candidate cold months, assuming nothing from the latitude', async () => {
    const { snow, port } = service();

    await snow.evidence(CHAMONIX, TODAY);

    expect(port.requests).toHaveLength(2);
    expect(port.requests.map((request) => request.horizon)).toEqual([
      { kind: 'window', startDate: '2025-01-01', endDate: '2025-01-31' },
      { kind: 'window', startDate: '2025-07-01', endDate: '2025-07-31' },
    ]);
  });

  it('asks for snowfall and nothing else, on the location own time axis', async () => {
    const { snow, port } = service();

    await snow.evidence(CHAMONIX, TODAY);

    expect(port.requests[0]?.metrics).toEqual(['snowfall']);
    expect(port.requests[0]?.timezone).toBe('Europe/Paris');
  });

  it('takes the larger of the two windows, and records both', async () => {
    const { snow } = service();
    const evidence = await snow.evidence(CHAMONIX, TODAY);

    expect(evidence?.basis).toBe('archive');
    expect(evidence).toMatchObject({ coldSeasonSnowfallCm: 96.53 });
    expect(evidence?.basis === 'archive' ? evidence.samples : []).toEqual([
      { startDate: '2025-01-01', endDate: '2025-01-31', snowfallCm: 96.53 },
      { startDate: '2025-07-01', endDate: '2025-07-31', snowfallCm: 0 },
    ]);
  });

  it('finds no season at a Mediterranean coastal city', async () => {
    const { snow } = service();
    const evidence = await snow.evidence(LISBON, TODAY);

    expect(evidence).toMatchObject({ basis: 'archive', coldSeasonSnowfallCm: 0 });
  });

  it('finds no season high on the equator, where the elevation would say otherwise', async () => {
    const { snow } = service();
    const evidence = await snow.evidence(QUITO, TODAY);

    // 2 920 m and nothing falls: elevation is necessary, never sufficient
    // (stage-five.md, section 5.1).
    expect(evidence).toMatchObject({ basis: 'archive', coldSeasonSnowfallCm: 0 });
  });

  it('finds a season at sea level inside the Arctic Circle', async () => {
    const { snow } = service();
    const evidence = await snow.evidence(TROMSO, TODAY);

    expect(evidence).toMatchObject({ basis: 'archive', coldSeasonSnowfallCm: 92.82 });
  });

  it('finds the southern season in July, by snowfall rather than by the month number', async () => {
    const { snow } = service();
    const evidence = await snow.evidence(PERISHER, TODAY);

    expect(evidence).toMatchObject({ basis: 'archive', coldSeasonSnowfallCm: 127.68 });
    expect(
      evidence?.basis === 'archive'
        ? evidence.samples.find((sample) => sample.snowfallCm === 127.68)?.startDate
        : undefined,
    ).toBe('2025-07-01');
  });

  it('is decided by the window that answered when the other one could not', async () => {
    // One month unreadable is not a reason to fall back on a guess while the
    // other month is sitting there with data in it.
    const snow = new SnowSeasonService(unreadableInJuly(recordingArchivePort()));
    const evidence = await snow.evidence(CHAMONIX, TODAY);

    expect(evidence).toMatchObject({ basis: 'archive', coldSeasonSnowfallCm: 96.53 });
    expect(evidence?.basis === 'archive' ? evidence.samples : []).toHaveLength(1);
  });
});

function unreachable(): SnowSeasonService {
  return new SnowSeasonService(
    new FailingSeriesPort('archive', domainError('TIMEOUT', 'no answer within the budget')),
  );
}

describe('an archive month that is present but empty', () => {
  it('is no reading at all, never a season of zero centimetres', async () => {
    // The archive answers an all-null month the same way the marine endpoint
    // answers over land. Summing it to 0 would settle "no snow season" on an
    // outage — the confident falsehood the whole change exists to prevent.
    const snow = new SnowSeasonService(allNullArchive(recordingArchivePort()));

    expect(await snow.evidence(CHAMONIX, TODAY)).toMatchObject({ basis: 'elevation' });
  });
});

describe('when the archive cannot be reached', () => {
  it('falls back to the declared heuristic and says so', async () => {
    const evidence = await unreachable().evidence(CHAMONIX, TODAY);

    expect(evidence).toEqual({
      basis: 'elevation',
      seasonLikely: true,
      elevationMetres: 1041,
      latitude: 45.9237,
      attemptedOn: TODAY,
    });
  });

  it('records the day it fell back, so the archive can be tried again tomorrow', async () => {
    const evidence = await unreachable().evidence(CHAMONIX, '2026-09-09');

    expect(evidence?.basis === 'elevation' ? evidence.attemptedOn : undefined).toBe('2026-09-09');
  });

  it('lets latitude carry a low-lying arctic place the elevation would miss', async () => {
    const evidence = await unreachable().evidence(TROMSO, TODAY);

    expect(evidence).toMatchObject({ basis: 'elevation', seasonLikely: true });
  });

  it('refuses a warm, low place', async () => {
    const evidence = await unreachable().evidence(LISBON, TODAY);

    expect(evidence).toMatchObject({ basis: 'elevation', seasonLikely: false });
  });

  it('reports nothing at all when even the elevation is unknown', async () => {
    // Raw coordinates carry no elevation; there is no fallback left, and
    // guessing one would be the silent degradation the spec forbids.
    const evidence = await unreachable().evidence(at(45.9237, 6.8694, null), TODAY);

    expect(evidence).toBeUndefined();
  });
});
