import { describe, expect, it } from 'vitest';

import { type Result, err, ok } from '../../../domain/shared/result';
import { domainError } from '../../../domain/shared/domain-error';
import type { MetricCode } from '../../../domain/weather/metric';
import {
  type MetricValues,
  type WeatherSeries,
  channel,
  createSeries,
} from '../../../domain/weather/weather-series';
import type { Coordinates, SeriesRequest, WeatherError } from '../ports/contracts';
import type { SeriesPort } from '../ports/series.port';
import { type ContractSuiteOptions, runSeriesPortContract } from './weather-port.conformance';

const HOURS = ['2026-09-07T00:00', '2026-09-07T01:00', '2026-09-07T02:00', '2026-09-07T03:00'];
const ANSWERED_GRID = { latitude: 38.75, longitude: -9.125, elevationMetres: 26 };

/** Each case is addressed by its coordinates, the way a recorded source is. */
const LISBON: Coordinates = { latitude: 38.72, longitude: -9.15 };
const PRAGUE: Coordinates = { latitude: 50.08, longitude: 14.44 };
const EMPTY_BODY: Coordinates = { latitude: 0.1, longitude: 0 };
const HTML_403: Coordinates = { latitude: 0.2, longitude: 0 };
const JSON_400: Coordinates = { latitude: 0.3, longitude: 0 };
const TIMES_OUT: Coordinates = { latitude: 0.4, longitude: 0 };

// Quotes and newlines are what JSON escaping hides: the leak check must not
// be fooled by them.
const SOURCE_REASON =
  'Cannot initialize WeatherVariable from invalid String value "temperature_2meters"\nat line 3';

interface FakeFlaws {
  readonly rawWindUnits?: boolean;
  readonly fillsGaps?: boolean;
  readonly reportsRequestedGrid?: boolean;
  readonly throwsOnFailure?: boolean;
  readonly leaksSourceReason?: boolean;
  readonly overclaimsSupport?: boolean;
  readonly dropsAllAbsentMetric?: boolean;
  readonly logsNothing?: boolean;
}

function fakeSource(flaws: FakeFlaws = {}) {
  const log: string[] = [];

  const port: SeriesPort = {
    sourceId: 'fake',
    capability: 'forecast',
    limits: { maxForecastDays: 16, maxPastDays: 92 },
    supports: (metric) =>
      flaws.overclaimsSupport === true
        ? true
        : ['temperature_2m', 'wind_speed_10m', 'visibility', 'wave_height'].includes(metric),
    fetch: (request) => Promise.resolve(answer(request)),
  };

  function answer(request: SeriesRequest): Result<WeatherSeries, WeatherError> {
    const { latitude } = request.location;

    if (latitude === EMPTY_BODY.latitude) {
      return failure('MALFORMED_BODY', 'the source answered 200 with an empty body');
    }

    if (latitude === HTML_403.latitude) {
      return failure('UNEXPECTED_CONTENT_TYPE', 'the source answered text/html, not JSON');
    }

    if (latitude === JSON_400.latitude) {
      if (flaws.logsNothing !== true) {
        log.push(SOURCE_REASON);
      }

      return err(
        domainError(
          'UNEXPECTED_STATUS',
          flaws.leaksSourceReason === true
            ? `the source refused the request: ${SOURCE_REASON}`
            : 'the source refused the request',
        ),
      );
    }

    if (latitude === TIMES_OUT.latitude) {
      if (flaws.throwsOnFailure === true) {
        throw new Error('socket hang up');
      }

      return failure('TIMEOUT', 'the source did not answer within the budget');
    }

    if (latitude === PRAGUE.latitude) {
      const waves: MetricValues = [null, null, null, null];

      return ok(
        createSeries({
          hourly: channel(HOURS, flaws.dropsAllAbsentMetric === true ? {} : { wave_height: waves }),
          provenance: [origin(request, ['wave_height'])],
        }),
      );
    }

    const temperature: MetricValues = flaws.fillsGaps === true
      ? [18.4, 0, 0, 17.1]
      : [18.4, null, null, 17.1];

    return ok(
      createSeries({
        hourly: channel(HOURS, {
          temperature_2m: temperature,
          // 36 km/h is 10 m/s. A port that skips the conversion sends 36.
          wind_speed_10m: flaws.rawWindUnits === true ? [36, 36, 36, 36] : [10, 10, 10, 10],
          visibility: [24.14, 24.14, 24.14, 24.14],
        }),
        provenance: [origin(request, ['temperature_2m', 'wind_speed_10m', 'visibility'])],
      }),
    );
  }

  function origin(request: SeriesRequest, metrics: readonly MetricCode[]) {
    return {
      sourceId: 'fake',
      capability: 'forecast' as const,
      gridPoint:
        flaws.reportsRequestedGrid === true
          ? { ...request.location, elevationMetres: 26 }
          : ANSWERED_GRID,
      fetchedAt: '2026-09-07T10:00:00Z',
      stale: false,
      metrics,
    };
  }

  function failure(code: WeatherError['code'], message: string) {
    if (flaws.logsNothing !== true) {
      log.push(SOURCE_REASON);
    }

    return err(domainError(code, message));
  }

  return { port, log };
}

