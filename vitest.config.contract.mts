import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * The only configuration without the socket guard, and the only one that runs
 * `test/contract/`. It is deliberately a separate file rather than a flag on
 * the default run: an option can be passed by accident, a second config has to
 * be chosen (design.md, Decision 7).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: './',
    include: ['test/contract/**/*.spec.ts'],
    fileParallelism: false,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
