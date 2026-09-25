import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './api';
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

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Xiro Style', importance: Notifications.AndroidImportance.DEFAULT });
    }

    const projectId = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
    let token: string;
    try {
      token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    } catch {
      // Sin credenciales de FCM/APNs en la compilación (ver guía de configuración) no hay token que registrar.
      return 'unsupported';
    }

    await api.registerPush({ platform: 'expo', token });
    await prefsStorage.set(TOKEN_KEY, token);
    return 'granted';
  },

  async disable(): Promise<void> {
    const token = await prefsStorage.get(TOKEN_KEY);
    if (!token) return;
    await api.unregisterPush(token).catch(() => undefined);
    await prefsStorage.remove(TOKEN_KEY);
  },
};
