import { describe, expect, it, vi } from 'vitest';

import type { ComputationRunRecord } from '../../src/modules/ranking/audit/computation-record';
import { rankingHarness } from '../support/ranking';
import { deferred } from '../support/deferred';

const LISBON = { kind: 'coordinates', coordinates: { latitude: 38.7167, longitude: -9.1333 } } as const;

describe('what the audit costs the answer', () => {
  it('nothing: the answer is returned while the write is still outstanding', async () => {
    const outstanding = deferred();
    const write = vi.fn(() => outstanding.promise);
    const harness = rankingHarness({ auditWriter: { write } });

    const answered = await harness.service.rank({ location: LISBON });

    // The answer is complete and the writer has not even been called: the
    // record is in the buffer, and the flush is somebody else's turn of the
    // event loop (design.md, Decision 7).
    expect(answered.ok).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(harness.audit.pending).toBe(1);

    const flushed = harness.audit.flush();

    outstanding.resolve();
    await flushed;

    expect(write).toHaveBeenCalledTimes(1);
  });

  it('nothing, even when the store never answers at all', async () => {
    const harness = rankingHarness({
      auditWriter: { write: () => new Promise<void>(() => undefined) },
    });

    // No timeout, no race: `rank` never touches the writer.
    const answered = await harness.service.rank({ location: LISBON });

    expect(answered.ok).toBe(true);
  });
});

describe('what a computation record carries', () => {
  const recorded = async (): Promise<ComputationRunRecord> => {
    const written: ComputationRunRecord[] = [];
    const harness = rankingHarness({
      auditWriter: {
        write: (runs) => {
          written.push(...runs);

          return Promise.resolve();
        },
      },
    });

    await harness.service.rank({ location: LISBON });
    await harness.audit.flush();

    const [run] = written;

    if (run === undefined) {
      throw new Error('nothing was recorded');
    }

    return run;
  };

  it('one row per activity per local day, and the run once', async () => {
    const run = await recorded();

    // Four activities over seven days.
    expect(run.outcomes).toHaveLength(28);
    expect(run.horizonDays).toBe(7);
    expect(run.profileCode).toBe('default');
  });

  it('the aggregated feature values, and no series behind them', async () => {
    const run = await recorded();
    const ranked = run.outcomes.find((outcome) => outcome.outcome === 'ranked');
    const inputs = (ranked?.inputs ?? []) as readonly Record<string, unknown>[];

    expect(inputs.length).toBeGreaterThan(0);

    for (const input of inputs) {
      // What reached the normaliser and what came back — one number each, not
      // the twenty-four the number was aggregated from.
      expect(Object.keys(input)).toContain('featureId');
      expect(Object.keys(input)).toContain('normalized');
      expect(input.raw === null || typeof (input.raw as { value: unknown }).value === 'number').toBe(
        true,
      );
    }

    // The assertion that matters: nothing anywhere in the record is a series.
    const serialised = JSON.stringify(run);

    expect(serialised).not.toMatch(/"hourly"/);
    expect(serialised).not.toMatch(/"daily"/);
    expect(serialised).not.toMatch(/"times"/);
    // A day's worth of hourly values would be an array of two dozen numbers.
    // The inputs hold one entry per declared feature and nothing longer.
    for (const outcome of run.outcomes) {
      expect(longestArray(outcome.inputs), outcome.activityCode).toBeLessThan(24);
    }
  });

  it('a score exactly where the outcome is a ranked one', async () => {
    const run = await recorded();

    for (const outcome of run.outcomes) {
      expect(outcome.score === null, outcome.activityCode).toBe(outcome.outcome !== 'ranked');
    }
  });

  it('the version of the declaration that produced each outcome', async () => {
    const run = await recorded();

    for (const outcome of run.outcomes) {
      expect(outcome.activityVersion, outcome.activityCode).toBeGreaterThan(0);
    }
  });
});

/** The longest array anywhere in the record: a series would be the giveaway. */
function longestArray(value: unknown): number {
  if (Array.isArray(value)) {
    return Math.max(value.length, ...value.map(longestArray), 0);
  }

  if (typeof value === 'object' && value !== null) {
    return Math.max(0, ...Object.values(value).map(longestArray));
  }

  return 0;
}
