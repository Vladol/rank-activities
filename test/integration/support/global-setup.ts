import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

/**
 * One container for the whole integration run, shared by every file through
 * `inject`. Each file then creates its own database inside it and migrates
 * that, so the files stay independent without paying for a container each.
 */
declare module 'vitest' {
  export interface ProvidedContext {
    postgresUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject): Promise<void> {
  container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('rank_activities')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  project.provide('postgresUrl', container.getConnectionUri());
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
