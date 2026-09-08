import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * The only suite that needs a database, and it is a separate configuration for
 * the same reason the live contract run is: an option can be passed by
 * accident, a second config has to be chosen.
 *
 * `npm test` and `npm run test:e2e` must pass with nothing running
 * (spec, "The whole test suite needs no store"), so everything here is opt-in.
 * A real PostgreSQL rather than a substitute engine: what is being checked is
 * migrations, partitioning, triggers and check constraints, and an emulation of
 * those would prove something about the emulation.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: './',
    setupFiles: ['./test/setup/no-network.ts'],
    globalSetup: ['./test/integration/support/global-setup.ts'],
    include: ['test/integration/**/*.spec.ts'],
    fileParallelism: false,
    // Pulling the image on a cold machine outlasts the default by a distance.
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
