import { formatMoney, type Currency } from '@xiro/shared';

/** "$35.000": el precio pegado al símbolo (Intl deja un espacio duro entre el símbolo y la cifra; `\s` también lo cubre). */
export const money = (amount: number, currency: Currency | string): string => formatMoney(amount, currency as Currency).replace(/^([^\d-]+)\s+/, '$1');

/** Primera letra en mayúscula para el círculo de un logo o una foto que no existe. */
export const initials = (name: string): string => name.trim().charAt(0).toUpperCase() || '?';
