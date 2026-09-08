import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parsePlaceLookupResponse } from './schema';
import { geocodingUrl } from './lookup';

const SAMPLES = join(process.cwd(), 'docs/investigation/open-meteo/samples');

function sample(name: string): unknown {
  return JSON.parse(readFileSync(join(SAMPLES, `${name}.json`), 'utf8'));
}

describe('the place lookup reads what the geocoding host answers', () => {
  it('reads a miss as an empty result, not as a failure', () => {
    // A lookup that matched nothing answers 200 with the `results` key absent
    // altogether (stage-three.md, section 6).
    const parsed = parsePlaceLookupResponse(sample('geocoding-not-found'));

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    expect(parsed.value).toEqual([]);
  });

  it('passes every candidate across the port unranked', () => {
    const parsed = parsePlaceLookupResponse(sample('geocoding-moscow-ambiguous'));

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    // Ten Moscows. Choosing among them is `location-applicability`'s decision,
    // and an adapter that quietly kept the first would take it instead.
    expect(parsed.value).toHaveLength(10);
    expect(new Set(parsed.value.map((candidate) => candidate.sourcePlaceId)).size).toBe(10);
  });

  it('asks the host by name, with no unit or ranking parameter', () => {
    const url = geocodingUrl({ name: 'Lisbon', count: 5, language: 'en' });

    expect(url).toContain('geocoding-api.open-meteo.com');
    expect(url).toContain('name=Lisbon');
    expect(url).toContain('count=5');
    expect(url).not.toContain('_unit');
  });

  it('percent-encodes a name the host would otherwise reject', () => {
    // An unencoded UTF-8 name came back as an HTML error page, not as JSON
    // (samples/error-geocoding-unencoded-utf8.html).
    const url = geocodingUrl({ name: 'München' });

    expect(url).toContain('M%C3%BCnchen');
  });
});

describe('the vendor explanation stays out of the returned error', () => {
  it('does not repeat what the host said about a bad latitude', () => {
    const body = sample('error-bad-latitude') as { reason: string };
    const parsed = parsePlaceLookupResponse(body);

    expect(parsed.ok).toBe(false);

    if (parsed.ok) {
      return;
    }

    expect(JSON.stringify(parsed.error)).not.toContain(body.reason);
  });

  it('does not repeat a horizon reason that is itself wrong', () => {
    // "Allowed range 0 to 16. Given 16." for a request of 30 days: the source's
    // own text is not only unhelpful, it is false (stage-three.md, section 2.3).
    const body = sample('error-horizon-too-large') as { reason: string };
    const parsed = parsePlaceLookupResponse(body);

    expect(parsed.ok).toBe(false);

    if (parsed.ok) {
      return;
    }

    expect(JSON.stringify(parsed.error)).not.toContain('Given 16');
  });
});
