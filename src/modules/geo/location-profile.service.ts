import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import type { ResolvedDefinition } from '../../domain/activity/activity-definition';
import { APPLICABILITY_RULES_VERSION } from '../../domain/activity/applicability.registry';
import {
  type LocationProfile,
  type MarineCoverageEvidence,
  type SnowSeasonEvidence,
  isOutdated,
  needsMarineProbe,
  recordProbe,
} from '../../domain/location/location-profile';
import type { ResolvedLocation } from '../../domain/location/resolved-location';
import { type DomainError, domainError } from '../../domain/shared/domain-error';
import type { ReasonCode } from '../../domain/shared/reason-code';
import { type Result, err, ok } from '../../domain/shared/result';
import { SingleFlight } from '../../common/cache/single-flight';
import {
  ACTIVITY_CATALOGUE,
  type ActivityCataloguePort,
} from '../activities/ports/activity-catalogue.port';
import { LOCATION_PROFILE_STORE, type LocationProfilePort } from './ports/location-profile.port';
import { LOCATION_STORE, type LocationStorePort } from './ports/location-store.port';
import { MarineProbeService } from './marine-probe.service';
import { SnowSeasonService } from './snow-season.service';

/** Why a place could not be profiled. From the one registry, like every reason. */
export type ProfileError = DomainError<ReasonCode>;

export interface LocationProfileOptions {
  /** The clock the probe's day is read from. Injected so a test can move it. */
  readonly now?: () => number;
}

/**
 * Optional, and unbound by default: the process clock is the right one
 * everywhere except a test that has to reach tomorrow.
 */
export const LOCATION_PROFILE_OPTIONS: unique symbol = Symbol('LocationProfileOptions');

const DEFAULT_CONFIRMATIONS = 2;

/**
 * Answers "what is possible here?" for a location, gathering the evidence the
 * first time and reusing it afterwards.
 *
 * Evidence is gathered only for rules some activity actually declares, so an
 * installation whose catalogue has no wave activity issues no marine probes —
 * the outbound call is driven by the declarations, never by a list of place
 * types in the code (spec, "Activities without applicability rules are
 * available everywhere").
 */
@Injectable()
export class LocationProfileService {
  private readonly logger = new Logger(LocationProfileService.name);

  private readonly now: () => number;

  /**
   * One profiling at a time per location.
   *
   * Two requests for the same place arriving together would otherwise both find
   * no probe recorded and both issue one, and the second would be spent on a
   * question the first had already answered. The store's primary key keeps the
   * second from being *recorded*; this keeps it from being *made*
   * (spec, "The same day cannot be probed twice").
   */
  private readonly profiling = new SingleFlight<Result<LocationProfile, ProfileError>>();

  constructor(
    @Inject(LOCATION_PROFILE_STORE) private readonly store: LocationProfilePort,
    private readonly marineProbe: MarineProbeService,
    private readonly snowSeason: SnowSeasonService,
    @Inject(ACTIVITY_CATALOGUE) private readonly catalogue: ActivityCataloguePort,
    @Inject(LOCATION_STORE) private readonly locations: LocationStorePort,
    @Optional() @Inject(LOCATION_PROFILE_OPTIONS) options: LocationProfileOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
  }

  profileFor(location: ResolvedLocation): Promise<Result<LocationProfile, ProfileError>> {
    return this.profiling.run(location.id, () => this.compute(location));
  }

  private async compute(
    location: ResolvedLocation,
  ): Promise<Result<LocationProfile, ProfileError>> {
    let stored: LocationProfile | undefined;

    try {
      stored = await this.store.find(location.id);
    } catch (cause) {
      // The adapter answers from memory through an outage and only throws when
      // the store said something we cannot act on — a table that is not there,
      // a column that moved. Not knowing whether we know this place is the same
      // refusal as not being able to store it, and it must not escape as a 500.
      return this.unprofilable(location, cause);
    }

    if (stored === undefined) {
      // The place before the evidence about the place. Doing it here rather
      // than beside the profile write is what keeps an outage from costing two
      // outbound calls per request for a location we are going to refuse anyway.
      try {
        await this.locations.save(location);
      } catch (cause) {
        return this.unprofilable(location, cause);
      }
    }

    const declared = this.catalogue.activities();
    const instant = this.now();
    const today = dayOf(instant);

    // Evidence outlives the rules that read it. A version bump re-stamps the
    // profile and nothing more: verdicts are derived from the evidence on every
    // read, so a changed threshold re-judges what is stored without a single
    // outbound call. That is the whole benefit Decision 4 was chosen for, and
    // discarding the evidence here would throw it away.
    const snow = await this.snowEvidence(location, stored, declared, today);
    const marine = await this.marineEvidence(location, stored, declared, today);

    if (stored !== undefined && !isOutdated(stored) && !snow.changed && !marine.changed) {
      // `computedAt` means when the evidence was computed. Re-stamping it here
      // would hide the age of a heuristic guess and turn every read into a
      // write.
      return ok(stored);
    }

    // Reached either because something was gathered, or because the profile is
    // only being re-stamped with the current rules version. In the second case
    // the evidence is the evidence that was already there, and so is its date.
    const gathered = snow.changed || marine.changed;

    const profile: LocationProfile = {
      locationId: location.id,
      rulesVersion: APPLICABILITY_RULES_VERSION,
      computedAt:
        (gathered ? undefined : stored?.computedAt) ?? new Date(instant).toISOString(),
      evidence: {
        ...(snow.evidence === undefined ? {} : { snowSeason: snow.evidence }),
        ...(marine.evidence === undefined ? {} : { marineCoverage: marine.evidence }),
      },
    };

    try {
      await this.store.save(profile);
    } catch (cause) {
      if (stored !== undefined) {
        // A place we already knew stays rankable. What is lost is the freshly
        // gathered evidence, which costs one more probe tomorrow — not an
        // answer today (spec, "A known location still ranks").
        this.logger.warn(
          `Could not store the profile for ${location.id}: ${describe(cause)}. ` +
            'Answering from what was already known.',
        );

        return ok(stored);
      }

      return this.unprofilable(location, cause);
    }

    return ok(profile);
  }

