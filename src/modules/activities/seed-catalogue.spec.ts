import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SeedActivityCatalogue } from './seed-catalogue';
import { seedDir } from './seed-files';

/**
 * The catalogue is the only source of activities (spec `activity-catalog`).
 * Everything below is checked against the seed files themselves rather than
 * against a copy of them in the test: a declaration that stopped loading would
 * otherwise still be green here.
 */
const SEEDED_ACTIVITIES = ['indoor-sightseeing', 'outdoor-sightseeing', 'ski', 'surfing'] as const;

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A seed directory copied from the real one, with one file replaced. */
function seedsWith(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'seeds-'));

  scratch.push(dir);

  for (const file of readdirSync(seedDir())) {
    if (!(file in files)) {
      writeFileSync(join(dir, file), readFileSync(join(seedDir(), file), 'utf8'));
    }
  }

  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(dir, file), JSON.stringify(content));
  }

  return dir;
}

describe('the seeded catalogue', () => {
  it('loads the four declarations of stage-five.md section 6', () => {
    const catalogue = SeedActivityCatalogue.load();

    expect(catalogue.activities().map((activity) => activity.code).toSorted()).toEqual([
      ...SEEDED_ACTIVITIES,
    ]);
  });

  it('makes the set of rankable activities equal to the set of declarations', () => {
    const catalogue = SeedActivityCatalogue.load();
    const declared = readdirSync(seedDir())
      .filter((file) => file.endsWith('.activity.json'))
      .map((file) => file.replace('.activity.json', ''));

    expect(catalogue.activities().map((activity) => activity.code).toSorted()).toEqual(
      declared.toSorted(),
    );
  });

  it('produces nothing for a code no declaration carries', () => {
    expect(SeedActivityCatalogue.load().find('kitesurfing')).toBeUndefined();
    expect(SeedActivityCatalogue.load().find('ski')?.code).toBe('ski');
  });

  it('normalises every declaration weights to one', () => {
    for (const activity of SeedActivityCatalogue.load().activities()) {
      const total = activity.features
        .filter((feature) => feature.role === 'additive')
        .reduce((sum, feature) => sum + (feature.weight ?? 0), 0);

      expect(total, activity.code).toBeCloseTo(1, 12);
    }
  });

  it('ranks one version of an activity, not every version it has ever had', () => {
    // Publishing version 2 must not make the activity appear twice, and
    // keeping only whichever file was read last is the silent overwrite the
    // version check exists to prevent.
    const dir = seedsWith({
      'ski-v2.activity.json': {
        ...(JSON.parse(readFileSync(join(seedDir(), 'ski.activity.json'), 'utf8')) as object),
        version: 2,
      },
    });
    const catalogue = SeedActivityCatalogue.load(dir);

    expect(catalogue.activities().map((activity) => activity.code).toSorted()).toEqual([
      ...SEEDED_ACTIVITIES,
    ]);
    expect(catalogue.find('ski')?.version).toBe(2);
  });

  it('keeps the earlier version reachable, so a past computation can be reproduced', () => {
    const dir = seedsWith({
      'ski-v2.activity.json': {
        ...(JSON.parse(readFileSync(join(seedDir(), 'ski.activity.json'), 'utf8')) as object),
        version: 2,
      },
    });
    const catalogue = SeedActivityCatalogue.load(dir);

    expect(catalogue.findVersion('ski', 1)?.version).toBe(1);
    expect(catalogue.findVersion('ski', 2)?.version).toBe(2);
    expect(catalogue.findVersion('ski', 3)).toBeUndefined();
  });

  it('refuses to start on one broken declaration, keeping none of the others', () => {
    const dir = seedsWith({
      'ski.activity.json': { code: 'ski', version: 1, titleKey: 'activity.ski', features: [] },
    });

    expect(() => SeedActivityCatalogue.load(dir)).toThrowError(/ski/);
  });

  it('names the fault well enough to fix it', () => {
    const dir = seedsWith({
      'ski.activity.json': {
        code: 'ski',
        version: 1,
        titleKey: 'activity.ski',
        features: [
          {
            id: 'gusts',
            metric: 'wind_gusts_10m',
            unit: 'km/h',
            aggregation: { type: 'max' },
            normalizer: { type: 'inverse', params: { from: 8, to: 17 } },
            weight: 1,
            nullPolicy: 'degrade',
          },
        ],
      },
    });

    expect(() => SeedActivityCatalogue.load(dir)).toThrowError(/km\/h/);
  });
});

