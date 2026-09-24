import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Credenciales (refresh token): Keychain en iOS y Keystore en Android. */
export const secureStorage: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key).catch(() => null),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key).catch(() => undefined),
};

/** Preferencias no sensibles (idioma, tema). */
export const prefsStorage: KeyValueStore = {
  get: (key) => AsyncStorage.getItem(key).catch(() => null),
  set: (key, value) => AsyncStorage.setItem(key, value),
  remove: (key) => AsyncStorage.removeItem(key).catch(() => undefined),
};
