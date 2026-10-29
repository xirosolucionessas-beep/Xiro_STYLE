import { EMPLOYEE_ACTIVE_LIMIT, type AuthSession, type Employee, type EmployeeQuotaDto } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { auth, createEmployee, PASSWORD, register, unique } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/** Límite de 5 empleados ACTIVOS por negocio: aplicado en el servidor, atómico, aislado por negocio y sin tocar al dueño. */
let testDb: TestDatabase;
let app: FastifyInstance;
let cleanup: () => void;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const setup = testAppConfig();
  cleanup = setup.cleanup;
  app = await buildApp({ db: testDb.db, config: setup.config });
});
afterAll(async () => {
  await app.close();
  cleanup();
  await testDb.drop();
});

const q = <T = Record<string, unknown>>(text: string, values: unknown[] = []) => testDb.pool.query(text, values).then((r) => r.rows as T[]);
const send = (session: AuthSession, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => app.inject({ method, url, headers: auth(session), payload: payload as object | undefined });
const addEmployee = (owner: AuthSession) => {
  const n = unique();
  return send(owner, 'POST', '/api/employees', { name: `Persona ${n}`, email: `cupo${n}@correo.com`, password: PASSWORD, permissions: [] });
};
const quota = (owner: AuthSession) => send(owner, 'GET', '/api/employees/quota').then((r) => r.json<EmployeeQuotaDto>());
const setActive = (owner: AuthSession, id: string, active: boolean) => send(owner, 'PATCH', `/api/employees/${id}`, { active });

async function fill(owner: AuthSession, howMany = EMPLOYEE_ACTIVE_LIMIT): Promise<Employee[]> {
  const created: Employee[] = [];
  for (let i = 0; i < howMany; i++) {
    const res = await addEmployee(owner);
    expect(res.statusCode).toBe(201);
    created.push(res.json<Employee>());
  }
  return created;
}

describe('límite de empleados activos', () => {
  it('hasta 5 activos (el dueño no cuenta); la sexta alta se rechaza en el servidor con un error claro', async () => {
    const owner = await register(app, 'Cupos');
    expect(await quota(owner)).toEqual({ active: 0, limit: 5, remaining: 5, overLimit: false });
    await fill(owner);
    expect(await quota(owner)).toEqual({ active: 5, limit: 5, remaining: 0, overLimit: false });
    const sixth = await addEmployee(owner);
    expect(sixth.statusCode).toBe(409);
    expect(sixth.json()).toMatchObject({ code: 'employee_limit_reached', active: 5, limit: 5 });
    expect(Number((await q<{ n: string }>(`select count(*) as n from users where business_id = (select business_id from users where id = $1) and role = 'employee'`, [owner.user.id]))[0]!.n)).toBe(5);
    // El dueño conserva su acceso de siempre.
    expect((await send(owner, 'GET', '/api/employees')).statusCode).toBe(200);
  });

  it('desactivar libera el cupo y se puede reutilizar; reactivar exige cupo igual que un alta', async () => {
    const owner = await register(app, 'Reactivar');
    const team = await fill(owner);
    expect((await setActive(owner, team[0]!.id, false)).statusCode).toBe(200);
    expect(await quota(owner)).toMatchObject({ active: 4, remaining: 1 });
    // La cuenta desactivada conserva sus datos.
    expect((await send(owner, 'GET', '/api/employees')).json<Employee[]>().find((e) => e.id === team[0]!.id)).toMatchObject({ name: team[0]!.name, active: false });

    expect((await addEmployee(owner)).statusCode).toBe(201); // reutiliza el cupo
    const reactivate = await setActive(owner, team[0]!.id, true);
    expect(reactivate.statusCode).toBe(409);
    expect(reactivate.json()).toMatchObject({ code: 'employee_limit_reached' });

    // Cambiar otras cosas de un empleado activo no se bloquea por estar en el límite.
    expect((await send(owner, 'PATCH', `/api/employees/${team[1]!.id}`, { name: 'Nuevo nombre', active: true })).statusCode).toBe(200);
  });

  it('dos altas simultáneas cuando queda un solo cupo: solo una lo ocupa', async () => {
    const owner = await register(app, 'Simultaneas');
    await fill(owner, EMPLOYEE_ACTIVE_LIMIT - 1);
    const results = await Promise.all([addEmployee(owner), addEmployee(owner), addEmployee(owner)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
    expect((await quota(owner)).active).toBe(5);
  });

  it('alta y reactivación simultáneas por el último cupo: solo una gana', async () => {
    const owner = await register(app, 'Mixta');
    const team = await fill(owner);
    expect((await setActive(owner, team[0]!.id, false)).statusCode).toBe(200);
    const results = await Promise.all([addEmployee(owner), setActive(owner, team[0]!.id, true)]);
    // Gana una (201 del alta o 200 de la reactivación) y la otra recibe 409.
    expect(results.filter((r) => r.statusCode === 201 || r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(1);
    expect((await quota(owner)).active).toBe(5);
  });

  it('los cupos están aislados por negocio', async () => {
    const full = await register(app, 'Lleno');
    const other = await register(app, 'Vacio');
    await fill(full);
    expect(await quota(other)).toMatchObject({ active: 0, remaining: 5 });
    expect((await addEmployee(other)).statusCode).toBe(201);
    expect((await quota(full)).active).toBe(5);
  });

  it('negocio que YA superaba el límite: nadie pierde acceso, se informa y no se agregan ni reactivan más', async () => {
    const owner = await register(app, 'Excedido');
    const team = await fill(owner);
    // Simula datos previos al límite: dos empleados más ya activos (insertados directo, como existían antes).
    const businessId = (await q<{ business_id: string }>(`select business_id from users where id = $1`, [owner.user.id]))[0]!.business_id;
    for (const n of [unique(), unique()]) {
      await q(`insert into users (business_id, name, email, password_hash, role, active) values ($1, $2, $3, 'x', 'employee', true)`, [businessId, `Antiguo ${n}`, `antiguo${n}@correo.com`]);
    }
    expect(await quota(owner)).toEqual({ active: 7, limit: 5, remaining: 0, overLimit: true });
    expect((await addEmployee(owner)).statusCode).toBe(409);
    // Siguen activos: nada se desactiva solo.
    expect(Number((await q<{ n: string }>(`select count(*) as n from users where business_id = $1 and role = 'employee' and active`, [businessId]))[0]!.n)).toBe(7);
    // Al bajar de 7 a 5 sigue sin cupo; desde 4 vuelve a haber uno.
    for (const e of team.slice(0, 3)) expect((await setActive(owner, e.id, false)).statusCode).toBe(200);
    expect(await quota(owner)).toMatchObject({ active: 4, remaining: 1, overLimit: false });
    expect((await setActive(owner, team[0]!.id, true)).statusCode).toBe(200);
    expect((await setActive(owner, team[1]!.id, true)).statusCode).toBe(409);
  });

  it('solo el dueño consulta los cupos', async () => {
    const owner = await register(app, 'PermisoCupos');
    const employee = await createEmployee(app, owner, ['services_record']);
    expect((await send(employee.session, 'GET', '/api/employees/quota')).statusCode).toBe(403);
  });
});
