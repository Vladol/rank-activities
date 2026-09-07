import { describe, expect, it } from 'vitest';

import { CAPABILITY_PORT_TOKENS, PLACE_LOOKUP_PORT } from './tokens';

describe('DI tokens', () => {
  it('gives every capability its own token', () => {
    const tokens = Object.values(CAPABILITY_PORT_TOKENS);

    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('covers exactly the three capabilities', () => {
    expect(Object.keys(CAPABILITY_PORT_TOKENS).toSorted()).toEqual([
      'archive',
      'forecast',
      'marine',
    ]);
  });

  it('keeps place lookup apart from the series capabilities', () => {
    expect(Object.values(CAPABILITY_PORT_TOKENS)).not.toContain(PLACE_LOOKUP_PORT);
  });

  it('describes each token, so a Nest resolution error names the seam', () => {
    expect(CAPABILITY_PORT_TOKENS.forecast.toString()).toContain('Forecast');
    expect(PLACE_LOOKUP_PORT.toString()).toContain('PlaceLookup');
  });
});
