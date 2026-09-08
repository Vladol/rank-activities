import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: './',
    // No test may reach the network: the suite runs on recorded fixtures.
    setupFiles: ['./test/setup/no-network.ts'],
    include: ['src/**/*.spec.ts'],
  },
  // SWC keeps `emitDecoratorMetadata` working, which Nest's DI relies on.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
