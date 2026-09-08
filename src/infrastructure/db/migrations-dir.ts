import { join } from 'node:path';

/**
 * Where the migrations live on disk.
 *
 * Resolved from the working directory rather than from this module's location,
 * for the same reason `seed-files.ts` is: the file is compiled to CommonJS for
 * the application and to ES modules for the test run, and only one of
 * `__dirname` and `import.meta.url` exists in each.
 */
export function migrationsDir(): string {
  return join(process.cwd(), 'src/infrastructure/db/migrations');
}
