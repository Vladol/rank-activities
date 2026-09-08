import { describe, expect, it } from 'vitest';

import { isErr, isOk } from '../shared/result';
import { loadDeclarations } from './declaration.load';

/**
 * The three levels of validation of docs/development-flow/stage-five.md,
 * section 8, and the resolution that follows them. Every fault here is a
 * startup failure by design: the alternative is a NaN reaching a user
 * (design.md, "Risks").
 */
const SHARED_RULES = {
  version: 1,
  rules: {
    'severe-weather': {
      reason: 'SEVERE_WEATHER',
      when: {
        anyOf: [
          {
            metric: 'weather_code',
            unit: 'wmo_code',
            aggregation: {
              type: 'countIf',
              params: { predicate: { op: 'in', value: [95, 96] }, window: 'day' },
            },
            op: 'gte',
            value: 1,
          },
          {
            metric: 'wind_gusts_10m',
            unit: 'm/s',
            aggregation: { type: 'max' },
            op: 'gte',
            value: 25,
          },
        ],
      },
    },
    'no-daylight': {
      reason: 'NO_DAYLIGHT',
      when: {
        metric: 'daylight_duration',
        unit: 'second',
        aggregation: { type: 'identity' },
        op: 'lte',
        value: 0,
      },
    },
  },
};

function declaration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: 'ski',
    version: 1,
    titleKey: 'activity.ski',
    include: ['shared:severe-weather', 'shared:no-daylight'],
    applicability: [{ rule: 'snowSeason', params: { minColdMonthSnowfallCm: 20 } }],
    constraints: [
      {
        reason: 'NO_SNOW_COVER',
        when: {
          metric: 'snow_depth',
          unit: 'm',
          aggregation: { type: 'max' },
          op: 'lt',
          value: 0.1,
        },
      },
    ],
    features: [
      {
        id: 'snowDepth',
        metric: 'snow_depth',
        unit: 'm',
        aggregation: { type: 'max' },
        normalizer: { type: 'trapezoid', params: { a: 0.1, b: 0.4, c: 2, d: 4 } },
        weight: 0.6,
        nullPolicy: 'fail',
      },
      {
        id: 'gusts',
        metric: 'wind_gusts_10m',
        unit: 'm/s',
        aggregation: { type: 'max' },
        normalizer: { type: 'inverse', params: { from: 8, to: 17 } },
        weight: 0.4,
        nullPolicy: 'degrade',
      },
    ],
    ...overrides,
  };
}

/** The features of the fixture, with one of them altered. */
function withFeature(id: string, patch: Record<string, unknown>): Record<string, unknown>[] {
  return (declaration().features as Record<string, unknown>[]).map((feature) =>
    feature.id === id ? { ...feature, ...patch } : feature,
  );
}

function load(...declarations: unknown[]) {
  return loadDeclarations(declarations, SHARED_RULES);
}

function faultsOf(...declarations: unknown[]): string[] {
  const result = load(...declarations);

  if (isOk(result)) {
    throw new Error('Expected the load to fail.');
  }

  return result.error.map((fault) => `${fault.activity} ${fault.path}: ${fault.message}`);
}

