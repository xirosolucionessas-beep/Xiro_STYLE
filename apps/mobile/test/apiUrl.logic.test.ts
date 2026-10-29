import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { expoConfig: null } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const { resolveNativeApiUrl, MISCONFIGURED_API_URL } = await import('../src/lib/api');

/** Fase 3: en producción la app nunca habla con la API por http en texto plano. */
describe('URL de la API en el celular', () => {
  it('desarrollo: la configurada o la IP del PC que sirve Metro (como siempre)', () => {
    expect(resolveNativeApiUrl({ dev: true, configured: 'http://192.168.18.31:3000/' })).toBe('http://192.168.18.31:3000');
    expect(resolveNativeApiUrl({ dev: true, hostUri: '192.168.1.5:8081' })).toBe('http://192.168.1.5:3000');
    expect(resolveNativeApiUrl({ dev: true })).toBe('http://10.0.2.2:3000');
  });
  it('producción: solo https; sin URL o con http falla cerrada (host inválido), nunca texto plano', () => {
    expect(resolveNativeApiUrl({ dev: false, configured: 'https://api.xirostyle.com/' })).toBe('https://api.xirostyle.com');
    for (const configured of [undefined, '', 'http://api.xirostyle.com', 'api.xirostyle.com', 'https://']) {
      expect(resolveNativeApiUrl({ dev: false, configured, hostUri: '192.168.1.5:8081' }), String(configured)).toBe(MISCONFIGURED_API_URL);
    }
  });
});
