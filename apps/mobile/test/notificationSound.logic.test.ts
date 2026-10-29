import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { NOTIFICATION_SOUND_CHANNEL_ID, NOTIFICATION_SOUND_FILE, WEB_NOTIFICATION_SOUND_URL } from '@xiro/shared';
import { describe, expect, it, vi } from 'vitest';
import { ANDROID_CHANNELS, createSoundPlayer, expoRegistration } from '../src/lib/notificationSound';

const ROOT = path.resolve(__dirname, '..');

describe('sonido de notificación: recurso y selección', () => {
  it('app.json empaqueta EXACTAMENTE el archivo que nombran el canal de Android y el servidor', () => {
    const app = JSON.parse(readFileSync(path.join(ROOT, 'app.json'), 'utf8')) as { expo: { plugins: unknown[] } };
    const plugin = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-notifications') as [string, { sounds: string[] }];
    expect(plugin[1].sounds).toEqual([`./assets/sounds/${NOTIFICATION_SOUND_FILE}`]);
    expect(ANDROID_CHANNELS.sound).toMatchObject({ id: NOTIFICATION_SOUND_CHANNEL_ID, sound: NOTIFICATION_SOUND_FILE });
    // Nombre válido como recurso de Android (res/raw): minúsculas, números y guion bajo.
    expect(NOTIFICATION_SOUND_FILE.replace(/\.wav$/, '')).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('el canal existente "default" se conserva tal cual; el del sonido es otro', () => {
    expect(ANDROID_CHANNELS.legacy).toEqual({ id: 'default', name: 'Xiro Style' });
    expect(ANDROID_CHANNELS.sound.id).not.toBe(ANDROID_CHANNELS.legacy.id);
  });

  it('el WAV cumple lo que exige iOS (PCM lineal, < 30 s) y el MP3 web existe', () => {
    const wav = readFileSync(path.join(ROOT, 'assets/sounds', NOTIFICATION_SOUND_FILE));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(20)).toBe(1); // formato 1 = PCM lineal
    const channels = wav.readUInt16LE(22);
    const sampleRate = wav.readUInt32LE(24);
    const bitsPerSample = wav.readUInt16LE(34);
    const dataOffset = wav.indexOf('data', 12, 'ascii');
    const seconds = wav.readUInt32LE(dataOffset + 4) / (sampleRate * channels * (bitsPerSample / 8));
    expect({ channels, sampleRate, bitsPerSample }).toEqual({ channels: 1, sampleRate: 44_100, bitsPerSample: 16 });
    expect(seconds).toBeGreaterThan(1);
    expect(seconds).toBeLessThan(30);
    // Sin metadatos del generador original.
    expect(wav.toString('latin1')).not.toMatch(/c2pa|ElevenLabs/i);
    expect(statSync(path.join(ROOT, 'public', WEB_NOTIFICATION_SOUND_URL)).size).toBeGreaterThan(1000);
  });

  it('un build nuevo se registra declarando que trae el sonido', () => {
    expect(expoRegistration('ExponentPushToken[abc]')).toEqual({ platform: 'expo', token: 'ExponentPushToken[abc]', customSound: true });
  });
});

describe('sonido en la página web: sin duplicados y sin saltarse las reglas del navegador', () => {
  const env = { visible: true, hasBeenActive: true };

  it('suena una sola vez por aviso aunque llegue repetido', async () => {
    const play = vi.fn(async () => undefined);
    const handle = createSoundPlayer({ env: () => env, play });
    expect(await handle('a')).toBe(true);
    expect(await handle('a')).toBe(true); // ya sonó: el aviso del sistema debe ir en silencio
    expect(await handle('b')).toBe(true);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('pestaña oculta o sin interacción: no suena en la página (el aviso del sistema usa su sonido de siempre)', async () => {
    const play = vi.fn(async () => undefined);
    expect(await createSoundPlayer({ env: () => ({ visible: false, hasBeenActive: true }), play })('x')).toBe(false);
    expect(await createSoundPlayer({ env: () => ({ visible: true, hasBeenActive: false }), play })('x')).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });

  it('si el navegador bloquea el audio o falta el archivo, responde que NO sonó', async () => {
    const handle = createSoundPlayer({ env: () => env, play: async () => Promise.reject(new DOMException('blocked', 'NotAllowedError')) });
    expect(await handle('y')).toBe(false);
  });
});
