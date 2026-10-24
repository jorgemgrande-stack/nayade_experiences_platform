# Tercer overnight — Big Elephant Admin (fase 3)

**Inicio:** 24/10/2026, 16:15 UTC
**Encargo:** completar el ~40 % pendiente tras la fase 2 ([INFORME_RESULTADOS_OVERNIGHT_FASE_2.md](INFORME_RESULTADOS_OVERNIGHT_FASE_2.md)).
**Informe final:** [INFORME_RESULTADOS_OVERNIGHT_FASE_3.md](INFORME_RESULTADOS_OVERNIGHT_FASE_3.md).

Reglas: bloques pequeños (CI → live → production); aislamiento y pruebas negativas; sin tocar Stripe, cobros, correo comercial
ni Náyade; `MAIL_MODE=off` en production; aprobación solo para lo protegido.

## Punto de partida

| Elemento | Estado |
|---|---|
| Production | Core/CP `28e53eca`, pasarela `923edc6d` (`/_ops` cerrado) |
| Resource Manager en production | Sin medición: el Core no tiene `ERM_DATABASE_URL` |
| `*.live.bigelephant.es` | DNS verificado y activado; certificado pendiente de Railway desde las 15:00 |
| Prueba intermitente | `crm.mysql.test.ts` › solicitudes web (falló en #328) |

## Registro

| Hora (UTC) | Área | Cambio | PR | Estado |
|---|---|---|---|---|
| 16:40 | Resource Manager | Procedimiento de la base de medición `es_erm` (erm-setup, referencias, acción `medicion-preparar`) | #329 | En CI |
| 16:55 | Estabilidad | Causa real de la prueba intermitente: carrera entre réplicas con la misma clave → «replayed» | #330 | En CI |
