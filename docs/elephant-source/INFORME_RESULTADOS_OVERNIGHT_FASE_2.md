# Informe de resultados — segundo overnight de Big Elephant Admin

**Fecha:** 24/10/2026
**Encargo:** completar lo pendiente del primer overnight ([INFORME_RESULTADOS_OVERNIGHT.md](INFORME_RESULTADOS_OVERNIGHT.md), ~30 %).
**Registro de trabajo:** [OVERNIGHT_FASE_2.md](OVERNIGHT_FASE_2.md).

## Cómo leer los estados

| Estado | Significado |
|---|---|
| **TERMINADO** | Implementado, probado y verificado (se indica el entorno) |
| **PARCIAL** | Funciona una parte; faltan elementos relevantes |
| **BLOQUEADO** | Depende de una aprobación, credencial o decisión concreta |
| **SIN INICIAR** | No se ha desarrollado |

**Entornos:**
- **live:** los servicios de pruebas en Railway, comprobados con su API real y con credenciales de operador de live.
- **production:** `admin.bigelephant.es` y `*.app.bigelephant.es`. En esta sesión **no hay credenciales de operador de production**. Allí se verifica con lo que no exige sesión:
  - el registro de la ejecución protegida;
  - la salud;
  - el paquete del CRM servido;
  - pruebas negativas sin efectos.
  Nada se marca «verificado en production» si solo se probó en live.

---

## 1. Resumen ejecutivo

**Qué está publicado y funcionando en production:**
- Core, plano de control y pasarela en `28e53eca`, con la ejecución protegida `aplicar-production` (run 40103107117):
  - copia previa;
  - CRM `0024` aplicada;
  - empresas `0014` en las 7, en el orden canario → Skibox → resto;
  - salud de `app.bigelephant.es` y Skibox: 200.
- CRM de production con todas las pantallas nuevas. Están en el paquete de `admin.bigelephant.es`:
  - Cerrar sesiones;
  - Coste atribuible;
  - Reanudar alta;
  - tareas con responsable;
  - Capacidades;
  - aviso de dominio;
  - historial de la prueba.
- Web comercial en production con Node 22.23.4 (run 40087106440).

**Avances de la fase:**
1. **Cerrar las sesiones de un usuario** sin desactivarlo: migración `0014`, E2E con dos empresas reales y verificación en live. En production está la migración y el código, y el canal está activo (prueba negativa: 401 con un token falso).
2. **Aislamiento de Accesos demostrado** con dos bases de datos reales (8 casos, incluidos los negativos).
3. **Operación SaaS:** 6 de 7 bloques pendientes conectados a la API real.
4. **Tareas comerciales con responsable y prioridad.** Ciclo completo verificado en live: alta, filtro, edición, hecha y 409 al editar una hecha.
5. **Coste atribuible por empresa.** Verificado en live con una estimación declarada como tal. En production no se mide (falta la base del ERM: es un bloqueo).
6. **Web comercial completa en la administración:** capacidades y comparación entre versiones («Cambios sin publicar», «Comparar»).
7. **Subdominios automáticos en live resueltos con la arquitectura original:**
   - `*.live.bigelephant.es` en la pasarela compartida;
   - DNS verificado contra Railway;
   - `CP_PLATFORM_DOMAINS` activado;
   - las 3 empresas de prueba con su dominio nuevo.
   El certificado comodín sigue en emisión por parte de Railway (sección 4).
8. **Cinco fallos reales del procedimiento detectados y corregidos** (sección 7). Uno habría dejado production sin migrar.

---

## 2. Tabla por áreas

