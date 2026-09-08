import { describe, expect, it } from 'vitest';

import type { MarineCoverageEvidence } from './location-profile';
import { needsMarineProbe, recordProbe } from './location-profile';

const CONFIRMATIONS = { confirmations: 2 };

const candidate: MarineCoverageEvidence = {
  allNullProbeDates: ['2026-09-07'],
  lastProbedOn: '2026-09-07',
  covered: false,
};

describe('recording what a probe found', () => {
  it('makes an unprobed location a candidate on the first all-null answer', () => {
    expect(recordProbe(undefined, { kind: 'uncovered' }, '2026-09-08')).toEqual({
      allNullProbeDates: ['2026-09-08'],
      lastProbedOn: '2026-09-08',
      covered: false,
    });
  });

  it('adds a second day to a candidacy, which is what confirms it', () => {
    expect(recordProbe(candidate, { kind: 'uncovered' }, '2026-09-08')).toEqual({
      allNullProbeDates: ['2026-09-07', '2026-09-08'],
      lastProbedOn: '2026-09-08',
      covered: false,
    });
  });

  it('records one day once, however many times it is probed', () => {
    const twice = recordProbe(candidate, { kind: 'uncovered' }, '2026-09-07');

    expect(twice?.allNullProbeDates).toEqual(['2026-09-07']);
  });

  it('clears a candidacy when a later probe returns wave values', () => {
    expect(recordProbe(candidate, { kind: 'covered' }, '2026-09-08')).toEqual({
      allNullProbeDates: [],
      lastProbedOn: '2026-09-08',
      covered: true,
    });
  });

  it('creates no candidacy at all when the probe itself failed', () => {
    // A wave-model outage must never turn into a claim about geography
    // (spec, "An unavailable marine source does not create geography").
    expect(recordProbe(undefined, { kind: 'failed' }, '2026-09-08')).toEqual({
      allNullProbeDates: [],
      lastProbedOn: '2026-09-08',
      covered: false,
    });
  });

  it('still records the attempt, so a failing source is not probed once per request', () => {
    const attempted = recordProbe(undefined, { kind: 'failed' }, '2026-09-08');

    expect(needsMarineProbe(attempted, '2026-09-08', CONFIRMATIONS)).toBe(false);
    expect(needsMarineProbe(attempted, '2026-09-09', CONFIRMATIONS)).toBe(true);
  });

  it('leaves an existing candidacy untouched when the probe failed', () => {
    expect(recordProbe(candidate, { kind: 'failed' }, '2026-09-08')).toEqual({
      ...candidate,
      lastProbedOn: '2026-09-08',
    });
  });
});

describe('whether a location is worth probing today', () => {
  it('probes a location nothing is known about', () => {
    expect(needsMarineProbe(undefined, '2026-09-08', CONFIRMATIONS)).toBe(true);
  });

  it('does not probe twice in one day', () => {
    expect(
      needsMarineProbe(
        { allNullProbeDates: ['2026-09-08'], lastProbedOn: '2026-09-08', covered: false },
        '2026-09-08',
        CONFIRMATIONS,
      ),
    ).toBe(false);
  });

  it('probes an unconfirmed candidate again on the next day', () => {
    expect(needsMarineProbe(candidate, '2026-09-08', CONFIRMATIONS)).toBe(true);
  });

  it('stops probing a place the model is known to cover', () => {
    expect(
      needsMarineProbe(
        { allNullProbeDates: [], lastProbedOn: '2026-09-01', covered: true },
        '2026-09-08',
        CONFIRMATIONS,
      ),
    ).toBe(false);
  });

  it('stops probing once the missing coastline is confirmed', () => {
    expect(
      needsMarineProbe(
        {
          allNullProbeDates: ['2026-09-06', '2026-09-07'],
          lastProbedOn: '2026-09-07',
          covered: false,
        },
        '2026-09-08',
        CONFIRMATIONS,
      ),
    ).toBe(false);
  });
});
