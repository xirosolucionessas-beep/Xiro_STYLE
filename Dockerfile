# syntax=docker/dockerfile:1.7
#
# Imagen de producción de la API de Xiro Style (Fase 4). La misma imagen sirve:
#   - la API (/api/…),
#   - el panel web (export de Expo, apps/mobile/dist) y
#   - la página pública de reservas (/reservar, apps/public/dist).
#
#   docker build -t xiro-api .
#   docker run --env-file apps/api/.env.production -p 3000:3000 xiro-api
#
# Multi-etapa: las herramientas de compilación (y los ~1 GB de dependencias de Expo) se quedan en las etapas de build;
# la imagen final solo lleva Node, las dependencias de PRODUCCIÓN de la API y los archivos estáticos ya compilados.
# Corre como el usuario sin privilegios `node` (uid 1000), nunca como root.
#
# Debian slim (glibc), no Alpine: sharp y @node-rs/argon2 traen binarios precompilados para glibc.
# Fijada por versión y digest (no una etiqueta flotante): actualizar ambos a propósito, nunca solo el tag, para que un
# `docker build` repetido no cambie de runtime sin que alguien lo decida. Versión alineada con el aviso oficial de
# seguridad de Node del 21 oct 2026 (TLS, Brotli OOB write/RCE, CA eMudhra comprometida) — ver https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
ARG NODE_IMAGE=node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205

# ---------- 1. Página pública de reservas (Vite) ----------
FROM ${NODE_IMAGE} AS public-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY apps/public/package.json apps/public/
RUN npm ci --workspace @xiro/public --workspace @xiro/shared --include-workspace-root=false --no-audit --no-fund
COPY tsconfig.json ./
COPY packages/shared packages/shared
COPY apps/public apps/public
RUN npm run build --workspace @xiro/public

# ---------- 2. Panel web (export web de Expo) ----------
FROM ${NODE_IMAGE} AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY apps/public/package.json apps/public/
RUN npm ci --workspace @xiro/mobile --workspace @xiro/shared --include-workspace-root=false --no-audit --no-fund
COPY tsconfig.json ./
COPY packages/shared packages/shared
COPY apps/mobile apps/mobile
# Variables públicas que se incrustan en el bundle web (nunca secretos). La web usa su propio origen como API.
ARG EXPO_PUBLIC_SUPPORT_WHATSAPP=""
ENV EXPO_PUBLIC_SUPPORT_WHATSAPP=${EXPO_PUBLIC_SUPPORT_WHATSAPP} CI=1
RUN npm run export:web --workspace @xiro/mobile

# ---------- 3. Dependencias de producción de la API ----------
FROM ${NODE_IMAGE} AS api-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY apps/public/package.json apps/public/
RUN npm ci --workspace @xiro/api --workspace @xiro/shared --include-workspace-root=false --omit=dev --no-audit --no-fund
# Las que npm no puede subir a la raíz quedan dentro de cada paquete: se garantiza que existan para copiarlas.
RUN mkdir -p apps/api/node_modules packages/shared/node_modules

# ---------- 3b. Compilado de la API (esbuild) ----------
# dist/server.js corre con "node" liso en producción: sin tsx (compilador JIT de TypeScript) ni el código fuente
# crudo en la imagen final. --packages=external deja TODAS las dependencias de npm (incluida @node-rs/argon2 y sharp,
# que traen binarios nativos) tal cual en node_modules; solo se agrupa el código propio (src/ + packages/shared/src),
# que es donde vivían los imports relativos sin extensión (válidos para tsx/el bundler, no para "node" con módulos
# ESM planos). dist/worker.js es el hilo de exportaciones (ver src/exports/pool.ts): entrypoint aparte porque
# worker_threads necesita un archivo cargable por su cuenta, no algo inlineado dentro de server.js.
FROM ${NODE_IMAGE} AS api-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY apps/public/package.json apps/public/
RUN npm ci --workspace @xiro/api --workspace @xiro/shared --include-workspace-root=false --no-audit --no-fund
COPY tsconfig.json ./
COPY packages/shared/src packages/shared/src
COPY apps/api/src apps/api/src
COPY apps/api/scripts/build.mjs apps/api/scripts/build.mjs
RUN npm run build --workspace @xiro/api

# ---------- 4. Imagen final ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/app/apps/api/data \
    WEB_DIR=/app/apps/mobile/dist \
    PUBLIC_WEB_DIR=/app/apps/public/dist
WORKDIR /app
COPY --from=api-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=api-deps --chown=node:node /app/package.json ./package.json
COPY --from=api-deps --chown=node:node /app/apps/api/node_modules apps/api/node_modules
COPY --from=api-deps --chown=node:node /app/packages/shared/node_modules packages/shared/node_modules
# apps/api/package.json: SOLO para que Node sepa que dist/server.js es ESM ("type":"module"); ya no se lee nada más
# de él en runtime. Ni packages/shared/src ni apps/api/src van en esta imagen: @xiro/shared y todo el código propio
# quedaron agrupados DENTRO de dist/*.js en la etapa "api-build" (ver scripts/build.mjs) — el resto de node_modules
# de arriba son las dependencias de npm reales (externas al empaquetado: sharp, @node-rs/argon2, fastify…).
COPY --chown=node:node apps/api/package.json apps/api/package.json
COPY --from=api-build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --chown=node:node apps/api/drizzle apps/api/drizzle
COPY --chown=node:node apps/api/public apps/api/public
COPY --from=web-build --chown=node:node /app/apps/mobile/dist apps/mobile/dist
COPY --from=public-build --chown=node:node /app/apps/public/dist apps/public/dist
# Única carpeta escribible (imágenes en modo local; en producción van a S3/R2).
RUN mkdir -p /app/apps/api/data && chown node:node /app/apps/api/data
USER node
WORKDIR /app/apps/api
EXPOSE 3000
# Liveness: el proceso responde (no depende de la base de datos; la readiness es /api/health/ready).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Node como PID 1 atiende SIGTERM (server.ts cierra ordenadamente). `--init` en `docker run` agrega un init mínimo si se quiere.
# dist/server.js: empaquetado en la etapa "api-build" (sin tsx ni TypeScript crudo en esta imagen — ver scripts/build.mjs).
CMD ["node", "dist/server.js"]