describe('a declaration that names something the registries do not know', () => {
  it('refuses an unknown metric, naming the declaration and the metric', () => {
    const faults = faultsOf(declaration({ features: withFeature('snowDepth', { metric: 'SNOW_DEPHT' }) }));

    expect(faults.join('\n')).toMatch(/ski/);
    expect(faults.join('\n')).toMatch(/SNOW_DEPHT/);
  });

  it('refuses an unknown normalizer without falling back to a default curve', () => {
    const faults = faultsOf(
      declaration({
        features: withFeature('gusts', { normalizer: { type: 'sigmoid', params: { k: 1 } } }),
      }),
    );

    expect(faults.join('\n')).toMatch(/sigmoid/);
  });

  it('refuses an unknown aggregation', () => {
    const faults = faultsOf(
      declaration({ features: withFeature('gusts', { aggregation: { type: 'percentile' } }) }),
    );

    expect(faults.join('\n')).toMatch(/percentile/);
  });

  it('refuses an unknown applicability rule', () => {
    const faults = faultsOf(declaration({ applicability: [{ rule: 'altitudeAbove', params: {} }] }));

    expect(faults.join('\n')).toMatch(/altitudeAbove/);
  });

  it('refuses a reason code that is not in the registry', () => {
    const faults = faultsOf(
      declaration({
        constraints: [
          {
            reason: 'NO_SNOW',
            when: { metric: 'snow_depth', unit: 'm', aggregation: { type: 'max' }, op: 'lt', value: 0.1 },
          },
        ],
      }),
    );

    expect(faults.join('\n')).toMatch(/NO_SNOW/);
  });
});

describe('normalizer parameters are checked against that normalizer schema', () => {
  it('refuses parameters the curve own schema rejects, naming the feature', () => {
    const faults = faultsOf(
      declaration({
        features: withFeature('snowDepth', { normalizer: { type: 'trapezoid', params: { a: 1 } } }),
      }),
    );

    expect(faults.join('\n')).toMatch(/snowDepth/);
    expect(faults.join('\n')).toMatch(/trapezoid|params|b/i);
  });

  it('refuses a linear curve whose bounds coincide', () => {
    expect(
      faultsOf(
        declaration({
          features: withFeature('gusts', { normalizer: { type: 'inverse', params: { from: 8, to: 8 } } }),
        }),
      ).join('\n'),
    ).toMatch(/gusts/);
  });

  it('refuses aggregation parameters the strategy own schema rejects', () => {
    expect(
      faultsOf(
        declaration({
          features: withFeature('gusts', {
            aggregation: { type: 'daylightWindow', params: { reduce: 'median' } },
          }),
        }),
      ).join('\n'),
    ).toMatch(/gusts/);
  });
});

describe('one broken declaration is never partially applied', () => {
  it('refuses to load the valid declarations alongside an invalid one', () => {
    const valid = declaration({ code: 'surfing', include: [], applicability: [] });
    const broken = declaration({ code: 'ski', features: withFeature('gusts', { metric: 'nope' }) });

    const result = load(valid, broken);

    expect(isErr(result)).toBe(true);
  });

  it('reports every fault of the load rather than only the first', () => {
    const faults = faultsOf(
      declaration({ code: 'ski', features: withFeature('gusts', { metric: 'nope' }) }),
      declaration({ code: 'surfing', include: ['shared:typo'], applicability: [] }),
    );

    expect(faults.some((fault) => fault.includes('nope'))).toBe(true);
    expect(faults.some((fault) => fault.includes('typo'))).toBe(true);
  });

  it('refuses two declarations claiming the same code and version', () => {
    expect(faultsOf(declaration(), declaration()).join('\n')).toMatch(/ski/);
  });
});

