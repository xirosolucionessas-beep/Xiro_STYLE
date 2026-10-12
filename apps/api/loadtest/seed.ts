/**
 * Siembra de datos para la carga, A TRAVÉS DE LA API (mismas validaciones y transacciones que en producción):
 *  - 1 negocio grande: 20.000 clientes, 5.000 artículos (4.500 productos + 500 servicios), 150 empleados, página publicada.
 *  - 200 negocios pequeños con página de reservas publicada (dueño que atiende + un servicio de 30 min).
 *
 *   npm run load:seed -w @xiro/api            (requiere `npm run load:db` corriendo)
 *   npm run load:seed -w @xiro/api -- --reset  (borra la base de carga y vuelve a sembrar)
 *
 * La contraseña de las cuentas de prueba se genera al azar y queda solo en data/carga/seed.json (ignorado por git).
 */
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import type { AuthSession, Item } from '@xiro/shared';
import pg from 'pg';
import { ADMIN_URL, DB_NAME, SEED_FILE, api, ensureDatabase, parallel, startApi } from './lib';

export interface SeedData {
  password: string;
  createdAt: string;
  big: { slug: string; ownerEmail: string; employeeEmails: string[]; serviceIds: string[]; clients: number; items: number };
  small: Array<{ slug: string; email: string; serviceId: string }>;
}

const CLIENTS = Number(process.env.LOADTEST_CLIENTS ?? 20_000);
const PRODUCTS = Number(process.env.LOADTEST_PRODUCTS ?? 4_500);
const SERVICES = Number(process.env.LOADTEST_SERVICES ?? 500);
// Muchos usuarios del negocio grande: el límite por usuario (600/min = 10 peticiones/s) es por persona, y con pocas
// cuentas la prueba mediría ese límite en vez del servidor.
const EMPLOYEES = Number(process.env.LOADTEST_EMPLOYEES ?? 150);
const SMALL = Number(process.env.LOADTEST_SMALL_BUSINESSES ?? 200);
const CONCURRENCY = 12;

const FIRST = ['Ana', 'Luis', 'María', 'Carlos', 'Laura', 'Andrés', 'Camila', 'Juan', 'Valentina', 'Santiago', 'Daniela', 'Mateo', 'Sofía', 'Sebastián', 'Isabella', 'Diego', 'Paula', 'Felipe', 'Natalia', 'Julián', 'Mariana', 'Alejandro', 'Gabriela', 'Nicolás', 'Lucía', 'David', 'Sara', 'Tomás', 'Juliana', 'Esteban'];
const LAST = ['Gómez', 'Rodríguez', 'Martínez', 'López', 'García', 'Hernández', 'Pérez', 'Sánchez', 'Ramírez', 'Torres', 'Díaz', 'Vargas', 'Moreno', 'Rojas', 'Castro', 'Ortiz', 'Jiménez', 'Muñoz', 'Álvarez', 'Ruiz', 'Mendoza', 'Herrera', 'Medina', 'Aguilar', 'Restrepo', 'Cárdenas', 'Ospina', 'Salazar', 'Quintero', 'Valencia'];
const PRODUCT_WORDS = ['Shampoo', 'Acondicionador', 'Cera', 'Gel', 'Tinte', 'Mascarilla', 'Aceite', 'Crema', 'Esmalte', 'Serum', 'Spray', 'Tónico', 'Bálsamo', 'Keratina', 'Pomada'];
const PRODUCT_TRAITS = ['hidratante', 'reparador', 'mate', 'brillo', 'anticaspa', 'rizos', 'nutritivo', 'fijación fuerte', 'natural', 'profesional'];
const SERVICE_WORDS = ['Corte', 'Barba', 'Manicure', 'Pedicure', 'Color', 'Peinado', 'Alisado', 'Masaje', 'Facial', 'Depilación'];

const pick = <T>(list: T[], n: number) => list[n % list.length]!;
const phoneFor = (n: number) => `3${String(100_000_000 + n).slice(-9)}`;

