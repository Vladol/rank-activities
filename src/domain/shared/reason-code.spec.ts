import { describe, expect, it } from 'vitest';

import { REASON, type ReasonCode, isReasonCode, reasonsOfKind } from './reason-code';

/** The registry of docs/development-flow/stage-four.md, section 4.1. */
describe('the reason registry', () => {
  it('declares every reason once, with a kind and an i18n key', () => {
    for (const [code, entry] of Object.entries(REASON)) {
      expect(entry.i18n, code).toBe(`reason.${code.toLowerCase()}`);
      expect(['not_applicable', 'constraint', 'no_data', 'request']).toContain(entry.kind);
    }
  });

  it('carries no human text, only a key the api layer resolves', () => {
    // Text never enters the domain: the message is assembled by the api layer
    // from the i18n key (flow.md, section 8.2).
    for (const entry of Object.values(REASON)) {
      expect(Object.keys(entry).toSorted()).not.toContain('message');
    }
  });

  it('holds the five constraint reasons the four activities can fire', () => {
    expect(reasonsOfKind('constraint').toSorted()).toEqual(
      [
        'DANGEROUS_SURF',
        'FLAT_SEA',
        'NO_DAYLIGHT',
        'NO_SNOW_COVER',
        'SEVERE_WEATHER',
      ] satisfies ReasonCode[],
    );
  });

  it('says which no-data reasons are worth retrying', () => {
    expect(REASON.PROVIDER_UNAVAILABLE.retryable).toBe(true);
    // The budget refills on its own; asking again later is exactly the fix.
    expect(REASON.PROVIDER_BUSY.retryable).toBe(true);
    expect(REASON.MARINE_UNAVAILABLE.retryable).toBe(true);
    // Gaps in a recorded day do not fill in on a second call.
    expect(REASON.TOO_MANY_GAPS.retryable).toBe(false);
  });

  it('recognises a code and refuses a string that is not one', () => {
    expect(isReasonCode('NO_SNOW_COVER')).toBe(true);
    expect(isReasonCode('NO_SNOW')).toBe(false);
  });
});
