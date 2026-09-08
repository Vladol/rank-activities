import { Args, Query, Resolver } from '@nestjs/graphql';

import { DomainFailure } from '../../../common/errors/domain-failure.error';
import { RankingService, type RankingRequest } from '../../ranking/ranking.service';
import { RankingInputPipe } from './ranking-input.pipe';
import { RankingInputModel } from './ranking.args';
import { toRankingAnswerModel } from './ranking.mapper';
import { RankingAnswerModel } from './ranking.models';

/**
 * The scenario, exposed.
 *
 * The resolver does three things and no more: it takes the request the pipe
 * has already validated, it calls the use case, and it maps the answer. Every
 * judgement — which days, which activities, which outcome — was made before it
 * was reached, and none of it may be made again here.
 *
 * A failure it cannot answer is thrown as a `DomainFailure` and turned into a
 * transport error by the filter; an activity that cannot be answered for is a
 * member of the union inside a successful response (design.md, Decision 2).
 */
@Resolver()
export class RankingResolver {
  constructor(private readonly ranking: RankingService) {}

  @Query(() => RankingAnswerModel, {
    description:
      'Ranks every activity in the catalogue against the forecast, for each local day of the horizon.',
  })
  async rankActivities(
    @Args('input', { type: () => RankingInputModel }, RankingInputPipe) request: RankingRequest,
  ): Promise<RankingAnswerModel> {
    const answer = await this.ranking.rank(request);

    if (!answer.ok) {
      throw new DomainFailure(answer.error);
    }

    return toRankingAnswerModel(answer.value);
  }
}
