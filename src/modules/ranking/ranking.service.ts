import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { ResolvedDefinition } from '../../domain/activity/activity-definition';
import { applicabilityPlan } from '../../domain/location/applicability-plan';
import type { ApplicabilityPlan } from '../../domain/location/applicability-plan';
import type { ResolvedLocation } from '../../domain/location/resolved-location';
import type { ActivityOutcome } from '../../domain/ranking/activity-outcome';
import { type HorizonLimits, resolveHorizon } from '../../domain/ranking/horizon';
import { type ActivityResult, rankDay } from '../../domain/ranking/rank';
import {
  RANKING_SCOPE,
  type RankedDay,
  type RankingAnswer,
} from '../../domain/ranking/ranking-answer';
import { requiredCapabilities } from '../../domain/ranking/required-capabilities';
import { type DomainError, domainError } from '../../domain/shared/domain-error';
import { type ReasonCode, isRetryable } from '../../domain/shared/reason-code';
import { type Result, err, ok } from '../../domain/shared/result';
import { scoreActivity } from '../../domain/scoring/scoring-engine';
import type { ScoringProfile } from '../../domain/scoring/scoring-profile';
import { buildDayWindows } from '../../domain/weather/day-window';
import type { Capability, MetricCode } from '../../domain/weather/metric';
import { mergeSeries } from '../../domain/weather/merge-series';
import type { WeatherSeries } from '../../domain/weather/weather-series';
import {
  ACTIVITY_CATALOGUE,
  type ActivityCataloguePort,
} from '../activities/ports/activity-catalogue.port';
import { LocationProfileService } from '../geo/location-profile.service';
import { LocationResolverService, type LocationQuery } from '../geo/location-resolver.service';
import { SCORING_PROFILE } from '../scoring/tokens';
import { MetricPlannerService } from '../weather/metric-planner.service';
import type { SeriesRequest, WeatherError } from '../weather/ports/contracts';
import { SourceRouterService } from '../weather/source-router.service';
import { AUDIT_PORT, type AuditPort } from './audit/audit.port';
import { recordOf } from './audit/computation-record';

export interface RankingRequest {
  readonly location: LocationQuery;
  /** Days ahead, including today. Omitted means the configured default. */
  readonly days?: number;
}

/**
 * Why a request produced no answer at all. Every code is a `ReasonCode`: a
 * refused request and a refused activity are explained from the same registry,
 * so a client learns one vocabulary (spec, "Every reason the service reports
 * comes from one registry").
 */
export type RankingError = DomainError<ReasonCode>;

/** The horizon range in force, read from configuration at composition. */
export const RANKING_LIMITS: unique symbol = Symbol('RankingLimits');

/**
 * The scenario the service exists for: a location and a horizon in, an
 * ordered, explained and accountable answer per day out.
 *
 * Nothing here knows the name of an activity. What each stage does, it does
 * because a declaration, a profile or a registry said so — which is what keeps
 * "an activity is data" true through the one place where all of it meets.
 */
@Injectable()
export class RankingService {
  constructor(
    private readonly resolver: LocationResolverService,
    private readonly profiles: LocationProfileService,
    @Inject(ACTIVITY_CATALOGUE) private readonly catalogue: ActivityCataloguePort,
    private readonly planner: MetricPlannerService,
    private readonly router: SourceRouterService,
    @Inject(SCORING_PROFILE) private readonly scoring: ScoringProfile,
    @Inject(RANKING_LIMITS) private readonly limits: HorizonLimits,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
  ) {}

