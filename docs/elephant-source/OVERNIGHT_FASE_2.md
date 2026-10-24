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
| Web comercial | Sí (#317) | live y production en `95938620` (Node 22.23.4; run 40087106440 aprobado) |

Vuelta atrás real de la web en live comprobada: `revertir-web` volvió al despliegue anterior (`a77c3873`) sin compilar y la
web siguió respondiendo 200 (run 40087490477).

## Registro

| Hora | Área | Cambio | PR | Estado |
|---|---|---|---|---|
| 24/10 | Accesos | E2E de aislamiento con dos empresas reales en MySQL (listas, acciones sobre el mismo id, correo ajeno, host ajeno, tokens reutilizados/ajenos/sin firmar, empresa inexistente, permisos, historial) | #319 | Fusionado; CI |
| 24/10 | Accesos | Cerrar sesiones de un usuario: migración 0014, acción revoke, botón en el CRM | #320, CRM #47 | Live verificado (API real) |
| 24/10 | Accesos | El segundo de la revocación se trunca (TIMESTAMP redondeaba) | #323 | Live verificado |
| 24/10 | Operación SaaS | 6 de 7 bloques pendientes conectados a la API real | CRM #48 | Live (API) |
| 24/10 | Tareas | Responsable y prioridad (migración CRM 0024), filtros, edición | #321, CRM #49 | Live verificado (alta, filtro, edición, hecha, 409 al editar una hecha) |
| 24/10 | Resource Manager | Coste atribuible por empresa (estimación declarada o ERM_COST_MODEL) | #322, CRM #50 | Live verificado |
| 24/10 | Web comercial | Pestaña Capacidades | CRM #51 | Live (desplegado) |
| 24/10 | Alta de empresas | Alta guiada real en live: funciona; subdominio sin respuesta (up.railway.app). Aviso en el alta | #324, CRM #52 | Live verificado |
| 24/10 | Dominios | Comodín *.live.bigelephant.es en la pasarela compartida; DNS verificado; CP_PLATFORM_DOMAINS activado; dominios de las 3 empresas de prueba | #325 | Hecho; certificado pendiente de Railway |
| 24/10 | Publicación | Migraciones con la imagen de restore-drill del commit (live «aplicaba» 0); espera agotada vuelve atrás; diagnóstico en aplicar-production | #326 | Live recuperado (0014 y 0024 aplicadas) |
| 24/10 | Production | aplicar-production 28e53eca: copia, restore-drill del commit, CRM 0024, 0014 en las 7 empresas, servicios y salud | run 40103107117 | Verificado (registro, salud, paquete del CRM) |
| 24/10 | Seguridad | /_ops/* cerrado en la pasarela (accesible desde internet) | #327 | Live y production verificados (404; Accesos 200) |
