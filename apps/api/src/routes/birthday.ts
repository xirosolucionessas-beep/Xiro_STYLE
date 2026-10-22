import { birthdayProgramSchema, type BirthdayProgramDto, type BirthdayStatusDto } from '@xiro/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { birthdayStatus, getBirthdayProgram, saveBirthdayProgram } from '../birthday';
import type { Ctx } from '../context';
import { parse, uuid } from '../errors';

/**
 * Programa de cumpleaños del negocio (opcional, apagado por defecto). Quién puede llamar cada ruta lo decide authz.ts: la
 * configuración es del dueño; el estado de un cliente lo ve quien ve clientes o registra ventas (para aplicarla en caja).
 */
export function birthdayRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;
  const businessOf = (request: FastifyRequest) => request.user.bid;

  app.get('/birthday/program', async (request): Promise<BirthdayProgramDto> => getBirthdayProgram(db, businessOf(request)));

  app.put('/birthday/program', async (request): Promise<BirthdayProgramDto> => {
    // `.strict()`: cualquier campo de más se rechaza; todos los rangos y combinaciones se validan aquí, no solo en la app.
    const input = parse(birthdayProgramSchema, request.body);
    return saveBirthdayProgram(db, businessOf(request), input);
  });

  /** Estado de cumpleaños de un cliente de ESTE negocio (sin la fecha de nacimiento). 404 si el cliente es de otro negocio. */
  app.get('/clients/:id/birthday', async (request): Promise<BirthdayStatusDto> => birthdayStatus(db, businessOf(request), uuid((request.params as { id?: string }).id)));
}
