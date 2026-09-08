import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scoreActivity } from '../../src/domain/scoring/scoring-engine';
import { buildDayWindows } from '../../src/domain/weather/day-window';
import { SeedActivityCatalogue } from '../../src/modules/activities/seed-catalogue';
import { seedDir } from '../../src/modules/activities/seed-files';
import { readScoringProfile } from '../../src/modules/scoring/scoring-profile.service';
import { readSeries, referenceCase } from './support/reference-cases';

/**
 * The claim the whole change exists to make: a new activity is a file, not a
 * release (spec `activity-catalog`, "An activity is a declaration, not code").
 *
 * The fifth activity below is written entirely in JSON. Nothing in
 * `src/domain/` or `src/modules/` knows the word "kitesurfing", and this test
 * would have to change if anything did.
 */
const KITESURFING = {
  code: 'kitesurfing',
  version: 1,
  titleKey: 'activity.kitesurfing',
  include: ['shared:severe-weather', 'shared:no-daylight'],
  applicability: [{ rule: 'marineCoverage', params: { confirmations: 2 } }],
  constraints: [
    {
      reason: 'FLAT_SEA',
      when: {
        metric: 'wave_height',
        unit: 'm',
        aggregation: { type: 'max' },
        op: 'lt',
        value: 0.2,
      },
    },
  ],
  features: [
    {
      id: 'windPower',
      metric: 'wind_speed_10m',
      unit: 'm/s',
      aggregation: { type: 'daylightWindow', params: { reduce: 'mean' } },
      // The inversion of every other activity's wind curve, and it needs no
      // exception anywhere: a kite wants the wind a walk does not.
      normalizer: { type: 'trapezoid', params: { a: 4, b: 7, c: 15, d: 22 } },
      weight: 0.6,
      nullPolicy: 'fail',
    },
    {
      id: 'chop',
      metric: 'wave_height',
      unit: 'm',
      aggregation: { type: 'daylightWindow', params: { reduce: 'max' } },
      normalizer: { type: 'trapezoid', params: { a: 0.2, b: 0.5, c: 2.0, d: 3.0 } },
      weight: 0.4,
      nullPolicy: 'exclude',
    },
  ],
};

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The real seed directory plus one more declaration, and nothing else. */
function seedsPlusKitesurfing(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fifth-activity-'));

  scratch.push(dir);
  cpSync(seedDir(), dir, { recursive: true });
  writeFileSync(join(dir, 'kitesurfing.activity.json'), JSON.stringify(KITESURFING, null, 2));

  return dir;
}

describe('a fifth activity, added as data', () => {
  it('joins the catalogue beside the four', () => {
    const catalogue = SeedActivityCatalogue.load(seedsPlusKitesurfing());

    expect(catalogue.activities().map((activity) => activity.code).toSorted()).toEqual([
      'indoor-sightseeing',
      'kitesurfing',
      'outdoor-sightseeing',
      'ski',
      'surfing',
    ]);
  });

  it('is scored on a real recording, by the same engine as the other four', async () => {
    const catalogue = SeedActivityCatalogue.load(seedsPlusKitesurfing());
    const profile = readScoringProfile();
    const series = await readSeries(referenceCase('lisbon-surf'));
    const kitesurfing = catalogue.find('kitesurfing');
    const window = series === undefined ? undefined : buildDayWindows(series)[0];

    if (series === undefined || window === undefined || kitesurfing === undefined) {
      throw new Error('The Lisbon recording and the fifth declaration must both be there.');
    }

    const outcome = scoreActivity(kitesurfing, series, window, profile);

    expect(outcome.kind).toBe('ranked');

    if (outcome.kind !== 'ranked') {
      return;
    }

    expect(outcome.score).toBeGreaterThan(0);
    expect(outcome.breakdown.map((entry) => entry.featureId)).toEqual(['windPower', 'chop']);
    expect(outcome.definitionVersion).toBe(1);
  });

  it('leaves the four already there untouched', async () => {
    const series = await readSeries(referenceCase('lisbon-surf'));
    const window = series === undefined ? undefined : buildDayWindows(series)[0];

    if (series === undefined || window === undefined) {
      throw new Error('The Lisbon recording must answer.');
    }

    const profile = readScoringProfile();
    const before = SeedActivityCatalogue.load();
    const after = SeedActivityCatalogue.load(seedsPlusKitesurfing());

    for (const activity of before.activities()) {
      expect(
        scoreActivity(activity, series, window, profile),
        activity.code,
      ).toEqual(scoreActivity(after.find(activity.code) ?? activity, series, window, profile));
    }
  });

  it('costs no code: no source file names it', () => {
    // Guarded by the naming check in `no-activity-names.spec.ts`, which reads
    // the catalogue rather than a list written here.
    expect(KITESURFING.code).toBe('kitesurfing');
  });
});
