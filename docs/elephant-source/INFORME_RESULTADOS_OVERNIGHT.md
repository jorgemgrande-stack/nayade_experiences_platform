# Informe de resultados del overnight — Big Elephant Admin

**Fecha:** 24/10/2026
**Alcance:** encargo «Evolución integral del backoffice SaaS» (overnight del 23–24/10/2026)
**Naturaleza:** verificación y presentación. No se ha desarrollado nada nuevo para este informe ni se ha tocado production.

Registro de ejecución: [OVERNIGHT_BACKOFFICE.md](OVERNIGHT_BACKOFFICE.md). Protocolo de publicación: [PROTOCOLO_PUBLICACION.md](PROTOCOLO_PUBLICACION.md).

## Cómo leer los estados

| Estado | Significado |
|---|---|
| **Terminado** | Implementado, probado y verificado en el entorno indicado |
| **Parcial** | Una parte implementada y verificada; el resto pendiente |
| **Sin modificar** | No se tocó en el overnight (puede funcionar como antes) |
| **Bloqueado** | Requiere una migración, una aprobación o una decisión humana |

**Entorno verificado:**
- **live** = Railway live (pruebas). Se ha comprobado con su API y en el navegador.
- **prod** = `admin.bigelephant.es`. Se indica si se ha comprobado o solo desplegado.

**Production, en una frase:** el Core, el plano de control y la pasarela están en `f3e2f0c9`, que incluye los cambios del overnight en el backend. **El CRM de production NO tiene ninguna pantalla del overnight.**
- **Cómo se comprobó:** el paquete JavaScript servido por `admin.bigelephant.es` no contiene «Accesos de la empresa», «Versiones y migraciones» ni «Requieren atención»; el de live, sí.
- **Por qué:** el CRM de production se desplegó a mano en el pasado y su versión no es identificable. El despliegue ordinario lo trata como protegido.

---

## 1. Resumen ejecutivo

### Qué se ha conseguido
1. **Accesos de los clientes SaaS** desde Big Elephant Admin:
   - ver los usuarios de cada empresa;
   - enviar el enlace de restablecimiento y reenviar invitaciones;
   - desbloquear, activar y desactivar.
   - Nunca se ven ni se fijan contraseñas, y queda constancia de todo. **Verificado en live.**
2. **Resource Manager con datos reales en live.** El plano de control no tenía la conexión a la base de medición; ahora muestra peticiones, tráfico, tiempo de CPU de tareas y correos por empresa.
3. **Estados de empresa explicados:**
   - el estado operativo, la prueba y la suscripción aparecen por separado;
   - la combinación «En prueba» + «Convertida» se explica;
   - las empresas que necesitan acción se marcan.
4. **Ficha 360°:**
   - resumen por dimensión (estado, prueba, suscripción, dominio, copia, tickets y esquema);
   - copias de seguridad;
   - comunicaciones;
   - auditoría legible.
