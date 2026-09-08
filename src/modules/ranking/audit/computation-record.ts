import type { ReasonCode } from '../../../domain/shared/reason-code';
import type { LocationId } from '../../../domain/shared/branded';
import type { ActivityOutcome } from '../../../domain/ranking/activity-outcome';
import type { RankingAnswer } from '../../../domain/ranking/ranking-answer';

/**
 * What one computation was made of. One record per request, and one outcome per
 * activity per local day — twenty-eight of them for four activities over a week,
 * which is why the provenance and the profile version sit on the run rather
 * than on every outcome (data-model.md, section 2.5).
 */
export interface ComputationOutcomeRecord {
  /**
   * The location's own local date, or `null` when the answer identified no day
   * at all. A date of ours would be the day-shift the contract forbids, and
   * dropping these rows would drop exactly the `no_data` outcomes that are worth
   * keeping.
   */
  readonly localDate: string | null;
  readonly activityCode: string;
  readonly activityVersion: number;
  readonly outcome: 'ranked' | 'not_applicable' | 'no_data';
  readonly score: number | null;
  readonly reason: ReasonCode | null;
  /**
   * The aggregated feature values that produced the score: what reached the
   * normaliser, in its canonical unit, and what came back. Never the hourly
   * series they were aggregated from — that would make the audit the forecast
   * table this schema exists without (design.md, Decision 1).
   */
  readonly inputs: readonly unknown[];
}

export interface ComputationRunRecord {
  readonly requestId: string;
  readonly locationId: LocationId;
  readonly horizonDays: number;
  readonly profileCode: string;
  readonly profileVersion: number;
  readonly provenance: readonly unknown[];
  readonly outcomes: readonly ComputationOutcomeRecord[];
}

/**
 * Turns an answer into the record of how it was reached.
 *
 * Reading it off the finished answer rather than instrumenting the computation
 * is deliberate: what is audited is then exactly what the client was told, and
 * the two cannot disagree.
 */
export function recordOf(
  requestId: string,
  answer: RankingAnswer,
  versionOf: (activityCode: string) => number,
): ComputationRunRecord {
  const dated = answer.days.flatMap((day) =>
    [...day.ranking.ranked, ...day.ranking.notRanked].map((result) =>
      outcomeRecord(day.date, result.activity, result.outcome, versionOf),
    ),
  );

  return {
    requestId,
    locationId: answer.location.id,
    horizonDays: answer.requestedDays,
    profileCode: answer.profileId,
    profileVersion: answer.profileVersion,
    provenance: answer.days.length > 0 || answer.fetchedAt !== null ? provenanceOf(answer) : [],
    outcomes: [
      ...dated,
      ...answer.undated.map((result) =>
        outcomeRecord(null, result.activity, result.outcome, versionOf),
      ),
    ],
  };
}

function outcomeRecord(
  localDate: string | null,
  activityCode: string,
  outcome: ActivityOutcome,
  versionOf: (activityCode: string) => number,
): ComputationOutcomeRecord {
  const base = {
    localDate,
    activityCode,
    activityVersion: outcome.kind === 'ranked' ? outcome.definitionVersion : versionOf(activityCode),
  };

  if (outcome.kind === 'ranked') {
    return {
      ...base,
      outcome: 'ranked',
      // The store rounds to a smallint; rounding here is what makes the stored
      // value and the recorded breakdown describe one number.
      score: Math.round(outcome.score),
      reason: outcome.constraintViolated ?? null,
      inputs: outcome.breakdown,
    };
  }

  return {
    ...base,
    outcome: outcome.kind,
    // A refusal has no score, and the store refuses a row that carries one.
    score: null,
    reason: outcome.reason,
    inputs: outcome.kind === 'no_data' ? [{ missingMetrics: outcome.missingMetrics }] : [],
  };
}

/** Where each part of the answer came from, once per source and capability. */
function provenanceOf(answer: RankingAnswer): readonly unknown[] {
  return [
    {
      fetchedAt: answer.fetchedAt,
      stale: answer.stale,
      timezone: answer.timezone,
      daysAnswered: answer.days.length,
    },
  ];
}
