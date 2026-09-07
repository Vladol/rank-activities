import { Query, Resolver } from '@nestjs/graphql';

import { AppService } from './app.service';

@Resolver()
export class AppResolver {
  constructor(private readonly appService: AppService) {}

  @Query(() => String, { description: 'Sanity check that the GraphQL layer is wired up.' })
  hello(): string {
    return this.appService.hello();
  }
}
