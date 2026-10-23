import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    // Por defecto Vitest usa 5s: de sobra en solitario, pero insuficiente para jsdom/axe-core cuando varios workers
    // compiten por CPU (visto en esta máquina corriendo las 4 suites del monorepo a la vez).
    testTimeout: 15_000,
  },
});