describe('weights are normalised on load', () => {
  it('rescales weights that sum to 2.0, preserving their ratios', () => {
    const result = load(
      declaration({
        features: [
          { ...(declaration().features as Record<string, unknown>[])[0], weight: 1.2 },
          { ...(declaration().features as Record<string, unknown>[])[1], weight: 0.8 },
        ],
      }),
    );

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    const weights = result.value[0]?.features.map((feature) => feature.weight);

    expect(weights?.[0]).toBeCloseTo(0.6, 12);
    expect(weights?.[1]).toBeCloseTo(0.4, 12);
    expect((weights?.[0] ?? 0) + (weights?.[1] ?? 0)).toBeCloseTo(1, 12);
  });

  it('refuses a declaration whose weights sum to zero, naming it', () => {
    const faults = faultsOf(
      declaration({
        features: (declaration().features as Record<string, unknown>[]).map((feature) => ({
          ...feature,
          weight: 0,
        })),
      }),
    );

    expect(faults.join('\n')).toMatch(/ski/);
  });

  it('does not rescale the contributing features when a limiting one is added', () => {
    const withGate = load(
      declaration({
        features: [
          ...(declaration().features as Record<string, unknown>[]),
          {
            id: 'thermalComfort',
            role: 'gate',
            gateFloor: 0.15,
            metric: 'apparent_temperature',
            unit: 'degC',
            aggregation: { type: 'daylightWindow', params: { reduce: 'mean' } },
            normalizer: { type: 'trapezoid', params: { a: 2, b: 15, c: 25, d: 33 } },
            nullPolicy: 'degrade',
          },
        ],
      }),
    );

    expect(isOk(withGate)).toBe(true);

    if (!isOk(withGate)) {
      return;
    }

    const features = withGate.value[0]?.features ?? [];
    const gate = features.find((feature) => feature.id === 'thermalComfort');

    expect(features.find((feature) => feature.id === 'snowDepth')?.weight).toBeCloseTo(0.6, 12);
    expect(features.find((feature) => feature.id === 'gusts')?.weight).toBeCloseTo(0.4, 12);
    // A limiting feature consumes no weight at all.
    expect(gate?.weight).toBeNull();
    expect(gate?.gateFloor).toBe(0.15);
  });

  it('refuses a limiting feature that could pull the score to zero', () => {
    // Zero belongs to a constraint, which can name its reason.
    const faults = faultsOf(
      declaration({
        features: [
          ...(declaration().features as Record<string, unknown>[]),
          {
            id: 'thermalComfort',
            role: 'gate',
            gateFloor: 0,
            metric: 'apparent_temperature',
            unit: 'degC',
            aggregation: { type: 'daylightWindow', params: { reduce: 'mean' } },
            normalizer: { type: 'trapezoid', params: { a: 2, b: 15, c: 25, d: 33 } },
            nullPolicy: 'degrade',
          },
        ],
      }),
    );

    expect(faults.join('\n')).toMatch(/thermalComfort/);
  });

  it('refuses a limiting feature whose null policy is fail', () => {
    // "fail" over a gate is meaningless: the gate has no weight to fail with.
    const faults = faultsOf(
      declaration({
        features: [
          ...(declaration().features as Record<string, unknown>[]),
          {
            id: 'thermalComfort',
            role: 'gate',
            gateFloor: 0.15,
            metric: 'apparent_temperature',
            unit: 'degC',
            aggregation: { type: 'daylightWindow', params: { reduce: 'mean' } },
            normalizer: { type: 'trapezoid', params: { a: 2, b: 15, c: 25, d: 33 } },
            nullPolicy: 'fail',
          },
        ],
      }),
    );

    expect(faults.join('\n')).toMatch(/thermalComfort/);
  });
});

describe('shared rules included by reference', () => {
  it('gives an including activity the shared constraint, ahead of its own', () => {
    const result = load(declaration());

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    expect(result.value[0]?.constraints.map((constraint) => constraint.reason)).toEqual([
      'SEVERE_WEATHER',
      'NO_DAYLIGHT',
      'NO_SNOW_COVER',
    ]);
  });

  it('reaches an indoor activity that includes severe weather but not darkness', () => {
    const indoor = declaration({
      code: 'indoor-sightseeing',
      include: ['shared:severe-weather'],
      applicability: [],
      constraints: [],
    });

    const result = load(indoor);

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    const reasons = result.value[0]?.constraints.map((constraint) => constraint.reason);

    expect(reasons).toEqual(['SEVERE_WEATHER']);
    // Omitting the rule took no exception in code, only a shorter list.
    expect(reasons).not.toContain('NO_DAYLIGHT');
  });

  it('refuses an include naming a rule that does not exist', () => {
    expect(faultsOf(declaration({ include: ['shared:hurricane'] })).join('\n')).toMatch(/hurricane/);
  });

  it('keeps the shared rule in exactly one place', () => {
    const result = load(declaration(), declaration({ code: 'surfing', constraints: [] }));

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    const [ski, surfing] = result.value;
    const skiSevere = ski?.constraints.find((constraint) => constraint.reason === 'SEVERE_WEATHER');
    const surfSevere = surfing?.constraints.find(
      (constraint) => constraint.reason === 'SEVERE_WEATHER',
    );

    expect(skiSevere).toEqual(surfSevere);
  });
});

