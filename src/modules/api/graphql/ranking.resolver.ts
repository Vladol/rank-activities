import { Args, Query, Resolver } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';

import { RankingService } from '../../ranking/ranking.service';
import { type LocationInputFault, RankingInputModel, toLocationQuery } from './ranking.args';
import { toRankingAnswerModel } from './ranking.mapper';
import { RankingAnswerModel } from './ranking.models';

const FAULT_MESSAGE: Record<LocationInputFault, string> = {
  EMPTY: 'a location is a name or a pair of coordinates, and this request gave neither',
  BOTH: 'a location is a name or a pair of coordinates, not both',
  PARTIAL_COORDINATES: 'a point needs both a latitude and a longitude',
};

/**
 * The scenario, exposed.
 *
 * The resolver does three things and no more: it turns the input into a domain
 * query, it calls the use case, and it maps the answer. Every judgement —
 * which days, which activities, which outcome — was made before it was
 * reached, and none of it may be made again here.
 */
@Resolver()
export class RankingResolver {
  constructor(private readonly ranking: RankingService) {}

  @Query(() => RankingAnswerModel, {
    description:
      'Ranks every activity in the catalogue against the forecast, for each local day of the horizon.',
  })
  async rankActivities(
    @Args('input', { type: () => RankingInputModel }) input: RankingInputModel,
  ): Promise<RankingAnswerModel> {
    const location = toLocationQuery(input.location);

    if ('fault' in location) {
      throw new GraphQLError(FAULT_MESSAGE[location.fault], {
        extensions: { code: location.fault },
      });
    }

    const answer = await this.ranking.rank({
      location: location.query,
      ...(input.days === undefined ? {} : { days: input.days }),
    });

    if (!answer.ok) {
      // The error envelope is `09-add-graphql-api`. What this change owes is
      // that the reason is the registry code and never free-form text.
      throw new GraphQLError(answer.error.message, {
        extensions: { code: answer.error.code, ...answer.error.context },
      });
    }

    return toRankingAnswerModel(answer.value);
  }
}
