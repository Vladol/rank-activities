import { GraphQLInputObjectType, GraphQLInt, GraphQLSchema, GraphQLString, printSchema } from 'graphql';
import { GraphQLObjectType } from 'graphql';
import { describe, expect, it } from 'vitest';

import { horizonDescription, stateHorizonRange } from './horizon-in-schema';

function schemaWithRankingInput(): GraphQLSchema {
  const input = new GraphQLInputObjectType({
    name: 'RankingInput',
    fields: { days: { type: GraphQLInt, description: 'Days ahead.' } },
  });

  return new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'Query',
      fields: { rank: { type: GraphQLString, args: { input: { type: input } } } },
    }),
  });
}

describe('the horizon as part of the published contract', () => {
  it('writes the configured range into the schema, not only into a validator', () => {
    const schema = stateHorizonRange(schemaWithRankingInput(), { defaultDays: 3, maxDays: 7 });
    const printed = printSchema(schema);

    expect(printed).toContain('from 1 to 7');
    expect(printed).toContain('Omitted means 3');
  });

  it('says the horizon is refused rather than shortened', () => {
    // A client that reads the contract learns the rule; a client that does not
    // learns it from a refusal rather than from a quietly different answer.
    expect(horizonDescription({ defaultDays: 7, maxDays: 7 })).toContain('HORIZON_TOO_LARGE');
    expect(horizonDescription({ defaultDays: 7, maxDays: 7 })).toContain('rather than shortened');
  });

  it('leaves a schema that has no such input alone rather than failing the start', () => {
    const empty = new GraphQLSchema({
      query: new GraphQLObjectType({ name: 'Query', fields: { hello: { type: GraphQLString } } }),
    });

    expect(() => stateHorizonRange(empty, { defaultDays: 7, maxDays: 7 })).not.toThrow();
  });
});
