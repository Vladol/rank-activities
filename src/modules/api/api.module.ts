import { Module } from '@nestjs/common';

import { RankingModule } from '../ranking/ranking.module';
import { RankingResolver } from './graphql/ranking.resolver';

/**
 * The transport layer, and the only place a GraphQL decorator appears. What it
 * exposes is decided by the models beside it, never by the shape of a domain
 * type that happened to be returned.
 */
@Module({
  imports: [RankingModule],
  providers: [RankingResolver],
})
export class ApiModule {}
