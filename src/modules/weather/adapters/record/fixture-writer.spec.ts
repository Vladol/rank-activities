import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { MANIFEST_FILE, type FixtureManifest } from '../mock/fixture-manifest';
import { FixtureWriter } from './fixture-writer';

let directory: string;

const EMPTY: FixtureManifest = {
  recordedWith: 'test',
  fixtures: [],
  gaps: [],
};

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fixtures-'));
  writeFileSync(join(directory, MANIFEST_FILE), JSON.stringify(EMPTY), 'utf8');
});

function manifest(): FixtureManifest {
  return JSON.parse(readFileSync(join(directory, MANIFEST_FILE), 'utf8')) as FixtureManifest;
}

function lookup(name: string) {
  return {
    url: `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&format=json`,
    status: 200,
    contentType: 'application/json',
    body: '{"results":[]}',
    fetchedAt: '2026-09-08T09:30:00.000Z',
  };
}

const RESPONSE = {
  url: 'https://api.open-meteo.com/v1/forecast?latitude=38.72&longitude=-9.15&hourly=temperature_2m',
  status: 200,
  contentType: 'application/json',
  body: '{"latitude":38.75,"longitude":-9.125}',
  fetchedAt: '2026-09-08T09:30:00.000Z',
};

describe('a recorded fixture is traceable to the request that produced it', () => {
  it('writes the body byte for byte', () => {
    const written = new FixtureWriter({ directory }).write(RESPONSE);

    expect(written.ok).toBe(true);

    if (!written.ok) {
      return;
    }

    expect(readFileSync(join(directory, written.value.file), 'utf8')).toBe(RESPONSE.body);
  });

  it('records the request URL and the moment of recording in the manifest', () => {
    const written = new FixtureWriter({ directory }).write(RESPONSE);

    expect(written.ok).toBe(true);

    const entry = manifest().fixtures[0];

    expect(entry?.url).toBe(RESPONSE.url);
    expect(entry?.capturedAt).toBe('2026-09-08');
    expect(entry?.endpoint).toBe('forecast');
    expect(entry?.location).toEqual({ latitude: 38.72, longitude: -9.15 });
  });

  it('names the fixture after the endpoint and the place it describes', () => {
    const written = new FixtureWriter({ directory }).write(RESPONSE);

    expect(written.ok && written.value.name).toBe('recorded-forecast-38.72--9.15');
  });
});

describe('an existing fixture is not overwritten silently', () => {
  it('refuses a second recording of the same fixture', () => {
    const writer = new FixtureWriter({ directory });
    writer.write(RESPONSE);

    const second = writer.write({ ...RESPONSE, body: '{"latitude":1}' });

    expect(second.ok).toBe(false);
  });

  it('names the fixture and the request that would have replaced it', () => {
    const writer = new FixtureWriter({ directory });
    writer.write(RESPONSE);

    const second = writer.write({ ...RESPONSE, body: '{"latitude":1}' });

    expect(second.ok).toBe(false);

    if (second.ok) {
      return;
    }

    expect(second.error).toContain('recorded-forecast-38.72--9.15');
    expect(second.error).toContain(RESPONSE.url);
  });

  it('leaves the stored recording untouched when it refuses', () => {
    const writer = new FixtureWriter({ directory });
    const first = writer.write(RESPONSE);
    writer.write({ ...RESPONSE, body: '{"latitude":1}' });

    expect(first.ok).toBe(true);

    if (!first.ok) {
      return;
    }

    expect(readFileSync(join(directory, first.value.file), 'utf8')).toBe(RESPONSE.body);
  });

  it('replaces it when replacement was explicitly requested', () => {
    const writer = new FixtureWriter({ directory });
    writer.write(RESPONSE);

    const second = new FixtureWriter({ directory, replace: true }).write({
      ...RESPONSE,
      body: '{"latitude":1}',
    });

    expect(second.ok).toBe(true);
    expect(manifest().fixtures).toHaveLength(1);
  });
});

describe('the writer stays inside the fixture directory', () => {
  it('writes nothing anywhere else', () => {
    new FixtureWriter({ directory }).write(RESPONSE);

    expect(readdirSync(directory).toSorted()).toEqual([
      MANIFEST_FILE,
      'recorded-forecast-38.72--9.15.json',
    ]);
  });

  it('refuses a response from a host it does not record from', () => {
    const written = new FixtureWriter({ directory }).write({
      ...RESPONSE,
      url: 'https://example.com/v1/forecast?latitude=38.72&longitude=-9.15',
    });

    expect(written.ok).toBe(false);
  });
});

describe('a place name never becomes a path', () => {
  it('keeps a name that climbs out of the fixture directory inside it', () => {
    // The name is a GraphQL argument. Recording turns a response into a file,
    // and a file name taken from caller text is a file name the caller chose:
    // without this, `../../../../package` overwrites the repository's
    // package.json with a geocoding response.
    const written = new FixtureWriter({ directory }).write(lookup('../../../../package'));

    expect(written.ok).toBe(true);

    if (!written.ok) {
      return;
    }

    expect(written.value.file).toBe('recorded-lookup-package.json');
    expect(readdirSync(directory)).toContain('recorded-lookup-package.json');
  });

  it('writes nothing outside the fixture directory', () => {
    const outside = join(directory, '..', 'escaped.json');
    new FixtureWriter({ directory }).write(lookup('../escaped'));

    expect(existsSync(outside)).toBe(false);
  });

  it('keeps an ordinary name readable', () => {
    const written = new FixtureWriter({ directory }).write(lookup('São Paulo'));

    expect(written.ok && written.value.name).toBe('recorded-lookup-sao-paulo');
  });

  it('writes a name that is only punctuation inside the directory all the same', () => {
    new FixtureWriter({ directory }).write(lookup('../..'));

    // Nothing outside, whatever is left of the name.
    expect(existsSync(join(directory, '..', '.json'))).toBe(false);
    expect(readdirSync(directory).every((file) => !file.includes('/'))).toBe(true);
  });

  it('does not let a separator inside a name split it into directories', () => {
    const written = new FixtureWriter({ directory }).write(lookup('a/b'));

    expect(written.ok).toBe(true);
    expect(written.ok && written.value.file).not.toContain('/');
  });
});
