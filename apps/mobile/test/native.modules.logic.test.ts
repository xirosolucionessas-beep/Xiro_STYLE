import { normalizePermissions, translate } from '@xiro/shared';
import { describe, expect, it } from 'vitest';
import { ACTION_LABELS, isRequiredByAnother, togglePermission, validateEmployeeForm } from '../src/lib/employeesLogic';
import { progressPercent } from '../src/lib/loyaltyLogic';

describe('permisos de empleado (nativo)', () => {
  it('marcar un permiso mayor agrega lo que necesita, y eso no se puede quitar mientras haga falta', () => {
    const selected = togglePermission([], 'services_record', true);
    expect(selected).toEqual(['clients_view', 'catalog_view', 'services_record']);
    expect(isRequiredByAnother(selected, 'clients_view')).toBe(true);
    expect(togglePermission(selected, 'clients_view', false)).toEqual(selected); // sigue marcado
  });

  it('desmarcar el permiso mayor libera lo implícito para poder quitarlo después', () => {
    const withoutRecord = togglePermission(['clients_view', 'catalog_view', 'services_record'], 'services_record', false);
    expect(withoutRecord).toEqual(['clients_view', 'catalog_view']);
    expect(togglePermission(withoutRecord, 'clients_view', false)).toEqual(['catalog_view']);
  });

  it('el resultado siempre está normalizado (mismo orden que entrega el servidor)', () => {
    const result = togglePermission(['catalog_manage'], 'clients_manage', true);
    expect(result).toEqual(normalizePermissions(result));
  });
});

describe('validación del formulario de empleado', () => {
  const base = { name: 'Ana', email: 'ana@correo.com', phone: '', password: 'Secreta123' };
  it('crear: pide nombre, correo o celular y contraseña fuerte', () => {
    expect(validateEmployeeForm(base, false)).toEqual({});
    expect(validateEmployeeForm({ ...base, name: '  ' }, false)).toEqual({ name: 'required' });
    expect(validateEmployeeForm({ ...base, email: '', phone: '' }, false)).toEqual({ contact: 'contact_required' });
    expect(validateEmployeeForm({ ...base, phone: '3001234567', email: '' }, false)).toEqual({});
    expect(validateEmployeeForm({ ...base, password: 'debil' }, false)).toEqual({ password: 'password_weak' });
  });

  it('editar: solo el nombre; la contraseña únicamente si se escribe una nueva', () => {
    expect(validateEmployeeForm({ name: 'Ana', email: '', phone: '', password: '' }, true)).toEqual({});
    expect(validateEmployeeForm({ name: 'Ana', email: '', phone: '', password: 'debil' }, true)).toEqual({ password: 'password_weak' });
    expect(validateEmployeeForm({ name: '', email: '', phone: '', password: '' }, true)).toEqual({ name: 'required' });
  });

  it('todas las acciones conocidas de la bitácora tienen texto en español e inglés', () => {
    for (const key of new Set(Object.values(ACTION_LABELS))) {
      expect(translate('es', key), key).not.toBe(key);
      expect(translate('en', key), key).not.toBe(key);
    }
  });
});

describe('progressPercent (fidelización)', () => {
  it.each([
    [0, 5, 0],
    [1, 5, 20],
    [3, 5, 60],
    [5, 5, 100],
    [9, 5, 100], // con más sellos que la meta la barra no se desborda
    [3, 0, 0], // meta inválida: sin división por cero
    [-1, 5, 0],
  ])('%i de %i → %i%%', (count, goal, expected) => {
    expect(progressPercent(count, goal)).toBe(expected);
  });
});

describe('textos compartidos con nativo', () => {
  it('los textos de Empleados y Fidelización existen en el diccionario compartido (es/en)', () => {
    for (const key of ['emp_subtitle', 'emp_count_one', 'perm_clients_view', 'perm_loyalty_redeem_hint', 'loyalty_title', 'loyalty_status_on', 'loyalty_whatsapp_message', 'loyalty_history_row']) {
      expect(translate('es', key), key).not.toBe(key);
      expect(translate('en', key), key).not.toBe(key);
    }
    expect(translate('es', 'emp_count_other', { n: 3 })).toBe('3 empleados');
  });
});
