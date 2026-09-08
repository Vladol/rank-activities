import { createHash } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { type Result, err, ok } from '../../../../domain/shared/result';
import { fixtureDir, readManifest } from '../mock/fixture-files';
import {
  type FixtureEndpoint,
  type FixtureEntry,
  type FixtureLocation,
  type FixtureManifest,
  MANIFEST_FILE,
  normaliseQuery,
} from '../mock/fixture-manifest';

/**
 * Writes a live response into the fixture set, as a by-product of serving it.
 *
 * A fixture is evidence of how the API behaves, so it is never written by hand
 * (spec `weather-mock-data`, "Fixtures are verbatim recordings"). The script
 * records one on demand; this writer records whatever the service actually
 * asked for, through the path that actually serves it — so a fixture cannot
 * describe a request the adapter would never make (design.md, Decision 6).
 *
 * It is bounded on purpose: it writes only under the fixture directory, only
 * for hosts this project records from, and never over an existing recording
 * unless replacement was asked for.
 */
export interface RecordedResponse {
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
  /** ISO instant the response arrived, taken by the transport. */
  readonly fetchedAt: string;
}

export interface WrittenFixture {
  readonly name: string;
  readonly file: string;
}

export interface FixtureWriterOptions {
  readonly directory?: string;
  /** Without this, an existing fixture is a refusal rather than a replacement. */
  readonly replace?: boolean;
}

const ENDPOINT_BY_HOST: Readonly<Record<string, FixtureEndpoint>> = {
  'api.open-meteo.com': 'forecast',
  'marine-api.open-meteo.com': 'marine',
  'archive-api.open-meteo.com': 'archive',
  'geocoding-api.open-meteo.com': 'lookup',
};

export class FixtureWriter {
  private readonly directory: string;
  private readonly replace: boolean;

  constructor(options: FixtureWriterOptions = {}) {
    this.directory = options.directory ?? fixtureDir();
    this.replace = options.replace ?? false;
  }

  /** The failure is a sentence for an operator: recording is an interactive act. */
  write(response: RecordedResponse): Result<WrittenFixture, string> {
    const url = new URL(response.url);
    const endpoint = ENDPOINT_BY_HOST[url.hostname];

    if (endpoint === undefined) {
      return err(
        `${url.hostname} is not an Open-Meteo host this project records from. ` +
          `Known hosts: ${Object.keys(ENDPOINT_BY_HOST).join(', ')}.`,
      );
    }

    const name = fixtureName(endpoint, url);
    const file = `${name}.${extensionFor(response.contentType)}`;

    // Belt and braces. `fixtureName` already reduces the caller's text to a
    // safe slug; this refuses anything that would still resolve outside the
    // fixture directory, so a future change to the naming rule cannot turn a
    // request into a write somewhere else.
    if (!isInside(this.directory, file)) {
      return err(
        `The fixture "${name}" would be written outside ${this.directory}. ` +
          `The request was ${response.url}.`,
      );
    }
    const manifest = readManifest(this.directory);
    const existing = manifest.fixtures.find((entry) => entry.name === name);

    if (existing !== undefined && !this.replace) {
      return err(
        `The fixture "${name}" already exists and was left untouched. ` +
          `The request that would have replaced it was ${response.url}. ` +
          'Record over it deliberately with WEATHER_RECORD_REPLACE=true.',
      );
    }

    // A recording that changed media type changes extension too; leaving the
    // old file behind would break startup, which refuses a file no manifest
    // declares.
    if (existing !== undefined && existing.file !== file) {
      rmSync(join(this.directory, existing.file), { force: true });
    }

    writeFileSync(join(this.directory, file), response.body, 'utf8');

    const entry = this.entryFor(name, file, endpoint, url, response);

    this.writeManifest({
      ...manifest,
      fixtures: [...manifest.fixtures.filter((candidate) => candidate.name !== name), entry],
    });

    return ok({ name, file });
  }

  private entryFor(
    name: string,
    file: string,
    endpoint: FixtureEndpoint,
    url: URL,
    response: RecordedResponse,
  ): FixtureEntry {
    const location = locationOf(url);
    const query = url.searchParams.get('name');
    const startDate = url.searchParams.get('start_date');
    const endDate = url.searchParams.get('end_date');

    return {
      name,
      file,
      endpoint,
      serves: [endpoint],
      url: response.url,
      capturedAt: response.fetchedAt.slice(0, 10),
      status: response.status,
      contentType: response.contentType,
      bytes: Buffer.byteLength(response.body, 'utf8'),
      sha256: createHash('sha256').update(response.body).digest('hex'),
      ...(location === undefined ? {} : { location }),
      ...(query === null ? {} : { query: normaliseQuery(query) }),
      ...(startDate === null || endDate === null ? {} : { window: { startDate, endDate } }),
      note: 'recorded by the service in WEATHER_PROVIDER=record',
    };
  }

  private writeManifest(manifest: FixtureManifest): void {
    // Sorted, so recording one fixture produces a one-entry diff.
    const fixtures = manifest.fixtures.toSorted((left, right) =>
      left.name.localeCompare(right.name),
    );

    writeFileSync(
      join(this.directory, MANIFEST_FILE),
      `${JSON.stringify({ ...manifest, fixtures }, null, 2)}\n`,
      'utf8',
    );
  }
}

/**
 * The fixture's name, derived from the request rather than chosen.
 *
 * Recording happens while the service serves traffic, so there is nobody to
 * name the file; the endpoint and the place it describes are what make one
 * recording distinguishable from another, and they are also what the registry
 * addresses a fixture by.
 */
function fixtureName(endpoint: FixtureEndpoint, url: URL): string {
  const query = url.searchParams.get('name');

  if (query !== null) {
    return `recorded-${endpoint}-${slug(normaliseQuery(query))}`;
  }

  const location = locationOf(url);

  return location === undefined
    ? `recorded-${endpoint}`
    : `recorded-${endpoint}-${location.latitude}-${location.longitude}`;
}

/**
 * A place name reduced to something that can only ever be one file name.
 *
 * The name is a request argument, so it is the caller's text; `normaliseQuery`
 * folds case and accents but keeps `/` and `.`, and `join` resolves `..`. A
 * name is therefore reduced to letters, digits and hyphens here — never
 * filtered for the dangerous shapes, which is the check one always forgets a
 * spelling of.
 *
 * The coordinate names need no such treatment: they are built from numbers.
 */
function slug(query: string): string {
  return query
    .replaceAll(/[^a-z\d]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Whether a file name stays inside the directory it is joined to. */
function isInside(directory: string, file: string): boolean {
  const root = resolve(directory);

  return resolve(root, file).startsWith(root + sep);
}

function locationOf(url: URL): FixtureLocation | undefined {
  const latitude = Number(url.searchParams.get('latitude'));
  const longitude = Number(url.searchParams.get('longitude'));

  return url.searchParams.has('latitude') &&
    url.searchParams.has('longitude') &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
    ? { latitude, longitude }
    : undefined;
}

function extensionFor(contentType: string): string {
  if (contentType.includes('json')) {
    return 'json';
  }

  return contentType.includes('html') ? 'html' : 'txt';
}
