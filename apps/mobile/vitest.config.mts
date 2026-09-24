import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Pruebas de la capa web (tokens, contraste, componentes DOM). No cargan React Native. */
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