describe('a published version is immutable', () => {
  it('refuses content for a published version that differs from what was published', () => {
    const published = load(declaration());

    expect(isOk(published)).toBe(true);

    if (!isOk(published)) {
      return;
    }

    const edited = declaration({ features: withFeature('gusts', { weight: 0.5 }) });
    const result = loadDeclarations([edited], SHARED_RULES, {
      published: published.value.map((definition) => ({
        code: definition.code,
        version: definition.version,
        fingerprint: definition.fingerprint,
      })),
    });

    expect(isErr(result)).toBe(true);

    if (!isErr(result)) {
      return;
    }

    expect(result.error.map((fault) => fault.message).join('\n')).toMatch(/version 1/);
  });

  it('accepts the same version republished with identical content', () => {
    const published = load(declaration());

    expect(isOk(published)).toBe(true);

    if (!isOk(published)) {
      return;
    }

    const again = loadDeclarations([declaration()], SHARED_RULES, {
      published: published.value.map((definition) => ({
        code: definition.code,
        version: definition.version,
        fingerprint: definition.fingerprint,
      })),
    });

    expect(isOk(again)).toBe(true);
  });

  it('accepts a new version beside the old one', () => {
    const published = load(declaration());

    expect(isOk(published)).toBe(true);

    if (!isOk(published)) {
      return;
    }

    const next = loadDeclarations(
      [declaration(), declaration({ version: 2, features: withFeature('gusts', { weight: 0.5 }) })],
      SHARED_RULES,
      {
        published: published.value.map((definition) => ({
          code: definition.code,
          version: definition.version,
          fingerprint: definition.fingerprint,
        })),
      },
    );

    expect(isOk(next)).toBe(true);

    if (!isOk(next)) {
      return;
    }

    expect(next.value.map((definition) => definition.version)).toEqual([1, 2]);
  });
});

describe('the unit a feature restates', () => {
  it('refuses a feature declaring km/h for a metric carried in m/s, naming both units', () => {
    const faults = faultsOf(declaration({ features: withFeature('gusts', { unit: 'km/h' }) }));

    expect(faults.join('\n')).toMatch(/gusts/);
    expect(faults.join('\n')).toMatch(/km\/h/);
    expect(faults.join('\n')).toMatch(/m\/s/);
  });

  it('refuses a constraint declaring the wrong unit too', () => {
    const faults = faultsOf(
      declaration({
        constraints: [
          {
            reason: 'NO_SNOW_COVER',
            when: { metric: 'snow_depth', unit: 'cm', aggregation: { type: 'max' }, op: 'lt', value: 10 },
          },
        ],
      }),
    );

    expect(faults.join('\n')).toMatch(/cm/);
    expect(faults.join('\n')).toMatch(/(^|[^c])m\b/m);
  });
});

