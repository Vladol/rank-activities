import type { ResolvedDefinition } from '../activity/activity-definition';
import { metricRequirements } from '../activity/metric-requirements';
import type { RequirableMetric } from '../weather/derived/derived-metric.registry';
import { type LocationProfile, type RuleVerdict, activityApplicability } from './location-profile';

export interface ActivityVerdict {
  readonly definition: ResolvedDefinition;
  readonly verdict: RuleVerdict;
}

export interface ApplicabilityPlan {
  /** Every activity with its verdict, so a withheld one can still be reported. */
  readonly outcomes: readonly ActivityVerdict[];
  readonly applicable: readonly ResolvedDefinition[];
  /** The union of what the applicable activities declare — and nothing else. */
  readonly requirements: readonly RequirableMetric[];
}

/**
 * What to fetch, and for whom, once the place is known.
 *
 * Only an applicable activity contributes requirements. An impossible one has
 * nothing to score, and an undecided one has nothing to score *yet*; fetching
 * for either would buy data no answer uses. This is what makes an inland
 * location skip the marine host altogether — nothing in this function knows
 * what a coastline is, it only knows that no applicable activity asked for a
 * wave (design.md, Decision 2 of `01-add-weather-source-contract`).
 */
export function applicabilityPlan(
  profile: LocationProfile,
  definitions: readonly ResolvedDefinition[],
): ApplicabilityPlan {
  const outcomes = definitions.map((definition) => ({
    definition,
    verdict: activityApplicability(profile, definition),
  }));

  const applicable = outcomes
    .filter((outcome) => outcome.verdict.kind === 'applicable')
    .map((outcome) => outcome.definition);

  return {
    outcomes,
    applicable,
    requirements: [...new Set(applicable.flatMap((definition) => metricRequirements(definition)))],
  };
}