| Área | Antes | Después | Funcionalidad implementada | Pruebas | Production | Pendiente | Estado |
|---|---|---|---|---|---|---|---|
| Accesos: aislamiento | Sin prueba con dos bases | E2E con dos empresas reales | Banco de pruebas con el canal real plano de control → Core | 8 casos E2E en MySQL (CI) | Canal activo (`SUPPORT_JWT_SECRET` en el Core y el plano de control; 401 con un token falso) | Ver la lista de Skibox en la pantalla (requiere sesión de operador de production) | **TERMINADO** (CI y live); production: canal activo |
| Accesos: cerrar sesiones | No existía | Acción y botón | `0014`, `revoke` en `/_ops/access` y en `/cp/v1/tenants/:id/access/users/:uid/revoke`, fecha del último cierre | E2E (A cerrada, B intacta, A vuelve a entrar); unitarias; live: 200, `sessionsRevokedAt` truncado al segundo, historial `access.revoke` | Migración `0014` en las 7 empresas; código y pantalla desplegados | Usarlo con Skibox (no se ha tocado a ningún usuario real) | **TERMINADO** en live · desplegado en production |
| Alta de empresas | Asistente sin recorrido real | Recorrido real en live; subdominios automáticos | Aviso `subdomainsRoutable`; comodín `*.live.bigelephant.es`; dominios de las empresas de prueba | Alta real en live (empresa, contacto, plataforma en 14 s, prueba de 15 días, esquema al día, invitación retenida por el sandbox); `/crm/onboarding/config` en live → `live.bigelephant.es`, `subdomainsRoutable: true` | El dominio de production ya funcionaba (`*.app.bigelephant.es`); no se ha creado ninguna empresa real | Certificado comodín de live en emisión; repetir el alta con su subdominio por HTTPS | **PARCIAL** (falta el certificado) |
| Operación SaaS | 7 bloques «Pendiente del plano de control» | 6 conectados | Límite de usuarios, historial y control de la prueba, listado global de altas, reanudar alta, solicitudes por empresa | CRM: 142 pruebas; live: `/provisioning?status=failed` → 200 | Pantalla desplegada | Listado de eventos de Stripe (la API solo da recuentos) | **PARCIAL** (6/7) |
| Tareas comerciales | Sin responsable ni prioridad | Completas | CRM `0024`; `PATCH /crm/tasks/:id`; filtros por responsable (`none`) y prioridad; «Mis tareas» | Servicio, API (400/401/403/404), MySQL real; live: ciclo completo | `0024` aplicada; pantalla desplegada | — | **TERMINADO** en live · desplegado en production |
| Resource Manager: costes | Solo métricas | Coste atribuible por empresa | `GET /cp/v1/resources/costs`; panel 7/30/90 días; estimación declarada o `ERM_COST_MODEL` | 19 pruebas; live: importes reales de 3 empresas | **Sin medición**: el Core de production no tiene `ERM_DATABASE_URL` | Base del ERM en production; tarifas reales; medir almacenamiento y BD | **PARCIAL** · production **BLOQUEADO** |
| Web comercial | Sin capacidades ni comparación | Completa | Capacidades (lista, edición, alta, coherencia); diferencias entre versiones y cambios sin publicar | CRM: 169 pruebas | Desplegado (CRM) | — | **TERMINADO** |
| Publicación continua | Sin la web | 5 servicios | Web en la cadena; vuelta atrás de la web probada | `revertir-web` real en live | Web en production | — | **TERMINADO** |
| Migraciones en la publicación | Se daban por aplicadas con la imagen anterior | Imagen del commit y comprobación | Despliegue de `restore-drill` antes de migrar; `drill --expect-sha` | Prueba de regresión; live recuperado; **production migrada con el procedimiento nuevo** | Verificado en `aplicar-production` | — | **TERMINADO** |
| Seguridad de la pasarela | `/_ops/*` accesible desde internet | 404 en la pasarela | Bloque `@internal` en el Caddyfile | Caddy real (404 público, 401 protegido, salud 200); prueba de regresión | Desplegado (`desplegar-core-gateway`, run 40107596894, aprobado): `/_ops/access` → 404 en Skibox, la demo y `app`; `login` y `admin` → 200 | — | **TERMINADO** (live y production) |
| Ficha 360° | Resumen, copias, comunicaciones, auditoría | Sin cambios | — | — | Desplegada | Integraciones, salud técnica y facturación unificadas | PARCIAL |
| Dashboard | Sección Clientes SaaS | Sin cambios | — | — | Desplegado | — | TERMINADO |
| Comercial: panel, leads, pipeline, empresas y contactos | Funcional | Sin cambios | — | — | Desplegado | Informes comerciales | PARCIAL |
| Contratos y contrataciones | Funcional | Sin cambios (no se ha tocado Stripe) | — | — | Desplegado | — | PARCIAL |
| Módulos y licencias | Licencias por capacidad | Sin cambios | — | — | Desplegado | Activación y compra de módulos por el operador con su flujo económico | SIN INICIAR (en esta fase) |
| Operadores centrales | Con MFA | Sin cambios | — | — | Desplegado | — | Sin cambios |
| Tickets y soporte delegado | Verificado en live | Sin cambios | — | — | Desplegado | — | Sin cambios |
| Experiencia de usuario (P2) | — | Avisos comprensibles en lugar de errores técnicos (dominio, Operación, 502 de Accesos) | — | — | — | Revisión general | SIN INICIAR (como bloque) |

