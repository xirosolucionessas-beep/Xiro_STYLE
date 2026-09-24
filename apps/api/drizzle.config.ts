import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  // Solo lo necesitan `drizzle-kit migrate/studio`; `generate` no se conecta.
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/xiro' },
  strict: true,
  verbose: true,
});
