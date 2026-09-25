import { EmployeesPanel } from '@/ui/EmployeesPanel';

/**
 * Gestión de empleados en Android/iOS. En la Web esta ruta la sirve employees.web.tsx (su propio diseño): este archivo
 * es la versión nativa y, a la vez, el hermano sin extensión de plataforma que exige Expo Router.
 * Solo el dueño: el guardián de rutas de (app)/_layout.tsx y el servidor lo imponen.
 */
export default function Employees() {
  return <EmployeesPanel />;
}