---

## 3. Accesos y Skibox

- **Aislamiento** (`server/accesosAislamiento.e2e.mysql.test.ts`, CI): dos empresas creadas por el flujo público, cada una con su base de datos, y un empleado con el mismo id (100) en las dos. Se comprueba:
  - cada lista contiene solo sus usuarios;
  - desactivar o reactivar el usuario 100 de A no toca al usuario 100 de B;
  - un envío a A con el correo de B se rechaza (`confirm_mismatch`) sin crear enlaces;
  - la empresa sale del token firmado: con el host de B no cambia nada;
  - un token reutilizado da 409; uno de otro secreto o sin firmar, 401; uno de una empresa inexistente, 404;
  - sin `support:write` la respuesta es 403;
  - el historial de cada empresa solo recoge lo suyo y no guarda correos;
  - cerrar las sesiones del 100 de A no cierra las del 100 de B, y A puede volver a entrar.
- **Skibox (`t5-skibox`) en production:**
  - Tiene la migración `0014`.
  - El Core y el plano de control tienen `SUPPORT_JWT_SECRET`.
  - El canal rechaza un token falso con 401, así que está montado y con el secreto.
  - La pestaña Accesos está en el CRM de production.
  - **No se ha podido abrir la lista de Skibox**: requiere una sesión de operador de production con MFA, que esta sesión no tiene.
- No se han enviado invitaciones ni enlaces, no se han fijado contraseñas y no se ha cerrado ninguna sesión de usuarios reales. La única revocación real se hizo en la empresa de prueba de live.

## 4. Dominios de las empresas en live

**Causa exacta del 404:**
- En live, `CP_PLATFORM_DOMAIN=up.railway.app`, así que el alta asignaba `<empresa>.up.railway.app`.
- Railway solo enruta los dominios dados de alta en un servicio. La respuesta lleva `x-railway-fallback: true`: la petición nunca llegaba a la pasarela.
- En `up.railway.app` no caben comodines.

**Solución, con la arquitectura original:**
- un despliegue compartido;
- una base de datos por empresa;
- subdominios automáticos;
- resolución del tenant por host;
- certificado comodín;
- ningún servicio por cliente.

| Paso | Resultado |
|---|---|
| `*.live.bigelephant.es` en `core-gateway` de live (run 40103055188) | Hecho |
| DNS: `*.live` → `pji3td3w.up.railway.app` y `_acme-challenge.live` → `pji3td3w.authorize.railwaydns.net` (valores de la API de Railway) | Creado por Jorge (sin acceso por API al proveedor); verificado en el servidor autoritativo: PROPAGATED |
| `CP_PLATFORM_DOMAINS=live.bigelephant.es,up.railway.app` (run 40105089773) | Hecho; el alta de live ofrece `live.bigelephant.es` con `subdomainsRoutable: true` |
| Dominios `<empresa>.live.bigelephant.es` de las 3 empresas de prueba (`dominios-app.cjs --apply`) | Registrados y activos; se conservan los anteriores |
| Certificado comodín | **Pendiente de Railway** (24/10, 15:52 UTC): «validando la propiedad» desde las 15:00, con el DNS correcto en el servidor autoritativo y en los resolvedores públicos y sin CAA; mientras tanto Railway sirve su certificado genérico. Configuración idéntica a `*.app.bigelephant.es`, que funciona. No se recrea el dominio: cambiaría los destinos y obligaría a tocar el DNS otra vez |

Runbook actualizado: [DOMINIOS_LIVE.md](../runbooks/DOMINIOS_LIVE.md).

## 5. Resource Manager y costes

