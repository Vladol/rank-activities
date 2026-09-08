import type { ActivityOutcome } from './activity-outcome';

/** One activity's answer for one day, tagged with the activity it belongs to. */
export interface ActivityResult {
  /** The stable declaration code: what a tie is broken by, and never a title. */
  readonly activity: string;
  readonly outcome: ActivityOutcome;
}

/**
 * A day's results in the two groups the contract distinguishes. They are two
 * fields rather than one sorted list because that is the distinction: a ranked
 * zero is a judgement about today, and an inapplicable result is a statement
 * about the place. Flattening them into one list is exactly the confusion the
 * outcome union exists to prevent (design.md, Decision 3).
 */
export interface DayRanking {
  /** Descending by score, ties broken by activity code. */
  readonly ranked: readonly ActivityResult[];
  /** Inapplicable and missing-data results, by activity code. Never scored. */
  readonly notRanked: readonly ActivityResult[];
}

/**
 * Orders one day (docs/development-flow/stage-five.md, section 9, and FR-15,
 * FR-16 of stage-two.md).
 *
 * The tie-break is the activity's code rather than the input order, because
 * the input order is the catalogue's, and the catalogue's order is whatever
 * the file system answered with. A determinism requirement that depended on
 * that would be untestable.
 */
export function rankDay(results: readonly ActivityResult[]): DayRanking {
  const ranked: RankedResult[] = [];
  const notRanked: ActivityResult[] = [];

  for (const result of results) {
    // Narrowed on the way in, so nothing downstream has to ask a non-scored
    // outcome for a score and invent an answer when it has none.
    if (result.outcome.kind === 'ranked') {
      ranked.push({ ...result, score: result.outcome.score });
    } else {
      notRanked.push(result);
    }
  }

  return {
    ranked: ranked.toSorted(byScoreThenCode).map(({ activity, outcome }) => ({ activity, outcome })),
    notRanked: notRanked.toSorted(byCode),
  };
}

interface RankedResult extends ActivityResult {
  readonly score: number;
}

function byScoreThenCode(left: RankedResult, right: RankedResult): number {
  return right.score - left.score || byCode(left, right);
}

function byCode(left: ActivityResult, right: ActivityResult): number {
  return left.activity < right.activity ? -1 : left.activity > right.activity ? 1 : 0;
}
