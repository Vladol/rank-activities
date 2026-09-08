import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import type { LocationProfile } from '../../../domain/location/location-profile';
import type { LocationId } from '../../../domain/shared/branded';
import type { Database } from '../../../infrastructure/db/database';
import { isUnavailable } from '../../../infrastructure/db/pg-error';
import { locationProfiles, marineProbes } from '../../../infrastructure/db/schema/locations';
import type { MetricsRegistry } from '../../../common/metrics/metrics.registry';
import { METRIC } from '../../../common/metrics/metrics.registry';
import type { LocationProfilePort } from '../ports/location-profile.port';
import { locationRowId } from './db-location.store';
import { probeRowsFrom, profileFrom, snowSeasonProjection, storedEvidenceOf } from './profile-rows';

/**
 * Profiles in PostgreSQL, with the copy in memory the degradation table rests
 * on.
 *
 * The mirror is filled only from what the store has confirmed. That is the
 * distinction the whole degradation depends on: a place this instance has read
 * or written durably is a place it still knows during an outage, while a place
 * it merely computed a profile for and failed to store is *not* known — and
 * treating it as known would turn an outage into an unrecorded profile that
 * quietly disagrees with the next instance (spec, "An unavailable store degrades
 * named capabilities only").
 *
 * `find` never throws: an outage answers with whatever the mirror holds, which
 * is the "known location still ranks" row of that table. `save` does throw,
 * because a caller that has just spent outbound calls gathering evidence has to
 * know the evidence was not kept.
 */
@Injectable()
export class DbLocationProfileStore implements LocationProfilePort {
  private readonly logger = new Logger(DbLocationProfileStore.name);

  private readonly mirror = new Map<LocationId, LocationProfile>();

  constructor(
    private readonly db: Database,
    private readonly metrics: MetricsRegistry,
  ) {}

  async find(locationId: LocationId): Promise<LocationProfile | undefined> {
    try {
      const stored = await this.read(locationId);

      if (stored === undefined) {
        this.mirror.delete(locationId);

        return undefined;
      }

      this.mirror.set(locationId, stored);

      return stored;
    } catch (cause) {
      if (!isUnavailable(cause)) {
        throw cause;
      }

      this.metrics.increment(METRIC.profileStoreDegraded, { operation: 'find' });
      this.logger.warn(
        `The store did not answer for ${locationId}; using what is held in memory. ` +
          `${cause instanceof Error ? cause.message : String(cause)}`,
      );

      return this.mirror.get(locationId);
    }
  }

  /**
   * Writes the profile and the probes it implies, in one transaction.
   *
   * The probe rows are inserted and never updated: a probe is a record of a day
   * that was spent, the primary key makes a second one for that day impossible,
   * and the day that lost the race is the day that is already recorded — which
   * is exactly what "at most one probe per location per day" means once two
   * requests are in flight (design.md, Decision 4).
   */
  async save(profile: LocationProfile): Promise<void> {
    const id = locationRowId(profile.locationId);
    const projection = snowSeasonProjection(profile.evidence.snowSeason);
    const evidence = storedEvidenceOf(profile);
    const probes = profile.evidence.marineCoverage
      ? probeRowsFrom(profile.evidence.marineCoverage)
      : [];

    await this.db.transaction(async (tx) => {
      await tx
        .insert(locationProfiles)
        .values({
          locationId: id,
          evidence,
          snowSeason: projection.snowSeason,
          snowSeasonSource: projection.snowSeasonSource,
          rulesVersion: profile.rulesVersion,
          computedAt: new Date(profile.computedAt),
        })
        .onConflictDoUpdate({
          target: locationProfiles.locationId,
          set: {
            evidence,
            snowSeason: projection.snowSeason,
            snowSeasonSource: projection.snowSeasonSource,
            rulesVersion: profile.rulesVersion,
            computedAt: new Date(profile.computedAt),
          },
        });

      if (probes.length > 0) {
        await tx
          .insert(marineProbes)
          .values(
            probes.map((probe) => ({
              locationId: id,
              localDate: probe.localDate,
              allNull: probe.allNull,
              probedAt: new Date(),
            })),
          )
          .onConflictDoNothing({ target: [marineProbes.locationId, marineProbes.localDate] });
      }
    });

    // Read back rather than mirroring what was offered: the probe that lost the
    // race is not the probe that is recorded, and the next request must use the
    // recorded one.
    //
    // The transaction has already committed, so a failure here is not a failure
    // to store. Refusing the caller over it would refuse a location whose
    // profile is durably there; the offered profile goes into the mirror
    // instead, and the next `find` replaces it with what actually won.
    try {
      const stored = await this.read(profile.locationId);

      if (stored !== undefined) {
        this.mirror.set(profile.locationId, stored);
      }
    } catch (cause) {
      this.mirror.set(profile.locationId, profile);
      this.metrics.increment(METRIC.profileStoreDegraded, { operation: 'read_back' });
      this.logger.warn(
        `Stored the profile for ${profile.locationId} but could not read it back: ` +
          `${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  private async read(locationId: LocationId): Promise<LocationProfile | undefined> {
    const id = locationRowId(locationId);
    const [row] = await this.db
      .select()
      .from(locationProfiles)
      .where(eq(locationProfiles.locationId, id))
      .limit(1);

    if (row === undefined) {
      return undefined;
    }

    const probes = await this.db
      .select({ localDate: marineProbes.localDate, allNull: marineProbes.allNull })
      .from(marineProbes)
      .where(eq(marineProbes.locationId, id));

    return profileFrom(locationId, row, probes);
  }
}
