import type { GraphQLSchema } from 'graphql';

import type { HorizonLimits } from '../../../domain/ranking/horizon';

/**
 * The shape a named input type has, asked for by structure rather than by
 * class. `graphql` ships a CommonJS and an ESM build, and the schema handed to
 * a transform is built by whichever one the driver loaded: an `instanceof`
 * here silently matches nothing and the range quietly stops being published.
 */
interface FieldBearing {
  getFields(): Record<string, { description: string | null } | undefined>;
}

/**
 * Writes the horizon the service actually answers for into the published
 * contract.
 *
 * The range is configuration, and a decorator is evaluated before configuration
 * is read; stamping it into the schema at build time is what keeps the two from
 * disagreeing. Without this the bound would live only in a validator, and a
 * client would have to discover it by being refused (design.md, Decision 4).
 */
export function stateHorizonRange(schema: GraphQLSchema, limits: HorizonLimits): GraphQLSchema {
  const input = schema.getType('RankingInput') as Partial<FieldBearing> | null | undefined;

  if (typeof input?.getFields !== 'function') {
    return schema;
  }

  const days = input.getFields()['days'];

  if (days !== undefined) {
    days.description = horizonDescription(limits);
  }

  return schema;
}

export function horizonDescription(limits: HorizonLimits): string {
  return (
    `Days ahead, including today: a whole number from 1 to ${limits.maxDays}. ` +
    `Omitted means ${limits.defaultDays}. A larger horizon is refused with ` +
    'HORIZON_TOO_LARGE rather than shortened, because a shortened answer is a ' +
    'different answer given silently.'
  );
}
