# ============================================================
# Dockerfile — Nayade Experiences Platform
# Build multi-stage: compila cliente Vite + servidor Node.js
# ============================================================

# ─── Etapa 1: Build ───────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Instalar pnpm
RUN npm install -g pnpm

# Copiar manifiestos de dependencias
COPY package.json pnpm-lock.yaml* ./

# Instalar dependencias (incluyendo devDependencies para el build)
RUN pnpm install --frozen-lockfile

# Copiar todo el código fuente
COPY . .

# Build del cliente Vite y del servidor TypeScript
RUN pnpm build

# ─── Etapa 2: Producción ──────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

RUN npm install -g pnpm

# Solo dependencias de producción
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod

# Copiar artefactos del build
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

# Directorio para almacenamiento local de fallback
RUN mkdir -p /tmp/local-storage

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
