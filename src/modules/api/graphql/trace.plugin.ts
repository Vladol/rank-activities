import type { ApolloDriverConfig } from '@nestjs/apollo';
import { Logger } from '@nestjs/common';

import { currentTraceId, newTraceId } from '../../../common/trace/trace-context';

/**
 * Puts the trace identifier on every answer and writes the record it points at.
 *
 * The exception filter already stamps a refusal; this covers the other case,
 * which is the one that matters most: a successful answer that turns out to be
 * wrong is the defect this service is most likely to have (ADR 0004), and a
 * user cannot report one they cannot name.
 */
/**
 * The plugin type is taken from the driver's own configuration rather than from
 * `@apollo/server` directly: the package ships CommonJS and ESM declarations of
 * the same types, and importing the other one makes two structurally identical
 * types refuse to be each other.
 */
type ApolloPlugin = NonNullable<ApolloDriverConfig['plugins']>[number];

export function traceExtensionPlugin(): ApolloPlugin {
  const logger = new Logger('Graphql');

  return {
    async requestDidStart() {
      const traceId = currentTraceId() ?? newTraceId();

      return {
        async willSendResponse({ response, operationName }) {
          if (response.body.kind === 'single') {
            response.body.singleResult.extensions = {
              ...response.body.singleResult.extensions,
              traceId,
            };
          }

          logger.log({
            traceId,
            operation: operationName ?? null,
            // A count, never the errors themselves: the filter has already
            // logged each one with what it was allowed to keep.
            errors:
              response.body.kind === 'single'
                ? (response.body.singleResult.errors?.length ?? 0)
                : 0,
          });
        },
      };
    },
  };
}
