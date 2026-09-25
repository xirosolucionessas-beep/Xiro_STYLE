/**
 * Ruta /employees SOLO WEB (fallback nativo: employees.tsx). Gestión del equipo: alta, permisos, desactivar y
 * bitácora de actividad. Solo el dueño (lo impone el servidor y el guardián de rutas de (app)/_layout.tsx).
 * Presentación en src/web/screens/Employees.tsx.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { Header, Screen } from '@/ui/Screen';
import { EmployeesView } from '@/web/screens/Employees';
import { useWebText } from '@/web/services/useWebText';

const keys = { employees: ['employees'] as const, auditLogs: ['auditLogs'] as const };

export default function EmployeesWeb() {
  const { t } = useWebText();
  const queryClient = useQueryClient();
  const employees = useQuery({ queryKey: keys.employees, queryFn: api.employees });
  const logs = useQuery({ queryKey: keys.auditLogs, queryFn: () => api.auditLogs() });

  if (!employees.data) return null;
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: keys.employees }), queryClient.invalidateQueries({ queryKey: keys.auditLogs })]);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await refresh();
      return { ok: true as const };
    } catch (error) {
      const result = apiErrors(error, t);
      return { ok: false as const, error: result.general ?? Object.values(result.fields)[0] ?? t('unknown_error') };
    }
  }

  return (
    <Screen header={<Header root title={t('nav_employees')} subtitle={t('emp_subtitle')} />}>
      <EmployeesView t={t} employees={employees.data} logs={logs.data ?? []} onCreate={(input) => run(() => api.createEmployee(input))} onUpdate={(id, input) => run(() => api.updateEmployee(id, input))} />
    </Screen>
  );
}
