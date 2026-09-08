/**
 * Records one Open-Meteo response into the fixture set.
 *
 * A fixture is evidence of how the API behaves, so it is never written by
 * hand: this script performs the request, stores the raw body exactly as it
 * arrived and writes the manifest entry that makes it traceable
 * (spec `weather-mock-data`, "Adding a fixture is a recorded, repeatable
 * procedure").
 *
 *   node scripts/record-fixture.ts <name> <url> [options]
 *   node scripts/record-fixture.ts --gap "<scenario>" --reason "<why>"
 *
 * Options:
 *   --force              overwrite an existing fixture whose key set is unchanged
 *   --raw                send the path byte for byte, without percent-encoding
 *   --coords <lat,lon>   address a fixture whose URL carries no coordinates
 *   --serves <a,b>       seams this recording may be served through
 *                        (default: the endpoint it came from)
 *   --note <text>        why this recording exists, for the manifest
 *
 * Re-recording reports the key-level difference and refuses to write when keys
 * appeared or vanished, with or without `--force`: a changed key set is news
 * about the API, not a fixture to be quietly replaced.
 */
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type FixtureEndpoint,
  type FixtureEntry,
  type FixtureLocation,
  type FixtureManifest,
  type FixtureWindow,
  MANIFEST_FILE,
  compareKeys,
  hasKeyDifference,
  normaliseQuery,
} from '../src/modules/weather/adapters/mock/fixture-manifest.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = join(REPO_ROOT, 'src/modules/weather/adapters/mock/fixtures');
const MANIFEST_PATH = join(FIXTURE_DIR, MANIFEST_FILE);

const ENDPOINT_BY_HOST: Readonly<Record<string, FixtureEndpoint>> = {
  'api.open-meteo.com': 'forecast',
  'marine-api.open-meteo.com': 'marine',
  'archive-api.open-meteo.com': 'archive',
  'geocoding-api.open-meteo.com': 'lookup',
};

const EMPTY_MANIFEST: FixtureManifest = {
  recordedWith: 'scripts/record-fixture.ts',
  fixtures: [],
  gaps: [],
};

function readManifest(): FixtureManifest {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
  } catch (thrown) {
    if ((thrown as NodeJS.ErrnoException).code === 'ENOENT') {
      return EMPTY_MANIFEST;
    }

    throw thrown;
  }
}

function writeManifest(manifest: FixtureManifest): void {
  // Sorted, so re-recording one fixture produces a one-entry diff.
  const fixtures = manifest.fixtures.toSorted((left, right) => left.name.localeCompare(right.name));

  writeFileSync(MANIFEST_PATH, `${JSON.stringify({ ...manifest, fixtures }, null, 2)}\n`, 'utf8');
}

function endpointOf(url: string): FixtureEndpoint {
  const host = new URL(url).hostname;
  const endpoint = ENDPOINT_BY_HOST[host];

  if (endpoint === undefined) {
    throw new Error(
      `${host} is not an Open-Meteo host this project records from. ` +
        `Known hosts: ${Object.keys(ENDPOINT_BY_HOST).join(', ')}.`,
    );
  }

  return endpoint;
}

function extensionFor(contentType: string): string {
  if (contentType.includes('json')) {
    return 'json';
  }

  return contentType.includes('html') ? 'html' : 'txt';
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

function windowOf(url: URL): FixtureWindow | undefined {
  const startDate = url.searchParams.get('start_date');
  const endDate = url.searchParams.get('end_date');

  return startDate !== null && endDate !== null ? { startDate, endDate } : undefined;
}

interface Recorded {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

/**
 * The request `fetch` would rewrite, sent byte for byte instead.
 *
 * `fetch` percent-encodes the path before it leaves the process, which makes
 * the unencoded-UTF-8 403 unrecordable through it: the request nginx rejects
 * never reaches the wire (stage-three.md, section 6).
 */
function fetchRaw(url: string): Promise<Recorded> {
  const parsed = new URL(url);
  const rawPath = Buffer.from(
    url.slice(url.indexOf(parsed.host) + parsed.host.length),
    'utf8',
  ).toString('latin1');

  return new Promise((resolve, reject) => {
    const call = httpsRequest(
      { host: parsed.hostname, path: rawPath, method: 'GET' },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            contentType: response.headers['content-type'] ?? 'application/octet-stream',
            body,
          }),
        );
      },
    );

    call.on('error', reject);
    call.end();
  });
}

async function fetchNormally(url: string): Promise<Recorded> {
  const response = await fetch(url, { headers: { 'accept-encoding': 'gzip, deflate, br' } });

  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    body: await response.text(),
  };
}