  async rank(request: RankingRequest): Promise<Result<RankingAnswer, RankingError>> {
    // First, and before anything leaves the process: an over-long horizon costs
    // no round trip, and is refused rather than quietly shortened
    // (design.md, Decision 5).
    const days = resolveHorizon(request.days, this.limits);

    if (!days.ok) {
      return days;
    }

    const located = await this.resolver.resolve(request.location);

    if (!located.ok) {
      return err(located.error);
    }

    const location = located.value;
    const profile = await this.profiles.profileFor(location);

    if (!profile.ok) {
      // The place resolved and we still cannot say what is possible there. It
      // is refused rather than answered from nothing, and with a reason that is
      // not `LOCATION_NOT_FOUND`: the place exists, our record of it does not
      // (spec `data-persistence`, "A new location is refused with a reason").
      return err(profile.error);
    }

    const plan = applicabilityPlan(profile.value, this.catalogue.activities());
    const data = await this.gather(location, plan, days.value);
    const answer = this.assemble(location, plan, data, days.value);

    // Buffered, never awaited. The answer is already complete, and a round trip
    // to the store here would put the database back on the path that Decision 2
    // took it off (design.md, Decision 7).
    this.audit.record(
      recordOf(randomUUID(), answer, (code) => this.catalogue.find(code)?.version ?? 0),
    );

    return ok(answer);
  }

  /**
   * Issues every planned call together and collects the outcomes one by one.
   *
   * `allSettled` rather than `all` is the whole of Decision 7: the idiomatic
   * primitive turns one failing item into a failed batch, which is the
   * requirement most easily broken by writing the obvious code. A port already
   * answers with a `Result`, so the settling here is what guards against an
   * adapter that throws where the contract says it must not.
   */
  private async gather(
    location: ResolvedLocation,
    plan: ApplicabilityPlan,
    days: number,
  ): Promise<GatheredData> {
    const planned = this.planner.plan({
      requirements: plan.requirements,
      location: location.coordinates,
      horizon: { kind: 'forecast', forecastDays: days },
      timezone: location.timezone,
    });

    if (!planned.ok) {
      // A declaration naming a metric no source serves is caught at load, so
      // this is our own misconfiguration rather than an outage. It is contained
      // like any other data failure instead of cancelling the answer.
      return { failures: new Map(CAPABILITIES_ALL.map((one) => [one, planned.error])) };
    }

    const outcomes = await Promise.allSettled(
      planned.value.requests.map(async (item) => ({
        capability: item.capability,
        result: await this.fetchOne(item),
      })),
    );

    const failures = new Map<Capability, WeatherError>();
    let series: WeatherSeries | undefined;

    for (const [index, settled] of outcomes.entries()) {
      const capability = planned.value.requests[index]?.capability;

      if (capability === undefined) {
        continue;
      }

      if (settled.status === 'rejected') {
        failures.set(capability, transportFault(capability, settled.reason));
        continue;
      }

      if (!settled.value.result.ok) {
        failures.set(capability, settled.value.result.error);
        continue;
      }

      if (series === undefined) {
        series = settled.value.result.value;
        continue;
      }

      const merged = mergeSeries(series, settled.value.result.value);

      if (merged.ok) {
        series = merged.value;
      } else {
        // Two series that do not line up cannot both be read; the one that
        // arrived first stays, and the other's activities lose it. Merging them
        // anyway would move a value by a slot and never say so.
        failures.set(
          capability,
          domainError('SCHEMA_MISMATCH', merged.error.message, { capability }),
        );
      }
    }

    return series === undefined ? { failures } : { series, failures };
  }

  private async fetchOne(request: SeriesRequest): Promise<Result<WeatherSeries, WeatherError>> {
    const port = this.router.portFor(request.capability);

    return port.ok ? port.value.fetch(request) : port;
  }

  private assemble(
    location: ResolvedLocation,
    plan: ApplicabilityPlan,
    data: GatheredData,
    requestedDays: number,
  ): RankingAnswer {
    const { series } = data;
    const windows = series === undefined ? [] : buildDayWindows(series).slice(0, requestedDays);
    const days: RankedDay[] = windows.map((window) => ({
      date: window.date,
      // Honest today because every window built here is a whole local day; the
      // behaviour this will describe arrives with TD-01.
      complete: !window.partial,
      hoursCounted: window.hoursInDay,
      ranking: rankDay(
        plan.outcomes.map(({ definition, verdict }) => ({
          activity: definition.code,
          outcome:
            verdict.kind === 'not_applicable'
              ? { kind: 'not_applicable', reason: verdict.reason }
              : verdict.kind === 'undecided'
                ? missing(verdict.reason, [])
                : (this.unavailable(definition, data) ??
                  // `series` is defined wherever a window exists.
                  scoreActivity(definition, series as WeatherSeries, window, this.scoring)),
        })),
      ),
    }));

    return {
      location,
      timezone: timezoneOf(location, series),
      requestedDays,
      days,
      // No day could be identified, because a day is the location's local date
      // and only the source ever told us one (TD-01 of stage-two.md, section
      // 10). The activities still answer, rather than the request failing.
      undated: days.length > 0 ? [] : this.undated(plan, data),
      fetchedAt: obtainedAt(series),
      stale: series?.provenance.some((entry) => entry.stale) ?? false,
      profileId: this.scoring.id,
      profileVersion: this.scoring.version,
      scope: RANKING_SCOPE,
    };
  }