5. **Dashboard con la sección Clientes SaaS**, **tareas creables** y **alta guiada**.
6. **Versiones de esquema por empresa**: API nueva y vista.
7. **Publicación continua cerrada** (#312): los cambios ordinarios llegan a production **sin aprobación** tras CI y live, verificado con una ejecución real. Lo protegido sigue con aprobación.
8. **Seguridad:** aviso de Node.js del 21/10/2026, con la imagen 22.23.4 fijada (#314, CRM #46).

### Problemas reales eliminados
- El CRM de **live se presentaba como «PRODUCCIÓN»** (CRM #34).
- **«Medición no configurada»** en el Resource Manager de live (#302, #303).
- Tarjetas del resumen 360° **ilegibles** (blanco sobre blanco) (CRM #40).
- Formulario de alta con identificador manual, **módulos separados por comas** y dominio `elephantsource.es` fijo (CRM #39).
- Cada publicación en live hacía **copia y migraciones sin necesidad** (#305).
- Un fallo de construcción **no dejaba ver su motivo** (#308).
- **Prueba inestable** en el CI bloqueante (#310).
- Despliegues ordinarios con **aprobación manual** (#312).

### Qué está en live y qué en production

| | Live | Production (`admin.bigelephant.es`) |
|---|---|---|
| Backend del overnight (Core y plano de control) | Desplegado y verificado | Desplegado (`f3e2f0c9`); **no verificado** con la API (sin credenciales de operador de production en esta sesión) |
| Pantallas del overnight (CRM) | Desplegadas y verificadas en el navegador | **No desplegadas** |
| Resource Manager con datos | Sí | **No** (depende del PR #309 y de su aplicación protegida) |
| Node.js 22.23.4 fijado | Sí | Pendiente de aprobación (run 40077684074) |

---

## 2. Comparativa antes y después

| # | Área | Situación anterior | Cambio realizado | Estado | Entorno verificado |
|---|---|---|---|---|---|
| 1 | Dashboard general | Plataforma, comercial y soporte | Nueva sección **Clientes SaaS** (CRM #38): pruebas activas, por vencer y vencidas; convertidas; suscripciones (modo sombra); copias al día; altas en curso. «Sin permiso» o «no disponible» en lugar de ceros | **Terminado** | live (navegador) |
| 2 | Panel comercial | — | Ninguno | **Sin modificar** | — |
| 3 | Leads y Pipeline | — | Ninguno | **Sin modificar** | — |
| 4 | Empresas y contactos del CRM | — | Ninguno (el alta guiada crea empresa y contacto con las API existentes) | **Sin modificar** | — |
| 5 | Catálogo, contratos, contrataciones, suscripciones | — | Ninguno | **Sin modificar** | — |
| 6 | Tareas comerciales | Lista y «Hecha»; sin alta ni filtros | Alta sobre una empresa, filtros por vencimiento con contadores, búsqueda y enlace a la empresa (CRM #37) | **Parcial** (sin responsable ni prioridad: requiere migración) | live (desplegado; no se creó ninguna tarea real) |
| 7 | Listado de empresas SaaS | Nombre, id, estado, esquema y fecha | Estado operativo, prueba y suscripción por separado, con explicación; orden; «Requieren atención»; próxima renovación (CRM #35) | **Terminado** | live (navegador) |
| 8 | Ficha 360° | 9 pestañas sin resumen | Resumen por dimensión (CRM #36, #40), copias (CRM #41), Comunicaciones (CRM #42), Auditoría legible (CRM #44) | **Parcial** (faltan integraciones, salud técnica, consumo y facturación unificados) | live (navegador) |
| 9 | Pestaña Accesos | No existía | API en Core y plano de control (#301) + pestaña (CRM #33) | **Terminado en live** · Bloqueado en production (CRM no desplegado) · Revocar sesiones: bloqueado (migración) | live (API real y navegador) |
| 10 | Operación SaaS | Pruebas, suscripciones, vencimientos, aprobaciones, errores, alertas | Solo se compartieron las uniones prueba/suscripción con el listado (`tenantStates.ts`) | **Sin modificar** (funcionalmente) | — |
| 11 | Alta guiada | Formulario técnico | Entrada guiada (empresa del CRM existente o nueva → asistente de alta existente) + alta técnica avanzada mejorada (CRM #39) | **Parcial** (no se ejecutó un alta real de punta a punta en el overnight) | live (desplegado) |
| 12 | Módulos de plataforma | — | Ninguno | **Sin modificar** | — |
| 13 | Resource Manager | «Medición no configurada (ERM_DATABASE_URL)» | Plano de control de live conectado a la base del ERM (#302, #303) | **Terminado en live** · Bloqueado en production (#309) | live (API: `/tenants/:id/resources`, `/usage/:id`) |
| 14 | Tickets y soporte | Funcional, sin registros | Sin cambios de código; ciclo completo verificado | **Sin modificar** (verificado) | live (API) |
| 15 | Operadores centrales | — | Ninguno | **Sin modificar** | — |
| 16 | Versiones y compatibilidad | No existía | `GET /cp/v1/platform/versions` (#306), vista Plataforma → Versiones (CRM #43) y diagnóstico con la versión esperada | **Terminado** (esquema por empresa; no incluye versiones de código por servicio) | live (API) |
| 17 | Administración de la web comercial | — | Avisos de coherencia (ver 20) | **Parcial** | live (desplegado) |
| 18 | Páginas y contenidos | — | Ninguno | **Sin modificar** | — |
| 19 | Menús y navegación | — | Ninguno | **Sin modificar** | — |
| 20 | Catálogo comercial, planes y precios | Productos publicados aunque técnicamente estén en hoja de ruta | Aviso por fila y resumen de lo publicado sin disponibilidad completa (CRM #45). No cambia publicación ni precios | **Parcial** | live (desplegado) |
| 21 | Módulos y extensiones comerciales | — | Ninguno | **Sin modificar** | — |
| 22 | Preguntas frecuentes | — | Ninguno | **Sin modificar** | — |
| 23 | SEO | — | Ninguno | **Sin modificar** | — |
| 24 | Formularios | — | Ninguno | **Sin modificar** | — |
| 25 | Publicación y control de versiones (web) | — | Ninguno | **Sin modificar** | — |

---

## 3. Accesos de clientes y Skibox

### Funcionamiento
**Clientes SaaS → empresa → Accesos** (`src/pages/TenantAccess.tsx`, `src/access.ts` del CRM).

**Lista de usuarios:**
- nombre y correo;
- rol en español;
- **propietario**;
- estado activo o desactivado;
- invitación (aceptada, pendiente, caducada);
- último acceso fiable: si solo consta el alta, dice «Sin accesos registrados»;
- bloqueo por intentos fallidos.

Hay búsqueda y filtros (administradores, activos, desactivados, invitación pendiente, bloqueados). La cabecera avisa con «Un solo administrador activo» o «Sin administradores activos».

**Arquitectura:**
- El plano de control **no toca** la tabla de usuarios de la empresa.
- Pide al Core, por la red privada, que ejecute la acción **en el contexto de esa empresa**.
- **Canal:** `POST /_ops/access`.
- **Código:** `server/_core/opsAccess/{token,actions,router}.ts` y `server/controlPlane/tenantAccess.ts`.
- **Rutas:**
  - `GET /cp/v1/tenants/:id/access`;
  - `POST /cp/v1/tenants/:id/access/users/:uid/{reset|invite|unlock|activate|deactivate}`.

### Operaciones del administrador central
| Operación | Qué hace (reutiliza) |
|---|---|
| Enviar restablecimiento | `requestPasswordReset` de la empresa: enlace de un solo uso, 60 min, invalida los anteriores |
| Reenviar invitación | Invitación nueva de 72 h (`resendUserInvite` + `sendInviteEmail`) |
| Desbloquear | Limpia el bloqueo por intentos (`loginThrottle`) |
| Activar / desactivar | `users.isActive`; desactivar corta las sesiones al instante (el Core lo comprueba en cada petición) |

### Protecciones
**Contraseñas y envíos:**
- **Nunca** se muestra, recupera ni fija una contraseña.
- Cada **envío** exige teclear el correo del destinatario; se valida en el servidor (`confirm_mismatch`).
- Cada acción exige **motivo** (5–300 caracteres).

**Permisos:**
- Escritura con el alcance `support:write` (roles soporte y administración).
- El rol comercial solo puede consultar.
- Límite de 20 acciones por minuto y operador.

**Canal con el Core:**
- Token firmado con una **clave derivada** de `SUPPORT_JWT_SECRET`: un token de soporte no sirve aquí.
- Audiencia propia, caducidad de 2 minutos como máximo y **un solo uso** (reutilizarlo da `409 replay`).

**Empresa y usuarios:**
- La empresa sale **del token firmado**, nunca del host ni del navegador.
- Una empresa inexistente o borrada no admite nada (404).
- Reactivar exige plaza libre en el plan (`seat_limit`).

### Registro de actuaciones
Cada acción, **también las rechazadas**, queda en el historial de la empresa (`tenant_events`, solo anexado) como `access.<acción>`. Recoge:
- el usuario afectado (id);
- el motivo;
- el resultado;
- el envío.

No se guardan correos ni tokens. Se ve en la ficha → **Auditoría**, por ejemplo «Accesos: enlace de restablecimiento · usuario #1 · hecho · fuera de la lista de pruebas, sin enlace · motivo: …».

### Comunicaciones desactivadas
- **Con `MAIL_MODE=off`** (production): la acción responde «No enviado: el correo está desactivado» y **no se crea ningún enlace**. La contraseña y los enlaces vigentes no cambian, y el botón aparece deshabilitado con la explicación.
- **En sandbox** (live): si el destinatario no está en la lista autorizada, responde `sandbox_blocked`, también sin enlace.

### Administrador principal y último administrador
- **Propietario** (`company_owner_email`): **no se puede desactivar** desde aquí (`owner_protected`).
- **Último administrador activo:** no se puede desactivar (`last_admin`).
- No hay acción para cambiar el administrador principal, ni a propósito ni por descuido.

### Revocar sesiones individuales
**No disponible.** Requiere una **migración**: una versión de sesión por usuario en la base de cada empresa y su comprobación en el Core, aplicada por el procedimiento protegido. Mientras tanto, «Desactivar» corta todas las sesiones del usuario.

### ¿Disponible en production? ¿Se puede consultar Skibox?
- **Backend:** desplegado en production (`f3e2f0c9`, run 40074585320) **sin verificar**.
  - No hay credenciales de operador de production en esta sesión: `admin.bigelephant.es/cp/v1/tenants/t5-skibox/access` responde 401 sin sesión.
  - No consta si production tiene `SUPPORT_JWT_SECRET` en el plano de control y el Core. Sin él, la ruta no se monta.
- **Pantalla:** **no** está en production (CRM no desplegado).
- **Skibox (`t5-skibox`): hoy no se puede consultar desde Admin.** Hace falta:
  1. desplegar el CRM en production (`desplegar-crm`, con aprobación);
  2. comprobar que `SUPPORT_JWT_SECRET` existe en el plano de control y el Core de production (diagnóstico `diagnostico-almacenamiento` en production, con aprobación).

No se han enviado correos de recuperación ni se han modificado credenciales.

### Pruebas
- `server/controlPlane/tenantAccess.test.ts`, 11 pruebas:
  - firma, rechazo de otro secreto y del token de soporte;
  - un solo uso;
  - empresa del token y no del host;
  - salvaguardas con código 409;
  - reglas de envío;
  - rutas con permisos;
  - historial sin correos.
- `src/access.test.ts` del CRM, 9 pruebas.
- **Live, API real** (empresa de prueba A), con constancia de todo en `tenant_events`:

| Caso | Resultado |
|---|---|
| Desactivar a la persona propietaria | `409 owner_protected` |
| Envío sin confirmar el correo | `400 confirm_required` |
| Envío con otro correo | `409 confirm_mismatch` |
| Destinatario fuera del sandbox | `200 sandbox_blocked`, sin enlace |
| Desbloquear | `200` |
| Empresa inexistente | `404` |

- **Navegador** (live): pestaña con el propietario, el aviso de un solo administrador, el modo de correo y «Desactivar» deshabilitado para el propietario.

---

## 4. Resource Manager

| | Live | Production |
|---|---|---|
| Medición del Core (escribe en `es_erm`) | Sí | No verificado |
| Plano de control leyendo la medición | **Sí** (#303: `controlplane.ERM_DATABASE_URL = ${{core.ERM_DATABASE_URL}}`) | **No**: «Medición no configurada» |

**Métricas reales por empresa** (comprobadas en live con `GET /cp/v1/usage/:id`):
- `http.request`, `http.request.ms` y `http.response.bytes`;
- `job.run.ms`;
- `email.sent`, que coincide con los correos de prueba enviados;
- en el registro, `data_export.bytes` y `data_export.runs`.

**Límites y alertas** (`/tenants/:id/resources`): uso frente a límite, con estado ok / al límite / excedido. Activos para:
- `email.sent` (diario);
- `http.request` (por minuto);
- `data_export.*`.

El dashboard cuenta las «Empresas con alerta de recursos» (≥ 80 %).

**Sin instrumentación** (siguen en «sin medición»):
- almacenamiento total;
- tamaño de la base de datos;
- usuarios activos;
- trabajos en cola;
- CPU y memoria por empresa;
- mensajería;
- integraciones salientes.

**PR #309:**
- **Qué hace:** permite que `almacenamiento-referencias`, en production y **con aprobación**, ponga la misma referencia en el plano de control de production. Si el Core de production no tiene la variable, se restaura y falla.
- **Estado:** **sin fusionar**, por decisión mía: cambia lo que hace una acción protegida.

**Control de costes: no existe todavía.**
- Hay métricas de uso, pero no hay coste atribuible por empresa: no hay precios por unidad, no se reparte la infraestructura compartida y no hay margen por cliente.
- Faltan también el almacenamiento y la base de datos por empresa, que son los mayores generadores de coste.

---

## 5. Cambios de interfaz

Todas las pantallas siguientes usan **API reales existentes o nuevas**; ninguna es una maqueta.

| Pantalla | Añadido |
|---|---|
| Empresas clientes | Columnas Estado operativo / Prueba gratuita / Suscripción / Próxima renovación; cabeceras ordenables; filtro «Requieren atención»; notas explicativas |
| Ficha de empresa | **Tarjetas de resumen** (enlazan a su pestaña); pestañas **Accesos** y **Comunicaciones**; tarjeta **Copias de seguridad** en Resumen; **Auditoría** con acciones en español, detalles, filtros por área y búsqueda |
| Accesos | Tabla de usuarios, búsqueda, filtros, botones Enviar restablecimiento / Reenviar invitación / Desbloquear / Activar / Desactivar, diálogo con motivo y confirmación del correo |
| Dashboard | Sección «Clientes SaaS» (5 indicadores) |
| Tareas | Botón «Nueva tarea» (formulario validado), filtros con contadores, búsqueda, enlace a la empresa |
| Alta de empresa | Buscador de empresas del CRM, formulario «empresa nueva + administrador», dirección sugerida; «Alta técnica (avanzado)» con identificador sugerido y comprobado y módulos por casillas |
| Plataforma → Versiones | Pantalla nueva con indicadores, filtros y tabla por empresa |
| Web comercial → Catálogo | Aviso por fila y resumen de productos publicados sin disponibilidad completa |
| Cabecera | Etiqueta de entorno correcta («Live · pruebas») |

**Mejoras solo visuales:** la legibilidad del resumen 360° (CRM #40) y las etiquetas en español de la auditoría. Todo lo demás es funcional.

---

## 6. Pruebas y validaciones

### Pruebas automáticas
- **Core:**
  - `server/controlPlane/tenantAccess.test.ts` (11);
  - `server/controlPlane/schemaVersions.test.ts` (3);
  - `server/medicionPlanoControl.test.ts` (3);
  - `server/publicacionContinua.test.ts` (11);
  - `server/nodeBaseImage.test.ts` (2).
- **CI de cada PR del Core** (bloqueantes, en verde antes de fusionar): «Suites del Core multiempresa» (con MySQL real) y «Secretos y ficheros sensibles».
- **Suites del plano de control y del registro en local:** 654 pruebas en verde. La única que falla en local es la de finales de línea de Windows, que en CI pasa.
- **CRM:** 138 pruebas en 25 ficheros, en verde, y compilación. Nuevas: `access`, `tenantStates`, `tenantSummary`, `tasks`, `dashboardSaas`, `provision`, `tenantBackups`, `tenantComms`, `versions`, `auditLog` y `webCoherence`.

### Aislamiento entre empresas
- La empresa de cada acción de Accesos va **firmada en el token**. La prueba manda un `host` de otra empresa y la acción se aplica a la del token.
- **No hay** una prueba E2E de aislamiento con dos bases reales para Accesos. **Es un pendiente.**

### Permisos y seguridad
- Sin `support:write` no se ejecuta nada (403).
- Acciones no admitidas: 400 (no existe «fijar contraseña»).
- Token de otro secreto o reutilizado: rechazado.

### Flujos completos comprobados con API reales (live)
- Accesos: las salvaguardas de la sección 3.
- Tickets: alta, asignación, nota interna, en curso, cierre; 5 eventos; visible en la ficha.
- Resource Manager con datos.
- Versiones: 2 empresas al día con `0013_data_export_purge`.

### Comprobado en la interfaz desplegada (live, navegador)
Accesos, Empresas clientes, ficha 360°, Dashboard, Auditoría y Comunicaciones.

**Sin comprobar en el navegador:** Tareas, Alta guiada y Versiones, aunque Versiones sí se verificó por API.

### E2E
No se han añadido pruebas E2E automáticas (Playwright) al repositorio. Las comprobaciones de navegador fueron scripts puntuales.

### Incidencias detectadas y corregidas
| Incidencia | Corrección |
|---|---|
| Fallo de construcción transitorio del Core en live (`703879d`) | **Vuelta atrás automática** (core y controlplane) |
| El registro de construcción no aparecía en los fallos | #308 |
| Prueba inestable `dataExport.e2e` | #310 |
| Versiones «no disponible»: #306 no se había fusionado por esa prueba | Fusionado tras reintentar |
| Colisión de estilos en el resumen | CRM #40 |
| CRM de live etiquetado «Producción» | CRM #34 |

---

## 7. Cambios técnicos y publicación

### PR

**Core** (`nayade_experiences_platform`, rama `integration/elephant-source`):

| PR | Contenido |
|---|---|
| **#301** | Accesos (API) |
| #302 | Diagnóstico de variables |
| #303 | Medición en live |
| #304, #307, #311 | Registro del overnight |
| #305 | Referencia común de los servicios activos |
| **#306** | Versiones de esquema |
| #308 | Registro de construcción en los fallos |
| #310 | Prueba estable |
| **#312** | Production ordinario automático |
| #313 | Imagen base en «estado» |
| **#314** | Node.js 22.23.4 |
| #309 | **Abierto**: medición en production |

**CRM** (`big-elephant-crm`, rama `integration/elephant-source`):

| PR | Contenido |
|---|---|
| **#33** | Accesos |
| #34 | Etiqueta de entorno |
| **#35** | Estados |
| **#36** | 360° |
| #37 | Tareas |
| #38 | Dashboard |
| #39 | Alta guiada |
| #40 | Legibilidad del resumen |
| #41 | Copias |
| #42 | Comunicaciones |
| #43 | Versiones |
| #44 | Auditoría |
| #45 | Web: coherencia de la oferta |
| #46 | Node.js |

### Base de datos
**Ninguna migración** en el overnight. Accesos usa `tenant_events`, que ya existía (método nuevo `recordEvent`, solo anexado).

### Variables
`controlplane.ERM_DATABASE_URL` en **live**, por referencia (`almacenamiento-referencias`).

### Secretos de GitHub
- `ES_GATEWAY_AUTH` en live.
- `CRM_DEPLOY_KEY` en live, production y el entorno ordinario.
- Claves de despliegue de **solo lectura** en `big-elephant-crm`.

### Live
- **Core, plano de control y pasarela:** `eb417401` (todo el overnight + Node 22.23.4), publicado y comprobado automáticamente.
- **CRM:** `c48b51d8` (todos los PR del CRM).

### Production
| Servicio | Estado |
|---|---|
| Core, plano de control, pasarela | `f3e2f0c9`. Publicado **automáticamente y sin aprobación** al fusionar #312 (run 40074585320, 0 aprobaciones); salud 200 en `app.bigelephant.es` y en Skibox |
| Node 22.23.4 fijado | Run **40077684074** esperando aprobación (protegido: cambia Dockerfiles) |
| CRM | **Versión antigua** sin el overnight; el automático lo omite porque su versión activa no es identificable |

### Relación con #312
- Desde su fusión, cada cambio ordinario va solo a production tras CI y live. **Verificado:** run 40072248649 manual y run 40074585320 automático, ambos sin aprobación.
- Los cambios de infraestructura (#314) se **omiten con aviso**, como debe ser.
- El CRM necesita **un** despliegue protegido para tener versión identificable; después, también se publica solo.

### Accesible hoy desde `admin.bigelephant.es`
**Ninguna pantalla del overnight.** Las API del backend sí están desplegadas.

---

## 8. Pendientes y prioridades

| Prioridad | Pendiente | Esfuerzo | Dependencias | ¿Migración o aprobación? |
|---|---|---|---|---|
| **P0** | Desplegar el CRM en production (pantallas del overnight, Accesos de Skibox) | 15 min | Run 40077684074 antes (solo cabe una ejecución en espera) | Aprobación (`desplegar-crm`), una vez |
| **P0** | Comprobar `SUPPORT_JWT_SECRET` en el plano de control y el Core de production y consultar Accesos de Skibox | 15 min | Lo anterior | Aprobación (diagnóstico en production) |
| **P0** | Aplicar Node 22.23.4 en production y reconstruir backup-job, restore-drill y la web comercial | 30 min | Run 40077684074; web: PR #13 de `bigelephant-web` (otra ventana) | Aprobación |
| **P0** | Prueba de aislamiento con dos bases reales para Accesos | 0,5 día | — | No |
| **P1** | Resource Manager en production | 15 min | Fusionar #309 | Aprobación |
| **P1** | Revocar sesiones de un usuario sin desactivarlo | 1 día | Diseño de la versión de sesión | **Migración** de empresa |
| **P1** | Medición de almacenamiento, base de datos y usuarios activos por empresa | 2–3 días | — | Posible migración del ERM |
| **P1** | Alta guiada probada de punta a punta en live | 0,5 día | Empresa de prueba nueva | No |
| **P1** | Gestión de dominios y certificados (DNS esperado/observado, certificado) | 2 días | — | No |
| **P2** | Tareas con responsable y prioridad | 1 día | — | **Migración** del CRM |
| **P2** | Costes y rentabilidad por empresa | 3–5 días | Medición completa, precios unitarios | No |
| **P2** | Búsqueda global, centro de notificaciones, historial unificado | 3 días | — | No |
| **P2** | CMS de la web: vista previa, comparación, versiones, SEO y formularios | 3–5 días | Aprobación comercial y legal de contenidos | No |
| **P2** | E2E automáticas (Playwright) de los recorridos críticos | 2 días | — | No |

---

## 9. Conclusión

1. **Porcentaje completado: alrededor del 30 %.**
   - **Por áreas:** de las 25 áreas de la tabla, 4 terminadas (1 punto), 8 parciales o terminadas solo en live (0,5) y 13 sin modificar, lo que da (4 + 4) / 25 ≈ 32 %.
   - **Por prioridad:** el bloque prioritario (A, accesos; B, Resource Manager y estados) está en torno al 80 % en live y por debajo del 30 % en production.
   - **Web comercial:** los bloques de la web comercial (F) están prácticamente sin hacer.
2. **¿Administrar clientes SaaS sin herramientas técnicas?** **En live, en buena parte sí:**
   - accesos de usuarios, estados, ficha 360°, copias, comunicaciones, auditoría y versiones;
   - tickets y alta guiada.

   **En production, todavía no**, porque las pantallas no están desplegadas.
3. **Siguen necesitando intervención técnica:**
   - despliegues protegidos (CRM, imágenes, variables) y migraciones;
   - restauraciones;
   - configuración de dominios y certificados;
   - revocar sesiones sin desactivar;
   - medición de almacenamiento y base de datos;
   - cambios en la web comercial.
4. **Cinco siguientes mejoras prioritarias:**
   1. CRM en production y Accesos de Skibox verificado.
   2. Resource Manager en production (#309).
   3. Node 22.23.4 en todos los servicios de production (incluidas copias y web).
   4. Prueba de aislamiento real de Accesos con dos empresas.
   5. Revocación de sesiones individual (migración protegida).
5. **Antes de operar comercialmente con clientes reales:**
   - desplegar y **verificar en production** lo anterior;
   - activar el correo transaccional en production con tu autorización (`MAIL_MODE`): sin él no salen invitaciones ni restablecimientos;
   - medición completa por empresa y alertas de cuota operativas;
   - prueba de aislamiento y E2E de los recorridos críticos (alta, accesos, suspensión, reactivación);
   - cerrar la incidencia de Stripe (ventana de Stripe) y los textos legales.
