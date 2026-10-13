# Bloqueos y dependencias externas

| # | Dependencia | Qué bloquea | Estado |
|---|---|---|---|
| B1 | Rotar token GHL, token inbox GHL y clave VAPI expuestos (runbook `ROTACION_CREDENCIALES_GHL_VAPI.md`) | Cierre de 01A | Pendiente del operador |
| B2 | Avisar al banco por el IBAN expuesto | Cierre de 01A | Pendiente del operador |
| B3 | Definir `GHL_LEAD_WEBHOOK_SECRET` y `VAPI_WEBHOOK_SECRET` en Railway | Webhooks fail-closed | Pendiente del operador |
| B4 | Verificar titularidad y DNS de `elephantsource.es` (+ CNAME de plataforma) | Subdominios/prueba y verificación de dominios en producción | Pendiente |
| B5 | Autorización específica para `TENANT_MODE=multi` en producción | Activación multiempresa real | Pendiente (la implementación y pruebas avanzan) |
| B6 | Tarifas/catálogo de precios definitivos | Facturación SaaS (Fase 06) | Catálogo parametrizable sin precios |
| B7 | Backup verificado de la BD de producción antes de cualquier migración real | Migraciones en BD reales | Pendiente |
| B8 | Decidir purga del historial git (secretos antiguos) | Higiene del repositorio | Pendiente del operador |
| B9 | Definir `INTEGRATION_KEYS` / `INTEGRATION_ACTIVE_KEY_ID` (32 bytes base64) y `REGISTRY_KEYS` en el entorno de producción | Guardar credenciales de integraciones por tenant | Pendiente del operador |
| B10 | Cliente OIDC del IdP corporativo (issuer, client id, JWKS) y lista de operadores (`CP_OIDC_USERS`) | SSO de Big Elephant CRM | Pendiente del operador |
| B11 | Elegir proveedor de pagos (adaptador Stripe listo) y tarifas; autorizar `BILLING_CHARGES_ENABLED=true` | Cobros reales | Pendiente (decisión comercial) |
| B12 | Alojamiento del plano de control (`server/controlPlane/main.ts`) y de la SPA del CRM; BD del registro/ERM/CRM/comercial | Poner en marcha el plano de control | Pendiente (coste de infraestructura) |
| B13 | Dominio/remitente de plataforma para correo (`PLATFORM_MAIL_FROM`, SPF/DKIM) | Correo transaccional de tenants sin remitente propio | Pendiente |
| B14 | Extracción de hotel/spa/restaurants a repositorios: requiere plugin de routers tRPC tipado en el cliente | Independencia total de módulos sectoriales | Diseño pendiente (ver DECISIONS) |
