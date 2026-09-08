import { Logger } from '@nestjs/common';
import { asc, sql } from 'drizzle-orm';

import type { ResolvedDefinition } from '../../../domain/activity/activity-definition';
import { type DeclarationFault, loadDeclarations } from '../../../domain/activity/declaration.load';
import { isErr } from '../../../domain/shared/result';
import type { Database } from '../../../infrastructure/db/database';
import { activityDefinitions } from '../../../infrastructure/db/schema/rules';
import type { ActivityCataloguePort } from '../ports/activity-catalogue.port';
import { IndexedCatalogue } from '../indexed-catalogue';

/**
 * What one published row carries: the declaration exactly as it was authored,
 * and the shared rules it names, as they were at the moment it was published.
 *
 * Storing the pair is what makes the row self-contained. The declaration alone
 * would need whichever `shared-rules.json` was in the repository that week to be
 * readable, and nothing records which that was — so reproducing a month-old
 * computation would need git archaeology, which is the thing this table exists
 * to remove.
 */
export interface PublishedDeclaration {
  readonly declaration: unknown;
  readonly sharedRules: unknown;
}

export interface StoreCatalogueOptions {
  /**
   * How long the in-process copy is trusted before the store is asked whether a
   * newer version exists. Rules change about once a month, so this is a
   * cadence rather than a consistency mechanism (data-model.md, section 5).
   */
  readonly lifetimeMs?: number;
  readonly now?: () => number;
}

const DEFAULT_LIFETIME_MS = 300_000;

/**
 * The catalogue over the published versions.
 *
 * It holds a resolved copy in memory and answers from it, because the port is
 * synchronous and because a declaration is read on every request while it
 * changes about once a month. The store is consulted again on a lifetime, and a
 * newly published version is picked up without a restart.
 *
 * Every row is revalidated on the way out, through the same loader the files go
 * through. That is not belt and braces: a row can be edited in psql and a
 * rollback can leave a definition written by a newer build, and neither of those
 * may reach the engine unchecked (data-model.md, section 3).
 */
export class StoreActivityCatalogue implements ActivityCataloguePort {
  private readonly logger = new Logger(StoreActivityCatalogue.name);

  private readonly lifetimeMs: number;

  private readonly now: () => number;

  private index: IndexedCatalogue;

  private checkedAt: number;

  private inFlight: Promise<boolean> | undefined;

  private constructor(
    private readonly db: Database,
    definitions: readonly ResolvedDefinition[],
    options: StoreCatalogueOptions,
  ) {
    this.lifetimeMs = options.lifetimeMs ?? DEFAULT_LIFETIME_MS;
    this.now = options.now ?? ((): number => Date.now());
    this.index = new IndexedCatalogue(definitions);
    this.checkedAt = this.now();
  }

  static async load(
    db: Database,
    options: StoreCatalogueOptions = {},
  ): Promise<StoreActivityCatalogue> {
    return new StoreActivityCatalogue(db, await read(db), options);
  }

  activities(): readonly ResolvedDefinition[] {
    this.scheduleCheck();

    return this.index.activities();
  }

  find(code: string): ResolvedDefinition | undefined {
    this.scheduleCheck();

    return this.index.find(code);
  }

  findVersion(code: string, version: number): ResolvedDefinition | undefined {
    this.scheduleCheck();

    return this.index.findVersion(code, version);
  }

  /**
   * Compares the published versions against the copy in memory and reloads when
   * they differ. Returns whether anything changed.
   *
   * The comparison is on `max(version)` per code rather than on the content:
   * a published version is immutable, so a version that exists and has not
   * changed cannot have changed.
   */
  async refresh(): Promise<boolean> {
    const published = await this.db
      .select({
        code: activityDefinitions.code,
        version: sql<number>`max(${activityDefinitions.version})`,
      })
      .from(activityDefinitions)
      .groupBy(activityDefinitions.code);

    const known = new Map(this.index.activities().map((one) => [one.code, one.version]));
    const changed =
      published.length !== known.size ||
      published.some(({ code, version }) => known.get(code) !== Number(version));

    this.checkedAt = this.now();

    if (!changed) {
      return false;
    }

    this.index = new IndexedCatalogue(await read(this.db));
    this.logger.log(
      `Reloaded the catalogue: ${this.index
        .activities()
        .map((one) => `${one.code}@${one.version}`)
        .join(', ')}`,
    );

    return true;
  }

  /** Whatever check is currently running, for a test that must not race one. */
  async settled(): Promise<void> {
    await this.inFlight;
  }

  /**
   * Starts a check if the copy has aged past its lifetime, and never waits for
   * it: the port is synchronous and an answer computed from rules that are five
   * minutes old is an answer, while an answer that waited for a round trip to
   * the database is a slower one for no gain.
   */
  private scheduleCheck(): void {
    if (this.inFlight !== undefined || this.now() - this.checkedAt < this.lifetimeMs) {
      return;
    }

    this.inFlight = this.refresh()
      .catch((cause: unknown) => {
        // The store being unreachable costs a newer version arriving late. It
        // must not cost the answer: the copy in memory is still valid rules.
        this.logger.warn(
          `Could not check for newly published rules: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
        this.checkedAt = this.now();

        return false;
      })
      .finally(() => {
        this.inFlight = undefined;
      });
  }
}

async function read(db: Database): Promise<readonly ResolvedDefinition[]> {
  const rows = await db
    .select({
      code: activityDefinitions.code,
      version: activityDefinitions.version,
      definition: activityDefinitions.definition,
    })
    .from(activityDefinitions)
    .orderBy(asc(activityDefinitions.code), asc(activityDefinitions.version));

  const definitions: ResolvedDefinition[] = [];

  for (const row of rows) {
    const published = row.definition as PublishedDeclaration;
    const result = loadDeclarations([published.declaration], published.sharedRules);

    if (isErr(result)) {
      throw new Error(describe(`${row.code}@${row.version}`, result.error));
    }

    definitions.push(...result.value);
  }

  return definitions;
}

function describe(published: string, faults: readonly DeclarationFault[]): string {
  const lines = faults.map((fault) => `  ${fault.activity} ${fault.path}: ${fault.message}`);

  return (
    `The published declaration ${published} is invalid and cannot be applied:\n${lines.join('\n')}`
  );
}
