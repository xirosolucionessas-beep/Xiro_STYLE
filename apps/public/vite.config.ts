import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Página pública de reservas (Vite + React). Se sirve bajo /reservar/ (la API la monta ahí, ver apps/api/src/routes/web.ts),
 * por eso `base` va fijo: los enlaces a los archivos generados (JS, CSS) deben salir con ese prefijo.
 * En desarrollo, las peticiones a /api y /media se reenvían a la API local (evita configurar CORS solo para probar).
 */
export default defineConfig({
  base: '/reservar/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3000',
      '/media': 'http://localhost:3000',
    },
  },
});