  /**
   * Missing data for an activity whose sources did not all answer, or
   * `undefined` when every capability it depends on did.
   *
   * The containment is per activity because the dependency is: the marine host
   * being down costs the answer surfing and nothing else, and no line here has
   * to know which activity that is.
   */
  private unavailable(
    definition: ResolvedDefinition,
    data: GatheredData,
  ): ActivityOutcome | undefined {
    for (const [capability, metrics] of requiredCapabilities(definition)) {
      const failure = data.failures.get(capability);

      if (failure !== undefined) {
        return missing(reasonFor(capability, failure), metrics);
      }
    }

    return undefined;
  }

  private undated(plan: ApplicabilityPlan, data: GatheredData): readonly ActivityResult[] {
    return plan.outcomes.map(({ definition, verdict }) => ({
      activity: definition.code,
      outcome:
        verdict.kind === 'not_applicable'
          ? ({ kind: 'not_applicable', reason: verdict.reason } as const)
          : (this.unavailable(definition, data) ??
            missing(verdict.kind === 'undecided' ? verdict.reason : 'PROVIDER_UNAVAILABLE', [])),
    }));
  }
}

const CAPABILITIES_ALL: readonly Capability[] = ['forecast', 'marine', 'archive'];

interface GatheredData {
  readonly series?: WeatherSeries;
  readonly failures: ReadonlyMap<Capability, WeatherError>;
}

/**
 * Which reason names the failure of a capability.
 *
 * An exhausted outbound budget is its own answer rather than "the provider is
 * unavailable": the provider is fine, and we declined to ask. Both are
 * retryable and they mean different things to an operator, which is the whole
 * reason the code exists (ADR 0006).
 *
 * The marine host has its own code because "the wave model is down" is a
 * statement a client can act on, and it is the one failure a user is most
 * likely to see.
 */
function reasonFor(capability: Capability, failure: WeatherError): ReasonCode {
  if (failure.code === 'PROVIDER_BUSY') {
    return 'PROVIDER_BUSY';
  }

  return capability === 'marine' ? 'MARINE_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE';
}

function missing(reason: ReasonCode, metrics: readonly MetricCode[]): ActivityOutcome {
  return {
    kind: 'no_data',
    reason,
    missingMetrics: metrics,
    // From the registry, never decided here: a result that claimed one thing
    // while the registry said another would be two answers to one question.
    retryable: isRetryable(reason),
  };
}

/**
 * The oldest moment any part of the answer was obtained at. An answer is only
 * as fresh as its stalest ingredient, and reporting the newest would make a
 * cached marine series look as recent as the forecast beside it.
 */
function obtainedAt(series: WeatherSeries | undefined): string | null {
  const times = series?.provenance.map((entry) => entry.fetchedAt).toSorted() ?? [];

  return times[0] ?? null;
}

/**
 * The zone the dates are in. The geocoder's answer when there is one; otherwise
 * whatever the source resolved `auto` to, which for a request made by
 * coordinates is the only thing that ever knew. `null` rather than a guess when
 * neither said (spec, "A day is the location's own local date").
 */
function timezoneOf(location: ResolvedLocation, series: WeatherSeries | undefined): string | null {
  if (location.timezone !== 'auto') {
    return location.timezone;
  }

  return series?.provenance.find((entry) => entry.timezone !== undefined)?.timezone ?? null;
}

function transportFault(capability: Capability, cause: unknown): WeatherError {
  return domainError('TRANSPORT_FAILURE', 'the source threw instead of answering', {
    capability,
    cause: cause instanceof Error ? cause.message : String(cause),
  });
}
