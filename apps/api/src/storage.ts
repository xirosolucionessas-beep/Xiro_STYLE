import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Dónde viven las imágenes (fotos de artículos, logos, avatares). En desarrollo, una carpeta local; en producción, un
 * almacén compatible con S3 (Cloudflare R2): sobrevive a reemplazar el servidor y lo comparten todas las instancias.
 * Solo se guardan nombres generados por la API (uuid + extensión), nunca el nombre que trae el usuario.
 */
export interface StoredObject {
  body: Buffer;
  contentType: string;
  etag?: string;
}

export interface MediaStore {
  readonly kind: 'local' | 's3';
  put(name: string, body: Buffer, contentType: string): Promise<void>;
  get(name: string): Promise<StoredObject | null>;
  exists(name: string): Promise<boolean>;
  remove(name: string): Promise<void>;
}

/** Nombre válido de un archivo de medios: exactamente lo que genera la API (impide cualquier ruta o nombre ajeno). */
export const MEDIA_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export const CONTENT_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
export const contentTypeOf = (name: string): string => CONTENT_TYPES[name.split('.').pop() ?? ''] ?? 'application/octet-stream';

export class LocalMediaStore implements MediaStore {
  readonly kind = 'local' as const;
  constructor(private readonly dir: string) {}

  private file(name: string): string {
    if (!MEDIA_NAME.test(name)) throw new Error(`Nombre de medio inválido: ${name}`);
    return path.join(this.dir, name);
  }

  async put(name: string, body: Buffer, _contentType?: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(name), body);
  }

  async get(name: string): Promise<StoredObject | null> {
    if (!MEDIA_NAME.test(name)) return null;
    try {
      const [body, info] = await Promise.all([readFile(this.file(name)), stat(this.file(name))]);
      return { body, contentType: contentTypeOf(name), etag: `"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"` };
    } catch {
      return null;
    }
  }

  async exists(name: string): Promise<boolean> {
    return MEDIA_NAME.test(name) && (await stat(this.file(name)).then(() => true).catch(() => false));
  }

  async remove(name: string): Promise<void> {
    if (!MEDIA_NAME.test(name)) return;
    await unlink(this.file(name)).catch(() => undefined);
  }
}

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3MediaStore implements MediaStore {
  readonly kind = 's3' as const;
  private readonly client: S3Client;
  constructor(private readonly settings: S3Settings) {
    this.client = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      // R2 y la mayoría de los compatibles con S3 usan rutas (bucket en la ruta, no en el subdominio).
      forcePathStyle: true,
      maxAttempts: 3,
    });
  }

  async put(name: string, body: Buffer, contentType: string): Promise<void> {
    if (!MEDIA_NAME.test(name)) throw new Error(`Nombre de medio inválido: ${name}`);
    await this.client.send(new PutObjectCommand({ Bucket: this.settings.bucket, Key: name, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }));
  }

  async get(name: string): Promise<StoredObject | null> {
    if (!MEDIA_NAME.test(name)) return null;
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.settings.bucket, Key: name }));
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) return null;
      return { body: Buffer.from(bytes), contentType: result.ContentType ?? contentTypeOf(name), etag: result.ETag };
    } catch (error) {
      if (error instanceof NoSuchKey || (error as { name?: string }).name === 'NoSuchKey') return null;
      throw error;
    }
  }

  async exists(name: string): Promise<boolean> {
    if (!MEDIA_NAME.test(name)) return false;
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.settings.bucket, Key: name }));
      return true;
    } catch (error) {
      if ((error as { name?: string; $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404 || (error as { name?: string }).name === 'NotFound') return false;
      throw error;
    }
  }

  async remove(name: string): Promise<void> {
    if (!MEDIA_NAME.test(name)) return;
    await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: name }));
  }
}
