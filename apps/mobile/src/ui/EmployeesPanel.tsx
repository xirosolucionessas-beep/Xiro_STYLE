import { useQueryClient } from '@tanstack/react-query';
import { EMPLOYEE_PERMISSIONS, normalizePermissions, type Employee, type EmployeePermission } from '@xiro/shared';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { ACTION_LABELS, isRequiredByAnother, quotaView, togglePermission, validateEmployeeForm, type EmployeeFormErrors } from '@/lib/employeesLogic';
import { apiErrors } from '@/lib/forms';
import { pickFromLibrary, uploadableImage } from '@/lib/images';
import { keys, useAuditLogs, useEmployeeQuota, useEmployees } from '@/lib/queries';
import { useSettings } from '@/lib/settings';
import { Button } from './Button';
import { CheckRow } from './CheckRow';
import { useDialogs } from './Dialogs';
import { Field } from './Field';
import { Card, Chip, ChipRow, EmptyState, Photo } from './Kit';
import { Header, Screen } from './Screen';
import { AppText } from './Text';
import { radius } from './theme';

type Tab = 'team' | 'activity';

/**
 * Gestión de empleados en nativo (solo dueño): mismas pantallas, reglas y endpoints que la Web (Fase 4). Sin borrado:
 * se desactiva, para conservar la bitácora de quién hizo qué. Los permisos de un empleado los impone el servidor.
 */
export function EmployeesPanel() {
  const { t } = useSettings();
  const queryClient = useQueryClient();
  const employees = useEmployees();
  const logs = useAuditLogs();
  const quotaQuery = useEmployeeQuota();
  const quota = quotaQuery.data ? quotaView(t, quotaQuery.data) : null;
  const [tab, setTab] = useState<Tab>('team');
  const [form, setForm] = useState<{ employee?: Employee } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: keys.employees }), queryClient.invalidateQueries({ queryKey: keys.auditLogs })]);

  async function toggleActive(employee: Employee) {
    setBusyId(employee.id);
    setError(undefined);
    try {
      await api.updateEmployee(employee.id, { active: !employee.active });
      await refresh();
    } catch (e) {
      const result = apiErrors(e, t);
      setError(result.general ?? Object.values(result.fields)[0]);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Screen header={<Header title={t('team')} subtitle={t('emp_subtitle')} />} refreshing={employees.isRefetching} onRefresh={() => void refresh()}>
      <ChipRow label={t('team')}>
        <Chip label={t('emp_tab_team')} selected={tab === 'team'} onPress={() => setTab('team')} />
        <Chip label={t('emp_tab_activity')} selected={tab === 'activity'} onPress={() => setTab('activity')} />
      </ChipRow>

      {tab === 'team' ? (
        <View style={styles.list}>
          {quota ? (
            <Card>
              <AppText variant="bodyStrong" accessibilityRole="header">
                {quota.title}
              </AppText>
              <AppText variant="small" tone={quota.full ? 'danger' : 'muted'}>
                {quota.detail}
              </AppText>
            </Card>
          ) : null}
          <Button label={t('emp_new_cta')} icon="add" onPress={() => setForm({})} disabled={quota?.full ?? false} />
          {error ? (
            <AppText tone="danger" accessibilityLiveRegion="polite">
              {error}
            </AppText>
          ) : null}
          {employees.isLoading ? <ActivityIndicator style={{ marginTop: 24 }} accessibilityLabel={t('loading')} /> : null}
          {employees.isError ? <Button label={t('retry')} variant="secondary" onPress={() => void employees.refetch()} /> : null}
          {employees.data && employees.data.length === 0 ? <EmptyState icon="people-outline" message={t('emp_empty')} /> : null}
          {employees.data?.map((employee) => (
            <Card key={employee.id} style={employee.active ? undefined : { opacity: 0.7 }}>
              <View style={styles.top}>
                <Photo url={employee.photoUrl} size={36} style={{ borderRadius: 18 }} initials={employee.name} icon="person-outline" />
                <AppText variant="bodyStrong" style={{ flex: 1 }}>
                  {employee.name}
                </AppText>
                <AppText tone={employee.active ? 'gold' : 'muted'} variant="small">
                  {employee.active ? t('emp_active') : t('emp_inactive')}
                </AppText>
              </View>
              <AppText tone="muted" variant="small" style={{ marginTop: 2 }}>
                {employee.email ?? employee.phone}
              </AppText>
              <AppText variant="small" style={{ marginTop: 8 }}>
                {employee.permissions.length === 0 ? t('emp_no_permissions') : employee.permissions.map((p) => t(`perm_${p}`)).join(' · ')}
              </AppText>
              <View style={styles.actions}>
                <Button label={t('edit')} variant="secondary" compact onPress={() => setForm({ employee })} />
                <Button label={employee.active ? t('emp_deactivate') : t('emp_reactivate')} variant="ghost" compact loading={busyId === employee.id} disabled={!employee.active && (quota?.full ?? false)} onPress={() => void toggleActive(employee)} />
              </View>
            </Card>
          ))}
        </View>
      ) : (
        <View style={styles.list}>
          {logs.isLoading ? <ActivityIndicator style={{ marginTop: 24 }} accessibilityLabel={t('loading')} /> : null}
          {logs.data && logs.data.length === 0 ? <EmptyState icon="time-outline" message={t('emp_activity_empty')} /> : null}
          {logs.data?.map((log) => {
            const labelKey = ACTION_LABELS[log.action];
            return (
              <Card key={log.id}>
                <AppText variant="small">
                  <AppText variant="bodyStrong">{log.userName}</AppText> · {labelKey ? t(labelKey) : log.action}
                  {log.status === 403 ? ` · ${t('emp_denied')}` : ''}
                </AppText>
                <AppText tone="muted" variant="small" style={{ marginTop: 2 }}>
                  {new Date(log.createdAt).toLocaleString()}
                </AppText>
              </Card>
            );
          })}
        </View>
      )}

      {form ? (
        <EmployeeForm
          employee={form.employee}
          onClose={() => setForm(null)}
          onSaved={async () => {
            setForm(null);
            await refresh();
          }}
        />
      ) : null}
    </Screen>
  );
}

