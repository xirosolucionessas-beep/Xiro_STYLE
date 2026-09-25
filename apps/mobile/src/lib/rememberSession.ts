/** Estructura mínima de un almacén clave-valor (la cumplen SecureStore y localStorage envueltos en storage.ts). */
export interface KeyValueLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * "Recordarme" en nativo. Con la casilla marcada (por defecto) el valor va al almacén persistente (Keychain/Keystore) y
 * sobrevive al cierre de la app. Desmarcada, el valor vive SOLO en memoria: al cerrar la app se pierde la sesión, y
 * se borra cualquier copia persistente anterior para que no quede una sesión "recordada" de un inicio previo.
 */
export function withRemember(persistent: KeyValueLike): { store: KeyValueLike; setRemember: (remember: boolean) => void } {
  let remember = true;
  const memory = new Map<string, string>();
  return {
    setRemember: (value) => {
      remember = value;
    },
    store: {
      async get(key) {
        return memory.get(key) ?? (await persistent.get(key));
      },
      async set(key, value) {
        if (remember) {
          memory.delete(key);
          await persistent.set(key, value);
        } else {
          await persistent.remove(key);
          memory.set(key, value);
        }
      },
      async remove(key) {
        memory.delete(key);
        await persistent.remove(key);
      },
    },
  };
}
