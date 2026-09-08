import { describe, expect, it } from 'vitest';

import { FixtureRegistry } from './fixture-registry';
import { RecordedPlaceLookupSource } from './recorded-place-lookup.source';

const registry = FixtureRegistry.load();
const lines: string[] = [];
const source = new RecordedPlaceLookupSource(registry, { log: (line) => lines.push(line) });

describe('the recorded place-lookup source', () => {
  it('serves a recorded lookup through the place-lookup port', async () => {
    const result = await source.lookup({ name: 'Lisbon' });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value[0]?.name : undefined).toBe('Lisbon');
    expect(result.ok ? result.value[0]?.timezone : undefined).toBe('Europe/Lisbon');
  });

  it('returns every candidate of an ambiguous name, choosing none of them', async () => {
    const result = await source.lookup({ name: 'Moscow' });

    expect(result.ok ? result.value.length : 0).toBeGreaterThan(1);
    expect(result.ok ? new Set(result.value.map((place) => place.countryCode)).size : 0).toBeGreaterThan(1);
  });

  it('reads a miss as an empty result, not as a failure', async () => {
    const result = await source.lookup({ name: 'Zzzqqxwv' });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : undefined).toEqual([]);
  });

  it('replays a 403 with an HTML body as an unexpected content type', async () => {
    lines.length = 0;

    const result = await source.lookup({ name: 'München' });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe('UNEXPECTED_CONTENT_TYPE');
    expect(result.ok ? undefined : result.error.context?.contentType).toContain('text/html');
    // The nginx page is logged; none of it is returned.
    expect(JSON.stringify(result)).not.toContain('nginx');
    expect(lines.join('\n')).toContain('nginx');
  });

  it('answers a name no fixture covers with an explicit miss', async () => {
    const result = await source.lookup({ name: 'Nowhere at all' });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe('TRANSPORT_FAILURE');
  });

  it('never throws', async () => {
    await expect(source.lookup({ name: '' })).resolves.toBeDefined();
  });
});
