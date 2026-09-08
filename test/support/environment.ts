import { ConfigService } from '@nestjs/config';

import { type Env, validateEnv } from '../../src/config/env.schema';

/**
 * A configuration a test states rather than sets.
 *
 * `ConfigModule.forRoot` validates the environment once, when `app.module.ts`
 * is first imported, so setting a variable inside a test changes nothing: the
 * answer was decided before the test ran. Overriding the service is what lets
 * one suite boot the same application under a different configuration — which
 * is the only way to exercise a bound at a size a test can cross.
 */
export function configurationWith(overrides: Record<string, string>): ConfigService<Env, true> {
  const env = validateEnv({ ...process.env, ...overrides });

  return {
    get: (key: keyof Env) => env[key],
    getOrThrow: (key: keyof Env) => env[key],
  } as unknown as ConfigService<Env, true>;
}
