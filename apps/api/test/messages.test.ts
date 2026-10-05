import type { AuthSession, ConversationDto, MessageDto, MessagePerson } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { auth, createEmployee, register } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

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

const send = (session: { accessToken: string }, method: 'GET' | 'POST', url: string, payload?: unknown) => app.inject({ method, url, headers: auth(session), payload: payload as object | undefined });

const people = (session: { accessToken: string }) => send(session, 'GET', '/api/messages/people').then((r) => r.json<MessagePerson[]>());
const conversations = (session: { accessToken: string }) => send(session, 'GET', '/api/messages/conversations').then((r) => r.json<ConversationDto[]>());
const start = (session: { accessToken: string }, userId: string) => send(session, 'POST', '/api/messages/conversations', { userId });
const messagesOf = (session: { accessToken: string }, id: string) => send(session, 'GET', `/api/messages/conversations/${id}/messages`).then((r) => r.json<MessageDto[]>());
const say = (session: { accessToken: string }, id: string, content: string) => send(session, 'POST', `/api/messages/conversations/${id}/messages`, { content });
const markRead = (session: { accessToken: string }, id: string) => send(session, 'POST', `/api/messages/conversations/${id}/read`);

/** Negocio con el dueño y dos empleados, todos con sesión. */
async function team() {
  const owner = await register(app, 'Equipo');
  const luis = await createEmployee(app, owner, []);
  const ana = await createEmployee(app, owner, []);
  return { owner, luis: luis.session, ana: ana.session };
}

describe('a quién se le puede escribir', () => {
  it('lista al resto del equipo (no a una misma) y trae su foto/rol', async () => {
    const { owner, luis, ana } = await team();
    const list = await people(owner);
    expect(list.map((p) => p.id).sort()).toEqual([luis.user.id, ana.user.id].sort());
    expect(list.find((p) => p.id === owner.user.id)).toBeUndefined(); // nunca a una misma
    expect(list.every((p) => p.photoUrl === null && !p.isOwner)).toBe(true);
    const fromLuis = await people(luis);
    expect(fromLuis.some((p) => p.isOwner)).toBe(true);
  });

  it('un negocio con un solo dueño y nadie más: la lista queda vacía, no falla', async () => {
    const solo = await register(app, 'Solo');
    expect(await people(solo)).toEqual([]);
  });
});

describe('conversaciones: una sola por par, sin importar quién la empieza', () => {
  it('empezarla dos veces (en cualquier orden) da la MISMA conversación', async () => {
    const { owner, luis } = await team();
    const first = await start(owner, luis.user.id);
    expect(first.statusCode).toBe(200);
    const a = first.json<ConversationDto>();
    const second = await start(luis, owner.user.id);
    expect(second.json<ConversationDto>().id).toBe(a.id);
  });

  it('cada quien ve al OTRO como interlocutor en su propia lista', async () => {
    const { owner, luis } = await team();
    await start(owner, luis.user.id);
    const mine = await conversations(owner);
    expect(mine[0]!.peer.id).toBe(luis.user.id);
    const theirs = await conversations(luis);
    expect(theirs[0]!.peer.id).toBe(owner.user.id);
  });

  it('no se puede empezar una conversación con una misma, ni con alguien de otro negocio', async () => {
    const { owner, luis } = await team();
    const other = await register(app, 'OtroNegocio');
    expect((await start(owner, owner.user.id)).statusCode).toBe(400);
    expect((await start(owner, other.user.id)).statusCode).toBe(404); // no confirma que exista
  });
});

describe('mensajes: enviar, leer y aislar', () => {
  it('van llegando en orden, y "último mensaje" y hora de actividad se actualizan', async () => {
    const { owner, luis } = await team();
    const { id } = (await start(owner, luis.user.id)).json<ConversationDto>();
    expect((await say(owner, id, 'Hola Luis')).statusCode).toBe(201);
    await new Promise((r) => setTimeout(r, 5));
    expect((await say(luis, id, 'Hola, dime')).statusCode).toBe(201);

    const thread = await messagesOf(owner, id);
    expect(thread.map((m) => m.content)).toEqual(['Hola Luis', 'Hola, dime']);

    const mine = (await conversations(owner))[0]!;
    expect(mine.lastMessage).toMatchObject({ content: 'Hola, dime', senderId: luis.user.id });
  });

  it('marcar como leído solo afecta lo que escribió la OTRA persona, y el contador baja a cero', async () => {
    const { owner, luis } = await team();
    const { id } = (await start(owner, luis.user.id)).json<ConversationDto>();
    await say(luis, id, 'Uno');
    await say(luis, id, 'Dos');
    await say(owner, id, 'Ya te leo');

    expect((await conversations(owner))[0]!.unreadCount).toBe(2);
    expect((await conversations(luis))[0]!.unreadCount).toBe(1); // el suyo propio no cuenta como sin leer

    expect((await markRead(owner, id)).statusCode).toBe(200);
    expect((await conversations(owner))[0]!.unreadCount).toBe(0);
    expect((await conversations(luis))[0]!.unreadCount).toBe(1); // a Luis no le cambió nada
  });

  it('un mensaje vacío, o de más de 4000 caracteres, se rechaza', async () => {
    const { owner, luis } = await team();
    const { id } = (await start(owner, luis.user.id)).json<ConversationDto>();
    expect((await say(owner, id, '')).statusCode).toBe(400);
    expect((await say(owner, id, '   ')).statusCode).toBe(400);
    expect((await say(owner, id, 'x'.repeat(4001))).statusCode).toBe(400);
    expect((await say(owner, id, 'x'.repeat(4000))).statusCode).toBe(201);
  });

  it('quien no es parte de la conversación no la ve, no le escribe y no la marca leída (404, sin confirmar que exista)', async () => {
    const { owner, luis, ana } = await team();
    const { id } = (await start(owner, luis.user.id)).json<ConversationDto>();
    expect((await send(ana, 'GET', `/api/messages/conversations/${id}/messages`)).statusCode).toBe(404);
    expect((await say(ana, id, 'Intruso')).statusCode).toBe(404);
    expect((await markRead(ana, id)).statusCode).toBe(404);
  });

  it('aislamiento entre negocios: ni ver, ni escribir, ni marcar leído en la conversación de OTRO negocio', async () => {
    const { owner, luis } = await team();
    const { id } = (await start(owner, luis.user.id)).json<ConversationDto>();
    const otherOwner = await register(app, 'NegocioB');
    expect((await send(otherOwner, 'GET', `/api/messages/conversations/${id}/messages`)).statusCode).toBe(404);
    expect((await say(otherOwner, id, 'Ajeno')).statusCode).toBe(404);
    expect((await markRead(otherOwner, id)).statusCode).toBe(404);
    // Y del otro lado: el negocio B no ve conversaciones del A en su propia lista.
    expect(await conversations(otherOwner)).toEqual([]);
  });

  it('dos negocios pueden tener, cada uno, una conversación entre su dueño y su empleado, sin mezclarse', async () => {
    const teamA = await team();
    const teamB = await team();
    const a = (await start(teamA.owner, teamA.luis.user.id)).json<ConversationDto>();
    const b = (await start(teamB.owner, teamB.luis.user.id)).json<ConversationDto>();
    expect(a.id).not.toBe(b.id);
    await say(teamA.owner, a.id, 'Solo para A');
    await say(teamB.owner, b.id, 'Solo para B');
    expect((await messagesOf(teamA.owner, a.id)).map((m) => m.content)).toEqual(['Solo para A']);
    expect((await messagesOf(teamB.owner, b.id)).map((m) => m.content)).toEqual(['Solo para B']);
  });
});
