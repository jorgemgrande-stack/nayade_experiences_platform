# Informe técnico y ejecutivo (corte 2026-10-14)

> Corte intermedio de la ejecución autónoma. El trabajo continúa; este documento refleja lo comprobado hasta la fecha.

## A. Resumen ejecutivo

Elephant Source Core dispone de un **núcleo multiempresa completo, probado y desplegado en modo inactivo** (`TENANT_MODE=single`): registro de tenants, resolución por dominio, sesiones ligadas al tenant, aislamiento de cachés/ficheros/jobs, licencias de módulos, Resource Manager con cuotas reales, aprovisionamiento automático, motor de suscripciones, operaciones (migraciones por tenant, diagnóstico, copias verificadas), soporte delegado y un **plano de control** versionado. Existe además un repositorio propio para **Big Elephant CRM** con una primera SPA operativa. Producción no ha cambiado de comportamiento y sus sondas son correctas tras cada despliegue.

Lo que **no** está hecho o activado: la activación multiempresa real en producción (requiere autorización y registro desplegado), la facturación contra un proveedor real y tarifas definitivas, el tema/marca del cliente público por tenant en la UI, la extracción física de módulos sectoriales a repositorios propios y el CRM comercial (leads, tickets).

## B. Estado del roadmap

| Fase | Estado | Detalle |
|---|---|---|
| 00 Auditoría | Completada | |
| 01A Seguridad crítica | Completada | Rotación de credenciales expuestas pendiente del operador (B1–B3) |
| 01B Estabilización | Parcial | CI con suites bloqueantes; pools consolidados salvo DDL de arranque en modo single; RBAC de producción sin tablas (no se crean sin siembra/backup) |
| 02 Multitenancy | Implementada y probada; no activada | Registro, middleware, `tid`, cachés, SSE, ficheros, cron, arranque por modo, SEO, correo e integraciones por tenant |
| 03 Módulos y licencias | Implementada; extracción pendiente | Manifiestos incorporados (cms, commerce, tpv, hotel, spa, restaurants), guardas HTTP/tRPC, migraciones por módulo |
| 04 ERM | Implementada y probada | Medición, agregación, cuotas, limitadores, enforcement en almacenamiento/correo/IA, métricas Prometheus |
| 05 Aprovisionamiento | Implementada y probada | E2E con MySQL real (152 tablas), reanudación, compensación |
| 06 Suscripciones | Implementada; proveedor real y tarifas pendientes | Catálogo parametrizable, prueba 15 d, gracia 7 d, webhooks verificados, conciliación |
| 07 CMS/plantillas/dominios | Parcial | 5 plantillas sembradas, verificación de dominios (CNAME+TXT), SEO por tenant; tema del cliente público pendiente |
| 08 Operaciones | Parcial | Migraciones con canario, diagnóstico, copias verificadas, soporte delegado, métricas; alertas y política de retención pendientes |
| 09 Big Elephant CRM | Parcial | API `/cp/v1` + SPA inicial; módulo comercial pendiente |

## C. Código e integración

- Repositorio Core: PR #2–#51 fusionados en `main` (merge commits), desplegados por Railway uno a uno con sondas y revisión de logs.
- Repositorio CRM: `jorgemgrande-stack/big-elephant-crm` (privado), `main` con CI.
- Detalle por componente y rutas: `docs/architecture/ELEPHANT_SOURCE_ARQUITECTURA.md`.

## D. Pruebas

- Suites propias bloqueantes en CI (`core-suites`): unitarias en paralelo + integración con MySQL real en serie (registro, aislamiento, aprovisionamiento, facturación, copias, operaciones, aplicación real en multiempresa).
- Línea base heredada: 18 tests preexistentes fallan (BD real/otros) y tsc conserva sus errores preexistentes; no han empeorado.
- Hallazgos corregidos durante la ejecución: CHECKs sensibles a colación, pruebas del inbox rotas por la consolidación de pools, CC global de Náyade en correo, credenciales de integraciones tomadas del entorno, SEO fijo de Náyade, FK entre suites de integración.

## E. Producción

Desplegado y verificado: todo el código anterior, inactivo en `single`; tareas programadas arrancan; sondas `/healthz`, `/readyz`, `/kb.json`, `/api/redsys/health` = 200 y `/api/ghl/templates` = 401. No se ha modificado infraestructura, variables de Railway ni datos.

## F. Arquitectura

Ver `docs/architecture/ELEPHANT_SOURCE_ARQUITECTURA.md` y `docs/roadmap/DECISIONS.md`. Desviación respecto al diseño inicial: la facturación vive como biblioteca en el repositorio del Core para poder extraerse sin cambios al CRM; el plano de control es un proceso separado del Core.

## G. Seguridad

Mitigado: tenant solo por `Host` validado; sesiones `tid`; DSN cifrado AES-256-GCM con AAD de tenant; sin secretos en logs/auditoría/estado de alta; tokens de servicio solo como hash; soporte temporal y de solo lectura; escape de HTML en SEO; fail-closed ante registro/licencias no verificables.
Pendiente: rotación de GHL/VAPI expuestos (B1), aviso bancario (B2), secretos de webhook (B3); bucket S3 público (el aislamiento por prefijo no es control de acceso del proveedor); credenciales de integraciones por tenant en claro en `system_settings` (cifrado a nivel de campo pendiente).

## H. Costes

Sin servicios nuevos contratados. Previsión al activar: una instancia MySQL para el registro y otra para métricas/comercial, y un servicio para el plano de control.

## I. Bloqueos que requieren al operador

Ver `docs/roadmap/BLOCKERS.md` (B1–B8): rotaciones, titularidad de `elephantsource.es`, autorización de `multi`, tarifas/proveedor de pagos, política de copias.

## J. Próxima ejecución

1. Tema/marca y navegación por módulos en el cliente público (coordinar con Ventana 1).
2. Configuración de integraciones por tenant desde la UI (cifrado de campo).
3. Proveedor de pagos real tras decisión comercial.
4. CRM comercial (leads, oportunidades, tickets) y SSO.
5. Extracción de módulos sectoriales a repositorios propios.
6. Alertas sobre métricas y política de retención/restauración periódica.
