import type { GraphQLFormattedError } from 'graphql';
import { describe, expect, it } from 'vitest';

import { isReasonCode } from '../../../domain/shared/reason-code';
import { runWithTrace } from '../../../common/trace/trace-context';
import { formatTransportError } from './format-error';

function format(error: GraphQLFormattedError): GraphQLFormattedError {
  return runWithTrace('trace-1', () => formatTransportError(error));
}

describe('the last gate an error passes', () => {
  it('keeps a code the filter already took from the registry', () => {
    const out = format({ message: 'the request was refused', extensions: { code: 'RATE_LIMITED' } });

    expect(out.extensions).toEqual({ code: 'RATE_LIMITED', traceId: 'trace-1' });
  });

  it('names a query the schema refused as a refused query, in the schema own words', () => {
    // A validation message quotes the public schema and the client's own text,
    // and it is the only thing a client can act on when a query will not run.
    const out = format({
      message: 'Cannot query field "scoore" on type "RankedOutcome".',
      extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
    });

    expect(out.extensions).toEqual({ code: 'INVALID_QUERY', traceId: 'trace-1' });
    expect(out.message).toContain('RankedOutcome');
  });

  it('answers an error that reached here by no route we watch as our own fault', () => {
    const out = format({
      message: 'Cannot read properties of undefined (reading "hourly")',
      extensions: { code: 'INTERNAL_SERVER_ERROR', stacktrace: ['at Object.<anonymous>'] },
    });

    expect(out.extensions).toEqual({ code: 'INTERNAL_ERROR', traceId: 'trace-1' });
    expect(out.message).not.toContain('hourly');
    expect(JSON.stringify(out)).not.toContain('stacktrace');
  });

  it('answers an error with no code at all rather than passing it through', () => {
    const out = format({ message: 'something happened' });

    expect(out.extensions?.['code']).toBe('INTERNAL_ERROR');
    expect(out.message).not.toContain('something happened');
  });

  it('emits only codes the reason registry declares', () => {
    const declared = ['GRAPHQL_PARSE_FAILED', 'BAD_USER_INPUT', 'LOCATION_NOT_FOUND', 'nonsense'];

    for (const code of declared) {
      const out = format({ message: 'x', extensions: { code } });

      expect(isReasonCode(String(out.extensions?.['code'])), code).toBe(true);
    }
  });

  it('keeps the path and locations, which say where in the query the fault is', () => {
    const out = format({
      message: 'x',
      extensions: { code: 'LOCATION_NOT_FOUND' },
      path: ['rankActivities'],
      locations: [{ line: 2, column: 3 }],
    });

    expect(out.path).toEqual(['rankActivities']);
    expect(out.locations).toEqual([{ line: 2, column: 3 }]);
  });
});
