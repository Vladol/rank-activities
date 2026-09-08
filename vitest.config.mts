import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: './',
    // No test may reach the network: the suite runs on recorded fixtures.
    setupFiles: ['./test/setup/no-network.ts'],
    // Acceptance and golden tests live under test/ but are unit-speed: they run
    // on recorded fixtures, not on a booted application (stage-five.md, 12).
    include: ['src/**/*.spec.ts', 'test/acceptance/**/*.spec.ts', 'test/golden/**/*.spec.ts'],
  },
  // SWC keeps `emitDecoratorMetadata` working, which Nest's DI relies on.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