  /**
   * A place that resolved and cannot be profiled.
   *
   * It is refused rather than answered from evidence held only in this process:
   * the two-phase confirmation needs yesterday's probe to exist today, and a
   * probe that lives in memory never reaches tomorrow — which is exactly the
   * defect this change exists to repair.
   */
  private unprofilable(
    location: ResolvedLocation,
    cause: unknown,
  ): Result<LocationProfile, ProfileError> {
    this.logger.error(`Could not profile ${location.id}: ${describe(cause)}`);

    return err(
      domainError('PROFILE_UNAVAILABLE', 'what is known about places cannot be reached', {
        locationId: location.id,
      }),
    );
  }

  /**
   * Read from the archive once. A profile that fell back to the heuristic is a
   * guess rather than evidence, so it is retried — at most once a day, the same
   * cadence the marine probe keeps, so an unreachable archive costs two calls a
   * day for a location instead of two per request.
   */
  private async snowEvidence(
    location: ResolvedLocation,
    previous: LocationProfile | undefined,
    declared: readonly ResolvedDefinition[],
    today: string,
  ): Promise<Gathered<SnowSeasonEvidence>> {
    const known = previous?.evidence.snowSeason;

    if (!isDeclared(declared, 'snowSeason')) {
      return { changed: known !== undefined };
    }

    if (known !== undefined && !(known.basis === 'elevation' && known.attemptedOn !== today)) {
      return { evidence: known, changed: false };
    }

    const gathered = await this.snowSeason.evidence(location, today);

    return gathered === undefined
      ? { changed: known !== undefined }
      : { evidence: gathered, changed: true };
  }

  private async marineEvidence(
    location: ResolvedLocation,
    previous: LocationProfile | undefined,
    declared: readonly ResolvedDefinition[],
    today: string,
  ): Promise<Gathered<MarineCoverageEvidence>> {
    const known = previous?.evidence.marineCoverage;

    if (!isDeclared(declared, 'marineCoverage')) {
      return { changed: known !== undefined };
    }

    if (!needsMarineProbe(known, today, { confirmations: confirmationsRequired(declared) })) {
      return known === undefined ? { changed: false } : { evidence: known, changed: false };
    }

    const outcome = await this.marineProbe.probe(location.coordinates, location.timezone);

    return { evidence: recordProbe(known, outcome, today), changed: true };
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Evidence, and whether reaching it cost an outbound call. */
interface Gathered<Evidence> {
  readonly evidence?: Evidence;
  readonly changed: boolean;
}

function isDeclared(declared: readonly ResolvedDefinition[], rule: string): boolean {
  return declared.some((definition) =>
    definition.applicability.some((declaredRule) => declaredRule.rule === rule),
  );
}

/**
 * The strictest confirmation count any activity asks for. Two activities may
 * name the same rule with different parameters, and probing to the looser one
 * would settle the stricter one's question on evidence it did not accept.
 */
function confirmationsRequired(declared: readonly ResolvedDefinition[]): number {
  const counts = declared
    .flatMap((definition) => definition.applicability)
    .filter((rule) => rule.rule === 'marineCoverage')
    .map((rule) => (rule.params as { confirmations?: number } | undefined)?.confirmations)
    .filter((count): count is number => typeof count === 'number');

  return counts.length === 0 ? DEFAULT_CONFIRMATIONS : Math.max(...counts);
}

/** The day a probe happened, in UTC: the cadence is ours, not the location's. */
function dayOf(instant: number): string {
  return new Date(instant).toISOString().slice(0, 10);
}
