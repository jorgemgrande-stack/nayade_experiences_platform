# Elephant Source — Roadmap maestro

Leyenda de estado: **I** implementado · **T** probado · **M** en main · **D** desplegado · **V** verificado en producción · **A** pendiente de activación externa.

| Fase | Alcance | Estado |
|---|---|---|
| 00 | Auditoría y plan | Completada |
| 01A | Seguridad crítica (kb.json, guards GHL, Redsys, sesiones…) | Completada (rotación de credenciales expuestas: A) |
| 01B | Estabilización: CI, baseline BD, migraciones, pools, health | Parcial (quedan pools de `_core/index.ts`, retirar `runMigrations`) |
| 02 | Multitenancy: registro, resolución, sesiones tid, jobs, aislamiento | Parcial: núcleo I·T·M·D·V en `single`; cachés en curso; falta almacenamiento, cron, arranque |
| 03 | Módulos y licencias | Pendiente |
| 04 | Elephant Resource Manager | Pendiente (interfaz `metering` con sumidero nulo) |
| 05 | Aprovisionamiento | Pendiente (CLI de operador cubre alta manual) |
| 06 | Suscripciones y facturación SaaS | Pendiente (sin tarifas definitivas) |
| 07 | CMS, plantillas, dominios, marketplace | Pendiente (coordinar con Ventana 1) |
| 08 | Operaciones y soporte | Pendiente |
| 09 | Big Elephant CRM | Pendiente |

Documentos relacionados: `EXECUTION_STATE.md` (estado vivo), `DECISIONS.md`, `BLOCKERS.md`.
