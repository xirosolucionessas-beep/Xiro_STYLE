/**
 * "Recordar mis datos en este dispositivo" (Fase 4, si el negocio lo activa y la persona lo marca): nombre, celular y correo se
 * guardan SOLO en este navegador (nunca en el servidor), por negocio, para no volver a escribirlos en la próxima reserva. Las
 * notas y los campos propios del negocio no se guardan. Todo acceso va en try/catch: en modo privado o con el almacenamiento
 * bloqueado simplemente no se recuerda nada.
 */
export interface RememberedCustomer {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

const keyFor = (slug: string) => `xp-customer:${slug}`;
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');

export function loadRememberedCustomer(slug: string): RememberedCustomer | null {
  try {
    const raw = window.localStorage.getItem(keyFor(slug));
    if (!raw) return null;
    const data = JSON.parse(raw) as Record<string, unknown>;
    const out = { firstName: text(data.firstName, 50), lastName: text(data.lastName, 50), phone: text(data.phone, 30), email: text(data.email, 254) };
    return out.firstName || out.phone ? out : null;
  } catch {
    return null;
  }
}

export function saveRememberedCustomer(slug: string, customer: RememberedCustomer): void {
  try {
    window.localStorage.setItem(keyFor(slug), JSON.stringify({ firstName: customer.firstName, lastName: customer.lastName, phone: customer.phone, email: customer.email }));
  } catch {
    /* sin almacenamiento disponible: no se recuerda */
  }
}

export function forgetRememberedCustomer(slug: string): void {
  try {
    window.localStorage.removeItem(keyFor(slug));
  } catch {
    /* nada que borrar */
  }
}
