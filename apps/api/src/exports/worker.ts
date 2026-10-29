import { parentPort } from 'node:worker_threads';
import { buildExport, type ExportJob } from './build';

/**
 * Hilo de trabajo de las descargas (ver pool.ts): recibe un archivo a generar, lo arma y devuelve los bytes. Un trabajo a la
 * vez; el grupo decide cuántos hilos hay y quién espera.
 */
if (!parentPort) throw new Error('exports/worker.ts debe correr como worker_thread');
const port = parentPort;

port.on('message', async (message: { id: number; job: ExportJob }) => {
  try {
    const file = await buildExport(message.job);
    // Copia propia (un Buffer chico puede compartir el bloque interno de Node) para transferirla sin copiar otra vez.
    const bytes = new Uint8Array(file);
    port.postMessage({ id: message.id, ok: true, bytes }, [bytes.buffer]);
  } catch (error) {
    port.postMessage({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