interface Options {
  readonly force: boolean;
  readonly raw: boolean;
  readonly coords?: FixtureLocation;
  readonly serves?: readonly FixtureEndpoint[];
  readonly note?: string;
}

function parseOptions(argv: readonly string[]): Options {
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);

    return index === -1 ? undefined : argv[index + 1];
  };

  const coords = flag('coords')?.split(',');
  const serves = flag('serves');
  const note = flag('note');

  return {
    force: argv.includes('--force'),
    raw: argv.includes('--raw'),
    ...(coords === undefined
      ? {}
      : { coords: { latitude: Number(coords[0]), longitude: Number(coords[1]) } }),
    ...(serves === undefined ? {} : { serves: serves.split(',') as FixtureEndpoint[] }),
    ...(note === undefined ? {} : { note }),
  };
}

function report(paths: readonly string[], sign: string): void {
  for (const path of paths) {
    console.error(`  ${sign} ${path}`);
  }
}

async function record(name: string, url: string, options: Options): Promise<void> {
  const endpoint = endpointOf(url);
  const parsedUrl = new URL(url);
  const manifest = readManifest();
  const existing = manifest.fixtures.find((entry) => entry.name === name);

  const response = options.raw ? await fetchRaw(url) : await fetchNormally(url);
  const file = `${name}.${extensionFor(response.contentType)}`;

  if (existing !== undefined) {
    const difference = compareKeys(
      readFileSync(join(FIXTURE_DIR, existing.file), 'utf8'),
      response.body,
    );

    if (hasKeyDifference(difference)) {
      console.error(`The key set of "${name}" changed; the stored fixture was left untouched.`);
      report(difference.appeared, '+');
      report(difference.vanished, '-');
      process.exitCode = 1;
      return;
    }

    if (!options.force) {
      console.error(
        `"${name}" already exists and its keys are unchanged. ` +
          'Re-record it with --force, or record under a new name.',
      );
      process.exitCode = 1;
      return;
    }
  }

  // A recording that changed media type changes extension too; leaving the old
  // file behind would break startup, which refuses a file no manifest declares.
  if (existing !== undefined && existing.file !== file) {
    rmSync(join(FIXTURE_DIR, existing.file), { force: true });
  }

  writeFileSync(join(FIXTURE_DIR, file), response.body, 'utf8');

  const location = options.coords ?? locationOf(parsedUrl);
  const query = parsedUrl.searchParams.get('name');
  const window = windowOf(parsedUrl);

  const entry: FixtureEntry = {
    name,
    file,
    endpoint,
    serves: options.serves ?? [endpoint],
    url,
    capturedAt: new Date().toISOString().slice(0, 10),
    status: response.status,
    contentType: response.contentType,
    bytes: Buffer.byteLength(response.body, 'utf8'),
    sha256: createHash('sha256').update(response.body).digest('hex'),
    ...(location === undefined ? {} : { location }),
    ...(query === null ? {} : { query: normaliseQuery(query) }),
    ...(window === undefined ? {} : { window }),
    ...(options.note === undefined ? {} : { note: options.note }),
  };

  writeManifest({
    ...manifest,
    fixtures: [...manifest.fixtures.filter((candidate) => candidate.name !== name), entry],
  });

  console.log(`recorded ${name}: HTTP ${response.status}, ${entry.bytes} bytes → ${file}`);
}

function recordGap(scenario: string, reason: string): void {
  const manifest = readManifest();

  writeManifest({
    ...manifest,
    gaps: [
      ...manifest.gaps.filter((gap) => gap.scenario !== scenario),
      { scenario, reason, recordedAt: new Date().toISOString().slice(0, 10) },
    ],
  });

  console.log(`recorded an open gap: ${scenario}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const gapIndex = argv.indexOf('--gap');

  if (gapIndex !== -1) {
    const scenario = argv[gapIndex + 1];
    const reasonIndex = argv.indexOf('--reason');
    const reason = reasonIndex === -1 ? undefined : argv[reasonIndex + 1];

    if (scenario === undefined || reason === undefined) {
      console.error('Usage: node scripts/record-fixture.ts --gap "<scenario>" --reason "<why>"');
      process.exitCode = 1;
      return;
    }

    recordGap(scenario, reason);
    return;
  }

  const [name, url] = argv;

  if (name === undefined || url === undefined || name.startsWith('--')) {
    console.error(
      'Usage: node scripts/record-fixture.ts <name> <url> ' +
        '[--force] [--raw] [--coords lat,lon] [--serves a,b] [--note text]',
    );
    process.exitCode = 1;
    return;
  }

  await record(name, url, parseOptions(argv));
}

await main();
