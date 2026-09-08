import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';

import { AppModule } from './app.module';
import type { Env } from './config/env.schema';
import { SchemaGuardService } from './infrastructure/db/schema-guard.service';

/**
 * What the process does on the way up, with the two things a test needs to
 * observe passed in: how it stops, and what it built.
 *
 * The schema is verified before `listen`, so a service that finds a schema it
 * does not recognise serves no request at all rather than serving a few and
 * then falling over (spec, "A schema behind the code stops the start").
 */
export interface BootstrapOptions {
  readonly exit?: (code: number) => void;
  readonly logger?: Pick<Logger, 'error'>;
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<INestApplication | undefined> {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const logger = options.logger ?? new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();

  try {
    await app.get(SchemaGuardService).verify();
  } catch (cause) {
    logger.error(cause instanceof Error ? cause.message : String(cause));
    await app.close();
    exit(1);

    return undefined;
  }

  const config = app.get(ConfigService<Env, true>);

  await app.listen(config.get('PORT', { infer: true }));

  return app;
}