describe('the shared rules reach the activities that include them', () => {
  it('gives severe weather to all four, indoor sightseeing among them', () => {
    for (const activity of SeedActivityCatalogue.load().activities()) {
      expect(
        activity.constraints.map((constraint) => constraint.reason),
        activity.code,
      ).toContain('SEVERE_WEATHER');
    }
  });

  it('gives darkness to the three outdoor activities and not to indoor', () => {
    const catalogue = SeedActivityCatalogue.load();
    const withDarkness = catalogue
      .activities()
      .filter((activity) =>
        activity.constraints.some((constraint) => constraint.reason === 'NO_DAYLIGHT'),
      )
      .map((activity) => activity.code);

    // Tromso in December: indoor must stay above zero, which it cannot do if
    // darkness zeroes it (stage-five.md, section 15).
    expect(withDarkness.toSorted()).toEqual(['outdoor-sightseeing', 'ski', 'surfing']);
  });
});

function indoor() {
  return SeedActivityCatalogue.load().find('indoor-sightseeing');
}

describe('indoor sightseeing, the activity that inverts the others', () => {
  it('states its inversion in its curves, not in code', () => {
    const features = indoor()?.features ?? [];

    // Discomfort rises as comfort falls; wind makes a museum more attractive,
    // where outdoors it makes a walk a fight.
    expect(features.find((feature) => feature.id === 'discomfort')?.normalizer.type).toBe(
      'inverseGaussian',
    );
    expect(features.find((feature) => feature.id === 'wind')?.normalizer.type).toBe('linear');
  });

  it('states its floor and ceiling as data', () => {
    expect(indoor()?.postprocess).toEqual({ floor: 40, ceiling: 85 });
  });

  it('reads its own rain metric and its own window, not the outdoor ones', () => {
    const features = indoor()?.features ?? [];
    const outdoor = SeedActivityCatalogue.load().find('outdoor-sightseeing')?.features ?? [];

    // precipitation_hours against shareOfHours, whole day against daylight:
    // indoor is not the literal inverse of outdoor, and no code says so.
    expect(features.find((feature) => feature.id === 'rainHours')?.metric).toBe(
      'precipitation_hours',
    );
    expect(outdoor.find((feature) => feature.id === 'dryHours')?.aggregation.type).toBe(
      'shareOfHours',
    );
    expect(features.find((feature) => feature.id === 'discomfort')?.aggregation.type).toBe('mean');
  });

  it('is the only activity carrying bounds, and carries no limiting feature', () => {
    const bounded = SeedActivityCatalogue.load()
      .activities()
      .filter((activity) => activity.postprocess !== undefined)
      .map((activity) => activity.code);

    expect(bounded).toEqual(['indoor-sightseeing']);
    expect(indoor()?.features.every((feature) => feature.role === 'additive')).toBe(true);
  });
});

describe('outdoor sightseeing, the only activity with a limiting feature', () => {
  it('declares thermal comfort as limiting, with a floor above zero', () => {
    const outdoor = SeedActivityCatalogue.load().find('outdoor-sightseeing');
    const gate = outdoor?.features.find((feature) => feature.role === 'gate');

    expect(gate?.id).toBe('thermalComfort');
    expect(gate?.gateFloor).toBe(0.15);
    expect(gate?.weight).toBeNull();
  });

  it('leaves the contributing weights summing to one beside it', () => {
    const outdoor = SeedActivityCatalogue.load().find('outdoor-sightseeing');
    const total = (outdoor?.features ?? [])
      .filter((feature) => feature.role === 'additive')
      .reduce((sum, feature) => sum + (feature.weight ?? 0), 0);

    expect(total).toBeCloseTo(1, 12);
  });
});
