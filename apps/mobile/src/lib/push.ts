import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { api } from './api';
import { ANDROID_CHANNELS, expoRegistration } from './notificationSound';
import type { PushAdapter, PushOutcome, PushPermission } from './pushTypes';
import { prefsStorage } from './storage';

const TOKEN_KEY = 'xiro.pushToken';

/**
 * Expo Go (SDK 53+) ya no incluye las notificaciones push remotas: con solo IMPORTAR `expo-notifications` lanza un
 * error que, al estar en la cadena de importación de la sesión, deja sin exportar a todas las pantallas. Por eso el
 * módulo se carga bajo demanda y NUNCA en Expo Go; en un build de desarrollo o de producción funciona igual que antes.
 */
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

type NotificationsModule = typeof import('expo-notifications');
let loading: Promise<NotificationsModule> | null = null;

function notifications(): Promise<NotificationsModule> {
  loading ??= import('expo-notifications').then((module) => {
    // Con la app abierta también se muestra el aviso (banner + lista); sin esto iOS/Android lo silencian en primer plano.
    module.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
    return module;
  });
  return loading;
}

// Deja el aviso en primer plano configurado desde el arranque (fuera de Expo Go).
if (!inExpoGo) void notifications().catch(() => undefined);

/**
 * Canales de Android y registro del token (con permiso ya concedido). El canal `default` existente se vuelve a declarar
 * igual que antes (crearlo de nuevo no cambia lo que la persona haya ajustado); el canal del sonido de Xiro es nuevo. El
 * token se registra declarando que este build trae el sonido (`customSound`), para que el servidor lo pida en el push.
 */
async function registerDevice(Notifications: NotificationsModule): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNELS.legacy.id, { name: ANDROID_CHANNELS.legacy.name, importance: Notifications.AndroidImportance.DEFAULT });
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNELS.sound.id, { name: ANDROID_CHANNELS.sound.name, importance: Notifications.AndroidImportance.DEFAULT, sound: ANDROID_CHANNELS.sound.sound });
  }

  const projectId = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  } catch {
    // Sin credenciales de FCM/APNs en la compilación (ver guía de configuración) no hay token que registrar.
    return false;
  }

  await api.registerPush(expoRegistration(token));
  await prefsStorage.set(TOKEN_KEY, token);
  return true;
}

/** Android/iOS: token de Expo Push, que el servidor entrega a FCM/APNs. Requiere un dispositivo físico y NO funciona en Expo Go. */
export const push: PushAdapter = {
  async permission(): Promise<PushPermission> {
    if (inExpoGo || !Device.isDevice) return 'unavailable';
    const { status } = await (await notifications()).getPermissionsAsync();
    return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
  },

  async enable(): Promise<PushOutcome> {
    if (inExpoGo || !Device.isDevice) return 'unsupported';
    const Notifications = await notifications();

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return 'denied';

    return (await registerDevice(Notifications)) ? 'granted' : 'unsupported';
  },

  async disable(): Promise<void> {
    const token = await prefsStorage.get(TOKEN_KEY);
    if (!token) return;
    await api.unregisterPush(token).catch(() => undefined);
    await prefsStorage.remove(TOKEN_KEY);
  },
};

let refreshed = false;

/**
 * Una instalación que se ACTUALIZA a este build ya tenía permiso y token: sin volver a registrarse, el servidor seguiría
 * mandándole los avisos sin el sonido de Xiro. Una vez por arranque (con sesión), si había permiso y un token guardado, se
 * crean los canales y se re-registra el token. Nunca pide permiso ni registra a quien no activó las notificaciones.
 */
export function useNotificationSound(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn || refreshed || inExpoGo || !Device.isDevice) return;
    refreshed = true;
    void (async () => {
      if (!(await prefsStorage.get(TOKEN_KEY))) return;
      const Notifications = await notifications();
      if ((await Notifications.getPermissionsAsync()).status !== 'granted') return;
      await registerDevice(Notifications);
    })().catch(() => {
      refreshed = false; // se reintenta en el próximo arranque con sesión
    });
  }, [signedIn]);
}

/**
 * Deep linking al tocar un push (app en segundo plano, cerrada del todo, o recién abierta desde él): navega a la
 * ruta de destino (`data.url`, puesta por el backend en push.ts) en vez de dejar a la persona en Inicio sin más
 * (sección "Deep linking"). Monta una sola vez, cerca de la raíz — ver `useNotificationNavigation()` en _layout.
 */
export function useNotificationNavigation(): void {
  const router = useRouter();
  useEffect(() => {
    if (inExpoGo || !Device.isDevice) return;
    let active = true;
    let subscription: { remove: () => void } | undefined;
    const go = (url: unknown) => {
      if (active && typeof url === 'string' && url) router.push(url as never);
    };
    void notifications().then((Notifications) => {
      if (!active) return;
      // La app se abrió TOCANDO un push (venía cerrada o en segundo plano): navega una sola vez a su destino.
      void Notifications.getLastNotificationResponseAsync().then((response) => {
        if (!active || !response) return;
        go(response.notification.request.content.data?.url);
        void Notifications.clearLastNotificationResponseAsync?.();
      });
      subscription = Notifications.addNotificationResponseReceivedListener((response) => go(response.notification.request.content.data?.url));
    });
    return () => {
      active = false;
      subscription?.remove();
    };
  }, [router]);
}
