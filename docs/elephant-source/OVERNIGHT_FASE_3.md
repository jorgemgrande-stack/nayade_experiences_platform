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
| 17:05 | Dominios | Causa real del certificado de `*.live.bigelephant.es`: Railway exige un TXT de propiedad (`_railway-verify.live`) que no figura en su lista de registros DNS. Herramienta que lo muestra y lo exige | #331, #337 | Pendiente del TXT (Jorge) |
| 17:10 | Resource Manager | Métricas por empresa con procedencia (medida/calculada/no disponible); tamaño de BD y usuarios desde la base de la empresa | #332, CRM #55 | Fusionado |
| 17:20 | Informes | Informes comerciales por periodo (hora de Madrid), calidad de datos y CSV sin datos de contacto ni fórmulas | #333 | Fusionado |
| 17:25 | Módulos | Licencias idempotentes en una transacción, auditoría completa, empresas por módulo | #334, CRM #54 | Fusionado |
| 17:30 | Ficha 360° | Integraciones sin secretos (estado, campos obligatorios, conexión «no comprobada») | #335, CRM #56 | En CI |
| 17:35 | CRM | Pantallas: integraciones, empresas por módulo, informes con exportación | CRM #56 | Fusionado |
| 17:40 | Medición | Orden del paso de medición en el workflow (fallaba «Falta --sha» en live) | #336 | En CI |
| 17:45 | Seguridad | Pruebas negativas en production: 13 rutas del plano de control → 401; hosts de empresa sin `/_ops`, sin ficheros ni API internas | — | Verificado en production |
| 17:50 | Experiencia de usuario | Recorrido real de 34 rutas en escritorio y móvil: sin errores de consola ni peticiones fallidas; 4 problemas (desbordes en móvil, contraste en el alta, campos sin etiqueta, ruta inexistente) | — | Corrección en curso |