describe('thresholds against the plausible range of the metric', () => {
  it('refuses a gust threshold of 60 declared in m/s, naming the value and the range', () => {
    // 60 is a possible hurricane in m/s, so the range alone cannot reject it —
    // and 60 in this field is somebody thinking in km/h (stage-five.md, 8).
    const faults = faultsOf(
      declaration({
        features: withFeature('gusts', { normalizer: { type: 'inverse', params: { from: 8, to: 60 } } }),
      }),
    );

    expect(faults.join('\n')).toMatch(/gusts/);
    expect(faults.join('\n')).toMatch(/60/);
    expect(faults.join('\n')).toMatch(/45/);
  });

  it('refuses a visibility threshold written in metres', () => {
    const faults = faultsOf(
      declaration({
        features: withFeature('gusts', {
          metric: 'visibility',
          unit: 'km',
          aggregation: { type: 'mean' },
          normalizer: { type: 'linear', params: { from: 200, to: 5000 } },
        }),
      }),
    );

    expect(faults.join('\n')).toMatch(/5000/);
  });

  it('refuses a constraint value outside the range of its metric', () => {
    const faults = faultsOf(
      declaration({
        constraints: [
          {
            reason: 'NO_SNOW_COVER',
            when: { metric: 'snow_depth', unit: 'm', aggregation: { type: 'max' }, op: 'lt', value: 100 },
          },
        ],
      }),
    );

    expect(faults.join('\n')).toMatch(/100/);
  });

  it('reads a share as a share rather than against the metric own range', () => {
    // shareOfHours answers in a ratio, so 0.4 and 1.0 are bounds on the share,
    // not on millimetres of precipitation.
    const result = load(
      declaration({
        features: [
          {
            id: 'dryHours',
            metric: 'precipitation',
            unit: 'mm',
            aggregation: {
              type: 'shareOfHours',
              params: { predicate: { op: 'lt', value: 0.1 }, window: 'daylight' },
            },
            normalizer: { type: 'linear', params: { from: 0.4, to: 1 } },
            weight: 1,
            nullPolicy: 'degrade',
          },
        ],
      }),
    );

    expect(isOk(result)).toBe(true);
  });

  it('refuses a predicate threshold written in the wrong unit', () => {
    // The predicate compares the metric's own values, so 5000 here is metres
    // in a field carried in kilometres. It never reaches the curve, so nothing
    // downstream would notice: the share would simply read 1.0 every day.
    const faults = faultsOf(
      declaration({
        features: withFeature('gusts', {
          metric: 'visibility',
          unit: 'km',
          aggregation: {
            type: 'shareOfHours',
            params: { predicate: { op: 'gt', value: 5000 }, window: 'day' },
          },
          normalizer: { type: 'linear', params: { from: 0.4, to: 1 } },
        }),
      }),
    );

    expect(faults.join('\n')).toMatch(/5000/);
    expect(faults.join('\n')).toMatch(/visibility/);
  });

  it('refuses a magnitude comparison on a categorical metric inside a predicate', () => {
    // Rejected as a constraint leaf already; a WMO code is no more ordered
    // inside countIf than outside it.
    const faults = faultsOf(
      declaration({
        features: withFeature('gusts', {
          metric: 'weather_code',
          unit: 'wmo_code',
          aggregation: {
            type: 'countIf',
            params: { predicate: { op: 'gte', value: 95 }, window: 'day' },
          },
          normalizer: { type: 'linear', params: { from: 0, to: 6 } },
        }),
      }),
    );

    expect(faults.join('\n')).toMatch(/weather_code/);
  });

  it('accepts the predicates the seeds actually use', () => {
    const result = load(
      declaration({
        features: withFeature('gusts', {
          metric: 'weather_code',
          unit: 'wmo_code',
          aggregation: {
            type: 'countIf',
            params: { predicate: { op: 'in', value: [95, 96] }, window: 'day' },
          },
          normalizer: { type: 'linear', params: { from: 0, to: 6 } },
        }),
      }),
    );

    expect(isOk(result)).toBe(true);
  });

  it('walks into a composite predicate', () => {
    const faults = faultsOf(
      declaration({
        features: withFeature('gusts', {
          aggregation: {
            type: 'shareOfHours',
            params: {
              predicate: { anyOf: [{ op: 'lt', value: 5 }, { not: { op: 'gt', value: 900 } }] },
              window: 'day',
            },
          },
          normalizer: { type: 'linear', params: { from: 0.4, to: 1 } },
        }),
      }),
    );

    expect(faults.join('\n')).toMatch(/900/);
  });

  it('refuses a share threshold that is not a share', () => {
    const faults = faultsOf(
      declaration({
        features: [
          {
            id: 'dryHours',
            metric: 'precipitation',
            unit: 'mm',
            aggregation: {
              type: 'shareOfHours',
              params: { predicate: { op: 'lt', value: 0.1 }, window: 'daylight' },
            },
            normalizer: { type: 'linear', params: { from: 40, to: 100 } },
            weight: 1,
            nullPolicy: 'degrade',
          },
        ],
      }),
    );

    expect(faults.join('\n')).toMatch(/dryHours/);
  });
});

