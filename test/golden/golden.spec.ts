import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import type { ActivityOutcome } from '../../src/domain/ranking/activity-outcome';
import {
  REFERENCE_CASES,
  type DayOutcomes,
  scoreReferenceCase,
} from '../acceptance/support/reference-cases';

/**
 * The reference scores over every recording (docs/development-flow/stage-five.md,
 * section 14.3). From here on a weight change is reviewed by its diff: a line
 * reading `"weight": 0.40 -> 0.46` shows nothing, whereas
 * `"top": "discomfort" -> "top": "rainHours"` says the dominant feature of an
 * activity changed, and that is worth a conversation.
 *
 * Updating the snapshot is deliberate: `UPDATE_GOLDEN=1 npm test`. Its diff
 * belongs in the change that moved the number.
 *
 * Days are keyed by their index rather than by their date: a forecast
 * recording is rebased onto today's axis on every run, so a date key would
 * churn daily while the scores stayed put.
 */
const SNAPSHOT = join(process.cwd(), 'test/golden/scores.snapshot.json');

interface GoldenEntry {
  readonly kind: ActivityOutcome['kind'];
  readonly score?: number;
  readonly reason?: string;
  /** The contributing feature with the largest share of the score. */
  readonly top?: string;
  readonly gate?: number;
  readonly excluded?: readonly string[];
}

type Golden = Record<string, Record<string, GoldenEntry>>;

function summarise(outcome: ActivityOutcome): GoldenEntry {
  if (outcome.kind === 'not_applicable') {
    return { kind: outcome.kind, reason: outcome.reason };
  }

  if (outcome.kind === 'no_data') {
    return { kind: outcome.kind, reason: outcome.reason };
  }

  const contributing = outcome.breakdown.filter((entry) => entry.role === 'additive');
  const top = contributing.toSorted(
    (left, right) => (right.contribution ?? 0) - (left.contribution ?? 0),
  )[0];
  const gate = outcome.breakdown.find((entry) => entry.role === 'gate');
  const excluded = outcome.breakdown
    .filter((entry) => entry.status === 'excluded')
    .map((entry) => entry.featureId as string);

  return {
    kind: outcome.kind,
    score: outcome.score,
    ...(outcome.constraintViolated === undefined ? {} : { reason: outcome.constraintViolated }),
    ...(top === undefined ? {} : { top: top.featureId as string }),
    ...(gate?.gateFactor === undefined || gate.gateFactor === null
      ? {}
      : { gate: Number(gate.gateFactor.toFixed(4)) }),
    ...(excluded.length === 0 ? {} : { excluded }),
  };
}

let actual: Golden;
let scored: { readonly reference: string; readonly days: readonly DayOutcomes[] }[];

beforeAll(async () => {
  scored = [];

  for (const reference of REFERENCE_CASES) {
    scored.push({ reference: reference.name, days: await scoreReferenceCase(reference) });
  }

  actual = Object.fromEntries(
    scored.flatMap(({ reference, days }) =>
      days.map((day, index) => [
        `${reference} / day ${index}`,
        Object.fromEntries(
          [...day.outcomes].map(([code, outcome]) => [code, summarise(outcome)]),
        ),
      ]),
    ),
  );

  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(SNAPSHOT)) {
    writeFileSync(SNAPSHOT, `${JSON.stringify(actual, null, 2)}\n`);
  }
});

describe('the golden snapshot', () => {
  it('matches the recorded scores of every fixture', () => {
    const expected = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Golden;

    expect(actual).toEqual(expected);
  });

  it('covers every reference case', () => {
    for (const reference of REFERENCE_CASES) {
      expect(
        Object.keys(actual).some((key) => key.startsWith(`${reference.name} / `)),
        reference.name,
      ).toBe(true);
    }
  });
});

describe('the breakdown invariant, on every day of every fixture', () => {
  it('reproduces the score from the contributions and the limiting factors', () => {
    for (const { reference, days } of scored) {
      for (const day of days) {
        for (const [code, outcome] of day.outcomes) {
          if (outcome.kind !== 'ranked' || outcome.constraintViolated !== undefined) {
            continue;
          }

          const sum = outcome.breakdown
            .filter((entry) => entry.role === 'additive' && entry.status !== 'excluded')
            .reduce((total, entry) => total + (entry.contribution ?? 0), 0);
          const gates = outcome.breakdown
            .filter((entry) => entry.role === 'gate')
            .reduce((product, entry) => product * (entry.gateFactor ?? 1), 1);

          const bounded = Math.min(
            Math.max(sum * gates * 100, boundsOf(outcome, 'floor')),
            boundsOf(outcome, 'ceiling'),
          );

          expect(Math.round(bounded), `${reference} ${day.date} ${code}`).toBe(outcome.score);
        }
      }
    }
  });

  it('keeps every effective weight set summing to one', () => {
    for (const { reference, days } of scored) {
      for (const day of days) {
        for (const [code, outcome] of day.outcomes) {
          if (outcome.kind !== 'ranked' || outcome.constraintViolated !== undefined) {
            continue;
          }

          const total = outcome.breakdown
            .filter((entry) => entry.role === 'additive' && entry.status !== 'excluded')
            .reduce((sum, entry) => sum + (entry.weight ?? 0), 0);

          expect(total, `${reference} ${day.date} ${code}`).toBeCloseTo(1, 10);
        }
      }
    }
  });
});

/**
 * The bounds an activity declared, read back off the only place the test can
 * see them from: indoor sightseeing is the one activity that declares any.
 */
function boundsOf(outcome: Extract<ActivityOutcome, { kind: 'ranked' }>, side: 'floor' | 'ceiling'): number {
  const indoor = outcome.breakdown.some((entry) => entry.featureId === 'rainHours');

  if (!indoor) {
    return side === 'floor' ? 0 : 100;
  }

  return side === 'floor' ? 40 : 85;
}
