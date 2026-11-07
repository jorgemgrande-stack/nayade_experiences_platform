# Life Net: definición vigente, alcance funcional y encaje de la contratación personal

**Fecha:** 07/11/2026 · **Estado:** análisis previo a construir. No cambia código, catálogo ni Stripe.

**Decisión de negocio de Jorge (07/11/2026):** Life Net será un producto personal, independiente de Essential, con un precio comercial de 9 €/mes. Debe reutilizar la plataforma y los servicios existentes y ofrecer una experiencia personal simplificada. Antes de construirlo hay que:
- recuperar su definición comercial vigente;
- preparar su alcance funcional exacto;
- no inventar funcionalidades ni crear una segunda plataforma;
- no modificar Stripe ni activar cobros hasta verificar cómo encaja la contratación personal.

**Fuentes leídas (solo lectura):**

| Repositorio | Rama | Commit |
|---|---|---|
| Core | `origin/integration/elephant-source` | `79e6a5db` |
| CRM | `origin/integration/elephant-source` | `901064d` |
| Web comercial | `origin/feat/elephant-web-portfolio` | `650e469` |
| `segolife` | rama local | `2df51d7` |

Las citas tienen la forma `ruta:línea` dentro de cada repositorio. No se ha consultado Stripe.

---

## 1. Definición comercial vigente

### 1.1 Qué dice cada fuente

**Core: registro de los 7 productos Net** (`shared/netProducts.ts`, decisión del 07/11/2026). Es la definición más reciente y la única con funcionalidades.

| Campo | Valor | Cita |
|---|---|---|
| Clave | `life-net` | `shared/netProducts.ts:160` |
| Licencia | `LIFE_NET` | `shared/netProducts.ts:161` |
| Nombre | «Life Net» | `shared/netProducts.ts:162` |
| Segmento | `personal` (los otros seis son `business`) | `shared/netProducts.ts:164` |
| Portada del panel | `/admin/net/life` | `shared/netProducts.ts:165` |
| Resumen | «Organización personal y familiar: agenda, tareas, recordatorios y actividades compartidas de los miembros del hogar.» | `shared/netProducts.ts:166` |
| Beneficios | «La agenda de toda la familia en un solo calendario.» · «Tareas y recordatorios compartidos.» · «Seguimiento de actividades y compromisos de cada miembro.» | `shared/netProducts.ts:167` |
| Área «Organización» | Organización personal · Gestión familiar · Calendario y agenda · Tareas y recordatorios. Todas «Próximamente» | `shared/netProducts.ts:170` |
| Área «Hogar» | Actividades compartidas · Organización de miembros del hogar · Seguimiento de actividades y compromisos. Todas «Próximamente» | `shared/netProducts.ts:171` |
| Antiguas extensiones | ninguna (`legacyKeys: []`) | `shared/netProducts.ts:168` |

El estado `coming_soon` («Próximamente») significa que la función no está operativa hoy en el Core (`shared/netProducts.ts:12-13`).

**Core: semilla del catálogo** (`server/catalog/elephantSourceV1.ts`).
- `server/catalog/elephantSourceV1.ts:275`:
  - familia `net_module`, grupo `life`, ámbito `company`;
  - lema «Organización personal y familiar.»;
  - estado técnico `planned` y estado comercial `coming_soon`;
  - precio mensual de 9 €, sin tarifa anual;
  - capacidad `life-net`;
  - público: «Profesionales y familias.»;
  - icono `leaf`.
- Importes sin IVA (21 % aparte): `server/catalog/elephantSourceV1.ts:12`.
- Nombre de la línea: «Elephant Life Net» (`server/catalog/elephantSourceV1.ts:345`).
- «Life Net es un producto, no un componente» (`server/catalog/elephantSourceV1.ts:232`).

**Core: capacidad.** `c("life-net", "Life Net", "extra", "net", "planned")` (`server/catalog/capabilities.ts:109`).

**Core: ficha comercial** (`server/catalog/commercial/specs.ts:499-515`):

