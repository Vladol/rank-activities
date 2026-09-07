import { describe, expect, it } from 'vitest';

import type { MetricCode } from '../../../domain/weather/metric';
import {
  type GridPoint,
  type MetricValues,
  type SeriesChannel,
  type WeatherSeries,
  hasMetric,
  isAllAbsent,
  metricsIn,
  valuesOf,
} from '../../../domain/weather/weather-series';
import type { PortErrorCode, SeriesRequest, WeatherError } from '../ports/contracts';
import type { SeriesPort } from '../ports/series.port';

/**
 * The shared conformance suite. Every adapter runs it before it can be bound,
 * so "interchangeable" is a checked property rather than an intention
 * (design.md, Decision 5 of `01-add-weather-source-contract`).
 *
 * It asserts contract properties only — canonical units, preserved gaps,
 * provenance, failure kinds — and never a vendor's field names. What a
 * recorded response is expected to yield comes from the adapter, expressed in
 * domain metric codes; the checks are the same for all of them.
 */
export type ContractCheck =
  | 'canonical-units'
  | 'gaps-preserved'
  | 'all-absent-series'
  | 'provenance-grid-point'
  | 'supports-agrees-with-fetch'
  | 'typed-failure-code'
  | 'source-text-not-returned'
  | 'source-text-is-logged'
  | 'never-throws';

export interface ContractViolation {
  readonly check: ContractCheck;
  readonly case: string;
  readonly detail: string;
}

export interface SeriesCase {
  readonly name: string;
  readonly request: SeriesRequest;
  /** Canonical values the response must produce, per metric, on the hourly axis. */
  readonly expectHourly?: Readonly<Partial<Record<MetricCode, MetricValues>>>;
  readonly expectDaily?: Readonly<Partial<Record<MetricCode, MetricValues>>>;
  /** Metrics that must come back present and entirely empty — marine over land. */
  readonly expectAllAbsent?: readonly MetricCode[];
  /** The node the recorded response answered for, never the requested coordinates. */
  readonly expectGridPoint?: GridPoint;
}

export interface FailureCase {
  readonly name: string;
  readonly request: SeriesRequest;
  readonly expectCode: PortErrorCode;
  /** Text from the source's own body that must stay in the log and out of the result. */
  readonly sourceText?: string;
}

export interface ContractSuiteOptions {
  readonly createPort: () => SeriesPort;
  readonly series: readonly SeriesCase[];
  readonly failures: readonly FailureCase[];
  /** A metric the source cannot serve, used to check `supports` is honest. */
  readonly unsupportedMetric: MetricCode;
  /** The adapter's own log capture, so "logged, not returned" can be checked. */
  readonly readSourceLog?: () => readonly string[];
}

export interface ContractReport {
  readonly passed: boolean;
  readonly checksRun: readonly ContractCheck[];
  readonly violations: readonly ContractViolation[];
}

export async function runSeriesPortContract(
  options: ContractSuiteOptions,
): Promise<ContractReport> {
  const violations: ContractViolation[] = [];
  const checksRun = new Set<ContractCheck>();

  const record = (check: ContractCheck, caseName: string, detail?: string): void => {
    checksRun.add(check);

    if (detail !== undefined) {
      violations.push({ check, case: caseName, detail });
    }
  };

  const port = options.createPort();

  checkSupports(port, options, record);

  for (const seriesCase of options.series) {
    const outcome = await settle(port, seriesCase.request);

    if (outcome.thrown !== undefined) {
      record('never-throws', seriesCase.name, `fetch threw ${outcome.thrown}`);
      continue;
    }

    if (outcome.result === undefined || !outcome.result.ok) {
      record(
        'canonical-units',
        seriesCase.name,
        `expected a series but the port failed with ${outcome.result?.ok === false ? outcome.result.error.code : 'nothing'}`,
      );
      continue;
    }

    checkSeries(seriesCase, outcome.result.value, record);
  }

  for (const failureCase of options.failures) {
    await checkFailure(port, failureCase, options, record);
  }

  return {
    passed: violations.length === 0,
    checksRun: [...checksRun],
    violations,
  };
}

/** The vitest wrapper an adapter's own spec file calls. */
export function describeSeriesPortContract(
  name: string,
  options: ContractSuiteOptions,
): void {
  describe(`${name} satisfies the source contract`, () => {
    it('reports no contract violations', async () => {
      const report = await runSeriesPortContract(options);

      expect(report.violations).toEqual([]);
    });
  });
}

type Recorder = (check: ContractCheck, caseName: string, detail?: string) => void;

function checkSupports(
  port: SeriesPort,
  options: ContractSuiteOptions,
  record: Recorder,
): void {
  if (port.supports(options.unsupportedMetric)) {
    record(
      'supports-agrees-with-fetch',
      'supports',
      `claims support for ${options.unsupportedMetric}, which it was declared unable to serve`,
    );
  } else {
    record('supports-agrees-with-fetch', 'supports');
  }

  for (const seriesCase of options.series) {
    for (const metric of seriesCase.request.metrics) {
      if (!port.supports(metric)) {
        record(
          'supports-agrees-with-fetch',
          seriesCase.name,
          `denies support for ${metric} while accepting it in a request`,
        );
      }
    }
  }
}

