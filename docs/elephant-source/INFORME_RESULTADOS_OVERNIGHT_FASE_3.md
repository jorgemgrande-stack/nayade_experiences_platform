# Informe de resultados — tercer overnight de Big Elephant Admin

**Fecha:** 24/10/2026
**Encargo:** completar el ~40 % pendiente tras la fase 2 ([INFORME_RESULTADOS_OVERNIGHT_FASE_2.md](INFORME_RESULTADOS_OVERNIGHT_FASE_2.md)).
**Registro de trabajo:** [OVERNIGHT_FASE_3.md](OVERNIGHT_FASE_3.md).

**Cómo leer este informe:**
- **live:** comprobado con la API real, el navegador real (Playwright) o los registros del despliegue.
- **production:** solo se marca así lo comprobado allí, mediante el registro de una ejecución aprobada, pruebas negativas sin credenciales o el paquete servido. En esta sesión no hay credenciales de operador de production.
- **Fusionado ≠ desplegado ≠ comprobado.** Se indica cada estado por separado.

**Estado final (24/10/2026, 20:30 UTC):**
- **Production:** Core, plano de control y pasarela en `55451c2d`, con todo el código de la fase 3 (#329–#344) y la medición activa. `MAIL_MODE=off` sin cambios.
- **Live:** la integración completa, incluido el #344.
- **CRM:** todas las pantallas de la fase 3 servidas en live y en production (#54–#61).
- **Avance real estimado del encargo original: 78 %** (60 % → 78 %).

---

## 1. Resumen ejecutivo

**Qué se ha conseguido:**
1. **Resource Manager operativo en production con datos reales.**
   - Procedimiento reproducible para la base de medición `es_erm`:
     - usuario con permisos mínimos, verificados con una sonda que no deja restos;
     - contraseña aleatoria que nunca se imprime;
     - referencias en lugar de copias.
   - Probado en live, de forma idempotente.
   - **Hecho en production** (ejecución aprobada 40126044874): base `es_erm` creada, permisos exactos, referencias en `core` y `controlplane`, los dos desplegados. **Ya llegan datos reales de las 7 empresas**, Skibox incluida.
2. **Métricas por empresa con su procedencia:** medida, calculada, estimada o no disponible.
   - Calculadas desde la base real de cada empresa: tamaño de la base, usuarios habilitados, usuarios activos en 30 días y usuarios contratados.
   - Histórico diario y tendencia de 7 días frente a los 7 anteriores.
3. **Gestión real de módulos:**
   - licencias idempotentes en una sola transacción, con auditoría completa (de/a, motivo, petición);
   - «empresas que usan cada módulo»;
   - cinco fallos del CRM corregidos, entre ellos un botón que nunca funcionaba y «Suspender» sin comprobar los dependientes.
4. **Ficha 360° con integraciones**, sin secretos: estado, campos obligatorios que faltan y conexión «no comprobada», nunca dada por buena.
5. **Informes comerciales** por periodo, en hora de Madrid:
   - conversión, actividad por responsable y seguimientos;
   - **calidad de los datos**: duplicados, registros sin responsable, estados incoherentes y relaciones inexistentes;
   - exportación CSV sin datos de contacto y protegida frente a fórmulas.
6. **Experiencia de usuario corregida con un recorrido real de 34 rutas**, en escritorio y móvil. Antes había 4 problemas; ahora 0 en las 68 comprobaciones (la última, un desborde de valores largos en móvil, corregida en el CRM #58 y comprobada en live).
7. **Alta automática con subdominio funcional en live:**
   - `*.live.bigelephant.es` con certificado emitido; un alta real queda accesible en su subdominio en 21 s;
   - comprobación de recursos huérfanos.
8. **Correo de acceso preparado para activarse por empresa** (invitación y restablecimiento), probado en live y apagado en production (sección 2.10).
9. **Estabilidad:** encontrada y corregida la **causa real** de la prueba intermitente. Era una carrera entre réplicas con la misma clave de idempotencia, no un problema de tiempos.
10. **Seguridad:** pruebas negativas en production (sección 4) y ninguna ruta interna nueva expuesta.

---

## 2. Tablas por área

### 2.1 Resource Manager

| | Detalle |
|---|---|
| Situación inicial | Medición solo en live; production con «Medición no configurada» (el Core de production sin `ERM_DATABASE_URL`) |
| Cambios | #329 procedimiento `es_erm` (`erm-setup`, `metering`, acción `medicion-preparar`); #336 orden del paso; #338 comprobación de solo lectura (`medicion-comprobar`); #332 métricas por empresa con procedencia; #340 histórico diario y tendencia; CRM #55 y #59 pantallas |
| Pruebas | MySQL real (7): creación, idempotencia, permisos de más, contraseña, agregado de 24 h; E2E con dos empresas reales (tamaño y usuarios sin mezclarse; 403/401/404/400); tendencia (día de Madrid, aislamiento); live: `erm-setup --apply` idempotente con sonda verde (escribir sí; borrar, DDL y otras bases, no) |
| Integración | Fusionado |
| Live | Desplegado y verificado (run 40117740011) |
| Production | **Operativo con datos reales.** Ejecución 40126044874 (aprobada): `erm-setup --apply` → SUCCESS, `grants: ok`, `core` y `controlplane` desplegados con `ERM_DATABASE_URL` por referencia. A los 90 s, el agregado de 24 h ya mostraba consumo de las 7 empresas (Skibox con 4 métricas) |
| Bloqueos | Ninguno. El primer intento (40118369228) falló porque la imagen de restore-drill no lleva `db/erm`. Se corrigió en el #343 y no quedó nada a medias |
| Pendientes | Medir el almacenamiento ocupado, la cola, la mensajería y las integraciones (declarados «no disponible»); CPU y memoria sin atribución fiable en despliegue compartido; tarifas reales en `ERM_COST_MODEL` |

### 2.2 Cuotas, alertas y costes

| | Detalle |
|---|---|
| Situación inicial | Cuotas, umbrales del 80 % y 100 %, vista de empresas con alertas y coste atribuible (fase 2) |
| Cambios | Histórico y tendencia (#340); métricas y costes desde la misma base de medición |
| Pruebas | Las de 2.1 y las de la fase 2 (costes) |
| Live / Production | Live verificado; production según 2.1 |
| Pendientes | **No se bloquea ningún servicio automáticamente**, porque no hay una política aprobada. El coste sigue siendo una estimación declarada hasta configurar `ERM_COST_MODEL` |

### 2.3 Módulos y licencias

| | Detalle |
|---|---|
| Situación inicial | 6 módulos del Core. Licencias con un PUT no idempotente (dos transacciones, eventos repetidos), sin de/a ni motivo. Sin «empresas que usan cada módulo». En el CRM: «Suspender» sin comprobar dependientes, una concesión de módulos externos que siempre recibía 404 e historial sin el módulo afectado |
| Cambios | #334 (servidor): una transacción con `FOR UPDATE`, sin evento si nada cambia, evento único con de/a, motivo y petición; DELETE idempotente; `GET /modules/:module/tenants`; recuento agregado. CRM #54 (cinco fallos) y #56 (empresas por módulo, motivo, «Sin cambios») |
| Pruebas | API (9) y MySQL real (6): idempotencia, suspensión sin paso intermedio, DELETE sin evento, 404, 403 sin efectos y listado aislado; CRM 174 → 194 |
| Live | Desplegado (cadena de la integración) |
| Production | Desplegado en production (`46ac96df`, ejecución 40126044874). En la misma ejecución se verificó la salud de `app.bigelephant.es` y del acceso de Skibox. Las rutas nuevas responden 401 sin sesión (sección 4) |
| Pendientes | Catálogo técnico persistente (versión instalada por entorno, historial de versiones, errores de carga de los módulos externos, que hoy solo quedan en consola); instalar migraciones de un módulo después del alta; caché de 30 s del Core sin invalidación al cambiar una licencia |

### 2.4 Ficha 360°

| | Detalle |
|---|---|
| Situación inicial | Resumen, Accesos, copias, comunicaciones, auditoría, recursos y licencias |
| Cambios | #335 integraciones sin secretos (solo proveedor, campo, fecha y autor de la base de la empresa); CRM #56 pestaña Integraciones y tarjeta en el resumen; métricas en Recursos (CRM #55); historial con las acciones de Accesos traducidas (CRM #57) |
| Pruebas | E2E con dos empresas reales: el valor secreto no aparece en la respuesta; B no ve las integraciones de A; 401 y 404 |
| Live | Desplegado; recorrido real sin errores |
| Production | Desplegado en production (`46ac96df`, ejecución 40126044874). En la misma ejecución se verificó la salud de `app.bigelephant.es` y del acceso de Skibox. Las rutas nuevas responden 401 sin sesión (sección 4) |
| Pendientes | Comprobación de conexión y última sincronización de cada integración (hoy no se registran: se muestra «no comprobada»); acciones de reconexión |

### 2.5 Informes comerciales

| | Detalle |
|---|---|
| Situación inicial | Panel con indicadores del momento, sin periodos |
| Cambios | #333 `GET /crm/reports` y la exportación; CRM #56 «Comercial › Informes» con atajos de fechas |
| Pruebas | Meses de Madrid, conversión, actividad, seguimientos, todos los casos de calidad de datos, CSV y API (fechas imposibles, periodo invertido o de más de 2 años, 403, 401) |
| Live | Desplegado |
| Production | Desplegado en production (`46ac96df`, ejecución 40126044874). En la misma ejecución se verificó la salud de `app.bigelephant.es` y del acceso de Skibox. Las rutas nuevas responden 401 sin sesión (sección 4) |
| Pendientes | Informes de módulos contratados y de consumo por periodo en la misma pantalla; los SaaS (empresas por estado, pruebas y conversiones) siguen en Operación SaaS y el Dashboard |

### 2.6 Experiencia de usuario

| | Detalle |
|---|---|
| Situación inicial | Sin revisión sistemática |
| Cambios | CRM #57: alta (contraste y desborde), ficha (miga de pan, tablas), Pruebas (cabecera oculta que se escapaba), Soporte (6 controles sin etiqueta), página «no encontrada», historial traducido, regla global de tablas. CRM #58: valores largos de las fichas (causa medida con datos reales) |
| Pruebas | Recorrido real Playwright de 34 rutas × 2 vistas: errores de consola, peticiones fallidas, desborde horizontal, botones sin nombre, campos sin etiqueta; CRM 195 → 206 pruebas |
| Live | Desplegado. Nuevo recorrido tras el #58: 0 desbordes en 390 px (ancho de página = ancho de pantalla en la ficha y en «no encontrada»). Total: 68/68 limpias |
| Production | CRM publicado automáticamente tras live (publicación ordinaria) |
| Pendientes | Contraste medido de forma automática (no hay herramienta sin añadir dependencias); revisión de foco por teclado pantalla a pantalla |

### 2.7 Alta automática y dominios

| | Detalle |
|---|---|
| Situación inicial | Alta funcional en live con 404 en el subdominio |
| Cambios | #331 y #337: el estado del dominio muestra y exige el TXT de propiedad; #339 comprobación de huérfanos (`huerfanos`, solo lectura) |
| Pruebas | Lógica de huérfanos con todos los casos (bases sin empresa o de empresas archivadas, empresas sin base, usuarios `esu_`/`esr_` sueltos, copias de restauración) |
| Live | Comodín creado, CNAME verificados, `CP_PLATFORM_DOMAINS` activo, 3 empresas de prueba con su dominio nuevo. **Certificado emitido** (Let's Encrypt, válido hasta el 22/01/2027) tras crear el TXT `_railway-verify.live` y pedir la emisión por API (#342). Alta real `alta-subdominio-20261024b` en 21 s: su subdominio sirve su login; invitación de un solo uso (reutilizarla da 404); la sesión y las credenciales no valen en otra empresa (401) |
| Production | `*.app.bigelephant.es` ya funcionaba |
| Bloqueos | Ninguno |

### 2.8 Estabilidad

| | Detalle |
|---|---|
| Situación inicial | Prueba intermitente de solicitudes web (falló en #328) |
| Cambios | #330: si la solicitud encontrada tiene la misma clave, es un reintento (`replayed`); se evita además la nota falsa «Solicitud web repetida» en el lead |
| Pruebas | Prueba determinista que reproduce la intercalación exacta (sin la corrección falla con el síntoma del CI) |
| Estado | Fusionado y desplegado |

### 2.9 Correo de acceso de las empresas (tarea paralela)

| | Detalle |
|---|---|
| Situación inicial | En Skibox (production), «Reenviar invitación» y «Enviar restablecimiento» deshabilitados por `MAIL_MODE=off`; administrador activo, sin contraseña, invitación pendiente y sin accesos |
| Revisión | Enlace al dominio de la propia empresa, un solo uso, caducidad (72 h la invitación, 60 min el restablecimiento), válido solo en su base, sin contraseñas en el correo y confirmación tecleando el correo del destinatario. **Tres defectos encontrados y corregidos:** `admin.resendInvite` aceptaba el destinatario del cuerpo de la petición y reabría invitaciones ya aceptadas; un restablecimiento dejaba viva la invitación pendiente, que podía volver a cambiar la contraseña; el cliente pedía 6 caracteres y el servidor, 8 |
| Cambios | #344: ámbito `MAIL_SCOPE_TENANTS` / `MAIL_SCOPE_CATEGORIES` (solo restringe; una lista vacía o mal escrita no deja pasar nada), `scope_blocked`, `accessMail` en el listado y las tres correcciones. CRM #61: botones según el ámbito de la empresa. #345: procedimiento [CORREO_ACCESO_EMPRESAS.md](../runbooks/CORREO_ACCESO_EMPRESAS.md) |
| Pruebas | Unitarias del ámbito (política, servicio, `mailGate`, `accessMail`), `resendInvite` con el correo de la base y 409/404, MySQL real (el restablecimiento anula la invitación) y CRM 217 |
| Live | **Prueba de punta a punta superada** (empresa nueva `alta-correo-20261024c`, solo al buzón de pruebas autorizado): confirmación errónea → 409; reenviar → `sent`; el enlace anterior → 404; restablecimiento → `sent`; auditoría completa |
| Production | **Desplegado** (`55451c2d`, ejecución 40128876983). `MAIL_MODE=off` sin cambios. **No se ha enviado nada a Skibox** |
| Bloqueos | Postmark sigue en Test mode; falta el token de Postmark de production; activar requiere tu autorización expresa |

### 2.10 Operación SaaS y Stripe

| | Detalle |
|---|---|
| Situación | El listado de eventos de Stripe pertenece a la ventana de pagos: **pendiente externo**. No se ha accedido a datos económicos por otros caminos |

---

## 3. Production: qué está realmente desplegado

| Componente | Versión | Cómo se comprobó |
|---|---|---|
| Core y plano de control | `46ac96df` (#329–#343) | Ejecución aprobada 40126044874: despliegues SUCCESS, salud de `app.bigelephant.es` y `skibox.app.bigelephant.es` → 200 |
| Medición `es_erm` | Activa | Misma ejecución: `database/table/user: exists`, `grants: ok`, consumo de las 7 empresas en la última hora |
| Core, plano de control y pasarela con el correo de acceso (#344) | `55451c2d` | Ejecución aprobada 40128876983: copia previa, migraciones sin cambios en las 7 empresas, despliegues SUCCESS, salud → 200. Sin sesión: Accesos y métricas de Skibox → 401 (también con token falso), `/_ops` → 404 |
| Pasarela | `923edc6d` | `/_ops` → 404 (fase 2) |
| CRM | integración con #54–#61 | Publicación ordinaria tras live |
| Migraciones | `0014` en las 7 empresas, CRM `0024` | Ejecuciones aprobadas de la fase |
| Interruptores | `MAIL_MODE=off`, cobros, autoservicio e IA **sin cambios** | Ninguna acción de la fase los toca |

**Fusionado, pero no en production:** solo documentación (#345 y este informe).

## 4. Seguridad y aislamiento

- **Aislamiento entre empresas** (con MySQL real y dos empresas):
  - métricas calculadas (tamaño y usuarios);
  - integraciones (sin valores y sin cruzar empresas);
  - listado de empresas por módulo (sin empresas borradas ni datos de otras tablas);
  - licencias (403 sin efectos).
- **Production, sin credenciales:**
  - **13 rutas** del plano de control responden **401**, incluidas `access`, `revoke`, `resources/costs`, `crm/reports`, `operators` y `metrics`, y también con un token falso;
  - en los hosts de empresa, `/_ops` da 404; `/.env`, `/.git/config` y el código fuente devuelven la página de la aplicación, no ficheros; `auth.me` sin sesión devuelve `null`.
- **Datos:**
  - la exportación CSV no incluye correo ni teléfono;
  - las integraciones nunca devuelven el valor;
  - la contraseña de medición nunca se imprime y solo viaja por referencias.
- **Rutas internas nuevas:** ninguna expuesta. `erm-setup` y `orphans` se ejecutan en `restore-drill`, dentro de la red privada, mediante órdenes permitidas por patrón exacto.

## 5. Cambios

**Core** (`nayade_experiences_platform`):

| PR | Contenido |
|---|---|
| #329 | Medición `es_erm` |
| #330 | Carrera entre réplicas en las solicitudes web |
| #331 | Detalle del estado del dominio |
| #332 | Métricas por empresa |
| #333 | Informes comerciales |
| #334 | Gestión de módulos |
| #335 | Integraciones de la ficha 360° |
| #336 | Orden del paso de medición |
| #337 | TXT de propiedad del dominio |
| #338 | Comprobación de la medición |
| #339 | Recursos huérfanos |
| #340 | Tendencia del consumo |
| #341 | Listado de operaciones de Railway (diagnóstico de dominios) |
| #342 | Emisión del certificado por API |
| #343 | DDL de la medición en el código (corrige el primer intento en production) |
| #344 | Ámbito del correo de acceso e invitaciones más seguras |
| #345 | Procedimiento del correo de acceso |

Cerrado el #309, sustituido por el #329.

**CRM** (`big-elephant-crm`):

| PR | Contenido |
|---|---|
| #54 | Módulos |
| #55 | Métricas |
| #56 | Integraciones, módulos e informes |
| #57 | Experiencia de usuario |
| #58 | Valores largos de las fichas |
| #59 | Tendencia |
| #60 | Enlaces a pestañas, botón «Accesos» y auditoría actualizada |
| #61 | Botones de Accesos según el ámbito del correo |

**Migraciones de esquema:** ninguna. La base `es_erm` es independiente y se crea con su propio procedimiento.

**Variables** (solo nombres): `MySQL.ES_ERM_PASSWORD`, `restore-drill.ES_ERM_PASSWORD`, `core.ERM_DATABASE_URL` y `controlplane.ERM_DATABASE_URL`, todas en production y por referencia salvo la primera.

## 6. Respuestas obligatorias

1. **Porcentaje total del encargo original: 78 %.** Es una estimación por áreas con criterio estricto: solo cuenta lo publicado y comprobado.
2. **Avance sobre el 60 %: +18 puntos.** Del 40 % pendiente se ha cerrado algo menos de la mitad. Lo que queda depende sobre todo de decisiones externas (Stripe, Postmark, tarifas) y de piezas grandes (catálogo técnico de módulos, comprobación de integraciones).
3. **Nuevo en production hoy:**
   - medición real por empresa, con métricas, histórico, tendencia y coste estimado;
   - gestión de módulos (activar, suspender y quitar con motivo y auditoría) y «empresas que usan cada módulo»;
   - pestaña Integraciones de la ficha;
   - informes comerciales con exportación;
   - Accesos con «Cerrar sesiones»;
   - enlaces directos a cada pestaña;
   - pantallas corregidas en móvil.
4. **Resource Manager: sí, operativo con datos reales.** Llegan datos de las 7 empresas, Skibox incluida. Faltan almacenamiento ocupado, cola, mensajería e integraciones: se muestran como «no disponible», nunca inventados. El coste es una estimación hasta configurar las tarifas (`ERM_COST_MODEL`).
5. **Módulos: sí.** Se activan, suspenden y quitan por empresa desde Admin, de forma idempotente y auditada. Falta el catálogo técnico: versión instalada, historial y errores de carga.
6. **Ficha 360°: casi completa.** Tiene resumen, operación, accesos, dominios, licencias, integraciones, cuotas, recursos, facturación, tickets, comunicaciones, auditoría y soporte. Falta comprobar la conexión y la última sincronización de cada integración, que hoy aparecen como «no comprobada».
7. **Informes comerciales: sí, fiables para lo que miden.** Periodos en hora de Madrid, conversión, actividad, seguimientos y calidad de datos. Los informes SaaS (empresas, pruebas, conversiones) siguen en Operación SaaS y en el Dashboard.
8. **Alta con subdominio: sí en live, de punta a punta** (certificado emitido, alta en 21 s, primer acceso y aislamiento). En production, `*.app.bigelephant.es` ya funcionaba. Para que el cliente reciba su invitación sin intervención falta activar el correo de acceso (respuesta 12).
9. **Experiencia de usuario corregida:**
   - desbordes en móvil (alta, ficha, valores largos);
   - contraste del alta;
   - miga de pan;
   - cabecera oculta de Pruebas;
   - 6 controles sin etiqueta en Soporte;
   - página «no encontrada»;
   - historial traducido;
   - botones de Accesos con su motivo.
   Resultado: 68/68 comprobaciones limpias.
10. **Pruebas de seguridad y aislamiento:**
    - con MySQL real y dos empresas: métricas, integraciones, módulos, licencias y Accesos;
    - tokens de invitación y restablecimiento de un solo uso, válidos solo en su empresa;
    - en production sin credenciales: 13 rutas → 401, `/_ops` → 404 y ningún fichero interno servido;
    - la contraseña de medición nunca se imprime;
    - el CSV sale sin datos de contacto.
11. **Siguen necesitando herramientas externas:**
    - el DNS de Dinahosting (TXT y CNAME);
    - la consola de Postmark (aprobación de la cuenta y token);
    - Stripe, en su ventana;
    - Railway, solo para lo que el flujo protegido no cubre todavía (borrar empresas de prueba).
12. **Bloqueos que dependen solo de una autorización humana:**
    - aprobar en Postmark la salida de Test mode;
    - crear el token de production y guardarlo sellado en Railway;
    - autorizar la activación limitada del correo de acceso para Skibox;
    - las tarifas reales para el coste;
    - la política de bloqueo automático por cuota.
13. **Comercialización general: todavía no.**
    - Aislamiento, recuperación y aprovisionamiento ya están probados.
    - Pero sin correo de acceso activo un cliente no recibe su invitación sin intervención técnica, y el cobro (Stripe) sigue pendiente en su ventana.
    - Sí está preparado para clientes acompañados, como Skibox, en cuanto se active el correo de acceso.
14. **Riesgos críticos abiertos:**
    - el alta devuelve al operador el token de invitación del administrador (`provisioning.adminInviteToken`), que es útil mientras no hay correo, pero conviene retirarlo al activarlo;
    - sin bloqueo automático por cuota, el consumo excesivo de una empresa solo se ve, no se frena;
    - la caché de licencias de 30 s del Core.
    Ninguno compromete el aislamiento entre empresas.

## 7. Cómo reanudar

- **Correo de acceso de Skibox:** seguir [CORREO_ACCESO_EMPRESAS.md](../runbooks/CORREO_ACCESO_EMPRESAS.md), pasos 1 a 8.
- **Consumo de 24 h por empresa en production:** acción `medicion-comprobar` (solo lectura; necesita aprobación).
- **Huérfanos:** acción `huerfanos` en live (libre) y en production (con aprobación).
- **Empresas de prueba en live:** `alta-subdominio-20261024b` y `alta-correo-20261024c` se pueden archivar cuando ya no se necesiten.
