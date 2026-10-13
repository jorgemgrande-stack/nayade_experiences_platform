# Elephant Source — Roadmap maestro

Leyenda de estado: **I** implementado · **T** probado · **M** en main · **D** desplegado · **V** verificado en producción · **A** pendiente de activación externa.

| Fase | Alcance | Estado |
|---|---|---|
| 00 | Auditoría y plan | Completada |
| 01A | Seguridad crítica (kb.json, guards GHL, Redsys, sesiones…) | Completada (rotación de credenciales expuestas: A) |
| 01B | Estabilización: CI, baseline BD, migraciones, pools, health | Parcial (quedan pools de `_core/index.ts`, retirar `runMigrations`) |
| 02 | Multitenancy: registro, resolución, sesiones tid, jobs, aislamiento, cachés, ficheros, cron, arranque | Núcleo I·T·M·D (en `single`); activación `multi` pendiente de autorización |
| 03 | Módulos y licencias | I·T·M·D: contrato, registro, licencias en servidor, SDK y cargador de módulos externos, plantilla; extracción de hotel/spa/restaurants pendiente (plugin tRPC) |
| 04 | Elephant Resource Manager | I·T·M·D (medición, agregación, cuotas, limitadores, enforcement real) |
| 05 | Aprovisionamiento | I·T·M·D (E2E con MySQL real) |
| 06 | Suscripciones y facturación SaaS | I·T·M·D; adaptador Stripe listo con cobros apagados (doble candado); proveedor y tarifas pendientes |
| 07 | CMS, plantillas, dominios, marketplace | I·T·M·D: plantillas, tema/marca por tenant, sitio neutro, dominios, SEO, navegación por módulos; marketplace pendiente |
| 08 | Operaciones y soporte | I·T·M·D: migraciones, diagnóstico, copias verificadas, soporte delegado, métricas, alertas, incidencias y retención |
| 09 | Big Elephant CRM | I·T: API + CRM comercial + SSO + SPA (repo propio); despliegue pendiente |

Documentos relacionados: `EXECUTION_STATE.md` (estado vivo), `DECISIONS.md`, `BLOCKERS.md`.
