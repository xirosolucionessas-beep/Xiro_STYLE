import { defaultBusinessHours, type BusinessType, type Language } from '@xiro/shared';
import { businesses, categories, users } from './db/schema';
import type { Database, DbExecutor } from './db/client';
import { isUniqueViolation } from './db/errors';
import { AppError } from './errors';
import type { UserRow } from './serializers';
import { randomToken, slugify } from './security';

const SLUG_ATTEMPTS = 6;

const DEFAULT_CATEGORIES: Record<Language, string[]> = {
  es: ['Servicios', 'Productos', 'Tratamientos'],
  en: ['Services', 'Products', 'Treatments'],
};

const slugCandidate = (base: string, attempt: number) => (attempt === 0 ? base : `${base}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`);

export interface NewBusinessAccount {
  businessName: string;
  businessType: BusinessType;
  ownerName: string;
  email: string | null;
  phone: string | null;
  passwordHash: string;
  language: Language;
}

/**
 * Crea un negocio con su dueño y las categorías iniciales, en UNA transacción (nunca queda un negocio sin dueño). Lo usan
 * el registro público y el alta desde el panel de plataforma. La unicidad de correo, teléfono y slug la garantizan los
 * índices únicos (sin "consultar y luego insertar"); si el slug choca, se reintenta con sufijo.
 *
 * `run` abre la transacción: así quien llama puede agregar más escrituras en la MISMA (p. ej. concesión y bitácora).
 */
export async function createBusinessWithOwner<T>(
  db: Database,
  input: NewBusinessAccount,
  extra?: (tx: DbExecutor, created: { owner: UserRow; businessId: string }) => Promise<T>,
): Promise<{ owner: UserRow; extra: T | undefined }> {
  const base = slugify(input.businessName);
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        const [business] = await tx
          .insert(businesses)
          .values({ name: input.businessName, slug: slugCandidate(base, attempt), type: input.businessType, whatsapp: input.phone, hours: defaultBusinessHours() })
          .returning();
        const [owner] = await tx
          .insert(users)
          .values({ businessId: business!.id, name: input.ownerName, email: input.email, phone: input.phone, passwordHash: input.passwordHash, language: input.language })
          .returning();
        await tx.insert(categories).values(DEFAULT_CATEGORIES[input.language].map((name) => ({ businessId: business!.id, name })));
        const result = extra ? await extra(tx, { owner: owner!, businessId: business!.id }) : undefined;
        return { owner: owner!, extra: result };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'users_email_uq') || isUniqueViolation(error, 'users_phone_uq')) throw new AppError(409, 'account_exists');
      if (isUniqueViolation(error, 'businesses_slug_uq')) continue; // otro registro tomó ese slug a la vez
      throw error;
    }
  }
  throw new AppError(503, 'service_unavailable');
}
