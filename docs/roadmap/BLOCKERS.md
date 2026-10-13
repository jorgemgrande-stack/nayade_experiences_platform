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
