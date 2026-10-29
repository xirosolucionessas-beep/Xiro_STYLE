import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { crc32, deflateSync } from 'node:zlib';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, removeMedia, saveAvatarImage, saveImage, sniffImage } from '../src/media';
import { LocalMediaStore } from '../src/storage';

const dirs: string[] = [];
async function tempMediaDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'xiro-media-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('sniffImage: el formato real, no la extensión ni el Content-Type', () => {
  it('reconoce JPG, PNG y WebP por su firma', async () => {
    expect(sniffImage(await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).jpeg().toBuffer())).toBe('jpg');
    expect(sniffImage(await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer())).toBe('png');
    expect(sniffImage(await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).webp().toBuffer())).toBe('webp');
  });
  it('un archivo de texto (aunque diga .jpg) no cuela', () => {
    expect(sniffImage(Buffer.from('esto no es una imagen, solo texto largo de relleno'))).toBeNull();
  });
});

describe('saveAvatarImage: siempre 400×400 en WebP, sin importar lo que llegó', () => {
  it('una foto ancha queda cuadrada, del lado pedido, y el archivo anterior no estorba', async () => {
    const dir = await tempMediaDir();
    const wide = await sharp({ create: { width: 1200, height: 600, channels: 3, background: { r: 200, g: 30, b: 30 } } }).jpeg().toBuffer();
    const file = await saveAvatarImage(new LocalMediaStore(dir), wide);
    expect(file).toMatch(/\.webp$/);
    const meta = await sharp(await readFile(path.join(dir, file!))).metadata();
    expect(meta).toMatchObject({ width: 400, height: 400, format: 'webp' });
  });

  it('una foto alta también queda 400×400 (el recorte es cuadrado, centrado)', async () => {
    const dir = await tempMediaDir();
    const tall = await sharp({ create: { width: 300, height: 900, channels: 3, background: { r: 30, g: 120, b: 200 } } }).png().toBuffer();
    const file = await saveAvatarImage(new LocalMediaStore(dir), tall);
    const meta = await sharp(await readFile(path.join(dir, file!))).metadata();
    expect(meta).toMatchObject({ width: 400, height: 400 });
  });

  it('endereza según la orientación EXIF antes de recortar (y no deja ese EXIF en el archivo guardado)', async () => {
    const dir = await tempMediaDir();
    // Lienzo 100×50: mitad izquierda roja, mitad derecha azul. Con EXIF orientation=6 (girar 90° CW), lo que un lector de
    // EXIF debe mostrar es la franja roja ARRIBA (no a la izquierda): así se comprueba que sí se giró, no solo que se recortó.
    const half = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 220, g: 20, b: 20 } } }).png().toBuffer();
    const otherHalf = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 20, g: 20, b: 220 } } }).png().toBuffer();
    const canvas = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#000' } })
      .composite([
        { input: half, left: 0, top: 0 },
        { input: otherHalf, left: 50, top: 0 },
      ])
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const file = await saveAvatarImage(new LocalMediaStore(dir), canvas);
    const saved = sharp(await readFile(path.join(dir, file!)));
    const meta = await saved.metadata();
    expect(meta).toMatchObject({ width: 400, height: 400 });
    expect(meta.orientation).toBeUndefined(); // sin metadata EXIF en la salida (podría traer ubicación)
    const { data } = await saved.raw().toBuffer({ resolveWithObject: true });
    const pixelAt = (x: number, y: number) => ({ r: data[(y * 400 + x) * 3], g: data[(y * 400 + x) * 3 + 1], b: data[(y * 400 + x) * 3 + 2] });
    expect(pixelAt(200, 20).r).toBeGreaterThan(150); // rojo arriba: la imagen sí se giró según el EXIF
    expect(pixelAt(200, 380).b).toBeGreaterThan(150); // azul abajo
  });

  it('un archivo que no es una imagen real (aunque pese poco) se rechaza sin reventar', async () => {
    const dir = await tempMediaDir();
    expect(await saveAvatarImage(new LocalMediaStore(dir), Buffer.from('no es una imagen'))).toBeNull();
  });

  it('una imagen con la firma correcta pero el cuerpo corrupto (sharp no la puede decodificar) también se rechaza', async () => {
    const dir = await tempMediaDir();
    const corrupt = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 0xff)]);
    expect(await saveAvatarImage(new LocalMediaStore(dir), corrupt)).toBeNull();
  });

  it('respeta el límite de 5 MB antes de intentar procesarla', async () => {
    const dir = await tempMediaDir();
    const big = Buffer.concat([await sharp({ create: { width: 4000, height: 4000, channels: 3, background: '#fff' } }).png().toBuffer(), Buffer.alloc(MAX_IMAGE_BYTES)]);
    expect(await saveAvatarImage(new LocalMediaStore(dir), big)).toBeNull();
  });
});

