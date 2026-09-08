import { describe, expect, it } from 'vitest';

import { divergence } from '../contract/divergence';

describe('a vendor change is reported as a fixture problem', () => {
  it('names the field that diverged', () => {
    expect(divergence('temperature_2m', 'arrived in "°F"')).toContain('temperature_2m');
  });

  it('carries what was wrong with it', () => {
    expect(divergence('temperature_2m', 'arrived in "°F"')).toContain('arrived in "°F"');
  });

  it('says the fixtures and the mapper are what need updating', () => {
    const message = divergence('wave_height', 'missing from the envelope');

    // The failure is not a defect in the adapter: it is the recording that
    // stopped describing the API. The message has to say which, or the person
    // reading it at 3am will go looking in the wrong file.
    expect(message).toContain('fixtures');
    expect(message).toContain('record-fixture.ts');
    expect(message).toContain('open-meteo.mapper.ts');
  });
});
