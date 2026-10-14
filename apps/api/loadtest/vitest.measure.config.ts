import { defineConfig } from 'vitest/config';

/**
 * Mediciones (no pruebas): `npx vitest run --config loadtest/vitest.measure.config.ts` desde apps/api. Usan el mismo
 * PostgreSQL efímero que las pruebas (test/setup/global.ts), nunca la base de desarrollo ni la de producción.
 */
export default defineConfig({
  test: {
    globalSetup: ['./test/setup/global.ts'],
    include: ['loadtest/**/*.measure.ts'],
    testTimeout: 60 * 60_000,
    hookTimeout: 60 * 60_000,
    fileParallelism: false,
  },
});
