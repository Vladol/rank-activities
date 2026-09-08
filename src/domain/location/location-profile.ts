import {
  type ApplicabilityRuleCode,
  APPLICABILITY_RULES_VERSION,
} from '../activity/applicability.registry';
import type { LocationId } from '../shared/branded';
import type { ReasonCode } from '../shared/reason-code';

/**
 * What an applicability rule concluded. Three outcomes, matching the three
 * honest result states: a place where the activity is possible, a place where
 * it is not, and a place we cannot yet speak about.
 *
 * `undecided` is what keeps a ten-minute outage from becoming a permanent
 * claim about geography (design.md, Decision 1).
 */
export type RuleVerdict =
  | { readonly kind: 'applicable' }
  | { readonly kind: 'not_applicable'; readonly reason: ReasonCode }
  | { readonly kind: 'undecided'; readonly reason: ReasonCode };

/** One cold-season window that was actually read, kept so a threshold change can be re-judged. */
export interface ColdSeasonSample {
  readonly startDate: string;
  readonly endDate: string;
  readonly snowfallCm: number;
}

/**
 * What was observed about the snow season, and how.
 *
 * The two bases carry different facts rather than the same field with a label,
 * which is Decision 2 made unambiguous: the archive path has centimetres to
 * compare against the declared threshold, and the fallback path has none. A
 * shared `coldSeasonSnowfallCm` would force the fallback to invent a number,
 * and an invented number is exactly how an unverified decision starts reading
 * as a verified one.
 */
export type SnowSeasonEvidence =
  | {
      readonly basis: 'archive';
      /** The largest cold-season total found, across every candidate window read. */
      readonly coldSeasonSnowfallCm: number;
      readonly samples: readonly ColdSeasonSample[];
    }
  | {
      readonly basis: 'elevation';
      readonly seasonLikely: boolean;
      readonly elevationMetres: number;
      readonly latitude: number;
      /**
       * The UTC date the archive was last tried on. A guess is not evidence,
       * so it is retried — but at most once a day, the same cadence the probe
       * keeps, rather than on every request.
       */
      readonly attemptedOn: string;
    };

/**
 * The probe record. Dates rather than a counter: confirmation requires two
 * all-null answers on *different* days, and a counter cannot tell two answers
 * one minute apart from two a day apart (spec, "Coastal applicability is
 * confirmed by two probes on different days").
 */
export interface MarineCoverageEvidence {
  /**
   * UTC dates, `YYYY-MM-DD`, on which a probe returned a full grid with no
   * values. The cadence is ours rather than the location's: two probes a day
   * apart on our clock are two days of evidence wherever the place is.
   */
  readonly allNullProbeDates: readonly string[];
  /** UTC date of the last probe *attempt*, whether or not it answered. */
  readonly lastProbedOn: string;
  /** Set once a probe returned values. Coverage observed is coverage settled. */
  readonly covered: boolean;
}

export interface RuleEvidence {
  readonly snowSeason: SnowSeasonEvidence;
  readonly marineCoverage: MarineCoverageEvidence;
}

/**
 * What is known about a place: the evidence, per rule, and the version of the
 * rules that read it. Conclusions are derived from this rather than stored
 * beside it — storing only the booleans means every profile has to be rebuilt
 * from scratch at the first threshold change (design.md, Decision 4).
 */
export interface LocationProfile {
  readonly locationId: LocationId;
  readonly rulesVersion: number;
  readonly computedAt: string;
  readonly evidence: { readonly [Rule in ApplicabilityRuleCode]?: RuleEvidence[Rule] };
}

const APPLICABLE: RuleVerdict = { kind: 'applicable' };

export function snowSeasonVerdict(
  evidence: SnowSeasonEvidence | undefined,
  params: { readonly minColdMonthSnowfallCm?: number },
): RuleVerdict {
  if (evidence === undefined) {
    return { kind: 'undecided', reason: 'PROVIDER_UNAVAILABLE' };
  }

  const season =
    evidence.basis === 'elevation'
      ? evidence.seasonLikely
      : evidence.coldSeasonSnowfallCm >= (params.minColdMonthSnowfallCm ?? 0);

  return season ? APPLICABLE : { kind: 'not_applicable', reason: 'NO_SNOW_SEASON' };
}

