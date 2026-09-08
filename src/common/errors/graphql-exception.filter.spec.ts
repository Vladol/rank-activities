import type { ArgumentsHost } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { describe, expect, it } from 'vitest';

import { REASON, type ReasonCode, isReasonCode } from '../../domain/shared/reason-code';
import { domainError } from '../../domain/shared/domain-error';
import { runWithTrace } from '../trace/trace-context';
import { DomainFailure } from './domain-failure.error';
import { GraphqlExceptionFilter, codeOf, transportMessage } from './graphql-exception.filter';

/** A host that says it is a GraphQL one, which is all the filter asks it. */
const GRAPHQL_HOST = { getType: () => 'graphql' } as unknown as ArgumentsHost;

function refuse(exception: unknown, traceId = 'trace-1'): GraphQLError {
  return runWithTrace(
    traceId,
    () => new GraphqlExceptionFilter().catch(exception, GRAPHQL_HOST) as GraphQLError,
  );
}

describe('the transport error a failure becomes', () => {
  it('carries the registry code of the failure and the trace identifier, and nothing else', () => {
    const error = refuse(new DomainFailure(domainError('LOCATION_NOT_FOUND', 'no such place')));

    expect(error.extensions).toEqual({ code: 'LOCATION_NOT_FOUND', traceId: 'trace-1' });
  });

  it('answers every code the registry declares with that same code', () => {
    // Enumerated from the registry rather than from a list here: a reason added
    // to the registry is covered by this test the moment it is added.
    for (const code of Object.keys(REASON) as ReasonCode[]) {
      const error = refuse(new DomainFailure(domainError(code, 'whatever the domain said')));

      expect(error.extensions['code'], code).toBe(code);
      expect(isReasonCode(String(error.extensions['code'])), code).toBe(true);
    }
  });

  it('answers an unforeseen exception with the generic code and no trace of it', () => {
    class SurfacePressureAndHeightVariable extends Error {}
    const thrown = new SurfacePressureAndHeightVariable('cannot initialize from invalid String');
    const error = refuse(thrown);

    expect(error.extensions['code']).toBe('INTERNAL_ERROR');
    expect(error.extensions['traceId']).toBe('trace-1');
    expect(error.message).not.toContain('SurfacePressureAndHeightVariable');
    expect(error.message).not.toContain('invalid String');
    expect(JSON.stringify(error)).not.toContain('stack');
  });

  it('never repeats what the failure itself said', () => {
    // The domain's own sentence is written by us and is still not published:
    // one rule, applied to every failure, is what makes a leak impossible
    // rather than unlikely (spec, "Nothing internal crosses the boundary").
    const said = 'the marine host answered 500: DataCorrupted at path MarineVariable';
    const error = refuse(new DomainFailure(domainError('MARINE_UNAVAILABLE', said)));

    expect(error.message).not.toContain('MarineVariable');
    expect(error.message).toBe(transportMessage('MARINE_UNAVAILABLE'));
  });

  it('reads a refusal by the inbound limiter as the rate-limit reason', () => {
    const tooMany = { getStatus: () => 429 };

    expect(codeOf(tooMany)).toBe('RATE_LIMITED');
  });

  it('reads a code that is not in the registry as our own fault, not as a new reason', () => {
    expect(codeOf(new DomainFailure(domainError('MADE_UP' as ReasonCode, 'x')))).toBe(
      'INTERNAL_ERROR',
    );
  });

  it('mints an identifier when there is no request scope to take one from', () => {
    const error = new GraphqlExceptionFilter().catch(
      new DomainFailure(domainError('HORIZON_TOO_LARGE', 'too far')),
      GRAPHQL_HOST,
    ) as GraphQLError;

    expect(String(error.extensions['traceId'])).toMatch(/^[\w-]+$/);
  });
});
