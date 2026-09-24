import { Redirect } from 'expo-router';

/**
 * Fallback nativo de /employees (exigido por Expo Router: todo "*.web.tsx" necesita un hermano sin extensión de
 * plataforma). La gestión de empleados aún es solo Web; en nativo la fila "Equipo" de Ajustes sigue como "Próximamente".
 * Nunca se navega aquí desde la UI nativa.
 */
export default function EmployeesFallback() {
  return <Redirect href="/more" />;
}
