# Variables de Entorno — Nayade Experiences Platform

Copia este contenido a un archivo `.env` en la raíz del proyecto y rellena los valores reales.
**NUNCA subas el archivo `.env` a Git.**

```env
# ── Base de Datos ─────────────────────────────────────────────
DATABASE_URL=mysql://user:password@host:3306/nayade_db

# ── Autenticación ─────────────────────────────────────────────
JWT_SECRET=your-super-secret-jwt-key-min-32-chars

# Manus OAuth (solo necesario con Manus OAuth provider)
VITE_APP_ID=your-manus-app-id
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://manus.im
OWNER_OPEN_ID=your-owner-open-id
OWNER_NAME=Your Name

# ── SMTP (Email) ──────────────────────────────────────────────
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=reservas@nayadeexperiences.es
SMTP_PASS=your-smtp-password
SMTP_FROM=reservas@nayadeexperiences.es
ADMIN_EMAIL=admin@nayadeexperiences.es

# ── Redsys (Pasarela de Pago) ─────────────────────────────────
# Entorno: sandbox | production
REDSYS_ENVIRONMENT=sandbox
REDSYS_MERCHANT_CODE=123456789
REDSYS_MERCHANT_KEY=your-redsys-merchant-key
REDSYS_MERCHANT_TERMINAL=001

# ── AWS S3 / Almacenamiento de Archivos ───────────────────────
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=eu-west-1
AWS_S3_BUCKET=nayade-experiences-assets
# Opcional: endpoint S3 compatible (Cloudflare R2, MinIO, etc.)
# AWS_ENDPOINT=https://your-endpoint.r2.cloudflarestorage.com

# ── Manus Built-in APIs (LLM, Storage, Notificaciones) ────────
# Se inyectan automáticamente en entornos Manus.
# Para desarrollo local, déjalos en blanco o usa tus propias claves.
BUILT_IN_FORGE_API_URL=https://api.manus.im/forge
BUILT_IN_FORGE_API_KEY=your-forge-api-key
VITE_FRONTEND_FORGE_API_KEY=your-frontend-forge-api-key
VITE_FRONTEND_FORGE_API_URL=https://api.manus.im/forge

# ── Analytics ─────────────────────────────────────────────────
VITE_ANALYTICS_ENDPOINT=https://analytics.example.com
VITE_ANALYTICS_WEBSITE_ID=your-website-id

# ── GoHighLevel CRM ───────────────────────────────────────────
GHL_API_KEY=your-gohighlevel-api-key
GHL_LOCATION_ID=your-ghl-location-id

# ── Branding ──────────────────────────────────────────────────
VITE_APP_TITLE=Nayade Experiences
VITE_APP_LOGO=https://your-cdn.com/logo.png

# ── Entorno Node ──────────────────────────────────────────────
NODE_ENV=development
```