- **Fórmula:** consumo medido × tarifa (tráfico saliente, tiempo de servidor de peticiones y de tareas, correo y exportaciones) + parte del coste fijo compartido, repartida por peticiones.
- **Tarifas:** sin `ERM_COST_MODEL`, se usa una **estimación** con precios públicos de Railway y Postmark, sin coste fijo. La pantalla lo dice.
- **Live (30 días):** `cms-prueba-a` 9,18 céntimos, de los que 8,96 son correo; `cms-prueba-b` 0,11 céntimos; `alta-guiada` 0,01 céntimos.
- **Production:** sin medición.
  - El Core no tiene `ERM_DATABASE_URL`, así que el #309 no serviría todavía. Está documentado en el PR.
  - Hace falta crear la base del ERM en production, que es infraestructura protegida.
- **No es control de costes:** no hay límites de coste ni margen por cliente, y no se mide el almacenamiento, el tamaño de la base de datos, la CPU ni la memoria por empresa.

## 6. Production: qué está realmente desplegado

| Servicio | Versión | Cómo | Comprobado |
|---|---|---|---|
| Plano de control, Core y pasarela | `28e53eca` | `aplicar-production` (run 40103107117, aprobado) | Despliegues SUCCESS; `app.bigelephant.es` y `skibox.app.bigelephant.es/login` → 200 |
| Migraciones de las empresas | `0014` en las 7 (canario, Skibox y resto) | Ídem, con `restore-drill` de `28e53eca` | Registro: «migrated»/«up_to_date», `0014_user_sessions_revoked` |
| Migraciones del CRM | `0024` (24 aplicadas, 0 pendientes) | Ídem | Registro |
| CRM | Integración con todas las pantallas de la fase | Publicación ordinaria automática | Paquete de `admin.bigelephant.es`: las 8 cadenas nuevas presentes |
| Web comercial | `95938620`, Node 22.23.4 | `desplegar-web` (run 40087106440) | `www.bigelephant.es` → 200 |
| Pasarela sin `/_ops` | `923edc6d` (`core-gateway`) | `desplegar-core-gateway` (run 40107596894, aprobado); en live, también las pasarelas de prueba `gw-prueba-a/b` (`preparar-pruebas-live`, run 40107730909) | `/_ops/access` → 404 desde internet; Skibox `/login`, `app` y `admin` → 200; Accesos legítimo (red interna) → 200 en live |
| Medición (Resource Manager) | — | — | No configurada (bloqueo) |

## 7. Incidencias encontradas y corregidas

| Incidencia | Efecto | Corrección |
|---|---|---|
| Migraciones con la imagen anterior de `restore-drill` | Live «aplicó» 0 migraciones (`0014`, `0024`) y Accesos dio 502. **Habría pasado igual en production** | #326: desplegar `restore-drill` con el commit antes de migrar y `--expect-sha`. Live recuperado; production migrada con el procedimiento corregido |
| Una espera agotada en la publicación terminaba sin volver atrás | En live quedó el plano de control nuevo y el Core sin desplegar (versiones compatibles, sin daño) | #326: se cancela el despliegue en curso y se vuelve atrás |
| `TIMESTAMP` redondea los segundos | Rechazo intermitente de un inicio de sesión legítimo justo después de cerrar las sesiones | #323: segundo truncado |
| `/_ops/access` accesible desde internet | Superficie innecesaria (no explotable: token firmado de un solo uso) | #327: 404 en la pasarela |
| Subdominios de live inaccesibles | Altas de live con 404 | #324, #325 y DNS (sección 4) |
| Fallo transitorio de Railway (`2441e101`) | Vuelta atrás automática | Republicado sin cambios |

## 8. Cambios

**Core** (`nayade_experiences_platform`, `integration/elephant-source`), fusionados:

| PR | Contenido |
|---|---|
| #319 | Aislamiento de Accesos (E2E) |
| #320 | Cerrar sesiones (`0014`) |
| #321 | Tareas con responsable y prioridad (CRM `0024`) |
| #322 | Costes por empresa |
| #323 | Revocación con el segundo truncado |
| #324 | Aviso de dominio sin comodín |
| #325 | Procedimiento del comodín de live |
| #326 | Migraciones con la imagen del commit, espera agotada con vuelta atrás y diagnóstico en `aplicar-production` |
| #327 | `/_ops/*` cerrado en la pasarela |

