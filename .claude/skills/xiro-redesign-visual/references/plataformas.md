# Dónde se cambia lo visual

## Proyecto confirmado: `mobile/` (Expo, React Native, TypeScript)
Un solo código para web, Android e iOS. Carpetas vistas y qué hacer con cada una:

| Carpeta / archivo | Qué es | Rediseño |
|---|---|---|
| `src/` | Código de la app (pantallas, componentes, tema, navegación) | **Aquí se trabaja.** Recórrela primero |
| `public/` | Recursos de la web (favicon, `index.html`, imágenes) | Se puede cambiar lo visual: favicon, título, meta theme-color, fuentes |
| `assets/` (`assets/images`) | Íconos, splash, imágenes de la app | Se pueden reemplazar o agregar; conserva los nombres referenciados |
| `app.json` | Configuración de Expo | Solo apariencia: `splash`, `icon`, `adaptiveIcon`, `backgroundColor`, `userInterfaceStyle`, `statusBar`. No tocar `name`, `slug`, `package`, `bundleIdentifier`, permisos, plugins |
| `android/` | Proyecto nativo generado (prebuild) | No se edita para el rediseño; el tema se resuelve desde `src/` |
| `dist/` | Salida generada de la web | No se edita; se regenera con `npx expo export --platform web` |
| `test/` | Pruebas | No se modifican; deben seguir pasando |
| `eas.json`, `metro.config.js`, `tsconfig*.json`, `eslint.config.mjs`, `.env*` | Compilación y entorno | No se tocan |
| `package.json` | Dependencias | Solo fuentes e íconos, avisando |

No hay carpeta `ios/`: iOS se compila con EAS desde el mismo código. Todo lo visual debe
vivir en `src/` para que se vea igual en las tres plataformas.

## Cómo rediseñar en Expo / React Native
- **Tokens**: `src/theme/` con `colors` (claro/oscuro), `typography`, `spacing`, `radii`,
  `shadows`. Un hook o contexto de tema ya existente se reutiliza; si no hay, crea uno
  que solo entregue valores (sin tocar estado de negocio).
- **Componentes**: crea o ajusta `Button`, `Card`, `Field`, `Chip`, `ListRow`, `Sheet`,
  `EmptyState`, `Money`. Las pantallas los usan; los handlers se pasan tal cual.
- **Fuentes**: `expo-font` o `@expo-google-fonts/*`. Carga antes de mostrar (el splash ya existe).
- **Íconos**: un solo set (el que ya use el proyecto, p. ej. `@expo/vector-icons`, o SVG propios).
- **Plataforma**: `Platform.select`/`Platform.OS` solo para estilo (sombras iOS vs elevación
  Android, tamaño de fuente, hojas inferiores). Sombras: `shadow*` en iOS, `elevation` en Android,
  `boxShadow` o estilos web en web.
- **Web (react-native-web)**: escritorio con menú lateral y contenido con ancho máximo;
  móvil con barra inferior. Revisa `position: fixed`, `gap`, scroll y foco visible.
- **Áreas seguras**: conserva `SafeAreaView`/insets y la corrección de barra de navegación
  para Huawei, Xiaomi e Infinix. No cambies flags de ventana.
- **Modo oscuro y claro**: ambos con identidad propia; respeta el selector de tema que ya existe.
- **Traducciones**: cambia valores en ES y EN; las claves quedan.

## Si en el futuro hay código nativo o web aparte
- Android nativo: `colors.xml`, `themes.xml`, `values-night/`, `res/font/`; no tocar `Activity`/`ViewModel`.
- iOS nativo: `Assets.xcassets`, `Theme`, `ViewModifier`; no tocar `@State`/servicios.
- Web con JS puro (plataforma Xero): variables CSS en `:root` y `[data-theme="dark"]`; antes de
  renombrar una clase o ID, `grep` en JS y HTML; si el JS lo usa, añade una clase nueva y deja la original.
