# Segundo overnight — Big Elephant Admin (fase 2)

**Inicio:** 24/10/2026
**Encargo:** completar lo que quedó pendiente del primer overnight ([INFORME_RESULTADOS_OVERNIGHT.md](INFORME_RESULTADOS_OVERNIGHT.md)).
**Informe final:** [INFORME_RESULTADOS_OVERNIGHT_FASE_2.md](INFORME_RESULTADOS_OVERNIGHT_FASE_2.md).

Reglas: PR pequeños; CI → live → production; aislamiento entre empresas y pruebas negativas obligatorias; sin tocar Stripe,
cobros, autoservicio público, IA ni correo comercial; `MAIL_MODE=off` en production; sin invitaciones ni enlaces reales a
Skibox sin autorización expresa.

## Punto de partida (cierre de la tarea anterior)

| Servicio | Publicación ordinaria automática | Estado |
|---|---|---|
| Core | Sí | production en `49ae085b`; el siguiente commit cambia `deploy/` y necesita una ejecución protegida |
| Plano de control | Sí | ídem |
| Pasarela | Sí | ídem |
| CRM | Sí | production en `c48b51d8` (todas las pantallas del primer overnight) |
| Web comercial | Sí (#317) | live en `95938620`; production pendiente de aprobación (run 40087106440) |

Vuelta atrás real de la web en live comprobada: `revertir-web` volvió al despliegue anterior (`a77c3873`) sin compilar y la
web siguió respondiendo 200 (run 40087490477).

## Registro

| Hora | Área | Cambio | PR | Estado |
|---|---|---|---|---|
| 24/10 | Accesos | Prueba E2E de aislamiento con dos empresas reales en MySQL (7 casos: listas, acciones sobre el mismo id, confirmación con correo ajeno, host ajeno, token reutilizado/ajeno/sin firmar/empresa inexistente, permisos, historial) | — | En CI |
