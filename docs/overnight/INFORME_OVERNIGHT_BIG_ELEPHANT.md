# Informe de la operación nocturna · Big Elephant

**Fecha:** 16/10/2026
**Alcance:** Core (`nayade_experiences_platform`), CRM (`big-elephant-crm`) y web comercial (`bigelephant-web`). La Ventana 1 y `Business-Elephant-Enterprise-Suite` no se han tocado.
**Producción:** sin cambios. No se ha fusionado nada, no se ha desplegado nada, no se ha tocado Railway, no se han ejecutado migraciones en bases reales, no se ha cobrado nada y no se ha enviado ninguna comunicación. El despliegue activo de Náyade sigue siendo `baeca78`.

Este informe no contiene contraseñas, tokens, claves ni datos personales.

---

## 1. Resumen ejecutivo

- **Integración lista para ejecutar, no ejecutada.** Hay un único runbook con el orden exacto de los 30 PR del Core, 12 del CRM y 4 de la web. Para cada paso indica qué despliega, qué migra, qué comprobar en Railway y cómo volver atrás por capa: código, esquema, datos y configuración. La integración completa se ha simulado en local sin conflictos y con todas las pruebas bloqueantes en verde: 703 unitarias y 85 con MySQL.
- **Motor de suscripciones contractual v1 (PR #86).** Es aditivo y guarda el precio aceptado como instantánea inmutable. Todas las operaciones son transaccionales, auditadas y con concurrencia optimista. No migra a ningún cliente existente.
- **Facturación en modo sombra (PR #86).** Calcula, registra y compara; **nunca cobra**. Es idempotente frente a duplicados, reintentos, webhooks repetidos y concurrencia. Se ha probado con un MySQL desechable.
- **CRM: Comercial → Suscripciones (PR #11).** Reutiliza el sistema de diseño. Todo lo simulado está rotulado y no hay botones de cobro ni de licencias.
- **Prueba autónoma de 15 días (PR #87).** Arquitectura, máquina de estados y pruebas locales. Nada es automático y no está conectada a Railway.
- **Auditoría técnica de los tres repositorios.** Se han corregido los defectos seguros: seguridad separada de robustez, en PR #90 (plano de control), CRM #12 y web #4. Un hallazgo serio exige tu decisión: **el repositorio público del Core versiona exportaciones con datos de producción** (`.manus/`, PR #89).
- **Hallazgo de CI (PR #91).** 9 ficheros de pruebas SaaS no eran bloqueantes, así que «CI en verde» no los garantizaba. Corregido; en local pasan.
- **Infraestructura de lanzamiento documentada.** La propuesta permite que un push a `main` no despliegue Náyade antes del CI: «esperar al CI» más *watch paths*. Hay además una guarda automática de que el binario de Náyade no incluye el plano de control (PR #88).

---

## 2. Trabajo completado

| Misión | Estado | Dónde |
|---|---|---|
| 1. Consolidación: auditoría de PR, simulación, runbook único, Bloque 1 preparado | Hecho; las fusiones quedan **bloqueadas** hasta tu autorización | `docs/runbooks/INTEGRACION_CONTROLADA.md` (#78) |
| 2. Motor contractual de suscripciones v1 | Hecho | Core #86 |
| 3. Facturación en modo sombra | Hecho | Core #86 |
| 4. Interfaz de suscripciones en el CRM | Hecho | CRM #11 |
| 5. Arquitectura de la prueba de 15 días | Hecho (sin conectar) | Core #87, `docs/architecture/PRUEBA_AUTONOMA_15_DIAS.md` |
| 6. Auditoría técnica transversal | Hecho; correcciones seguras aplicadas | Core #89, #90, #91; CRM #12; web #4 |
| 7. Infraestructura de lanzamiento | Documentada; la configuración en Railway queda **bloqueada** | `docs/infra/ARQUITECTURA_LANZAMIENTO.md` (#78), guarda #88 |

---

## 3. Repositorios y PR

Ningún PR se ha fusionado. Estado del CI comprobado en GitHub tras el último push de cada uno, salvo donde se indica.

### Core (`nayade_experiences_platform`), PR nuevos de esta noche

| PR | Rama → base | Contenido | CI |
|---|---|---|---|
| #86 | `feat/subscriptions-v1` → `feat/cp-web-catalog` | Motor de suscripciones v1 y facturación en modo sombra; migración CRM 0006 | verde |
| #87 | `feat/trial-architecture` → `feat/subscriptions-v1` | Prueba de 15 días: estados, servicio y pruebas; migración CRM 0007 | verde |
| #88 | `chore/guarda-binario-nayade` → `main` | Prueba que falla si el binario de Náyade importa el plano de control | verde |
| #89 | `chore/dejar-de-versionar-manus` → `main` | Deja de versionar `.manus/` (399 ficheros con datos de producción) | verde |
| #90 | `fix/cp-seguridad` → `feat/cp-web-catalog` | 7 correcciones de seguridad del plano de control y 1 de su imagen Docker (commit aislado) | verde |
| #91 | `chore/ci-suites-saas` → `main` | 9 ficheros de pruebas SaaS pasan a la lista bloqueante del CI | en curso al cerrar el informe |

**Actualizados:** #78 (runbook, arquitectura de lanzamiento y este informe) y #68 (decisión D5, opción B).

### CRM (`big-elephant-crm`)

| PR | Rama → base | Contenido | CI |
|---|---|---|---|
| #10 | (existente) | Se ha eliminado un `case "web"` duplicado e inalcanzable en `App.tsx` | verde |
| #11 | `feat/crm-subscriptions` → `feat/crm-web-admin` | Comercial → Suscripciones (modo sombra) | verde |
| #12 | `fix/crm-auditoria` → `feat/crm-subscriptions` | Correcciones de la auditoría: seguridad y robustez | verde |

### Web (`bigelephant-web`)

| PR | Rama → base | Contenido | CI |
|---|---|---|---|
| #4 | `fix/web-endurecimiento` → `feat/web-catalogo` | XSS por JSON en `<script>`, enlaces del CRM, tarifas sin confirmar y envíos sin tiempo máximo | verde |

**Bloque 1** (web #1 → #2 → #3 → #4): preparado y simulado; el árbol final es idéntico a la punta. **No fusionado**: espera tu autorización. La web no tiene despliegue configurado, así que fusionar no cambia producción.

---

## 4. Pruebas

Todas en local, con bases MySQL 8.4 **desechables** en contenedor (nunca bases reales).

| Ámbito | Resultado |
|---|---|
| Integración completa del Core simulada (24 ramas del runbook + #88, #89, #90, #86, #87; árbol `738d552`) | 0 conflictos; **703 superadas y 1 omitida** con la lista bloqueante ampliada; **85/85** con MySQL en serie |
| Suite completa de Vitest, `main` frente a integración | Los **mismos** 4 ficheros y 18 pruebas fallan en ambos: fallos de Náyade previos e informativos. **Sin regresiones** |
| Motor de suscripciones (#86) | 24 unitarias, 9 con MySQL (concurrencia, fallos a medias, reintentos, webhooks repetidos) y 5 de API; en la rama, 628 unitarias y 69 con MySQL en verde |
| Prueba de 15 días (#87) | 12 unitarias y 4 con MySQL |
| Seguridad del plano de control (#90) | 4 pruebas nuevas que **fallan sin las correcciones**; 170 unitarias y 60 con MySQL en verde; la imagen `Dockerfile.controlplane` se ha construido y su contenido comprobado |
| Guarda del binario (#88) | Comprobada con sabotaje: falla si Náyade importa el plano de control |
| CRM #11 | 36 unitarias; E2E de suscripciones: 4 superadas, 1 omitida (por diseño) |
| CRM #12 | 38/38; las 3 pruebas nuevas fallan sin las correcciones; build y tipos E2E correctos. E2E completos: 7 superadas, 5 omitidas, 2 fallidas. Las 2 fallidas (web comercial en `:4180`) **fallan igual en la rama base**: es el entorno, no el cambio |
| Web #4 | 21 superadas, 5 omitidas; `astro check` sin errores; build correcto |
| Tipos del Core (`tsc`) | 108 errores **previos** de Náyade, los mismos con y sin los cambios de #90 |

**Dependencias (`pnpm audit`):** hay avisos documentados y **no actualizados**, porque actualizar es un cambio de infraestructura que va aparte.
- **Core:** xlsx (sin parche publicado), @trpc/server (11.6 → 11.8), fast-xml-parser (vía aws-sdk), tar y rollup.
- **CRM:** solo herramientas de desarrollo.
- **Web:** astro, sharp y vitest.

---

## 5. Motor de suscripciones (Core #86)

**Modelo (migración CRM 0006, aditiva):**

| Tabla | Qué guarda |
|---|---|
| `subscriptions` | Contrato vivo con `version` (concurrencia optimista), día de anclaje y un único contrato vivo por empresa |
| `subscription_items` | Partidas con **instantánea inmutable** del precio aceptado (importe, IVA, periodicidad, producto) |
| `subscription_events` | Auditoría de cada cambio |
| `subscription_usage` | Consumo con clave de idempotencia única |

**Operaciones:**
- alta;
- cambio de plan: la subida se aplica al momento; la bajada, al final del periodo;
- añadir o retirar extensión o módulo sectorial;
- cancelación programada (motivo obligatorio);
- reactivación;
- cambio de periodicidad;
- registro de consumo;
- renovaciones bajo demanda.

**Garantías:**
- Cada operación es una transacción con `SELECT … FOR UPDATE`, comprobación de versión y evento de auditoría.
- Una versión desfasada se rechaza; nunca se pisa.
- **Compatibilidad:** convive con la facturación v1 existente. Nadie se migra automáticamente.
- Solo usa productos publicados y precios aprobados del catálogo de la web.
- `licencePlan` describe qué licencias corresponderían, con `applied: false`: **no activa ni retira licencias**.

**API:** `/cp/v1/subscriptions`, con los ámbitos nuevos `subscriptions:read` y `subscriptions:write`. Lectura para comercial y solo lectura, nada para soporte y todo para admin. **No hay rutas de cobro.**

Detalle operativo en `docs/runbooks/SUSCRIPCIONES_V1.md`.

---

## 6. Facturación (modo sombra)

**Nunca cobra.** El proveedor de pago es `SimulatedProvider`, sin red.

| Riesgo de la fase 5 | Cómo queda resuelto |
|---|---|
| Facturas duplicadas | Clave única `(suscripción, tipo, periodo, dedupe)` y hash de entradas: repetir el cálculo devuelve la misma factura |
| Reintentos con claves distintas | La clave del intento se deriva de la factura (`inv:<id>:a<n>`), nunca del cliente |
| Estado «procesando» mal leído | Ante un resultado desconocido o en curso, se **consulta** con la misma clave; nunca se reintenta a ciegas |
| Webhooks no idempotentes | Tabla de eventos con id único; un webhook repetido no cambia nada |
| Concurrencia | Bloqueo de fila y versión; probado con escrituras simultáneas en MySQL |
| Cambios retroactivos de precio | Se factura la instantánea contratada; si el catálogo cambia, se detecta como **deriva**, no se aplica |

**Qué calcula:** renovaciones; prorrateo al subir de plan (abona lo no consumido del plan anterior, nunca en negativo); cargos únicos; y consumo, solo cuando el periodo está cerrado. Los periodos de prueba no se facturan. Además compara con el importe del contrato (`contractDiffCents`) para detectar diferencias.

---

## 7. CRM

**Comercial → Suscripciones (#11):**
- listado, ficha, formularios de cada operación, historial, vista previa del periodo y simulación;
- el aviso «modo sombra» es visible en todas las pantallas;
- **no hay botones de cobro, emisión de facturas ni activación de licencias**;
- el servidor exige los ámbitos en cada llamada; ocultar botones no se usa como protección.

**Correcciones de la auditoría (#12):**

| Id | Hallazgo | Estado |
|---|---|---|
| A1 | «1.500 €» se guardaba como 1,50 €. Al editar un precio de 10.000 € o más, el propio CRM lo mostraba como «12.999» y al guardar quedaba en 12,99 € | Corregido con un único análisis de importes para todo el CRM |
| A2 | Cancelar la confirmación de una edición de contrato mostraba «hecho» y borraba lo editado | Corregido |
| M1 | El patrón del id en el alta de plataforma era inválido en navegadores actuales | Corregido |
| M2 | Enlace al repositorio de un módulo sin validar | Corregido (solo https) |
| M5 | Un error cerraba los paneles de suscripciones | Corregido |
| B1 | Id de cliente de la ruta sin validar | Corregido (regla del registro) |
| M3 | Acciones de escritura visibles a roles sin permiso (el servidor las rechaza) | Pendiente |
| M6 | Fechas de promociones desplazadas un día | Pendiente |
| — | Accesibilidad (etiquetas y foco en paneles) | Pendiente |

---

## 8. Integración

**Orden** (detalle en el runbook):
1. **Paso 0 · web:** #1 → #2 → #3 → #4. Sin despliegue.
2. **Paso 1 · plan de esquema de solo lectura en producción:** **bloqueado**; hace falta una clave SSH propia o que lo ejecutes tú.
3. **Paso 2 · Core, un PR por despliegue verificado:** #91 (CI) → #79 (arranque sin DDL, el primero de código) → … → #77 → #88 → #89 → #90 → #86 → #87.
4. **Paso 3 · CRM:** #1 … #12. Sin despliegue.

**Por qué uno a uno:** cada push a `main` del Core despliega Náyade en unos 4 segundos, sin esperar al CI, **incluso si solo cambia documentación**.

**Recuperación por capa:** el runbook distingue código (`git revert` o *rollback* de Railway), esquema de Náyade, esquema del plano de control, datos y configuración. Deja claro que **`git revert` no basta** si una migración o un script cambió el esquema o los datos.

**Compatibilidad a vigilar:** con #90, activar un contrato exige `provisioning:write`, y `billing:write` si tiene plan. Los operadores admin ya los tienen; hay que revisar los tokens de servicio que activen contratos.

---

## 9. Producción

- **Sin cambios.** Despliegue activo `baeca78` (`www.nayadeexperiences.es`). Railway solo se ha consultado en modo lectura.
- **Fallo del acceso SSH:** la CLI ofreció una clave de otro proyecto y Railway la rechazó. **No se ha registrado ninguna clave ni se ha usado ninguna ajena.**
- **Propuesta para que un push a `main` no despliegue Náyade antes del CI** (`docs/infra/ARQUITECTURA_LANZAMIENTO.md` §2):
  - **A.** Activar «Wait for CI» en el servicio de Náyade.
  - **B.** *Watch paths*: solo despliegan los cambios que entran en el binario de Náyade. El plano de control, CRM, web, suscripciones, pruebas, `db/`, `docs/` y `scripts/` no entran, como confirma la guarda #88.
  - **C.** Separar servicios.
- **Arquitectura de lanzamiento propuesta:**
  - proyecto «Big Elephant» con `www`, `crm` y `control` en `bigelephant.es`;
  - MySQL propio del plano de control con esquemas `be_registry`, `be_crm`, `be_billing` y `be_erm`;
  - copias de seguridad, observabilidad, secretos y orden de arranque.

  Solo se citan nombres de variables, nunca valores.

---

## 10. Pendientes

**Bloqueados (necesitan tu autorización):**
- todas las fusiones (Core, CRM y web);
- el plan de esquema de solo lectura en producción (clave SSH);
- configurar Railway («Wait for CI», *watch paths*);
- hacer privado el repositorio o limpiar el historial de `.manus/`;
- rotar credenciales;
- actualizar dependencias con avisos de seguridad;
- activar la prueba de 15 días;
- cualquier cobro real.

**Hallazgos sin corregir:**
- **Core:**
  - la activación de contrato no comprueba antes que el id de tenant esté libre;
  - el bloqueo de operadores por intentos fallidos permite un DoS dirigido;
  - mensajes de error del aprovisionamiento llegan al cliente;
  - `grant` y `setStatus` de licencias no son atómicos;
  - el gancho de publicación de la web se come los errores.
- **CRM:** M3, M6 y accesibilidad.
- **Web:**
  - filtro de fechas de promociones;
  - textos fijos;
  - jerarquía de encabezados;
  - `noindex` del sitemap;
  - nombre del campo trampa del formulario;
  - se pierde `?modulo=`.
- **Entorno de pruebas:** los E2E de la web comercial necesitan la web en `:4180` apuntando al mismo plano de control de pruebas.

---

## 11. Decisiones para Jorge

1. **`.manus/` en el repositorio público (urgente).**
   - **Qué hay:** el Core es **público** y versiona 399 ficheros exportados de la plataforma anterior: host y usuario de la base de datos anterior, teléfonos, correos, tokens de enlaces de pago y hashes de contraseñas.
   - **Qué hace #89:** deja de versionarlos, pero **siguen en el historial**.
   - **Hay que decidir:**
     - hacer privado el repositorio;
     - limpiar el historial (reescritura: la lanzas tú);
     - rotar credenciales;
     - invalidar los tokens de pago;
     - forzar cambios de contraseña;
     - valorar la notificación RGPD.
2. **Railway: «esperar al CI» y *watch paths* en Náyade**, antes de fusionar nada del Core. Con #91, el CI pasa a cubrir todas las pruebas SaaS.
3. **Autorizar la integración por bloques según el runbook:**
   - Bloque 1 (web #1–#4), que no despliega;
   - después #91 y #79 como primeros del Core, uno a uno, con verificación en Railway.
4. **Plan de esquema de solo lectura en producción:** registrar una clave SSH **propia** para esta tarea, o ejecutarlo tú (#83, sin `--apply`).
5. **Aprobar el diseño del motor de suscripciones v1 y el modo sombra.** Las reglas que conviene confirmar:
   - subida inmediata con prorrateo;
   - bajada al final del periodo;
   - sin abonos por retirar partidas;
   - consumo facturado al cerrar el periodo;
   - prueba sin facturar.

   Pasar a cobros reales requiere otra autorización.