describe('removeMedia', () => {
  it('borra el archivo si existe y no falla si ya no está (reemplazo/borrado sin dejar huérfanos)', async () => {
    const dir = await tempMediaDir();
    const file = await saveImage(new LocalMediaStore(dir), await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer());
    await removeMedia(new LocalMediaStore(dir), file);
    await expect(readFile(path.join(dir, file!))).rejects.toThrow();
    await expect(removeMedia(new LocalMediaStore(dir), file)).resolves.toBeUndefined(); // segunda vez: no revienta
    await expect(removeMedia(new LocalMediaStore(dir), null)).resolves.toBeUndefined();
  });
});

/** PNG válido en escala de grises de 1 bit: muchísimos píxeles en muy pocos bytes (la clásica "bomba" de descompresión). */
function pngBomb(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 1; // 1 bit por píxel
  header[9] = 0; // escala de grises
  const raw = Buffer.alloc((1 + Math.ceil(width / 8)) * height); // filtro 0 + bits, todo en cero
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

describe('saveImage (fotos de catálogo): sin metadatos ni imágenes "bomba"', () => {
  it('descarta el EXIF con la ubicación GPS y endereza la foto', async () => {
    const dir = await tempMediaDir();
    const withGps = await sharp({ create: { width: 60, height: 40, channels: 3, background: '#c00' } })
      .jpeg()
      .withExif({ IFD0: { Make: 'TelefonoX', Model: 'Modelo 9' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '4/1 36/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '74/1 4/1 0/1' } })
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined(); // la original SÍ trae EXIF
    const file = await saveImage(new LocalMediaStore(dir), withGps);
    const stored = await readFile(path.join(dir, file!));
    const meta = await sharp(stored).metadata();
    expect(meta.exif).toBeUndefined();
    expect(stored.includes(Buffer.from('TelefonoX'))).toBe(false);
    expect(meta).toMatchObject({ format: 'jpeg', width: 60, height: 40 });
  });

  it('reduce las fotos enormes sin agrandar las pequeñas', async () => {
    const dir = await tempMediaDir();
    const big = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#0a0' } }).png().toBuffer();
    const meta = await sharp(await readFile(path.join(dir, (await saveImage(new LocalMediaStore(dir), big))!))).metadata();
    expect(meta).toMatchObject({ width: 2048, height: 1024, format: 'png' });
  });

  it('rechaza una imagen "bomba" de descompresión (muchísimos píxeles en pocos KB)', async () => {
    const dir = await tempMediaDir();
    const bomb = pngBomb(8_000, 8_000); // 64 MP declarados en un PNG de pocos KB (1 bit por píxel)
    expect((await sharp(bomb).metadata()).width).toBe(8_000); // PNG válido: el rechazo es por píxeles, no por estar roto
    expect(bomb.length).toBeLessThan(MAX_IMAGE_BYTES); // pasa el filtro de tamaño…
    expect(await saveImage(new LocalMediaStore(dir), bomb)).toBeNull(); // …pero no el de píxeles
  });
});

describe('almacén local: solo nombres generados por la API', () => {
  it('rechaza nombres ajenos y rutas relativas sin tocar el disco', async () => {
    const dir = await tempMediaDir();
    const store = new LocalMediaStore(dir);
    for (const name of ['../secreto.txt', 'x.svg', '..%2F..%2Fetc', '00000000-0000-4000-8000-000000000000.svg', 'A0000000-0000-4000-8000-000000000000.png']) {
      expect(await store.get(name)).toBeNull();
      expect(await store.exists(name)).toBe(false);
      await expect(store.put(name, Buffer.from('x'), 'image/png')).rejects.toThrow(/inválido/);
    }
  });
});