async function resetDatabase() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${DB_NAME} with (force)`);
  await admin.end();
}

async function main() {
  if (process.argv.includes('--reset')) await resetDatabase();
  else if (existsSync(SEED_FILE)) {
    console.log(`Ya hay datos sembrados (${SEED_FILE}). Usa --reset para empezar de cero.`);
    return;
  }
  await ensureDatabase();
  // Siembra sin límites de abuso (es una carga masiva de un solo origen); las pruebas sí los tienen activos.
  const server = await startApi('seed', { RATE_LIMIT: 'off', LOG_LEVEL: 'warn' });
  const password = `${randomBytes(12).toString('base64url')}Aa1`;
  const started = Date.now();
  const elapsed = () => `${Math.round((Date.now() - started) / 1000)} s`;

  try {
    const register = (label: string, email: string) =>
      api<AuthSession>('POST', '/api/auth/register', { name: `Dueño ${label}`, businessName: label, businessType: 'barbershop', email, password, acceptTerms: true, language: 'es' });
    const publish = async (session: AuthSession, publicName: string) => {
      await api('PATCH', `/api/professionals/${session.user.id}`, { bookable: true, publicName }, session.accessToken);
      await api('PUT', '/api/booking/profile', { published: true }, session.accessToken);
    };
    const firstCategory = async (session: AuthSession) => (await api<Array<{ id: string }>>('GET', '/api/categories', undefined, session.accessToken))[0]!.id;

    /* ----- Negocio grande ----- */
    const ownerEmail = 'grande@carga.local';
    const owner = await register('Carga Grande', ownerEmail);
    await publish(owner, 'Dueño Grande');
    const categoryId = await firstCategory(owner);
    const token = owner.accessToken;

    const serviceIds: string[] = [];
    await parallel(Array.from({ length: SERVICES }, (_, i) => i), CONCURRENCY, async (i) => {
      const item = await api<Item>('POST', '/api/items', { name: `${pick(SERVICE_WORDS, i)} ${pick(PRODUCT_TRAITS, i >> 2)} ${i + 1}`, categoryId, price: 20_000 + (i % 40) * 1_000, kind: 'service', durationMinutes: 30 + (i % 4) * 15 }, token);
      serviceIds.push(item.id);
    });
    console.log(`  ${SERVICES} servicios (${elapsed()})`);
    await parallel(Array.from({ length: PRODUCTS }, (_, i) => i), CONCURRENCY, async (i) => {
      await api('POST', '/api/items', { name: `${pick(PRODUCT_WORDS, i)} ${pick(PRODUCT_TRAITS, i >> 3)} ${i + 1}`, categoryId, price: 8_000 + (i % 90) * 500, kind: 'product', stock: i % 25, referenceCode: `REF-${String(i + 1).padStart(5, '0')}` }, token);
    });
    console.log(`  ${PRODUCTS} productos (${elapsed()})`);

    let done = 0;
    await parallel(Array.from({ length: CLIENTS }, (_, i) => i), CONCURRENCY, async (i) => {
      const name = `${pick(FIRST, i)} ${pick(LAST, Math.floor(i / FIRST.length))} ${pick(LAST, Math.floor(i / 7))}`;
      await api('POST', '/api/clients', { name, phone: phoneFor(i), ...(i % 2 === 0 ? { email: `cliente${i}@carga.local` } : {}), notes: i % 10 === 0 ? 'Prefiere citas en la mañana' : '' }, token);
      if (++done % 5_000 === 0) console.log(`  ${done} clientes (${elapsed()})`);
    });

    const employeeEmails: string[] = [];
    await parallel(Array.from({ length: EMPLOYEES }, (_, i) => i), 4, async (i) => {
      const email = `empleado${i + 1}@carga.local`;
      await api('POST', '/api/employees', { name: `Empleado ${i + 1}`, email, password, permissions: ['clients_view', 'clients_manage', 'catalog_view', 'catalog_manage', 'agenda_all', 'appointments_manage'] }, token);
      employeeEmails.push(email);
    });
    console.log(`  ${EMPLOYEES} empleados (${elapsed()})`);

    /* ----- Negocios pequeños con reservas ----- */
    const small: SeedData['small'] = [];
    await parallel(Array.from({ length: SMALL }, (_, i) => i), 6, async (i) => {
      const email = `negocio${i + 1}@carga.local`;
      const session = await register(`Carga Negocio ${i + 1}`, email);
      await publish(session, `Profesional ${i + 1}`);
      const service = await api<Item>('POST', '/api/items', { name: 'Corte clásico', categoryId: await firstCategory(session), price: 25_000, kind: 'service', durationMinutes: 30 }, session.accessToken);
      small.push({ slug: session.business.slug, email, serviceId: service.id });
    });
    console.log(`  ${SMALL} negocios con reservas (${elapsed()})`);

    const seed: SeedData = {
      password,
      createdAt: new Date().toISOString(),
      big: { slug: owner.business.slug, ownerEmail, employeeEmails, serviceIds, clients: CLIENTS, items: SERVICES + PRODUCTS },
      small,
    };
    writeFileSync(SEED_FILE, JSON.stringify(seed, null, 2));
    console.log(`Siembra lista en ${elapsed()}: ${SEED_FILE}`);
  } finally {
    await server.stop();
  }
}

await main();
