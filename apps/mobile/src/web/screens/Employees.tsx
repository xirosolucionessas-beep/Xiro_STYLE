import { EMPLOYEE_PERMISSIONS, normalizePermissions, passwordSchema, type AuditLogEntry, type Employee, type EmployeePermission } from '@xiro/shared';
import { useRef, useState } from 'react';
import { ACTION_LABELS } from '../../lib/employeesLogic';
import { Ico } from '../icons';
import { Button, Input } from '../ui';
import { Checkbox, FormMessage } from '../ui/auth';
import { Modal } from '../ui/Modal';
import { Avatar, KpiRow, type KpiView } from '../ui/Page';
import { useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;
type ActionResult = { ok: true } | { ok: false; error: string };
type PhotoResult = { ok: true; photoUrl: string | null } | { ok: false; error: string };

export interface EmployeesViewProps {
  t: T;
  employees: Employee[];
  logs: AuditLogEntry[];
  onCreate: (input: { name: string; email?: string; phone?: string; password: string; permissions: EmployeePermission[] }) => Promise<ActionResult>;
  onUpdate: (id: string, input: { name?: string; permissions?: EmployeePermission[]; active?: boolean; password?: string }) => Promise<ActionResult>;
  onUploadPhoto: (id: string, file: File) => Promise<PhotoResult>;
  onRemovePhoto: (id: string) => Promise<PhotoResult>;
}

type Tab = 'team' | 'activity';

function TabButton({ id, active, label, onSelect }: { id: Tab; active: boolean; label: string; onSelect: (id: Tab) => void }) {
  return (
    <button type="button" role="tab" id={`xw-emp-tab-${id}`} aria-selected={active} aria-controls={`xw-emp-panel-${id}`} tabIndex={active ? 0 : -1} className={`xw-emp-tab${active ? ' is-active' : ''}`} onClick={() => onSelect(id)}>
      {label}
    </button>
  );
}

/** Casillas de permisos. Lo implícito (gestionar ⇒ ver) se marca solo y no se puede quitar mientras otro permiso lo necesite. */
function PermissionPicker({ t, value, onChange }: { t: T; value: EmployeePermission[]; onChange: (next: EmployeePermission[]) => void }) {
  const effective = normalizePermissions(value);
  return (
    <fieldset className="xw-emp-perms">
      <legend className="xw-label">{t('emp_permissions_label')}</legend>
      <p className="xw-hint">{t('emp_permissions_hint')}</p>
      {EMPLOYEE_PERMISSIONS.map((permission) => {
        const required = normalizePermissions(effective.filter((p) => p !== permission)).includes(permission);
        return (
          <div key={permission} className="xw-emp-perm">
            <Checkbox
              checked={effective.includes(permission)}
              onChange={(checked) => onChange(checked ? [...value, permission] : value.filter((p) => p !== permission))}>
              {t(`perm_${permission}`)}
            </Checkbox>
            {required ? <span className="xw-hint">{t('emp_permission_required')}</span> : <span className="xw-hint">{t(`perm_${permission}_hint`)}</span>}
          </div>
        );
      })}
    </fieldset>
  );
}

interface FormState {
  name: string;
  email: string;
  phone: string;
  password: string;
  permissions: EmployeePermission[];
}

/** Alta y edición comparten formulario; al editar la contraseña es opcional y no hay correo/celular (son el acceso de la persona). */
function EmployeeModal({
  t,
  employee,
  onClose,
  onSubmit,
  onUploadPhoto,
  onRemovePhoto,
}: {
  t: T;
  employee?: Employee;
  onClose: () => void;
  onSubmit: (state: FormState) => Promise<ActionResult>;
  onUploadPhoto: (id: string, file: File) => Promise<PhotoResult>;
  onRemovePhoto: (id: string) => Promise<PhotoResult>;
}) {
  const [state, setState] = useState<FormState>({ name: employee?.name ?? '', email: '', phone: '', password: '', permissions: employee?.permissions ?? [] });
  const [errors, setErrors] = useState<Partial<Record<'name' | 'contact' | 'password', string>>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(employee?.photoUrl ?? null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string>();
  const photoInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState((current) => ({ ...current, [key]: value }));

  async function pickPhoto(file: File | undefined) {
    if (!file || !employee) return;
    setPhotoBusy(true);
    setPhotoError(undefined);
    const result = await onUploadPhoto(employee.id, file);
    if (result.ok) setPhotoUrl(result.photoUrl);
    else setPhotoError(result.error);
    setPhotoBusy(false);
  }

  async function removePhoto() {
    if (!employee || !window.confirm(t('emp_photo_remove_text'))) return;
    setPhotoBusy(true);
    setPhotoError(undefined);
    const result = await onRemovePhoto(employee.id);
    if (result.ok) setPhotoUrl(result.photoUrl);
    else setPhotoError(result.error);
    setPhotoBusy(false);
  }

  async function submit() {
    const next: typeof errors = {};
    if (!state.name.trim()) next.name = t('required');
    if (!employee && !state.email.trim() && !state.phone.trim()) next.contact = t('contact_required');
    if ((!employee || state.password) && !passwordSchema.safeParse(state.password).success) next.password = t('password_weak');
    setErrors(next);
    setError(undefined);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      const result = await onSubmit(state);
      if (!result.ok) setError(result.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={employee ? t('emp_edit_title', { name: employee.name }) : t('emp_new_title')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="ghost" onPress={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button onPress={() => void submit()} loading={busy} loadingLabel={t('loading')}>
            {employee ? t('save_changes') : t('emp_create_cta')}
          </Button>
        </>
      }>
      <div className="xw-form">
        {employee ? (
          <div className="xw-profile-avatar-row">
            <div className="xw-avatar-edit">
              <Avatar name={employee.name} photoUrl={photoUrl} size={84} />
              <button type="button" className="xw-home-cam" aria-label={t(photoUrl ? 'account_photo_change' : 'account_photo_add')} disabled={photoBusy} onClick={() => photoInput.current?.click()}>
                {photoBusy ? <span className="xw-spinner" aria-hidden="true" /> : <Ico name="camera" size={14} />}
              </button>
            </div>
            <input
              ref={photoInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="xw-sr"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                void pickPhoto(file);
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="xw-hint">{t('emp_photo_hint')}</p>
              {photoUrl ? (
                <button type="button" className="xw-link-btn" disabled={photoBusy} onClick={() => void removePhoto()}>
                  {t('delete')}
                </button>
              ) : null}
              {photoError ? <FormMessage>{photoError}</FormMessage> : null}
            </div>
          </div>
        ) : null}
        <Input label={t('emp_name_label')} value={state.name} onChange={(v) => set('name', v)} name="name" error={errors.name} required />
        {employee ? null : (
          <>
            <Input label={t('emp_email_label')} value={state.email} onChange={(v) => set('email', v)} type="email" name="email" error={errors.contact} />
            <Input label={t('emp_phone_label')} value={state.phone} onChange={(v) => set('phone', v)} type="tel" name="phone" hint={t('emp_contact_hint')} />
          </>
        )}
        <Input
          label={employee ? t('emp_new_password_label') : t('emp_password_label')}
          value={state.password}
          onChange={(v) => set('password', v)}
          type="password"
          name="password"
          error={errors.password}
          hint={employee ? t('emp_new_password_hint') : t('emp_password_hint')}
          required={!employee}
        />
        <PermissionPicker t={t} value={state.permissions} onChange={(next) => set('permissions', next)} />
        {error ? <FormMessage>{error}</FormMessage> : null}
      </div>
    </Modal>
  );
}

function TeamTab({ t, employees, onCreate, onUpdate, onUploadPhoto, onRemovePhoto }: Pick<EmployeesViewProps, 't' | 'employees' | 'onCreate' | 'onUpdate' | 'onUploadPhoto' | 'onRemovePhoto'>) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  async function toggleActive(employee: Employee) {
    setBusyId(employee.id);
    setError(undefined);
    const result = await onUpdate(employee.id, { active: !employee.active });
    if (!result.ok) setError(result.error);
    setBusyId(null);
  }

  return (
    <div className="xw-emp-team">
      <Button onPress={() => setCreating(true)} icon={<Ico name="plus" size={18} />}>
        {t('emp_new_cta')}
      </Button>
      {error ? <FormMessage>{error}</FormMessage> : null}
      {employees.length === 0 ? (
        <p className="xw-hint">{t('emp_empty')}</p>
      ) : (
        <ul className="xw-emp-list">
          {employees.map((employee) => (
            <li key={employee.id} className={`xw-emp-card${employee.active ? '' : ' is-inactive'}`}>
              <div className="xw-emp-top">
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--xw-space-2)', minWidth: 0 }}>
                  <Avatar name={employee.name} photoUrl={employee.photoUrl} size={36} />
                  <span className="xw-emp-name">{employee.name}</span>
                </span>
                <span className={`xw-emp-status${employee.active ? ' is-on' : ''}`}>{employee.active ? t('emp_active') : t('emp_inactive')}</span>
              </div>
              <p className="xw-emp-contact">{employee.email ?? employee.phone}</p>
              <ul className="xw-emp-chips" aria-label={t('emp_permissions_label')}>
                {employee.permissions.length === 0 ? <li className="xw-emp-chip is-empty">{t('emp_no_permissions')}</li> : employee.permissions.map((p) => <li key={p} className="xw-emp-chip">{t(`perm_${p}`)}</li>)}
              </ul>
              <div className="xw-emp-actions">
                <Button size="sm" variant="secondary" onPress={() => setEditing(employee)}>
                  {t('edit')}
                </Button>
                <Button size="sm" variant="ghost" onPress={() => void toggleActive(employee)} loading={busyId === employee.id} loadingLabel={t('loading')}>
                  {employee.active ? t('emp_deactivate') : t('emp_reactivate')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {creating ? (
        <EmployeeModal
          t={t}
          onClose={() => setCreating(false)}
          onSubmit={async (s) => {
            const result = await onCreate({ name: s.name.trim(), email: s.email.trim() || undefined, phone: s.phone.trim() || undefined, password: s.password, permissions: normalizePermissions(s.permissions) });
            if (result.ok) setCreating(false);
            return result;
          }}
          onUploadPhoto={onUploadPhoto}
          onRemovePhoto={onRemovePhoto}
        />
      ) : null}
      {editing ? (
        <EmployeeModal
          t={t}
          employee={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (s) => {
            const result = await onUpdate(editing.id, { name: s.name.trim(), permissions: normalizePermissions(s.permissions), ...(s.password ? { password: s.password } : {}) });
            if (result.ok) setEditing(null);
            return result;
          }}
          onUploadPhoto={onUploadPhoto}
          onRemovePhoto={onRemovePhoto}
        />
      ) : null}
    </div>
  );
}

function ActivityTab({ t, logs }: Pick<EmployeesViewProps, 't' | 'logs'>) {
  if (logs.length === 0) return <p className="xw-hint">{t('emp_activity_empty')}</p>;
  return (
    <ul className="xw-emp-log">
      {logs.map((log) => {
        const labelKey = ACTION_LABELS[log.action];
        const denied = log.status === 403;
        return (
          <li key={log.id} className={`xw-emp-log-row${denied ? ' is-denied' : ''}`}>
            <span className="xw-emp-log-text">
              <strong>{log.userName}</strong> · {labelKey ? t(labelKey) : log.action}
              {denied ? <span className="xw-emp-denied"> · {t('emp_denied')}</span> : null}
            </span>
            <span className="xw-emp-log-date">{new Date(log.createdAt).toLocaleString()}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function EmployeesView({ t, employees, logs, onCreate, onUpdate, onUploadPhoto, onRemovePhoto }: EmployeesViewProps) {
  useWebStyles();
  const [tab, setTab] = useState<Tab>('team');
  const activeCount = employees.filter((employee) => employee.active).length;
  const kpis: KpiView[] = [
    { id: 'total', icon: 'briefcase', label: t('sec_emp_kpi_total'), value: String(employees.length) },
    { id: 'active', icon: 'shield-check', label: t('sec_emp_kpi_active'), value: String(activeCount), tone: 'success' },
    { id: 'inactive', icon: 'x', label: t('sec_emp_kpi_inactive'), value: String(employees.length - activeCount) },
  ];
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'team', label: t('emp_tab_team') },
    { id: 'activity', label: t('emp_tab_activity') },
  ];

  return (
    <div className="xw-section">
      <KpiRow kpis={kpis} label={t('dash_kpis')} t={t} />

      <div className="xw-panel">
      <div role="tablist" aria-label={t('nav_employees')} className="xw-emp-tabs">
        {tabs.map((tb) => (
          <TabButton key={tb.id} id={tb.id} active={tab === tb.id} label={tb.label} onSelect={setTab} />
        ))}
      </div>
      <div role="tabpanel" id="xw-emp-panel-team" aria-labelledby="xw-emp-tab-team" hidden={tab !== 'team'}>
        {tab === 'team' ? <TeamTab t={t} employees={employees} onCreate={onCreate} onUpdate={onUpdate} onUploadPhoto={onUploadPhoto} onRemovePhoto={onRemovePhoto} /> : null}
      </div>
      <div role="tabpanel" id="xw-emp-panel-activity" aria-labelledby="xw-emp-tab-activity" hidden={tab !== 'activity'}>
        {tab === 'activity' ? <ActivityTab t={t} logs={logs} /> : null}
      </div>
      </div>
    </div>
  );
}
