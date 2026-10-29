/* En web no existe Keychain: se usa localStorage (protegido por el mismo origen). */

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const local: KeyValueStore = {
  async get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* almacenamiento bloqueado (modo privado): la sesión durará solo esta pestaña */
    }
  },
  async remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* noop */
    }
  },
};

/**
 * "Recordarme" (solo web). Con la casilla marcada (por defecto, el comportamiento de siempre) la sesión se guarda en
 * localStorage y sobrevive al cierre del navegador; desmarcada, el refresh token vive en sessionStorage y se pierde al cerrar la pestaña.
 * La preferencia (`xiro.remember`) es lo único que se guarda de forma persistente.
 */
const REMEMBER_KEY = 'xiro.remember';

export function setRememberSession(remember: boolean): void {
  try {
    if (remember) window.localStorage.removeItem(REMEMBER_KEY);
    else window.localStorage.setItem(REMEMBER_KEY, '0');
  } catch {
    /* almacenamiento bloqueado: la sesión durará solo esta pestaña */
  }
}

const remembers = () => {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) !== '0';
  } catch {
    return false;
  }
};

/** "Recordarme": la API lo usa para dar una cookie persistente (30 días) o de sesión del navegador. */
export function remembersSession(): boolean {
  return remembers();
}

const session = (): Storage | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const credentials: KeyValueStore = {
  async get(key) {
    return session()?.getItem(key) ?? (await local.get(key));
  },
  async set(key, value) {
    if (remembers()) {
      session()?.removeItem(key);
      await local.set(key, value);
    } else {
      await local.remove(key);
      session()?.setItem(key, value);
    }
  },
  async remove(key) {
    session()?.removeItem(key);
    await local.remove(key);
  },
};

export const secureStorage: KeyValueStore = credentials;
export const prefsStorage: KeyValueStore = local;
