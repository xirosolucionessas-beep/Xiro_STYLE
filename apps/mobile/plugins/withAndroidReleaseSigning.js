const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Firma real para los APK/AAB "release" (Fase 1.2 de la auditoría de seguridad): por defecto, Expo/RN generan
 * android/app/build.gradle con `buildTypes.release.signingConfig signingConfigs.debug` — cualquiera con el repo
 * podría re-firmar y publicar una build "release" con la clave de depuración, de dominio público. android/ está en
 * .gitignore (Expo lo regenera con cada `prebuild`), así que no sirve editarlo a mano: este plugin hace el mismo
 * cambio EN CADA prebuild, de forma determinista y revisable en el historial.
 *
 * Nunca lee ni genera el keystore real: eso lo provee el equipo (o EAS: `eas credentials`, más seguro todavía porque
 * ni siquiera toca el disco local) por estas 4 variables de entorno al compilar. Sin ellas, en una máquina de
 * desarrollo cae al keystore de debug con una advertencia clara (no bloquea el `prebuild`/build local de alguien que
 * aún no tiene las credenciales de subida), pero en CI/EAS (que siempre exportan `CI`) falla cerrado: una tubería de
 * release nunca debe poder publicar un .aab/.apk firmado con la clave de depuración pública sin que nadie lo note.
 *
 *   XIRO_UPLOAD_STORE_FILE      ruta absoluta al archivo .keystore/.jks (nunca dentro del repo)
 *   XIRO_UPLOAD_STORE_PASSWORD
 *   XIRO_UPLOAD_KEY_ALIAS
 *   XIRO_UPLOAD_KEY_PASSWORD
 */
const SIGNING_CONFIGS_RE = /(signingConfigs\s*\{\s*debug\s*\{[^}]*\}\n)(\s*\})/;
const RELEASE_BLOCK_RE = /(release\s*\{\n)(\s*\/\/ Caution![^\n]*\n\s*\/\/ see https:\/\/reactnative\.dev\/docs\/signed-apk-android\.\n\s*)signingConfig signingConfigs\.debug/;

function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;

    if (!SIGNING_CONFIGS_RE.test(contents) || !RELEASE_BLOCK_RE.test(contents)) {
      throw new Error(
        'withAndroidReleaseSigning: no encontré el signingConfigs/buildTypes.release esperado en app/build.gradle generado. ' +
          'Expo/React Native puede haber cambiado la plantilla — revisa SIGNING_CONFIGS_RE/RELEASE_BLOCK_RE en apps/mobile/plugins/withAndroidReleaseSigning.js ' +
          'antes de seguir: sin este plugin, una build "release" quedaría firmada con la clave de depuración.',
      );
    }

    const releaseSigningConfig = `release {
            if (System.getenv("XIRO_UPLOAD_STORE_FILE") != null) {
                storeFile file(System.getenv("XIRO_UPLOAD_STORE_FILE"))
                storePassword System.getenv("XIRO_UPLOAD_STORE_PASSWORD")
                keyAlias System.getenv("XIRO_UPLOAD_KEY_ALIAS")
                keyPassword System.getenv("XIRO_UPLOAD_KEY_PASSWORD")
            } else if (System.getenv("CI") != null) {
                throw new GradleException("XIRO_UPLOAD_STORE_FILE no está definida en un entorno CI/EAS (CI=" + System.getenv("CI") + "): una build 'release' no puede firmarse con la clave de depuración pública. Configura XIRO_UPLOAD_STORE_FILE/STORE_PASSWORD/KEY_ALIAS/KEY_PASSWORD (o 'eas credentials').")
            } else {
                logger.warn("XIRO_UPLOAD_STORE_FILE no está definida: la build 'release' queda firmada con la clave de depuración (NUNCA publicar así).")
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }
`;
    let next = contents.replace(SIGNING_CONFIGS_RE, (_match, before, closing) => `${before}        ${releaseSigningConfig}${closing}`);
    next = next.replace(RELEASE_BLOCK_RE, (_match, head, comment) => `${head}${comment}signingConfig signingConfigs.release`);

    config.modResults.contents = next;
    return config;
  });
}

module.exports = withAndroidReleaseSigning;
