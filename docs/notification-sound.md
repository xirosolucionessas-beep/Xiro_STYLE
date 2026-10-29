# Sonido de notificación de Xiro Style

Estado: implementado y probado con pruebas automáticas (sin enviar notificaciones reales). **Requiere un build nativo nuevo**
(EAS) para Android/iOS: el sonido es un recurso nativo y no llega por actualización OTA ni funciona en Expo Go.

## Archivos de audio

| Archivo | Uso | Formato |
|---|---|---|
| `apps/mobile/assets/sounds/xiro_notification.wav` | Android e iOS (empaquetado por el plugin de `expo-notifications` en `app.json`) | WAV PCM 16 bits, mono, 44,1 kHz, 1,84 s, 162 KB, sin metadatos |
| `apps/mobile/public/sounds/xiro_notification.mp3` | Web (lo reproduce la página) | MP3 mono 44,1 kHz, 1,84 s, 21 KB, sin etiquetas ID3 ni C2PA |

Origen: una composición de ElevenLabs (MP3, 1,84 s; pico −3,6 dBFS, volumen medio −24,8 dB, −22,2 LUFS integrados; sin
saturación). Se convirtió una copia con ffmpeg; el archivo original no se modificó. Los metadatos de origen (manifiesto C2PA
de ElevenLabs: organización, marca de contenido generado por IA, identificadores de generación) no se copiaron. Volumen sin
alterar.

Nombres compartidos: `packages/shared/src/notificationSound.ts` (archivo, canal y URL web).

## Comportamiento por plataforma

| Plataforma | Cómo suena | Si no está disponible |
|---|---|---|
| **Android 8+** | Canal nuevo `xiro_alerts` ("Avisos de Xiro Style") con el sonido. El servidor envía `channelId: xiro_alerts` solo a los dispositivos registrados por el build nuevo. | Dispositivos de builds anteriores: canal `default` y sonido del sistema, como siempre. |
| **iOS** | El servidor envía `sound: xiro_notification.wav` solo a los dispositivos del build nuevo (antes los push de iOS **no sonaban**: este es el único cambio de comportamiento, y solo para quien instale el build nuevo). | Builds anteriores: sin sonido, como siempre. Si el archivo faltara en un build, iOS usaría el sonido estándar. |
| **Web** | El aviso del sistema no admite sonido propio (ningún navegador actual). Si hay una pestaña de Xiro **visible**, con sesión y en la que la persona **ya interactuó** (regla de autoreproducción), la página reproduce el MP3 y el aviso del sistema sale en silencio. | Pestaña cerrada u oculta, sin interacción, audio bloqueado o archivo ausente: el aviso sale como siempre (con el sonido que decidan el sistema y el navegador). |
| **App abierta (Android/iOS)** | Sin cambios: en primer plano el aviso se muestra sin sonido (`shouldPlaySound: false`). | — |

**Preferencias de la persona:** la app no tiene un ajuste propio de sonido; se respetan los del sistema. En Android, el sonido
y la importancia de cada canal se cambian en Ajustes → Notificaciones de la app; en iOS, Ajustes → Notificaciones → Xiro
Style → Sonidos; en la web, los del navegador y el sistema operativo. El interruptor de notificaciones y las categorías de la
app siguen funcionando igual.

**Sin duplicados:** cada push llega una vez por dispositivo; la app no programa notificaciones locales. En la web, el service
worker le pregunta a UNA sola pestaña visible y, si sonó, muestra el aviso en silencio; el mismo aviso no suena dos veces en
la página. Las alertas que la app consulta cada 45 s (centro de notificaciones) nunca reproducen sonido.

## Por qué un canal nuevo en Android (migración)

En Android 8+ el sonido pertenece al canal y **no se puede cambiar** en un canal ya creado, ni siquiera actualizando la app.
Por eso:

- Se crea `xiro_alerts` con el sonido. El canal `default` **se conserva** (se vuelve a declarar igual que antes, lo que no
  altera lo que la persona haya ajustado). En los ajustes de la app de Android aparecerán los dos canales.
- Si en el futuro se quiere otro sonido, hay que crear OTRO canal (p. ej. `xiro_alerts_v2`), porque `xiro_alerts` quedará
  fijo en los teléfonos que ya lo crearon.
- Borrar `default` (no se hizo) eliminaría lo que la persona haya configurado en él.

## Despliegue (orden)

1. Migración `0038_notification_sound` (aditiva: `push_tokens.custom_sound`, por defecto `false` → nada cambia para los
   dispositivos existentes). Reversión: `apps/api/drizzle/rollback/0038_notification_sound.down.sql`.
2. API (lee y escribe `custom_sound`).
3. Build nativo nuevo (EAS) y publicación en las tiendas. Al abrirlo con sesión, una instalación que ya tenía permiso y token
   se vuelve a registrar sola con `customSound: true`; no se pide permiso a nadie que no lo hubiera dado.
4. Web: se publica con el resto de la app (sw.js y el MP3 en `public/`).

## Cómo probarlo en un dispositivo real (no se hizo en esta tarea)

Requisitos: un build de desarrollo o de prueba con EAS (`eas build --profile development`), credenciales de FCM/APNs y la
API de un entorno de pruebas (nunca producción).

- **Android:** instala el build, inicia sesión y activa las notificaciones. En Ajustes → Apps → Xiro Style → Notificaciones
  deben aparecer "Xiro Style" y "Avisos de Xiro Style". Con la app en segundo plano, provoca un aviso (p. ej. una reserva
  desde la página pública de prueba): debe sonar el sonido de Xiro. Prueba también con el canal en silencio y con el
  teléfono en "No molestar".
- **iOS:** igual en un iPhone físico (el simulador no recibe push remotos). Con Ajustes → Notificaciones → Xiro Style →
  Sonidos desactivado, no debe sonar.
- **Actualización:** instala primero el build anterior, activa notificaciones, actualiza al nuevo y abre la app: el siguiente
  aviso debe usar el sonido nuevo.
- **Web:** con la pestaña visible y después de hacer clic en la página, provoca un aviso: suena el MP3 una vez y el aviso del
  sistema sale en silencio. Con la pestaña en segundo plano: aviso normal.
