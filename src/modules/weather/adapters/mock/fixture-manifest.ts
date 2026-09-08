/**
 * What the fixture manifest is, and the two derivations both the recorder and
 * the registry have to agree on: how a fixture is addressed, and what counts
 * as "the same shape".
 *
 * The manifest is written by `scripts/record-fixture.ts` and read at startup by
 * `fixture-registry.ts`. It exists so that a fixture is traceable to the
 * request that produced it (spec `weather-mock-data`, "Fixtures are verbatim
 * recordings").
 */

/** Which Open-Meteo host answered. It decides the default capability and the key shape. */
export type FixtureEndpoint = 'forecast' | 'marine' | 'archive' | 'lookup';

export const FIXTURE_ENDPOINTS: readonly FixtureEndpoint[] = [
  'forecast',
  'marine',
  'archive',
  'lookup',
];

export interface FixtureWindow {
  readonly startDate: string;
  readonly endDate: string;
}

export interface FixtureLocation {
  readonly latitude: number;
  readonly longitude: number;
}

export interface FixtureEntry {
  readonly name: string;
  readonly file: string;
  readonly endpoint: FixtureEndpoint;
  /**
   * Which seams may serve this recording. An archive response carries the same
   * keys as a forecast response, so the Chamonix winter recording serves both
   * (design.md, Decision 4).
   */
  readonly serves: readonly FixtureEndpoint[];
  readonly url: string;
  readonly capturedAt: string;
  readonly status: number;
  readonly contentType: string;
  readonly bytes: number;
  readonly sha256: string;
  /** Series fixtures: the coordinates the request named, before the grid snapped them. */
  readonly location?: FixtureLocation;
  /** Lookup fixtures: the place name the request carried, normalised. */
  readonly query?: string;
  /** Fixtures recorded over an explicit date window rather than a rolling forecast. */
  readonly window?: FixtureWindow;
  readonly note?: string;
}

/** A scenario no endpoint can produce. Listed rather than synthesised. */
export interface FixtureGap {
  readonly scenario: string;
  readonly reason: string;
  readonly recordedAt: string;
}

export interface FixtureManifest {
  readonly recordedWith: string;
  readonly fixtures: readonly FixtureEntry[];
  readonly gaps: readonly FixtureGap[];
}

export const MANIFEST_FILE = 'manifest.json';

/**
 * The address of a series fixture: coordinates rounded to two decimals, which
 * is the same rounding the cache key uses (stage-three.md, section 7.3). The
 * provider's own grid is coarser than 1.1 km, so two requests that round the
 * same are asking about the same place.
 */
export function coordinateKey(latitude: number, longitude: number): string {
  return `${round(latitude)}:${round(longitude)}`;
}

/**
 * The same rounding as `roundToGrid` in `domain/shared/coordinates.ts`, and
 * deliberately not imported from it: `scripts/record-fixture.ts` loads this
 * module under Node's own type stripping, which resolves a relative import
 * only with an explicit `.ts` extension — and that extension would not survive
 * the Nest build. `coordinates.spec.ts` pins the two together so they cannot
 * drift apart silently.
 *
 * Two decimals, with the negative zero folded away: `-0`, and every coordinate
 * between -0.005 and 0, format as `-0.00`, which would address a second
 * fixture at a point that is the same place.
 */
function round(value: number): string {
  const fixed = value.toFixed(2);

  return fixed === '-0.00' ? '0.00' : fixed;
}

/** The address of a lookup fixture, matched case- and accent-insensitively. */
export function normaliseQuery(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Every key path in a body, with array indices collapsed to `[]`.
 *
 * Comparing these sets is what turns "the API changed" into a failed recording
 * rather than a silently different fixture (spec `weather-mock-data`, "A
 * fixture matches what the endpoint still returns in shape").
 */
export function keyPaths(value: unknown, prefix = ''): Set<string> {
  const paths = new Set<string>();

  if (Array.isArray(value)) {
    for (const item of value) {
      for (const path of keyPaths(item, `${prefix}[]`)) {
        paths.add(path);
      }
    }

    return paths;
  }

  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix === '' ? key : `${prefix}.${key}`;
      paths.add(path);

      for (const nested of keyPaths(child, path)) {
        paths.add(nested);
      }
    }
  }

  return paths;
}

export interface KeyDifference {
  readonly appeared: readonly string[];
  readonly vanished: readonly string[];
}

export function compareKeys(stored: string, recorded: string): KeyDifference {
  const before = parseOrEmpty(stored);
  const after = parseOrEmpty(recorded);

  return {
    appeared: [...after].filter((path) => !before.has(path)).toSorted(),
    vanished: [...before].filter((path) => !after.has(path)).toSorted(),
  };
}

export function hasKeyDifference(difference: KeyDifference): boolean {
  return difference.appeared.length > 0 || difference.vanished.length > 0;
}

function parseOrEmpty(body: string): Set<string> {
  try {
    return keyPaths(JSON.parse(body));
  } catch {
    // A non-JSON recording (the nginx 403 page) has no key set to compare.
    return new Set<string>();
  }
}
