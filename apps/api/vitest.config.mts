import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/setup/global.ts'],
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // Cada archivo usa su propia base de datos, así que pueden ejecutarse en paralelo contra el mismo servidor.
    fileParallelism: true,
  },
});