export function marineCoverageVerdict(
  evidence: MarineCoverageEvidence | undefined,
  params: { readonly confirmations?: number },
): RuleVerdict {
  if (evidence === undefined) {
    return { kind: 'undecided', reason: 'MARINE_UNAVAILABLE' };
  }

  if (evidence.covered) {
    return APPLICABLE;
  }

  const days = new Set(evidence.allNullProbeDates).size;

  return days >= (params.confirmations ?? 2)
    ? { kind: 'not_applicable', reason: 'NO_COASTLINE_NEARBY' }
    : { kind: 'undecided', reason: 'MARINE_UNAVAILABLE' };
}

/**
 * The verdict one declared rule reaches against a profile. `params` is
 * `unknown` at the declaration boundary and has already been checked against
 * the registry's schema at load, so it is read here rather than re-parsed.
 */
export function ruleVerdict(
  profile: LocationProfile,
  rule: { readonly rule: string; readonly params?: unknown },
): RuleVerdict {
  const params = (rule.params ?? {}) as Record<string, number | undefined>;

  if (rule.rule === 'snowSeason') {
    return snowSeasonVerdict(profile.evidence.snowSeason, params);
  }

  if (rule.rule === 'marineCoverage') {
    return marineCoverageVerdict(profile.evidence.marineCoverage, params);
  }

  // Unreachable through a loaded declaration: an unregistered rule name fails
  // at load (`declaration.load.ts`). Reached only by a rule added to the
  // registry and not to this function, which must not read as "applicable".
  return { kind: 'undecided', reason: 'PROVIDER_UNAVAILABLE' };
}

/**
 * Whether the rules have moved since the profile was computed. Any difference
 * counts, in either direction: a profile from a version we do not recognise is
 * not evidence that survived a downgrade, it is a profile we cannot read.
 */
export function isOutdated(profile: LocationProfile): boolean {
  return profile.rulesVersion !== APPLICABILITY_RULES_VERSION;
}

/**
 * Whether an activity is possible at the profiled place: every rule it
 * declares must be.
 *
 * The precedence is deliberate. A settled impossibility outranks an undecided
 * rule, because knowing the activity cannot happen here is a complete answer
 * whatever else is unknown; an undecided rule outranks applicability, because
 * "possible as far as we checked" is not what applicable means.
 *
 * An activity naming no rule is applicable everywhere and reaches no evidence,
 * which is the whole of spec `location-applicability`, "Activities without
 * applicability rules are available everywhere".
 */
export function activityApplicability(
  profile: LocationProfile,
  definition: { readonly applicability: readonly { readonly rule: string; readonly params?: unknown }[] },
): RuleVerdict {
  const verdicts = definition.applicability.map((rule) => ruleVerdict(profile, rule));

  return (
    verdicts.find((verdict) => verdict.kind === 'not_applicable') ??
    verdicts.find((verdict) => verdict.kind === 'undecided') ??
    APPLICABLE
  );
}

/**
 * What one marine probe found. `uncovered` is the interesting one: a complete
 * time grid with no value in any slot, which is what the marine endpoint
 * answers over land, over a lake, and during a wave-model outage alike
 * (docs/development-flow/stage-three.md, section 5.1).
 */
export type ProbeOutcome = { readonly kind: 'covered' | 'uncovered' | 'failed' };

/**
 * The probe record after one probe. Days are kept as a set, because two answers
 * on one day are one day's evidence.
 *
 * A failure adds no date to `allNullProbeDates`, so an outage can never begin a
 * candidacy — but it does advance `lastProbedOn`. Leaving that untouched would
 * make a source that is down the *only* one probed on every single request,
 * which is the opposite of the cadence the probe was designed around.
 */
export function recordProbe(
  previous: MarineCoverageEvidence | undefined,
  outcome: ProbeOutcome,
  today: string,
): MarineCoverageEvidence {
  if (outcome.kind === 'failed') {
    return { allNullProbeDates: [], covered: false, ...previous, lastProbedOn: today };
  }

  if (outcome.kind === 'covered') {
    return { allNullProbeDates: [], lastProbedOn: today, covered: true };
  }

  return {
    allNullProbeDates: [...new Set([...(previous?.allNullProbeDates ?? []), today])].toSorted(),
    lastProbedOn: today,
    covered: false,
  };
}

/**
 * Whether to spend a probe on this location today. Settled either way — the
 * model covers the place, or the missing coastline is confirmed — is never
 * probed again, and an unsettled location is probed at most once a day
 * (spec, "A probe is cheap and is not repeated per request").
 */
export function needsMarineProbe(
  evidence: MarineCoverageEvidence | undefined,
  today: string,
  params: { readonly confirmations?: number },
): boolean {
  if (evidence === undefined) {
    return true;
  }

  return (
    marineCoverageVerdict(evidence, params).kind === 'undecided' && evidence.lastProbedOn !== today
  );
}
