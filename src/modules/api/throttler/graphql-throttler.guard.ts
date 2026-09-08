import { type ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * The inbound limit, taught where the request is in a GraphQL call.
 *
 * `ThrottlerGuard` reads the request off the HTTP arguments, and under GraphQL
 * those hold the resolver's arguments instead. Without this the tracker would be
 * the same for every caller and the limit would be global — which is not a limit
 * on a client, it is an outage waiting for enough traffic.
 *
 * It is a guard, so it runs before the resolver and therefore before anything
 * leaves the process: the refusal costs the source nothing, which is the point
 * (stage-six.md, section 5.4).
 */
interface GraphqlContext {
  readonly req?: Record<string, unknown> & { readonly res?: Record<string, unknown> };
  readonly res?: Record<string, unknown>;
}

@Injectable()
export class GraphqlThrottlerGuard extends ThrottlerGuard {
  protected override getRequestResponse(context: ExecutionContext): {
    req: Record<string, unknown>;
    res: Record<string, unknown>;
  } {
    const gql = GqlExecutionContext.create(context).getContext<GraphqlContext>();
    const request = gql?.req;

    if (request === undefined) {
      return super.getRequestResponse(context);
    }

    // The response is taken from the request when the context does not carry
    // one of its own. The guard writes the rate-limit headers onto it, and a
    // stand-in object would turn a refusal into an internal error.
    return { req: request, res: gql.res ?? request.res ?? {} };
  }
}
