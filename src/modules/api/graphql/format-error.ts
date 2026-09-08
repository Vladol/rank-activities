import type { GraphQLFormattedError } from 'graphql';

import { type ReasonCode, isReasonCode } from '../../../domain/shared/reason-code';
import { transportMessage } from '../../../common/errors/graphql-exception.filter';
import { currentTraceId, newTraceId } from '../../../common/trace/trace-context';

/**
 * The last gate anything passes on its way out.
 *
 * The exception filter covers what a resolver throws, but a query refused
 * before execution — a syntax error, a field that does not exist, a depth the
 * endpoint will not accept — never reaches a filter, and Apollo would answer it
 * with its own vocabulary. Rewriting every error here is what makes "every code
 * comes from the registry" true of the whole surface rather than of the part
 * that happens to run a resolver.
 *
 * It also means an internal failure cannot escape by a route the filter does
 * not watch: anything unrecognised leaves as `INTERNAL_ERROR` with a trace
 * identifier and nothing else.
 */
const CLIENT_FAULTS = new Set([
  'GRAPHQL_PARSE_FAILED',
  'GRAPHQL_VALIDATION_FAILED',
  'BAD_USER_INPUT',
  'BAD_REQUEST',
  'OPERATION_RESOLUTION_FAILURE',
  'PERSISTED_QUERY_NOT_FOUND',
  'PERSISTED_QUERY_NOT_SUPPORTED',
]);

export function formatTransportError(formatted: GraphQLFormattedError): GraphQLFormattedError {
  const declared = formatted.extensions?.['code'];
  const code = codeOf(typeof declared === 'string' ? declared : undefined);

  return {
    // A query the schema refused is described in the schema's own vocabulary,
    // which is public by definition. Everything else is described by us, so no
    // exception's message, type name or stack can travel out.
    message: code === 'INVALID_QUERY' ? formatted.message : transportMessage(code),
    ...(formatted.locations === undefined ? {} : { locations: formatted.locations }),
    ...(formatted.path === undefined ? {} : { path: formatted.path }),
    extensions: { code, traceId: currentTraceId() ?? newTraceId() },
  };
}

function codeOf(declared: string | undefined): ReasonCode {
  if (declared !== undefined && isReasonCode(declared)) {
    return declared;
  }

  return declared !== undefined && CLIENT_FAULTS.has(declared) ? 'INVALID_QUERY' : 'INTERNAL_ERROR';
}
