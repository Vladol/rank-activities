import { describe, expect, it } from 'vitest';

import type { ActivityCataloguePort } from '../ports/activity-catalogue.port';

/**
 * The shared catalogue contract, run against every implementation.
 *
 * It exists for the same reason the weather-port conformance suite does: the
 * file-backed catalogue is what a developer runs and the store-backed one is
 * what production runs, and two implementations checked by two different sets
 * of tests drift until the difference is discovered by a user
 * (design.md, Decision 8).
 *
 * Every case is a property of the port rather than of the four activities this
 * service happens to ship, so the suite says nothing about ski or surfing: the
 * declarations below are the suite's own, and both adapters are handed exactly
 * these.
 */
export type CatalogueFactory = (
  declarations: readonly unknown[],
  sharedRules: unknown,
) => Promise<ActivityCataloguePort>;

const SHARED_RULES = {
  version: 1,
  rules: {
    'severe-weather': {
      reason: 'SEVERE_WEATHER',
      when: {
        metric: 'wind_gusts_10m',
        unit: 'm/s',
        aggregation: { type: 'max' },
        op: 'gte',
        value: 25,
      },
    },
  },
};

function declaration(code: string, version: number, weight: number): Record<string, unknown> {
  return {
    code,
    version,
    titleKey: `activity.${code}`,
    include: ['shared:severe-weather'],
    features: [
      {
        id: 'gusts',
        metric: 'wind_gusts_10m',
        unit: 'm/s',
        aggregation: { type: 'max' },
        normalizer: { type: 'inverse', params: { from: 8, to: 17 } },
        weight,
        nullPolicy: 'degrade',
      },
      {
        id: 'warmth',
        metric: 'temperature_2m',
        unit: 'degC',
        aggregation: { type: 'mean' },
        normalizer: { type: 'gaussian', params: { center: 20, sigma: 6 } },
        weight: 1,
        nullPolicy: 'degrade',
      },
    ],
  };
}

const ALPHA_V1 = declaration('alpha', 1, 3);
const ALPHA_V2 = declaration('alpha', 2, 1);
const BETA_V1 = declaration('beta', 1, 1);

export function describeCatalogueContract(name: string, build: CatalogueFactory): void {
  const catalogue = (): Promise<ActivityCataloguePort> =>
    build([ALPHA_V1, ALPHA_V2, BETA_V1], SHARED_RULES);

  describe(`${name}: the activity catalogue contract`, () => {
    it('offers one version of each activity, and it is the highest published', async () => {
      const port = await catalogue();

      expect(port.activities().map((one) => `${one.code}@${one.version}`).toSorted()).toEqual([
        'alpha@2',
        'beta@1',
      ]);
    });

    it('answers `find` with the same declaration it offers for ranking', async () => {
      const port = await catalogue();

      expect(port.find('alpha')).toEqual(port.activities().find((one) => one.code === 'alpha'));
    });

    it('produces nothing for a code no declaration carries', async () => {
      const port = await catalogue();

      expect(port.find('kitesurfing')).toBeUndefined();
    });

    it('keeps a superseded version reachable, which is what makes a past result explicable', async () => {
      const port = await catalogue();

      expect(port.findVersion('alpha', 1)?.version).toBe(1);
      expect(port.findVersion('alpha', 2)?.version).toBe(2);
    });

    it('keeps the superseded version out of what gets ranked', async () => {
      const port = await catalogue();

      expect(port.activities().filter((one) => one.code === 'alpha')).toHaveLength(1);
    });

    it('produces nothing for a version that was never published', async () => {
      const port = await catalogue();

      expect(port.findVersion('alpha', 3)).toBeUndefined();
      expect(port.findVersion('gamma', 1)).toBeUndefined();
    });

    it('expands the included rules rather than handing the reference on', async () => {
      const port = await catalogue();

      expect(port.find('beta')?.constraints.map((one) => one.reason)).toEqual(['SEVERE_WEATHER']);
    });

    it('normalises the contributing weights to one, whatever they were declared as', async () => {
      const port = await catalogue();

      for (const activity of port.activities()) {
        const total = activity.features
          .filter((feature) => feature.role === 'additive')
          .reduce((sum, feature) => sum + (feature.weight ?? 0), 0);

        expect(total, activity.code).toBeCloseTo(1, 12);
      }
    });

    it('answers in a stable order, so two runs produce the same ranking on a tie', async () => {
      const port = await catalogue();

      expect(port.activities().map((one) => one.code)).toEqual(
        (await catalogue()).activities().map((one) => one.code),
      );
    });

    it('resolves the two implementations to the same declaration, field for field', async () => {
      // The point of the suite in one case: whatever the storage, what reaches
      // the engine is the same object.
      const port = await catalogue();

      expect(port.find('alpha')).toEqual((await catalogue()).find('alpha'));
    });
  });
}