| Campo | Valor |
|---|---|
| Categoría | `sector_module` |
| Descripción larga | «Organización personal y familiar con Big Elephant. Llegará próximamente: anunciaremos sus funciones cuando esté disponible.» |
| `includes` y `excludes` | vacíos |
| Regla de capacidad | «Por empresa» |
| Implantación | nivel 3, «Definición funcional y desarrollo nuevo» |
| Grado verificado | `none`, «Ninguna funcionalidad identificada» |
| Titular | «Próximamente: organización personal y familiar.» |
| Llamada a la acción | `waitlist` |
| SEO | `life-net`, «Big Elephant Life Net (próximamente)» |
| Decisión pendiente | «Definición funcional antes de comprometer plazos» |

La prueba `server/commercialSpecs.test.ts:38` impide que la ficha pública lleve notas internas (corrección del Core #480).

**Core: panel.**
- Sección «Life Net» con un único elemento, «Panel general» (`shared/panelExtensions.ts:356`, `shared/panelExtensions.ts:364-366`).
- Módulo integrado `life_net` «Organización personal y familiar» (`server/_core/modules/builtin.ts:120`).
- Asistente de configuración: «Life Net» sin enlace (`shared/setupWizard.ts:288`).

**Core: documentación.**
- `docs/elephant-net-connect-integration-matrix.md:177` y `:186-208`:
  - el modelo comercial está pendiente de decidir entre «(a) Hogar con Essential» y «(b) Producto personal sin Core»;
  - según el documento, no hay código ni definición en Skicenter, Hotel Nayade ni el Core (`:189`);
  - recoge una lista de reutilizaciones y una propuesta de primera entrega.
- `docs/runbooks/CATALOGO_COMERCIAL_UNIFICADO.md:113`: «Los módulos Net sueltos (`net_module`, incluido Life Net, que no tiene paquete) siguen siendo módulos individuales que requieren un plan de Elephant Core».

**CRM.**
- Grupo `life` con el nombre «Elephant Life Net» (`src/catalog.ts:167`).
- `"life-net": { name: "Life Net", licence: "LIFE_NET" }` dentro de los 7 productos Net (`src/catalog.ts:175-183`).
- Datos de prueba: `net_module`, `coming_soon`, 900 céntimos (`src/catalog.test.ts:51`).
- El CRM no tiene una ficha propia de Life Net: la ficha comercial publicada sale del Core (`specs.ts`), y en production la fuente de verdad es la BD del catálogo (`server/catalog/elephantSourceV1.ts:9`).

**Web comercial.** Instantánea del catálogo publicado del 30/10/2026: `src/data/catalog.generated.json:6`, versión `6b43857b9833d6b8`.

| Dato | Valor | Cita |
|---|---|---|
| Nombre | «Life Net» | `:2465` |
| Lema | «Organización personal y familiar.» | `:2481` |
| Estado comercial | `coming_soon` | `:2478` |
| Nivel de implantación | 3 | `:2479` |
| Descripción larga | la misma que la ficha del Core | `:2503` |
| Público | «Profesionales y familias.» | `:2494` |
| Regla de capacidad | «Por empresa» | `:2500-2502` |
| Llamada a la acción | `waitlist` | `:2488` |
| Familia | `net_module` | `:2525` |
| Precio | 900 céntimos mensuales, `taxIncluded: false`, IVA 21 % | `:2527-2536` |

La página `/elephant-net/life` sale de `src/pages/elephant-net/[familia].astro`. Como Life Net no tiene `coreIncluded`, muestra:
- «Requiere un plan de Elephant Core» y «Elephant Core se contrata aparte» (`src/data/netTerms.ts:52-65`);
- «Para toda la empresa» y «Una licencia para toda la empresa. Precios mensuales sin IVA» (`src/pages/elephant-net/[familia].astro:84-86`);
- «Tu sector, con los clientes y la facturación de tu plan» (`:110-112`).

El inventario de la web recoge su llamada «Avísame → /contacto?tipo=modulo&modulo=life-net&aviso=1» (`docs/REFACTORIZACION-WEB-INVENTARIO.md:228`).

**`segolife`: no tiene relación con Life Net.**
- Es una plataforma de comunidades universitarias (IE y UVA): locales, eventos y SegoTokens. Ver `docs/SEGOLIFE_DOMAIN_MODEL.md:1-40` y `docs/SEGOLIFE_ROADMAP.md:14-36`.
- En el Core es el origen de **Social Token Net** (`server/catalog/commercial/specs.ts:527`, `:544`, `:561`).
- Ningún documento de `segolife` menciona Life Net, organización personal ni familias.

### 1.2 Discrepancias entre fuentes

| # | Tema | Fuente A | Fuente B | Comentario |
|---|---|---|---|---|
| D1 | **Dependencia de Elephant Core** | Decisión de Jorge del 07/11: «independiente de Essential» | El runbook (`CATALOGO_COMERCIAL_UNIFICADO.md:113`) dice que requiere un plan de Core. La web (`netTerms.ts:56-57`) dice «Requiere un plan de Elephant Core». El cotizador exige siempre un plan `core_plan` (`server/catalog/quote.ts:142-145`) | Contradicción directa: hay que corregir el código y los textos cuando se construya (sección 3) |
| D2 | **Destinatario** | `segment: "personal"` (`netProducts.ts:164`) y la decisión: «producto personal» | «Profesionales y familias», «Por empresa», ámbito `company` (`elephantSourceV1.ts:275`, `specs.ts:504,508`). La web dice «Para toda la empresa» | «Profesionales» no casa con un producto personal |
| D3 | **Funcionalidades** | 7 funciones y 3 beneficios (`netProducts.ts:166-171`) | La ficha publicada dice «anunciaremos sus funciones», con `includes: []`, `benefits: []` y «Ninguna funcionalidad identificada» (`specs.ts:502-512`). La web no muestra ninguna función | La ficha pública es anterior a la unificación del 07/11 y aún no lleva las 7 funciones |
| D4 | **Precio e IVA** | «9 €/mes» (decisión) | 900 céntimos **sin IVA** (`elephantSourceV1.ts:12`, web `taxIncluded: false`): 10,89 € con el 21 % | A un particular se le debe mostrar el precio final con impuestos (`server/stripe/eligibility.ts:15`). Ver la decisión J3 |
| D5 | **Tarifa anual** | Sin tarifa anual (`elephantSourceV1.ts:275`) | Los planes de autoservicio exigen exactamente una tarifa mensual y otra anual aprobadas (`server/stripe/catalog.ts:97-108`) | Solo importa si Life pasa a ser un plan (sección 3.3) |
| D6 | **Nombre** | «Life Net» (`netProducts.ts:162`; CRM `src/catalog.ts:182`) | «Elephant Life Net» (línea, `elephantSourceV1.ts:345`; CRM `src/catalog.ts:167`) y «Big Elephant Life Net (próximamente)» (SEO, `specs.ts:513`) | Igual que en los otros Net: no es un conflicto real |
| D7 | **Modelo en la matriz** | La opción (b) se llama «Producto personal sin Core» (`integration-matrix.md:196`) | La decisión pide «reutilizar la plataforma y los servicios existentes» | Hay que leer (b) como «sin plan Essential», no «fuera de la plataforma» |
| D8 | **Escaparate de empresas** | Life Net sale en el marketplace del panel de cualquier empresa (`server/connectMarketplace.test.ts:156-165`) | Producto personal | Hay que decidir si una empresa puede seguir viéndolo y contratándolo (J7) |

---

## 2. Alcance funcional exacto

**Regla del alcance.** Entran solo las 7 funciones de `shared/netProducts.ts:170-171`. Los 3 beneficios (`:167`) describen esas mismas funciones y no añaden ninguna. Ninguna fuente define otra funcionalidad.

En la tabla, «Reutilización» indica qué servicio existente del Core cubriría la función y «Falta» lo que hay que construir.

| # | Función (cita) | Reutilización (servicio existente del Core) | Falta |
|---|---|---|---|
| F1 | **Organización personal** (`netProducts.ts:170`) | Portada de la sección «Life Net», que ya existe con su «Panel general» (`shared/panelExtensions.ts:356,364-366`). Menú filtrado por capacidades (`shared/adminNav.ts`, cada entrada con `capabilities`) | Contenido de la portada: tareas, recordatorios y agenda del usuario. Hoy la ruta solo existe como «Panel general» del producto |
| F2 | **Gestión familiar** (`netProducts.ts:170`) | Un hogar es una empresa (tenant) con su BD propia (`server/_core/provisioning/types.ts:9-22`). Usuarios, roles e invitaciones del panel: capacidad `admin-users` (`server/catalog/capabilities.ts:59`; ruta `admin` en `server/_core/capabilities/routeGuard.ts:73`; invitaciones en `server/routers.ts:63-69`) | Roles propios del hogar, porque los actuales son de equipo comercial. Pantalla de alta de miembros en lenguaje personal |
| F3 | **Calendario y agenda** (`netProducts.ts:170`) | Hay un calendario en `/admin/operaciones/calendario`, capacidad `bookings-generic` de Business (`shared/adminNav.ts:299-302`; `capabilities.ts:67`). Pero muestra **reservas de clientes**, no eventos personales: se reutilizan sus componentes de interfaz, no su modelo | Modelo de eventos personales y del hogar, con API y vista |
| F4 | **Tareas y recordatorios** (`netProducts.ts:170`) | Tabla `crm_tasks`: título, descripción, fecha límite, persona asignada, estado, prioridad y entidad **opcional** (`drizzle/schema.ts:3655-3671`). Capacidad `crm-tasks` (`capabilities.ts:40`; `routeGuard.ts:34,36`). Vencidas en el panel con `dueTasksFor` (`server/crmTasksDb.ts:253-259`; `server/routers/notifications.ts:40`). Correo transaccional `comms-email` (`capabilities.ts:60`) | Hoy la tabla es de **tareas comerciales**: el propio esquema dice «sin envíos automáticos» (`schema.ts:3655`). Falta el aviso por correo al vencer y la tarea programada por empresa. Falta decidir si se reutiliza `crm_tasks` o se crea una tabla propia (decisión técnica T1) |
| F5 | **Actividades compartidas** (`netProducts.ts:171`) | La asignación de usuarios de `crm_tasks` (`assignedTo`, `schema.ts:3661`) y la agenda de F3 | Compartir una actividad entre varios miembros: hoy una tarea tiene un solo responsable |
| F6 | **Organización de miembros del hogar** (`netProducts.ts:171`) | Usuarios del tenant (F2). Cupo de usuarios del sistema de límites: métrica `users` (`elephantSourceV1.ts:163`) | Falta decidir si un miembro es siempre un usuario con acceso o también puede ser una ficha sin acceso, como un menor (decisión J5). Falta el número de miembros incluidos |
| F7 | **Seguimiento de actividades y compromisos** (`netProducts.ts:171`) | Estado, fecha y autor de la finalización en `crm_tasks` (`completedAt` y `completedBy`, `schema.ts:3667-3668`). Historial de actividad (`crm-activity`, `capabilities.ts:36`) | Vista de seguimiento por miembro, con lo pendiente y lo hecho |

**Fuera del alcance:** cualquier función que no figure arriba, por ejemplo:
- finanzas del hogar;
- documentos;
- compras;
- mensajería;
- aplicación móvil;
- integraciones con calendarios externos.

Ninguna aparece en las definiciones vigentes. Añadir cualquiera es una decisión de negocio (J8).

**Experiencia personal simplificada.** La decisión la pide, pero no define pantallas. El Core ya tiene dos piezas para darla sin crear otra aplicación:
- el menú y las rutas se filtran por capacidad (`shared/adminNav.ts`, `routeGuard.ts`);
- la portada se decide por plan (`client/src/pages/admin/home/EssentialHome.tsx` para Essential).

Un tenant que solo tenga las capacidades de Life no vería CRM, tienda, CMS ni facturación. El trabajo pendiente es el vocabulario («miembros», no «empleados» ni «clientes»), que tiene precedente en `server/panelVocabulary.ts`.

**Propuesta técnica ya documentada** (`integration-matrix.md:204-208`):
- módulo SDK `lifeNet`;
- tablas `life_members`, `life_events`, `life_tasks` y `life_reminders`;
- una tarea programada de recordatorios por empresa;
- menú propio.

Es compatible con este alcance. La alternativa es reutilizar `crm_tasks` para F4 en lugar de crear `life_tasks` (T1).

---

## 3. Encaje de la contratación personal en el sistema actual

### 3.1 Cómo se crea hoy una empresa o tenant

**Recorrido de un pedido** (`server/orchestrator/types.ts:4-10`):

`requested → quoted → contracted → confirmed → subscribed → licensed → active`

- El pedido pertenece a una empresa del CRM (`companyId`, `server/orchestrator/types.ts:111`).
- Su petición siempre lleva un `plan` (`server/catalog/quote.ts:57-69`).
- El cotizador rechaza cualquier petición cuyo plan no sea de la familia `core_plan` (`quote.ts:142-145`).

**Aprovisionamiento** (`server/_core/provisioning/types.ts:9-22`). Sus pasos son: registro, BD física con usuario propio, esquema y migraciones, módulos, administrador, subdominio, marca, plantilla, derechos y cupos. **Cada empresa tiene su propia base de datos.**

**Prueba gratuita.**
- El alta pide solo correo y nombre de empresa (`server/trials/api.ts:59`).
- Es siempre de Essential, 15 días (`server/trials/onboarding.ts:2-6`, `:24` `ESSENTIAL_PLAN`).

**Licencias.** Se calculan como capacidades del plan, con su herencia, más las de cada partida (`server/licensing/service.ts:1-20`, `capabilitiesOf` en `:32-38`).

**¿Exige el Core datos de empresa?** No, salvo el nombre.
- En el CRM, `legalName` y `taxId` admiten `null` (`server/crm/types.ts:36-40`).
- En el perfil fiscal de un particular se piden nombre y apellidos. El NIF es opcional y «nunca se exige razón social» (`server/stripe/buyerProfile.ts:136-144`; `docs/elephant-source/CONTRATACION_B2B_B2C.md:35-44`).
- El autoservicio documenta que «un particular no da razón social» (`server/stripe/selfService.ts:5-12`).
- La pega: el nombre de la entidad sigue siendo «empresa» (`companyName` en la prueba, `company.name` en el CRM). Para un hogar se usaría el nombre del titular o «Hogar de…» (J6).

### 3.2 Compra en línea hoy

**Interruptor.** `CP_COMMERCE_PURCHASES_ENABLED=1` en el plano de control; sin él, la compra responde 503 (`server/controlPlane/main.ts:529-534`; `server/stripe/purchases.ts:157`).

**Bloqueo del panel** (`server/routers/connectRouter.ts:146-148`). `purchaseBlock` vale:
- `role` si quien compra no es administrador;
- `trial` si la empresa está en prueba;
- `plan` si el plan no es Essential ni Business;
- `closed` si la compra está apagada;
- `null` si se puede comprar.

**Compra del panel** (`server/stripe/purchases.ts`):
- solo añade complementos a una suscripción de Essential o Business (`:263-265`);
- exige que la empresa ya tenga plataforma (`:230`);
- exige que el producto esté «available», sea de una familia comprable y tenga Price (`:280`).

**Planes de autoservicio.** Solo `essential` y `business` (`server/stripe/catalog.ts:26-33`), y cada uno necesita una tarifa mensual y otra anual aprobadas en EUR (`:97-108`). El alta pública acepta solo esos dos planes (`server/stripe/selfService.ts:65,74`). Además está apagada salvo `CP_PUBLIC_SELF_SERVICE_ENABLED=1` (`selfService.ts:2-4`).

**Conclusión.** Hoy Life Net solo se podría contratar como **complemento de 9 € sobre Essential o Business**: la opción (a) de la matriz, contraria a la decisión. Aun así haría falta pasarla a «Disponible» y crear su Price.

### 3.3 Facturación a particulares (B2C)

El código lo contempla, pero **todo está apagado o pendiente de decisión legal y fiscal**.

**Contratación de particulares.** Bloqueada mientras falte cualquiera de estas variables (`server/stripe/buyerProfile.ts:211-217`; `docs/elephant-source/CONTRATACION_B2B_B2C.md:43-44,117-120`):
- `CP_CONSUMER_WITHDRAWAL`, la decisión sobre el desistimiento (por defecto `pending`);
- `CP_PRECONTRACT_VERSION`, la información precontractual publicada.

**Elegibilidad** (`server/stripe/eligibility.ts:1-22`). Exige además:
- el escenario `consumer:es_mainland` aprobado en `CP_STRIPE_FISCAL_SCENARIOS` (hoy solo está `business:es_mainland`: `docs/elephant-source/FACTURACION_FISCAL.md:136`);
- un tipo de impuesto decidido para mostrar el precio final (`CP_STRIPE_CONSUMER_RATES`, `eligibility.ts:15,124-134,187-200`).

**Factura** (Big Elephant la emite con `server/invoicing`, `FACTURACION_FISCAL.md:3-20`).
- El caso `consumer:es_mainland` figura como `ready` en la matriz fiscal (`server/invoicing/fiscalMatrix.ts:189-204`). Para activarlo hacen falta `CP_INVOICING_FISCAL_CASES`, la decisión sobre el desistimiento y `CP_INVOICING_SIMPLIFIED=1`.
- Un particular sin NIF recibe una **factura simplificada**, con un límite de 400 € IVA incluido (`FACTURACION_FISCAL.md:139-145`). Holgado para 9 €/mes.
- El caso `consumer:eu` está bloqueado si no se declara el régimen. Con `below_threshold` cobra el IVA español (`fiscalMatrix.ts:266-298`).

### 3.4 Prices de Stripe de `life-net` (según el código, sin consultar Stripe)

- Un producto solo recibe Price si está «available» o si se ha preparado antes de abrir la venta (`server/stripe/catalog.ts:6-14,69-79,110`).
- La preparación automática solo afecta a `connect` y `connect_bundle`. Cualquier otro producto necesita `catalog.stripePrepared: true` en su ficha del CRM (`catalog.ts:70-79`).
- `life-net` está en `coming_soon`. Por eso **el código no prevé ningún Price para `life-net`**.
- Las claves de Price serían `es:life-net:monthly:eur:v<id>` (`catalog.ts:64`), y el servicio nunca escribe en Stripe: solo planifica y lee (`catalog.ts:18-20`).
- En el repositorio no hay ninguna referencia a `es:life-net`. La frase «conserva sus precios de Stripe» (`shared/netProducts.ts:9-10`) es genérica para los 7 productos y en Life Net no apunta a ningún Price.
- **Pendiente de verificar en Stripe (no hecho):** que no exista un Product o Price de Life Net creado a mano.

### 3.5 Opciones de encaje

| Opción | Qué es | Encaje con la decisión | Cambios necesarios | Riesgos |
|---|---|---|---|---|
| **A. Hogar con Essential + Life Net** | Empresa con plan Essential y Life Net como complemento de 9 € | **No**: depende de Essential (38 €/mes en total) | Pasar a «Disponible» y crear el Price | Contradice la decisión. La interfaz enseñaría CRM, tienda y facturación a un particular |
| **B. Plan personal «Life»** (recomendada) | Un tenant por hogar con un **plan propio** de la familia `core_plan`. Concede solo `life-net` y las capacidades base necesarias, como `admin-users` y `comms-email`, sin CRM, tienda, CMS ni facturación | **Sí**: misma plataforma, mismo orquestador, licencias, aprovisionamiento y facturación | (1) Plan en el catálogo, por el circuito de borrador → aprobación → publicación. (2) Ampliar `SELF_SERVICE_PLANS` y `STRIPE_PRODUCT_NAME` (`server/stripe/catalog.ts:26-33`) y quitar la exigencia de tarifa anual para este plan (`:97-108`), o aprobar una. (3) Alta del autoservicio para el plan (`selfService.ts:65,74`). (4) Prueba de Life, o ninguna: hoy la prueba es solo de Essential (`trials/onboarding.ts:24`). (5) Cupos del plan: miembros y almacenamiento. (6) Activar el circuito B2C (3.3). (7) Fichas y web sin «Requiere un plan de Elephant Core» (D1). (8) Decidir qué pasa con la clave `life-net` (J2) | Una BD física por hogar a 9 €/mes: hay que medir el coste por tenant. Tocar la contratación y Stripe es una publicación protegida. Las prohibiciones de compra en el panel (`purchaseBlock: "plan"`) dejan a un hogar sin marketplace, lo que es coherente. El vocabulario de «empresa» aparece por todo el ciclo (CRM, facturas, correos) |
| **C. Un único tenant «Life» con muchos hogares** | Todos los hogares dentro de una sola empresa | **No recomendable** | Modelo de datos multihogar dentro de un tenant | Rompe el aislamiento por empresa en BD, licencias, facturación y copias. En la práctica es una segunda plataforma, lo que la decisión prohíbe |

**Detalle de la opción B.** La pieza que más se acerca en el código es la regla «Core incluido» (`server/catalog/commercial/policy.ts:52-78`): un Net completo incluye Essential por el precio del paquete. No sirve tal cual para Life, por tres razones:
- con 9 € no se puede incluir Essential (29 €);
- `NET_COMPLETE` no contiene `life-net` (`policy.ts:72`);
- la regla «Net adicional, −29 €» daría un importe negativo.

Por eso la opción B se resuelve como un **plan** propio y no como un Net con Core incluido.

### 3.6 Decisiones que necesita Jorge

| # | Decisión | Por qué bloquea |
|---|---|---|
| J1 | Confirmar la **opción B** (plan personal «Life», un tenant por hogar) | Determina todo el desarrollo y los cambios en la contratación |
| J2 | Clave comercial: (i) reconvertir `life-net` en plan o (ii) crear un plan nuevo y dejar `life-net` como capacidad o licencia (`LIFE_NET`) | `life-net` no tiene Prices, contratos ni licencias, así que el riesgo es bajo, pero cambia su familia en el catálogo y en el CRM |
| J3 | **9 € IVA incluido** (base 7,44 €) o **9 € + IVA** (10,89 € para el particular) | Hoy el catálogo guarda importes sin IVA y a un consumidor se le muestra el precio final |
| J4 | Tarifa anual sí o no (y su importe), y si hay prueba gratuita de Life (días) | Los planes de autoservicio exigen hoy una tarifa anual. La prueba actual es solo de Essential |
| J5 | Miembros: cuántos incluye el precio y si un miembro puede ser una ficha sin acceso, como un menor | Define F2 y F6 y los cupos del plan |
| J6 | Datos del titular para el alta: nombre del hogar o del titular en lugar de razón social | El modelo exige un nombre de «empresa» |
| J7 | ¿Puede una **empresa** seguir contratando Life Net como complemento? ¿Sale en el marketplace de los paneles de empresa? | Hoy aparece en el escaparate de empresas (D8) |
| J8 | Confirmar que el alcance son **solo** las 7 funciones de la sección 2 | Cualquier añadido es una decisión nueva |
| J9 | Legal y fiscal (con el asesor): desistimiento (`CP_CONSUMER_WITHDRAWAL`), información precontractual, `consumer:es_mainland` en Stripe y en facturación, facturas simplificadas, y si se abren particulares de la UE | Sin esto no se puede cobrar a un particular (3.3) |
| J10 | Cuándo actualizar la ficha pública: sigue diciendo «anunciaremos sus funciones» y «Requiere un plan de Elephant Core» | Coherencia comercial (D1 a D3). Puede ir antes del desarrollo si las funciones se muestran como «Próximamente» |

**Decisiones técnicas** (no las toma Jorge):
- T1: reutilizar `crm_tasks` o crear tablas `life_*`;
- T2: medir el coste de una BD por hogar;
- T3: portada y vocabulario personal en el panel.

### 3.7 Lo que no se ha hecho

- No se ha modificado Stripe ni el catálogo.
- No se ha cambiado ningún estado comercial.
- No se ha activado ningún cobro ni ninguna variable.
- No se ha consultado Stripe.
- Este documento es la única modificación.