describe('the channel an aggregation reads must be one the metric is on', () => {
  it('refuses identity over a metric the provider serves only hourly', () => {
    // snow_depth is on the hourly channel only; identity reads the daily one.
    const faults = faultsOf(
      declaration({ features: withFeature('snowDepth', { aggregation: { type: 'identity' } }) }),
    );

    expect(faults.join('\n')).toMatch(/snowDepth/);
    expect(faults.join('\n')).toMatch(/daily/);
  });

  it('refuses an hourly aggregation over a metric the provider serves only daily', () => {
    const faults = faultsOf(
      declaration({
        features: withFeature('gusts', {
          metric: 'precipitation_hours',
          unit: 'hour',
          aggregation: { type: 'mean' },
          normalizer: { type: 'linear', params: { from: 0, to: 12 } },
        }),
      }),
    );

    expect(faults.join('\n')).toMatch(/hourly/);
  });

  it('accepts identity over a metric the provider serves daily', () => {
    const result = load(
      declaration({
        features: withFeature('gusts', {
          metric: 'precipitation_hours',
          unit: 'hour',
          aggregation: { type: 'identity' },
          normalizer: { type: 'linear', params: { from: 0, to: 12 } },
        }),
      }),
    );

    expect(isOk(result)).toBe(true);
  });
});

describe('a derived metric a feature may read', () => {
  it('accepts one and keeps its own unit', () => {
    const result = load(
      declaration({
        features: withFeature('gusts', {
          metric: 'FRESH_COLD_SNOWFALL',
          unit: 'cm',
          aggregation: { type: 'sum' },
          normalizer: { type: 'linear', params: { from: 0, to: 20 } },
        }),
      }),
    );

    expect(isOk(result)).toBe(true);
  });

  it('refuses the wrong unit for one', () => {
    expect(
      faultsOf(
        declaration({
          features: withFeature('gusts', {
            metric: 'FRESH_COLD_SNOWFALL',
            unit: 'm',
            aggregation: { type: 'sum' },
            normalizer: { type: 'linear', params: { from: 0, to: 20 } },
          }),
        }),
      ).join('\n'),
    ).toMatch(/cm/);
  });
});

describe('what a valid declaration resolves to', () => {
  it('keeps its identity, its title key and its applicability rules', () => {
    const result = load(declaration());

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    expect(result.value[0]).toMatchObject({
      code: 'ski',
      version: 1,
      titleKey: 'activity.ski',
      applicability: [{ rule: 'snowSeason', params: { minColdMonthSnowfallCm: 20 } }],
    });
  });

  it('is applicable everywhere when it names no rule', () => {
    const result = load(declaration({ applicability: [] }));

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    expect(result.value[0]?.applicability).toEqual([]);
  });

  it('refuses two features sharing an id, because the id addresses the breakdown', () => {
    expect(
      faultsOf(
        declaration({
          features: (declaration().features as Record<string, unknown>[]).map((feature) => ({
            ...feature,
            id: 'same',
          })),
        }),
      ).join('\n'),
    ).toMatch(/same/);
  });

  it('carries the bounds an activity declares', () => {
    const result = load(declaration({ postprocess: { floor: 40, ceiling: 85 } }));

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    expect(result.value[0]?.postprocess).toEqual({ floor: 40, ceiling: 85 });
  });

  it('refuses a floor above its ceiling', () => {
    expect(faultsOf(declaration({ postprocess: { floor: 90, ceiling: 85 } })).join('\n')).toMatch(
      /ski/,
    );
  });
});
