import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Ctx } from '../context';
import { eq } from 'drizzle-orm';
import { itemOnPublicPage, resolveSlug, loadProfileRow } from '../booking/view';
import { businesses } from '../db/schema';
import { isUuid } from '../errors';
import { loadItems } from '../serializers';
import { MEDIA_NAME } from '../storage';

// Relativo al directorio de trabajo del proceso (apps/api/), no a este archivo: ver la misma nota en db/migrate.ts.
const catalogDir = path.join(process.cwd(), 'public/catalog/');

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// fonts.googleapis.com / fonts.gstatic.com: la tipografía del rediseño (Fase 3), igual que la página de reservas.
const CATALOG_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// challenges.cloudflare.com: solo entra en juego si se configura TURNSTILE_SITE_KEY (si no, la página nunca lo carga).
// style-src 'unsafe-inline': la portada del negocio se pinta con un estilo en línea (imagen subida por el propio negocio,
// nunca texto de un tercero); mismo trato que ya recibe el resto de la app (ver CSP de la app web en este archivo).
// fonts.googleapis.com/fonts.gstatic.com: tipografías (Outfit/Inter) cargadas por su <link> en index.html — igual que
// el resto del proyecto, nunca se autohospedan archivos binarios de fuentes en el repo.
// `{{THEME_SCRIPT_HASH}}`: el hash SHA-256 del script en línea de index.html que fija el tema (claro/oscuro) ANTES del
// primer pintado (evita el parpadeo del tema equivocado) — se calcula del contenido real leído del archivo, nunca a
// mano, así nunca queda desactualizado si ese script cambia.
const RESERVAR_CSP_TEMPLATE =
  "default-src 'none'; script-src 'self' {{THEME_SCRIPT_HASH}} https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; font-src 'self' https://fonts.gstatic.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * Catálogo público (HTML), fotos subidas y —si existe— la app web exportada por Expo.
 * Devuelve el index.html de la app web (para el fallback de rutas del cliente) o null si no hay build web.
 */
