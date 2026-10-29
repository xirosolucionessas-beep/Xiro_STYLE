import { normalizePermissions, passwordSchema, type EmployeePermission, type EmployeeQuotaDto } from '@xiro/shared';

/** Acción de la bitácora → clave de texto legible. Lo que no esté aquí se muestra tal cual (la ruta), nunca se oculta. */
export const ACTION_LABELS: Record<string, string> = {
  'POST /clients': 'audit_client_create',
  'PUT /clients/:id': 'audit_client_update',
  'DELETE /clients/:id': 'audit_client_delete',
  'POST /items': 'audit_item_create',
  'PUT /items/:id': 'audit_item_update',
  'DELETE /items/:id': 'audit_item_delete',
  'POST /items/:id/stock-adjustments': 'audit_stock_adjust',
  'POST /categories': 'audit_category_change',
  'PATCH /categories/:id': 'audit_category_change',
  'DELETE /categories/:id': 'audit_category_change',
  'POST /service-records': 'audit_service_record',
  'POST /loyalty/clients/:clientId/redeem': 'audit_loyalty_redeem',
  'POST /employees': 'audit_employee_create',
  'PATCH /employees/:id': 'audit_employee_update',
};

/** ¿Otro permiso marcado exige este (gestionar ⇒ ver)? Entonces se muestra marcado y no se puede quitar. */
export const isRequiredByAnother = (selected: readonly EmployeePermission[], permission: EmployeePermission): boolean =>
  normalizePermissions(normalizePermissions(selected).filter((p) => p !== permission)).includes(permission);

/** Marca o desmarca un permiso. Lo implícito no se puede quitar mientras otro lo necesite. */
export function togglePermission(selected: readonly EmployeePermission[], permission: EmployeePermission, checked: boolean): EmployeePermission[] {
  if (checked) return normalizePermissions([...selected, permission]);
  if (isRequiredByAnother(selected, permission)) return normalizePermissions(selected);
  return normalizePermissions(normalizePermissions(selected).filter((p) => p !== permission));
}

export interface EmployeeFormValues {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export type EmployeeFormErrors = Partial<Record<'name' | 'contact' | 'password', string>>;

/**
 * Validación del formulario de empleado (valores = claves de traducción). Al crear se exige un correo o celular y una
 * contraseña fuerte; al editar solo el nombre, y la contraseña únicamente si se escribe una nueva.
 */
export function validateEmployeeForm(values: EmployeeFormValues, editing: boolean): EmployeeFormErrors {
  const errors: EmployeeFormErrors = {};
  if (!values.name.trim()) errors.name = 'required';
  if (!editing && !values.email.trim() && !values.phone.trim()) errors.contact = 'contact_required';
  if ((!editing || values.password) && !passwordSchema.safeParse(values.password).success) errors.password = 'password_weak';
  return errors;
}

/**
 * Cupos de empleados activos para la pantalla de Equipo ("3 de 5 empleados activos"). El conteo lo da el servidor, que es
 * quien aplica el límite; esto solo lo explica y deshabilita los botones de agregar/reactivar cuando no hay cupo.
 */
export function quotaView(t: (key: string, params?: Record<string, string | number>) => string, quota: EmployeeQuotaDto): { title: string; detail: string; full: boolean } {
  const title = t('employees_quota', { active: quota.active, limit: quota.limit });
  const detail = quota.overLimit
    ? t('employees_quota_over', { limit: quota.limit })
    : quota.remaining === 0
      ? t('employees_quota_full')
      : quota.remaining === 1
        ? t('employees_quota_left_one')
        : t('employees_quota_left', { n: quota.remaining });
  return { title, detail: `${detail} ${t('employees_quota_owner_note')}`, full: quota.remaining === 0 };
}
