const fs = require('node:fs');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * `@xiro/shared` vive fuera de este proyecto (packages/shared, enlazado por el workspace). Sin esto, Metro solo
 * vigila `apps/mobile` y un cambio ahí nunca dispara una recarga — el bundle sigue sirviendo la versión vieja hasta
 * reiniciar el servidor a mano, aunque el archivo en disco ya esté actualizado.
 */
config.watchFolders = [...(config.watchFolders ?? []), path.join(__dirname, '..', '..', 'packages', 'shared')];

/**
 * SOLO WEB. Expo compila `import { Pressable } from 'react-native'` en web como un import profundo de
 * react-native-web. Para el código de src/ esos componentes se sustituyen por versiones de src/web/rn/:
 *  - Pressable: traduce `accessibilityState` a ARIA (react-native-web 0.21 no lo hace).
 *  - ActivityIndicator: skeleton accesible en lugar de una ruedita sin contexto.
 * Android, iOS y las librerías no se ven afectados (la condición exige platform === 'web' y origen dentro de src/).
 */
const srcRoot = path.join(__dirname, 'src') + path.sep;
const shimDir = path.join(__dirname, 'src', 'web', 'rn') + path.sep;
const REPLACEMENTS = {
  'react-native-web/dist/exports/Pressable': path.join(shimDir, 'Pressable.tsx'),
  'react-native-web/dist/exports/ActivityIndicator': path.join(shimDir, 'ActivityIndicator.tsx'),
};
const appRoot = path.join(__dirname, 'src', 'app');
/**
 * Rutas SOLO WEB (archivos "*.web.tsx" dentro de src/app). Expo Router las descarta del árbol de rutas en Android/iOS, pero require.context
 * igualmente empaqueta el módulo y toda su cadena de imports (~120 KB). En nativo se resuelven a un módulo vacío:
 * el código web nunca llega al bundle y los archivos nativos originales no se tocan.
 */
const isWebOnlyRoute = (moduleName, origin) => /\.web\.[jt]sx?$/.test(moduleName) && origin.startsWith(appRoot);
/**
 * Caso simétrico al de arriba: una ruta NATIVA ("foo.tsx") que tiene hermana "foo.web.tsx" también se empaqueta
 * completa en web por el mismo require.context, aunque en tiempo de ejecución la web siempre use la hermana .web.
 * Sin esto, dependencias solo-nativas importadas desde la versión nativa (p. ej. react-native-purchases) terminan
 * dentro del bundle web sin usarse nunca — pasó justo con la ruta de suscripción (+1.2 MB muertos).
 */
const isNativeRouteWithWebSibling = (moduleName, origin) => {
  if (!origin.startsWith(appRoot) || !/\.[jt]sx?$/.test(moduleName) || /\.web\.[jt]sx?$/.test(moduleName)) return false;
  const absolute = path.isAbsolute(moduleName) ? moduleName : path.resolve(path.dirname(origin), moduleName);
  return fs.existsSync(absolute.replace(/\.([jt]sx?)$/, '.web.$1'));
};
const upstream = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform !== 'web' && isWebOnlyRoute(moduleName, context.originModulePath)) return { type: 'empty' };
  if (platform === 'web' && isNativeRouteWithWebSibling(moduleName, context.originModulePath)) return { type: 'empty' };
  const replacement = REPLACEMENTS[moduleName];
  if (platform === 'web' && replacement && context.originModulePath.startsWith(srcRoot) && !context.originModulePath.startsWith(shimDir)) {
    return { type: 'sourceFile', filePath: replacement };
  }
  return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
