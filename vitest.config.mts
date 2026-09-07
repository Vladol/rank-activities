import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: './',
    include: ['src/**/*.spec.ts'],
  },
  // SWC keeps `emitDecoratorMetadata` working, which Nest's DI relies on.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