export function webRoutes(app: FastifyInstance, ctx: Ctx): string | null {
  const { db, config } = ctx;
  const template = readFileSync(path.join(catalogDir, 'index.html'), 'utf8');
  // ¿Se sirve la página pública moderna (/reservar)? Sin ese build, los enlaces de artículo se quedan en el catálogo de siempre.
  const modernPage = Boolean(config.publicWebDir && existsSync(path.join(config.publicWebDir, 'index.html')));
  /** Redirección CONDICIONAL (depende de lo que el negocio publique en cada momento): temporal y sin guardar en caché. */
  const redirectTo = (reply: FastifyReply, location: string) => reply.header('Cache-Control', 'no-store').redirect(location, 302);

  app.register(fastifyStatic, {
    root: catalogDir,
    prefix: '/catalog-assets/',
    index: false,
    decorateReply: false,
    setHeaders: (res) => res.header('Cache-Control', 'public, max-age=300'),
  });

  /**
   * Imágenes desde el almacén configurado (carpeta local o S3/R2). Solo nombres generados por la API (uuid + extensión):
   * cualquier otra cosa es 404 sin tocar el almacén (sin rutas relativas posibles). El nombre nunca cambia, así que el
   * navegador y la CDN (Cloudflare) pueden guardarla un año: cada imagen sale del servidor una sola vez por región.
   */
  app.get('/media/:file', async (request, reply) => {
    const { file } = request.params as { file: string };
    // Mismo 404 JSON que el resto de rutas del servidor.
    const missing = () => reply.code(404).header('Cache-Control', 'no-store').send({ code: 'not_found', message: 'Not found' });
    if (!MEDIA_NAME.test(file)) return missing();
    const object = await ctx.media.get(file);
    if (!object) return missing();
    if (object.etag && request.headers['if-none-match'] === object.etag) return reply.code(304).header('ETag', object.etag).send();
    reply
      .header('Content-Type', object.contentType)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
      .header('Content-Disposition', 'inline');
    if (object.etag) reply.header('ETag', object.etag);
    return reply.send(object.body);
  });

  async function ogTags(request: FastifyRequest, slug: string, itemId: string | null): Promise<string> {
    const [business] = await db.select().from(businesses).where(eq(businesses.slug, slug.slice(0, 60))).limit(1);
    if (!business || business.accessStatus !== 'active') return '<title>Catálogo | Xiro Style</title><meta name="robots" content="noindex">';
    const origin = `${request.protocol}://${request.host}`;
    const item = itemId && isUuid(itemId) ? (await loadItems(db, business.id, { id: itemId.toLowerCase(), publishedOnly: true }))[0] : undefined;
    const title = item ? `${item.name} | ${business.name}` : `${business.name} | Catálogo`;
    const description = item ? item.shortDescription || item.description : 'Servicios y productos para tu estilo.';
    const image = item?.photos[0]?.url ?? (business.logoFile ? `/media/${business.logoFile}` : null);
    const tags = [
      `<title>${escapeHtml(title)}</title>`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:title" content="${escapeHtml(title)}">`,
      `<meta property="og:description" content="${escapeHtml(description.slice(0, 200))}">`,
      `<meta name="description" content="${escapeHtml(description.slice(0, 200))}">`,
    ];
    if (image) tags.push(`<meta property="og:image" content="${escapeHtml(origin + image)}">`);
    return tags.join('\n  ');
  }

  async function catalogPage(request: FastifyRequest<{ Params: { slug: string; id?: string } }>, reply: FastifyReply) {
    const { slug, id } = request.params;
    // Enlace de un artículo (Fase 2): si el artículo se ve en la página moderna, se lleva allí (con la dirección vigente del
    // negocio). Si no —página sin publicar, artículo no reservable, sección oculta—, este catálogo lo sigue mostrando como
    // siempre: ningún enlace ya compartido deja de funcionar.
    if (modernPage && id && isUuid(id)) {
      const resolved = await resolveSlug(db, slug.slice(0, 60));
      if (resolved && (await itemOnPublicPage(db, resolved.business.id, id.toLowerCase()))) {
        return redirectTo(reply, `/reservar/${encodeURIComponent(resolved.business.slug)}/articulo/${id.toLowerCase()}`);
      }
    }
    const tags = await ogTags(request, slug, id ?? null);
    return reply
      .header('Content-Security-Policy', CATALOG_CSP)
      .header('Cache-Control', 'no-cache')
      .type('text/html; charset=utf-8')
      // Función de reemplazo, no texto: con texto, "$`" o "$'" en el nombre del negocio insertaban trozos de la plantilla.
      .send(template.replace('<!--OG_TAGS-->', () => tags));
  }

  app.get<{ Params: { slug: string } }>('/catalog/:slug', catalogPage);
  app.get<{ Params: { slug: string; id: string } }>('/catalog/:slug/item/:id', catalogPage);

  /* Página pública de reservas (Vite + React, apps/public), bajo /reservar/<negocio>. */
  if (config.publicWebDir && existsSync(path.join(config.publicWebDir, 'index.html'))) {
    const dir = config.publicWebDir;
    const reservarTemplate = readFileSync(path.join(dir, 'index.html'), 'utf8');
    // Único <script> sin `src` del archivo: el que fija el tema antes del primer pintado (ver index.html). El hash de
    // CSP se calcula sobre el texto YA normalizado a LF: el navegador normaliza CRLF→LF al parsear el HTML antes de
    // hashear (es la fuente de verdad), y este archivo en disco trae CRLF (core.autocrlf de git en Windows) — sin
    // esta normalización el hash calculado aquí nunca coincide con el que exige el navegador.
    const inlineScript = (/<script>([\s\S]*?)<\/script>/.exec(reservarTemplate)?.[1] ?? '').replace(/\r\n?/g, '\n');
    const themeScriptHash = `'sha256-${createHash('sha256').update(inlineScript).digest('base64')}'`;
    const RESERVAR_CSP = RESERVAR_CSP_TEMPLATE.replace('{{THEME_SCRIPT_HASH}}', themeScriptHash);

    app.register(fastifyStatic, {
      root: dir,
      prefix: '/reservar/',
      index: false,
      wildcard: false,
      decorateReply: false,
      setHeaders: (res, filePath) => {
        const hashed = filePath.includes(`${path.sep}assets${path.sep}`);
        res.header('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });

    async function ogTagsForBooking(request: FastifyRequest, slug: string, itemId?: string, privateLink = false): Promise<string> {
      const generic = '<title>Reserva tu cita | Xiro Style</title><meta name="robots" content="noindex">';
      const resolved = await resolveSlug(db, slug.slice(0, 60));
      if (!resolved) return generic;
      const profile = await loadProfileRow(db, resolved.business.id);
      // Sin publicar se trata igual que si no existiera: no se filtra ni su nombre por esta vía.
      if (!profile?.published) return generic;
      const origin = `${request.protocol}://${request.host}`;
      const businessName = profile.displayName || resolved.business.name;
      // Enlace de un artículo: la vista previa (WhatsApp, redes) muestra ESE artículo — nombre, descripción y su foto.
      const item = itemId ? (await loadItems(db, resolved.business.id, { id: itemId, publishedOnly: true }))[0] : undefined;
      const title = item ? `${item.name} | ${businessName}` : `Reserva tu cita | ${businessName}`;
      const description = (item ? item.shortDescription || item.description : '') || profile.tagline || profile.description || 'Agenda tu cita en línea, cuando quieras.';
      // Dirección canónica (Fase 4, SEO): la del negocio o la del artículo, siempre con el slug vigente.
      const canonical = `${origin}/reservar/${encodeURIComponent(resolved.business.slug)}${item ? `/articulo/${item.id}` : ''}`;
      const tags = [
        `<title>${escapeHtml(title)}</title>`,
        `<meta property="og:type" content="website">`,
        `<meta property="og:site_name" content="${escapeHtml(businessName)}">`,
        `<meta property="og:title" content="${escapeHtml(title)}">`,
        `<meta property="og:description" content="${escapeHtml(description.slice(0, 200))}">`,
        `<meta property="og:url" content="${escapeHtml(canonical)}">`,
        `<meta name="description" content="${escapeHtml(description.slice(0, 200))}">`,
        `<link rel="canonical" href="${escapeHtml(canonical)}">`,
      ];
      // Enlaces personales (gestión de cita, lista de espera, reseña): llevan un token en la URL, nunca se indexan.
      if (privateLink) tags.push('<meta name="robots" content="noindex, nofollow">');
      const itemPhoto = item?.photos[0]?.url;
      // Imagen de la vista previa: la foto del artículo; si no, la portada del negocio; si no, su logo.
      const shareImage = itemPhoto ? origin + itemPhoto : profile.coverFile ? `${origin}/media/${profile.coverFile}` : resolved.business.logoFile ? `${origin}/media/${resolved.business.logoFile}` : null;
      if (shareImage) tags.push(`<meta property="og:image" content="${escapeHtml(shareImage)}">`);
      tags.push(`<meta name="twitter:card" content="${shareImage && (itemPhoto || profile.coverFile) ? 'summary_large_image' : 'summary'}">`);
      // Datos estructurados del negocio (schema.org) en su página principal: ayudan a los buscadores a mostrarlo bien.
      if (!item && !privateLink) {
        const address = [resolved.business.address, resolved.business.city].filter(Boolean).join(', ');
        const data: Record<string, unknown> = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: businessName, url: canonical };
        if (description) data.description = description.slice(0, 300);
        if (shareImage) data.image = shareImage;
        if (profile.phone) data.telephone = profile.phone;
        if (address) data.address = { '@type': 'PostalAddress', streetAddress: resolved.business.address || undefined, addressLocality: resolved.business.city || undefined };
        if (profile.latitude !== null && profile.longitude !== null) data.geo = { '@type': 'GeoCoordinates', latitude: profile.latitude, longitude: profile.longitude };
        // "<" escapado: un texto del negocio con "</script>" no puede cerrar la etiqueta.
        tags.push(`<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`);
      }
      if (resolved.business.logoFile) {
        const logoUrl = escapeHtml(`${origin}/media/${resolved.business.logoFile}`);
        // Favicon dinámico (Tarea 4): el logo del negocio si lo tiene; si no, la etiqueta estática del propio HTML
        // (favicon.png de Xiro, ver index.html) queda como único <link rel="icon">, sin nada que pisarla aquí.
        tags.push(`<link rel="icon" sizes="16x16" href="${logoUrl}">`, `<link rel="icon" sizes="32x32" href="${logoUrl}">`, `<link rel="apple-touch-icon" sizes="180x180" href="${logoUrl}">`);
      }
      return tags.join('\n  ');
    }

    async function reservarPage(request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) {
      const privateLink = /^\/reservar\/[^/]+\/(gestion|espera|resena|cuenta|ingresar|registro|recuperar)(\/|$)/.test(request.url.split('?')[0] ?? '');
      const tags = await ogTagsForBooking(request, request.params.slug, undefined, privateLink);
      return reply
        .header('Content-Security-Policy', RESERVAR_CSP)
        .header('Cache-Control', 'no-cache')
        .type('text/html; charset=utf-8')
        .send(reservarTemplate.replace('<!--OG_TAGS-->', () => tags)); // función: ver catalogPage
    }

    app.get<{ Params: { slug: string } }>('/reservar/:slug', reservarPage);
    // Enlace de gestión de una cita (ver, cancelar, mover, eliminar datos): misma página, el token lo procesa el cliente.
    app.get<{ Params: { slug: string } }>('/reservar/:slug/gestion/:token', reservarPage as never);
    // Enlace personal de la lista de espera (Fase 4): igual, el token lo procesa el cliente.
    app.get<{ Params: { slug: string } }>('/reservar/:slug/espera/:token', reservarPage as never);
    // Enlace firmado para reseñar una cita completada (Fase 4).
    app.get<{ Params: { slug: string } }>('/reservar/:slug/resena/:token', reservarPage as never);
    // Enlace directo a un artículo (Fase 2): la página del negocio con su detalle abierto. Si ese artículo NO se ve en la página
    // moderna, al catálogo de siempre, que muestra todo lo publicado (regla única: itemOnPublicPage, sin bucles).
    app.get<{ Params: { slug: string; id: string } }>('/reservar/:slug/articulo/:id', async (request, reply) => {
      const { slug, id } = request.params;
      const resolved = isUuid(id) ? await resolveSlug(db, slug.slice(0, 60)) : null;
      if (!resolved || !(await itemOnPublicPage(db, resolved.business.id, id.toLowerCase()))) {
        return redirectTo(reply, `/catalog/${encodeURIComponent(resolved?.business.slug ?? slug)}${isUuid(id) ? `/item/${id.toLowerCase()}` : ''}`);
      }
      const tags = await ogTagsForBooking(request, slug, id.toLowerCase());
      return reply
        .header('Content-Security-Policy', RESERVAR_CSP)
        .header('Cache-Control', 'no-cache')
        .type('text/html; charset=utf-8')
        .send(reservarTemplate.replace('<!--OG_TAGS-->', () => tags));
    });
    // Ingresar, registro, recuperar acceso y "Mi cuenta" (Entrega D): mismo cascarón de la SPA, el cliente decide qué
    // pantalla mostrar según la ruta (ver lib/route.ts). Sin esto, abrir el enlace directo o recargar la página en
    // cualquiera de estas vistas devolvía el 404 JSON de la API en vez de la aplicación.
    app.get<{ Params: { slug: string; view: string } }>('/reservar/:slug/:view', reservarPage as never);
  }

  /* App web (Expo export) con fallback a index.html para las rutas del cliente. */
  if (config.webDir && existsSync(path.join(config.webDir, 'index.html'))) {
    const webDir = config.webDir;
    const indexHtml = readFileSync(path.join(webDir, 'index.html'), 'utf8');
    app.register(fastifyStatic, {
      root: webDir,
      prefix: '/',
      index: false,
      wildcard: false,
      decorateReply: false,
      setHeaders: (res, filePath) => {
        const hashed = filePath.includes(`${path.sep}_expo${path.sep}`) || filePath.includes(`${path.sep}assets${path.sep}`);
        res.header('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.get('/', (_request, reply) => reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(indexHtml));
    return indexHtml;
  }
  return null;
}
