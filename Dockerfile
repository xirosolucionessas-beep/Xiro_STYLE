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
# En producción conviene fijar la imagen base por digest (node:24-bookworm-slim@sha256:…) y actualizarla a propósito.
ARG NODE_IMAGE=node:24-bookworm-slim

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
COPY --chown=node:node packages/shared/package.json packages/shared/package.json
COPY --chown=node:node packages/shared/src packages/shared/src
COPY --chown=node:node apps/api/package.json apps/api/tsconfig.json apps/api/
COPY --chown=node:node apps/api/src apps/api/src
COPY --chown=node:node apps/api/drizzle apps/api/drizzle
COPY --chown=node:node apps/api/public apps/api/public
COPY --chown=node:node apps/api/scripts apps/api/scripts
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
CMD ["node", "--import", "tsx", "src/server.ts"]