function EmployeeForm({ employee, onClose, onSaved }: { employee?: Employee; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t, colors } = useSettings();
  const { confirm } = useDialogs();
  const editing = Boolean(employee);
  const [values, setValues] = useState({ name: employee?.name ?? '', email: '', phone: '', password: '' });
  const [permissions, setPermissions] = useState<EmployeePermission[]>(employee?.permissions ?? []);
  const [errors, setErrors] = useState<EmployeeFormErrors>({});
  const [general, setGeneral] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(employee?.photoUrl ?? null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string>();
  const set = (key: keyof typeof values) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key === 'email' || key === 'phone' ? 'contact' : key]: undefined }));
  };
  const effective = normalizePermissions(permissions);

  async function changePhoto() {
    if (!employee) return;
    const [picked] = await pickFromLibrary(1);
    if (!picked) return;
    setPhotoBusy(true);
    setPhotoError(undefined);
    try {
      setPhotoUrl((await api.uploadEmployeePhoto(employee.id, await uploadableImage(picked))).photoUrl);
    } catch (e) {
      setPhotoError(apiErrors(e, t).general ?? t('unknown_error'));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    if (!employee) return;
    if (!(await confirm({ title: t('emp_photo_remove_title'), message: t('emp_photo_remove_text'), confirmLabel: t('delete'), destructive: true }))) return;
    setPhotoBusy(true);
    setPhotoError(undefined);
    try {
      setPhotoUrl((await api.deleteEmployeePhoto(employee.id)).photoUrl);
    } catch (e) {
      setPhotoError(apiErrors(e, t).general ?? t('unknown_error'));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function submit() {
    setGeneral(undefined);
    const found = validateEmployeeForm(values, editing);
    setErrors(Object.fromEntries(Object.entries(found).map(([field, key]) => [field, t(key)])));
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      if (employee) await api.updateEmployee(employee.id, { name: values.name.trim(), permissions: effective, ...(values.password ? { password: values.password } : {}) });
      else await api.createEmployee({ name: values.name.trim(), email: values.email.trim() || undefined, phone: values.phone.trim() || undefined, password: values.password, permissions: effective });
      await onSaved();
    } catch (e) {
      const result = apiErrors(e, t);
      setGeneral(result.general ?? Object.values(result.fields)[0]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.modal, { backgroundColor: colors.background }]}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
            <AppText variant="title" style={{ marginBottom: 16 }}>
              {employee ? t('emp_edit_title', { name: employee.name }) : t('emp_new_title')}
            </AppText>
            {employee ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 }}>
                <Photo url={photoUrl} size={72} initials={employee.name} icon="person-outline" />
                <View style={{ flex: 1, gap: 6 }}>
                  <AppText variant="small" tone="muted">
                    {t('emp_photo_hint')}
                  </AppText>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <Button label={t(photoUrl ? 'account_photo_change' : 'account_photo_add')} icon="image-outline" variant="secondary" compact loading={photoBusy} onPress={() => void changePhoto()} style={{ alignSelf: 'flex-start' }} />
                    {photoUrl ? <Button label={t('delete')} icon="trash-outline" variant="ghost" compact loading={photoBusy} onPress={() => void removePhoto()} style={{ alignSelf: 'flex-start' }} /> : null}
                  </View>
                  {photoError ? (
                    <AppText tone="danger" variant="small">
                      {photoError}
                    </AppText>
                  ) : null}
                </View>
              </View>
            ) : null}
            <Field label={t('emp_name_label')} value={values.name} onChangeText={set('name')} error={errors.name} maxLength={80} />
            {editing ? null : (
              <>
                <Field label={t('emp_email_label')} value={values.email} onChangeText={set('email')} error={errors.contact} autoCapitalize="none" keyboardType="email-address" />
                <Field label={t('emp_phone_label')} value={values.phone} onChangeText={set('phone')} keyboardType="phone-pad" hint={t('emp_contact_hint')} />
              </>
            )}
            <Field
              label={editing ? t('emp_new_password_label') : t('emp_password_label')}
              value={values.password}
              onChangeText={set('password')}
              error={errors.password}
              hint={editing ? t('emp_new_password_hint') : t('emp_password_hint')}
              password
              textContentType="newPassword"
            />
            <AppText variant="label" tone="gold" style={{ marginTop: 4 }}>
              {t('emp_permissions_label')}
            </AppText>
            <AppText tone="muted" variant="small" style={{ marginBottom: 6 }}>
              {t('emp_permissions_hint')}
            </AppText>
            {EMPLOYEE_PERMISSIONS.map((permission) => {
              const required = isRequiredByAnother(permissions, permission);
              return <CheckRow key={permission} label={t(`perm_${permission}`)} hint={required ? t('emp_permission_required') : t(`perm_${permission}_hint`)} checked={effective.includes(permission)} onChange={(next) => setPermissions(togglePermission(permissions, permission, next))} />;
            })}
            {general ? (
              <AppText tone="danger" style={{ marginTop: 10 }} accessibilityLiveRegion="polite">
                {general}
              </AppText>
            ) : null}
            <View style={{ height: 16 }} />
            <Button label={employee ? t('save_changes') : t('emp_create_cta')} onPress={() => void submit()} loading={busy} />
            <Button label={t('cancel')} variant="ghost" onPress={onClose} disabled={busy} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, marginTop: 14 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  modal: { flex: 1 },
  formContent: { padding: 20, paddingBottom: 40, borderRadius: radius.lg },
});
