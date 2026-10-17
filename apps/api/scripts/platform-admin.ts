/**
 * Administradores del panel de plataforma (fundador y equipo autorizado). ÚNICA forma de crearlos: no hay registro público.
 *
 *   npm run platform:admin -w @xiro/api -- create --email tu@correo.com --name "Nombre" --founder
 *   npm run platform:admin -w @xiro/api -- create --email soporte@correo.com --name "Soporte" --permissions metrics_view,businesses_view
 *   npm run platform:admin -w @xiro/api -- permissions --email soporte@correo.com --permissions metrics_view,businesses_view,business_extend
 *   npm run platform:admin -w @xiro/api -- reset-password --email ...   (cierra sus sesiones)
 *   npm run platform:admin -w @xiro/api -- reset-mfa --email ...        (nuevo código QR; cierra sus sesiones)
 *   npm run platform:admin -w @xiro/api -- disable --email ... | enable --email ...
 *   npm run platform:admin -w @xiro/api -- list
 *
 * Requiere DATABASE_URL y PLATFORM_ADMIN_KEY. La contraseña generada y el enlace otpauth:// se muestran UNA sola vez:
 * pásalos al administrador por un canal seguro y que agregue el enlace a su app autenticadora (Google Authenticator,
 * 1Password, Authy…). Para fijar tú la contraseña: PLATFORM_ADMIN_PASSWORD=... (mín. 14 caracteres).
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config';
import { createDatabase, directDatabaseConfig } from '../src/db/client';
import { createAdmin, listAdmins, resetAdminMfa, resetAdminPassword, setAdminActive, setAdminPermissions } from '../src/platform/admins';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { email: { type: 'string' }, name: { type: 'string' }, founder: { type: 'boolean', default: false }, permissions: { type: 'string' } },
});
const command = positionals[0];
const config = loadConfig();
if (!config.platform.adminKey) {
  console.error('Falta PLATFORM_ADMIN_KEY (≥ 32 caracteres): sin ella el panel de plataforma está desactivado.');
  process.exit(1);
}
const need = (value: string | undefined, flag: string): string => {
  if (!value) {
    console.error(`Falta --${flag}.`);
    process.exit(1);
  }
  return value;
};
const permissions = values.permissions?.split(',').map((p) => p.trim()).filter(Boolean) ?? [];
const handle = createDatabase(directDatabaseConfig(config.database, 1));
try {
  const db = handle.db;
  switch (command) {
    case 'create': {
      const e = await createAdmin(db, config.platform.adminKey, { email: need(values.email, 'email'), name: need(values.name, 'name'), founder: values.founder, permissions, password: process.env.PLATFORM_ADMIN_PASSWORD });
      console.log(`Administrador creado: ${e.email}\nContraseña (se muestra una sola vez): ${e.password}\nAgrega este enlace a tu app autenticadora (o escribe el secreto a mano):\n  ${e.otpauthUri}\n  secreto: ${e.totpSecret}`);
      break;
    }
    case 'permissions':
      console.log('Permisos:', (await setAdminPermissions(db, need(values.email, 'email'), permissions)).join(', ') || '(ninguno)');
      break;
    case 'reset-password':
      console.log(`Nueva contraseña (se muestra una sola vez): ${await resetAdminPassword(db, need(values.email, 'email'), process.env.PLATFORM_ADMIN_PASSWORD)}`);
      break;
    case 'reset-mfa': {
      const r = await resetAdminMfa(db, config.platform.adminKey, need(values.email, 'email'));
      console.log(`Nuevo enlace TOTP:\n  ${r.otpauthUri}\n  secreto: ${r.totpSecret}`);
      break;
    }
    case 'disable':
    case 'enable':
      await setAdminActive(db, need(values.email, 'email'), command === 'enable');
      console.log(command === 'enable' ? 'Activado.' : 'Desactivado y sesiones cerradas.');
      break;
    case 'list':
      console.table((await listAdmins(db)).map((a) => ({ ...a, permissions: a.isFounder ? 'todos (fundador)' : a.permissions.join(',') })));
      break;
    default:
      console.error('Comando: create | permissions | reset-password | reset-mfa | disable | enable | list');
      process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
