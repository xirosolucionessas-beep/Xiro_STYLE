import sharp from 'sharp';

/** Una imagen real (sharp la puede decodificar de verdad), para que el recorte/redimensionado del servidor no falle. */
export async function realJpeg(width = 900, height = 500): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 180, g: 90, b: 30 } } })
    .jpeg()
    .toBuffer();
}

/** Cuerpo multipart con una foto, listo para `app.inject` (mismo truco que las subidas de portada/galería: FormData + Response). */
export async function photoForm(buffer: Buffer, field = 'photo', filename = 'foto.jpg'): Promise<{ payload: Buffer; contentType: string }> {
  const data = new FormData();
  data.append(field, new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' }), filename);
  const response = new Response(data);
  return { payload: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type')! };
}
