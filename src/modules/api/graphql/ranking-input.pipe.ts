import { Inject, Injectable, type PipeTransform } from '@nestjs/common';

import { type HorizonLimits, resolveHorizon } from '../../../domain/ranking/horizon';
import { DomainFailure } from '../../../common/errors/domain-failure.error';
import { RANKING_LIMITS } from '../../ranking/ranking.service';
import type { RankingRequest } from '../../ranking/ranking.service';
import { RankingInputModel, toLocationQuery } from './ranking.args';

/**
 * The door.
 *
 * Everything a request can be wrong about is decided here, before the resolver
 * body runs and therefore before anything leaves the process — which is the
 * whole of the protection stage-six.md, section 5.4 asks for: a flood of
 * invented city names must cost the source nothing, and an over-long horizon
 * must cost a round trip nothing.
 *
 * The horizon is refused rather than shortened. Answering four days to a
 * request for ten is a different answer given silently (design.md, Decision 4).
 */
@Injectable()
export class RankingInputPipe implements PipeTransform<RankingInputModel, RankingRequest> {
  constructor(@Inject(RANKING_LIMITS) private readonly limits: HorizonLimits) {}

  transform(input: RankingInputModel): RankingRequest {
    const located = toLocationQuery(input.location);

    if ('fault' in located) {
      throw new DomainFailure(located.fault);
    }

    const horizon = resolveHorizon(input.days, this.limits);

    if (!horizon.ok) {
      throw new DomainFailure(horizon.error);
    }

    return {
      location: located.query,
      ...(input.days === undefined ? {} : { days: input.days }),
    };
  }
}