**Abierto:** #309 (medición en production), bloqueado por la base del ERM.

**CRM** (`big-elephant-crm`), fusionados:

| PR | Contenido |
|---|---|
| #47 | Cerrar sesiones |
| #48 | Operación SaaS |
| #49 | Tareas |
| #50 | Costes |
| #51 | Capacidades |
| #52 | Aviso de dominio |
| #53 | Diferencias entre versiones |

**Migraciones:**
- empresas: `0014_user_sessions_revoked`, aplicada en live y en production;
- CRM: `0024_crm_task_assignment`, aplicada en live y en production.

Las dos son aditivas y tienen reversión.

**Variables** (solo nombres): `CP_PLATFORM_DOMAINS` en el plano de control de live. `ERM_COST_MODEL` es opcional y no está configurada.

**Infraestructura de live:**
- dominio comodín `*.live.bigelephant.es` en `core-gateway`;
- dos registros DNS creados por Jorge.

## 9. Respuestas obligatorias

1. **Porcentaje del encargo global completado: alrededor del 60 %.**
   - Hecho: Accesos (con aislamiento y cierre de sesiones), alta (live a falta del certificado), Operación SaaS (6/7), tareas, administración web completa y publicación robusta.
   - Pendiente: módulos y licencias, informes comerciales, la ficha 360° unificada, la medición en production y la revisión de experiencia de usuario.
2. **Avance adicional respecto al 30 % anterior: unos 30 puntos.**
3. **Nuevas funcionalidades en production** (desplegadas; la parte que exige sesión de operador no se ha comprobado allí):
   - cerrar sesiones de un usuario en Accesos;
   - Accesos de Skibox (canal activo);
   - Operación SaaS con listado global de altas, reanudar alta, historial y control de pruebas, límite de usuarios y solicitudes por empresa;
   - tareas con responsable y prioridad;
   - capacidades y comparación de versiones en la web comercial;
   - aviso de dominio en el alta.
   El coste atribuible está desplegado, pero en production dice «Medición no configurada».
4. **Partes incompletas:**
   - listado de eventos de Stripe;
   - medición y costes en production;
   - ficha 360° (integraciones, salud técnica, facturación);
   - módulos y licencias (activación por el operador);
   - informes comerciales;
   - revisión de experiencia de usuario.
5. **Operaciones que siguen necesitando herramientas técnicas:**
   - crear la base del ERM en production;
   - configurar las tarifas reales de costes (`ERM_COST_MODEL`);
   - cambios de DNS;
   - migraciones (vía GitHub Actions, no desde Admin);
   - archivar o borrar empresas de prueba (doble aprobación manual).
6. **Migraciones o aprobaciones pendientes:**
   - la creación de la base del ERM de production, con su procedimiento protegido;
   - el #309 después de lo anterior.
   No queda ninguna migración de esquema pendiente.
7. **Cinco mejoras prioritarias:**
   1. Medición en production (base del ERM y #309) y tarifas reales.
   2. Verificar Accesos de Skibox en production con una sesión de operador y dejar una comprobación automática con un operador técnico de solo lectura.
   3. Módulos y licencias gestionados por el operador.
   4. Ficha 360° con salud técnica, integraciones y facturación.
   5. Listado de eventos de Stripe en Operación (en la ventana de Stripe) e informes comerciales.
8. **¿Preparados para administrar clientes SaaS reales desde Big Elephant Admin? En lo operativo, sí, con dos reservas:**
   - Sí: altas, accesos con aislamiento probado, cierre de sesiones, operación de pruebas y altas, tareas y web comercial.
   - Reserva 1: el control de recursos y costes no funciona en production.
   - Reserva 2: la gestión de módulos depende de operaciones técnicas.
9. **Qué impide considerar Elephant Source plenamente preparado para comercializarse:**
   - la medición y el control de costes en production;
   - la gestión de módulos por el operador;
   - la verificación funcional en production con sesión de operador;
   - las decisiones ya identificadas fuera de esta fase (fiscalidad y cobros reales, que no se han tocado).