function checkSeries(seriesCase: SeriesCase, series: WeatherSeries, record: Recorder): void {
  compareChannel(seriesCase, series.hourly, seriesCase.expectHourly, 'hourly', record);
  compareChannel(seriesCase, series.daily, seriesCase.expectDaily, 'daily', record);

  for (const metric of seriesCase.expectAllAbsent ?? []) {
    const present = hasMetric(series.hourly, metric) || hasMetric(series.daily, metric);
    const empty = isAllAbsent(series.hourly, metric) || isAllAbsent(series.daily, metric);

    record(
      'all-absent-series',
      seriesCase.name,
      present && empty
        ? undefined
        : `${metric} must come back present and entirely empty, not ${present ? 'partly filled' : 'dropped'}`,
    );
  }

  if (seriesCase.expectGridPoint !== undefined) {
    const answered = series.provenance[0]?.gridPoint;

    record(
      'provenance-grid-point',
      seriesCase.name,
      sameGridPoint(answered, seriesCase.expectGridPoint)
        ? undefined
        : `provenance reports ${JSON.stringify(answered)} instead of the node the response named, ${JSON.stringify(seriesCase.expectGridPoint)}`,
    );
  }
}

function compareChannel(
  seriesCase: SeriesCase,
  actual: SeriesChannel,
  expected: Readonly<Partial<Record<MetricCode, MetricValues>>> | undefined,
  axis: 'hourly' | 'daily',
  record: Recorder,
): void {
  for (const metric of metricsIn(actual)) {
    const values = valuesOf(actual, metric) ?? [];

    record(
      'gaps-preserved',
      seriesCase.name,
      values.length === actual.time.length
        ? undefined
        : `${metric} has ${values.length} values against a ${axis} axis of ${actual.time.length}`,
    );
  }

  for (const [metric, wanted] of Object.entries(expected ?? {}) as [MetricCode, MetricValues][]) {
    const values = valuesOf(actual, metric);

    if (values === undefined) {
      record('canonical-units', seriesCase.name, `${metric} is missing from the ${axis} channel`);
      continue;
    }

    const mismatch = wanted.findIndex((value, index) => !sameValue(value, values[index]));

    record(
      'canonical-units',
      seriesCase.name,
      mismatch === -1
        ? undefined
        : `${metric} crossed the port as ${String(values[mismatch])} where the canonical value is ${String(wanted[mismatch])} (slot ${mismatch})`,
    );

    const filledGap = wanted.findIndex(
      (value, index) => value === null && values[index] !== null && values[index] !== undefined,
    );

    record(
      'gaps-preserved',
      seriesCase.name,
      filledGap === -1
        ? undefined
        : `${metric} filled the gap at slot ${filledGap} with ${String(values[filledGap])}`,
    );
  }
}

async function checkFailure(
  port: SeriesPort,
  failureCase: FailureCase,
  options: ContractSuiteOptions,
  record: Recorder,
): Promise<void> {
  const before = options.readSourceLog?.().length ?? 0;
  const outcome = await settle(port, failureCase.request);

  if (outcome.thrown !== undefined) {
    record('never-throws', failureCase.name, `fetch threw ${outcome.thrown} instead of returning`);
    return;
  }

  record('never-throws', failureCase.name);

  const result = outcome.result;

  if (result === undefined || result.ok) {
    record(
      'typed-failure-code',
      failureCase.name,
      `expected a failure with ${failureCase.expectCode} but the port returned a series`,
    );
    return;
  }

  record(
    'typed-failure-code',
    failureCase.name,
    result.error.code === failureCase.expectCode
      ? undefined
      : `mapped onto ${result.error.code} instead of ${failureCase.expectCode}`,
  );

  if (failureCase.sourceText === undefined) {
    return;
  }

  record(
    'source-text-not-returned',
    failureCase.name,
    describesSourceText(result.error, failureCase.sourceText)
      ? `the returned error repeats the source's own text`
      : undefined,
  );

  if (options.readSourceLog === undefined) {
    return;
  }

  const logged = options.readSourceLog().slice(before);

  record(
    'source-text-is-logged',
    failureCase.name,
    logged.some((line) => line.includes(failureCase.sourceText ?? ''))
      ? undefined
      : `the source's own text was neither returned nor logged, so the fault is unexplainable`,
  );
}

async function settle(
  port: SeriesPort,
  request: SeriesRequest,
): Promise<{ result?: Awaited<ReturnType<SeriesPort['fetch']>>; thrown?: string }> {
  try {
    return { result: await port.fetch(request) };
  } catch (thrown) {
    return { thrown: thrown instanceof Error ? thrown.message : String(thrown) };
  }
}

function describesSourceText(error: WeatherError, sourceText: string): boolean {
  // Not JSON.stringify: it escapes quotes and newlines, and a leaked reason
  // containing either would slip past the check unchanged.
  const carried = [error.code, error.message, ...Object.values(error.context ?? {}).map(String)];

  return carried.some((value) => value.includes(sourceText));
}

function sameValue(left: number | null, right: number | null | undefined): boolean {
  return left === null ? right === null : right !== null && right !== undefined && Math.abs(left - right) < 1e-9;
}

function sameGridPoint(left: GridPoint | undefined, right: GridPoint): boolean {
  return (
    left !== undefined &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude &&
    left.elevationMetres === right.elevationMetres
  );
}