function seriesRequest(location: Coordinates, metrics: readonly MetricCode[]): SeriesRequest {
  return {
    capability: 'forecast',
    location,
    metrics,
    horizon: { kind: 'forecast', forecastDays: 7 },
    timezone: 'auto',
  };
}

function options(flaws: FakeFlaws = {}): ContractSuiteOptions {
  const { port, log } = fakeSource(flaws);

  return {
    createPort: () => port,
    unsupportedMetric: 'snow_depth',
    readSourceLog: () => log,
    series: [
      {
        name: 'a forecast with gaps',
        request: seriesRequest(LISBON, ['temperature_2m', 'wind_speed_10m', 'visibility']),
        expectHourly: {
          temperature_2m: [18.4, null, null, 17.1],
          wind_speed_10m: [10, 10, 10, 10],
          visibility: [24.14, 24.14, 24.14, 24.14],
        },
        expectGridPoint: ANSWERED_GRID,
      },
      {
        name: 'marine over land',
        request: seriesRequest(PRAGUE, ['wave_height']),
        expectAllAbsent: ['wave_height'],
        expectGridPoint: ANSWERED_GRID,
      },
    ],
    failures: [
      {
        name: 'an empty 200 body',
        request: seriesRequest(EMPTY_BODY, ['temperature_2m']),
        expectCode: 'MALFORMED_BODY',
      },
      {
        name: 'an HTML 403',
        request: seriesRequest(HTML_403, ['temperature_2m']),
        expectCode: 'UNEXPECTED_CONTENT_TYPE',
      },
      {
        name: 'a JSON 400 carrying the source reason',
        request: seriesRequest(JSON_400, ['temperature_2m']),
        expectCode: 'UNEXPECTED_STATUS',
        sourceText: SOURCE_REASON,
      },
      {
        name: 'a source that never answers',
        request: seriesRequest(TIMES_OUT, ['temperature_2m']),
        expectCode: 'TIMEOUT',
      },
    ],
  };
}

async function violationsOf(flaws: FakeFlaws = {}): Promise<string[]> {
  const report = await runSeriesPortContract(options(flaws));

  return report.violations.map((violation) => `${violation.check}: ${violation.detail}`);
}

describe('a source that honours the contract', () => {
  it('reports no violations', async () => {
    expect(await violationsOf()).toEqual([]);
  });

  it('is reported as passing', async () => {
    const report = await runSeriesPortContract(options());

    expect(report.passed).toBe(true);
  });
});

describe('the suite fails loudly when', () => {
  it('a port returns raw source units instead of canonical ones', async () => {
    const violations = await violationsOf({ rawWindUnits: true });

    expect(violations.join('\n')).toMatch(/canonical-units.*wind_speed_10m/s);
  });

  it('a port fills a gap instead of preserving it', async () => {
    const violations = await violationsOf({ fillsGaps: true });

    expect(violations.join('\n')).toMatch(/canonical-units.*temperature_2m/s);
  });

  it('a port reports the requested coordinates as the grid point', async () => {
    const violations = await violationsOf({ reportsRequestedGrid: true });

    expect(violations.join('\n')).toMatch(/provenance-grid-point/);
  });

  it('a port drops an entirely absent metric instead of returning it empty', async () => {
    const violations = await violationsOf({ dropsAllAbsentMetric: true });

    expect(violations.join('\n')).toMatch(/all-absent-series.*wave_height/s);
  });

  it('a port throws instead of returning a failure', async () => {
    const violations = await violationsOf({ throwsOnFailure: true });

    expect(violations.join('\n')).toMatch(/never-throws/);
  });

  it('a port returns the source own error text', async () => {
    const violations = await violationsOf({ leaksSourceReason: true });

    expect(violations.join('\n')).toMatch(/source-text-not-returned/);
  });

  it('a port claims support for a metric it cannot serve', async () => {
    const violations = await violationsOf({ overclaimsSupport: true });

    expect(violations.join('\n')).toMatch(/supports-agrees-with-fetch.*snow_depth/s);
  });

  it('a port logs nothing about a failure it reported', async () => {
    const violations = await violationsOf({ logsNothing: true });

    expect(violations.join('\n')).toMatch(/source-text-is-logged/);
  });
});

describe('the report', () => {
  it('names every check it ran, so a passing adapter says what it proved', async () => {
    const report = await runSeriesPortContract(options());

    expect(report.checksRun.toSorted()).toEqual([
      'all-absent-series',
      'canonical-units',
      'gaps-preserved',
      'never-throws',
      'provenance-grid-point',
      'source-text-is-logged',
      'source-text-not-returned',
      'supports-agrees-with-fetch',
      'typed-failure-code',
    ]);
  });
});
