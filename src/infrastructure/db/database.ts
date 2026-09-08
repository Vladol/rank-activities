import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema';

/**
 * The typed handle every adapter takes. `undefined` where there is no store
 * configured at all, which is a supported way to run this service rather than a
 * misconfiguration: the rules load from the repository and a known location
 * still ranks (ADR 0007, and design.md, Decision 2).
 */
export type Database = NodePgDatabase<typeof schema>;

export const DATABASE: unique symbol = Symbol('Database');

export { schema };
