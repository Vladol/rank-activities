import { sql } from 'drizzle-orm';

import { REASON, type ReasonCode } from '../../../domain/shared/reason-code';
import { METRICS, type MetricCode } from '../../../domain/weather/metric';
import { readScoringProfile } from '../../../modules/scoring/scoring-profile.service';
import { SeedActivityCatalogue } from '../../../modules/activities/seed-catalogue';
import { readSeedFiles } from '../../../modules/activities/seed-files';
import type { Database } from '../database';
import { metrics, reasonCodes } from '../schema/reference';
import { type PublicationOutcome, publishVersions } from './publish';

export interface SeedReport {
  readonly metrics: number;
  readonly reasonCodes: number;
  readonly activities: PublicationOutcome;
  readonly profiles: PublicationOutcome;
}

/**
 * The publication step of a deploy: reference data and rule versions arrive as
 * *content*, never as a migration. A migration changes the shape of the store
 * and a seed changes what is in it, and conflating the two makes adding a
 * reason code a schema change (spec, "Reference data arrives by publication,
 * not by migration").
 *
 * Running it twice is a no-op, so it can run on every deploy without anyone
 * having to remember whether it already has.
 */
export async function seed(db: Database): Promise<SeedReport> {
  const reference = await publishReference(db);

  // Publishing an invalid declaration would put a row in front of every
  // instance that no instance can load. It is validated here, by the same
  // loader that will read it back, before anything is written.
  SeedActivityCatalogue.load();

  const { declarations, sharedRules } = readSeedFiles();
  const profile = readScoringProfile();

  return {
    ...reference,
    activities: await publishVersions(
      db,
      'activity',
      declarations.map((declaration) => {
        const authored = declaration as { code: string; version: number; include?: string[] };

        return {
          code: authored.code,
          version: authored.version,
          content: {
            declaration,
            // Only the rules this declaration names. Publishing the whole file
            // would make an edit to an unrelated shared rule fail this
            // activity's republication, which is a false alarm; publishing none
            // of them would make the row unreadable without the repository of
            // that week, which is the archaeology this table exists to remove.
            sharedRules: narrowSharedRules(sharedRules, authored.include ?? []),
          },
        };
      }),
    ),
    profiles: await publishVersions(db, 'profile', [
      { code: profile.id, version: profile.version, content: { ...profile } },
    ]),
  };
}

/**
 * The registries, mirrored from the TypeScript dictionaries they are derived
 * from. Unlike a rule version these are not history: they describe the code
 * that is running, so a changed entry is updated rather than refused.
 */
export async function publishReference(
  db: Database,
): Promise<{ metrics: number; reasonCodes: number }> {
  const metricRows = (Object.keys(METRICS) as MetricCode[]).map((code) => {
    const definition = METRICS[code];

    return {
      code,
      canonicalUnit: definition.canonicalUnit,
      granularity: definition.granularity,
      capability: definition.capability,
      kind: definition.kind,
      plausibleMin: definition.plausible?.[0] ?? null,
      plausibleMax: definition.plausible?.[1] ?? null,
    };
  });

  await db
    .insert(metrics)
    .values(metricRows)
    .onConflictDoUpdate({
      target: metrics.code,
      set: {
        canonicalUnit: sql`excluded.canonical_unit`,
        granularity: sql`excluded.granularity`,
        capability: sql`excluded.capability`,
        kind: sql`excluded.kind`,
        plausibleMin: sql`excluded.plausible_min`,
        plausibleMax: sql`excluded.plausible_max`,
      },
    });

  const reasonRows = (Object.keys(REASON) as ReasonCode[]).map((code) => ({
    code,
    kind: REASON[code].kind,
  }));

  await db
    .insert(reasonCodes)
    .values(reasonRows)
    .onConflictDoUpdate({ target: reasonCodes.code, set: { kind: sql`excluded.kind` } });

  return { metrics: metricRows.length, reasonCodes: reasonRows.length };
}

const INCLUDE_PREFIX = 'shared:';

/** The shared rules a declaration includes, and no others. */
function narrowSharedRules(sharedRules: unknown, include: readonly string[]): unknown {
  const source = sharedRules as { version?: unknown; rules?: Record<string, unknown> };
  const wanted = include
    .filter((reference) => reference.startsWith(INCLUDE_PREFIX))
    .map((reference) => reference.slice(INCLUDE_PREFIX.length));

  return {
    version: source.version,
    rules: Object.fromEntries(
      wanted
        .filter((name) => source.rules !== undefined && name in source.rules)
        .map((name) => [name, source.rules?.[name]]),
    ),
  };
}
