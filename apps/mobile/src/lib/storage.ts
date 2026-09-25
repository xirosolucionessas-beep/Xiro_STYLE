import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { withRemember } from './rememberSession';

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const keychain: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key).catch(() => null),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key).catch(() => undefined),
};

const credentials = withRemember(keychain);

/** "Recordarme" (login): por defecto la sesión persiste; sin marcar, vive solo en memoria hasta cerrar la app. */
export function setRememberSession(remember: boolean): void {
  credentials.setRemember(remember);
}

/** Credenciales (refresh token): Keychain en iOS y Keystore en Android. */
export const secureStorage: KeyValueStore = credentials.store;

/** Preferencias no sensibles (idioma, tema). */
export const prefsStorage: KeyValueStore = {
  get: (key) => AsyncStorage.getItem(key).catch(() => null),
  set: (key, value) => AsyncStorage.setItem(key, value),
  remove: (key) => AsyncStorage.removeItem(key).catch(() => undefined),
};
