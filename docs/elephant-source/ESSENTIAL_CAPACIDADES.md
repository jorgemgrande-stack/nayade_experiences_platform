# Validación funcional de Essential (Fase P0)

Fecha: 2026-10-16. Rama `test/essential-capacidades`.

**Fuente de verdad:** `server/catalog/capabilities.ts`. `capabilitiesOfTier("essential")` devuelve **29 capacidades**, la misma cifra que indicaba el informe previo.

## Veredicto

**Essential todavía no puede comercializarse como completo.** De las 29 capacidades:

| Estado | Nº | Capacidades |
|---|---|---|
| FUNCIONAL | 6 | crm-contacts, crm-leads, cms-pages-forms, bill-payments, admin-panel, shop-orders* |
| FUNCIONAL CON LIMITACIONES | 22 | crm-accounts, crm-activity, crm-tags, crm-quotes, crm-tasks, shop-catalog, shop-variants, shop-store, shop-checkout, shop-coupons, cms-editor, cms-domain, cms-seo, bill-invoices, bill-series, bill-taxes, bill-cash, bill-reports, admin-users, comms-email, auto-basic, comms-whatsapp-links |
| INCOMPLETA | 0 | — |
| BLOQUEADA | 0 | — (ver bloqueantes de lanzamiento más abajo) |
| NO IMPLEMENTADA | 1 | cms-blog |

\* shop-orders funciona; la devolución se registra, pero el reembolso se ejecuta fuera de la plataforma (ver la matriz).

Para venderlo como completo hace falta:

1. **Implementar** el blog (`cms-blog`), o sacarlo de Essential en el catálogo comercial. No existe código. ~~Etiquetas del CRM (`crm-tags`)~~ **Resuelto (rama `feat/crm-etiquetas-tareas`):** catálogo por empresa, asignación a clientes y oportunidades y filtro de listados. Requiere aplicar la migración `0008_crm_tags_tasks`.
2. ~~**Completar `crm-tasks`.**~~ **Resuelto (rama `feat/crm-etiquetas-tareas`):** tareas internas con vencimiento, responsable, estado, prioridad y vínculo a cliente, oportunidad o presupuesto; «Mis tareas», vencidas destacadas, pendientes en el Inicio y en la campana de avisos (sin correos). Misma migración `0008`.
3. ~~**Completar `comms-whatsapp-links` y corregir la fuga de marca del botón de WhatsApp.**~~ **Resuelto en la integración (PR #113):** el botón usa el número de la propia empresa (`public.getTheme` → `contact.whatsapp`, desde su teléfono) y no aparece si no lo tiene; en instalación única, igual que antes. Prueba: `essential.admin.mysql.test.ts`.
4. **Requisitos de plataforma**, de los que dependen varias capacidades:
   - Proveedor de correo de la plataforma (`BREVO_API_KEY`) más el remitente propio de cada empresa.
   - Almacenamiento S3 para los PDF y la subida de medios. Para facturas hay vista bajo demanda sin S3.
   - Cuenta Redsys propia de cada empresa (Integraciones) para el cobro online.
5. ~~**Botones que faltan en el panel**: alta de caja del TPV.~~ **Resuelto (PR #113):** botón «Nueva caja». Queda que la pantalla del TPV usa siempre la caja 1 (sin selector).
6. **Rellenar los datos que faltan a las empresas ya aprovisionadas** antes de esta rama. No tienen las filas de ajustes ni los flags que ahora siembra el aprovisionamiento (ver «Correcciones»). Hay que ejecutar la misma siembra (`INSERT IGNORE`) contra ellas.

## Método

Cada área tiene una prueba de integración con la **aplicación real sobre MySQL** (opt-in con `REGISTRY_TEST_DATABASE_URL`). Todas usan el banco común `server/essentialApp.testkit.ts`, que funciona así:

- **Empresas:** aprovisiona **dos empresas nuevas** (A y B) desde `db/baseline/0000_baseline.sql` con el `ProvisioningService` real. No llevan datos de Náyade y su identidad fiscal es sintética (`.example`).
- **Licencias:** aplica en el registro las 29 licencias de Essential como activas, con origen `trial:prueba`.
- **Montaje igual al arranque en multi:**
  - `installTenantResolution` y `installTenantBinding`
  - autenticación local y recuperación de contraseña
  - guardián de módulos y guardián de capacidades, con `CAPABILITY_ENFORCEMENT=on`
  - guardián de sesión, tRPC, IPN de Redsys, vista de factura y sitemap/robots
- **Usuarios por rol legado:** `admin`, `agente`, `controler` y `user`. Cada operación se prueba con el **rol mínimo** que la permite: `agente` para CRM, pedidos y facturas, y `admin` solo donde el procedimiento lo exige. También se comprueba que un rol inferior recibe `FORBIDDEN`.
- **Sin salidas reales:**
  - Correo: proveedor falso que solo registra el cuerpo. Cualquier otra salida de red se bloquea.
  - Redsys: cuenta ficticia guardada como credencial de la empresa. La notificación de pago se firma en la prueba con una implementación independiente.
  - DNS: resolvedor falso.
- **Licencia:** `licenseMatrix` comprueba para cada capacidad que con la licencia activa funciona; en solo lectura las consultas pasan y las mutaciones devuelven 403 con `data.capability`; y sin contratar se devuelve 403. Además se verifica que la mutación bloqueada no persistió.
- **Aislamiento:** la misma consulta desde B no ve nada de A, ni por listado ni por id. Por id devuelve `NOT_FOUND`.

| Fichero de prueba | Área | Pruebas |
|---|---|---|
| `server/essential.crm.mysql.test.ts` | CRM | 6 |
| `server/essential.commerce.mysql.test.ts` | Comercio | 6 |
| `server/essential.web.mysql.test.ts` | Web y CMS | 5 |
| `server/essential.billing.mysql.test.ts` | Facturación (solo empresas sintéticas) | 5 |
| `server/essential.admin.mysql.test.ts` | Administración, comunicaciones y automatización | 6 |
| `server/capabilities.test.ts` (unitaria) | Mapa ruta → capacidad | +2 |

Cómo ejecutarlas:

```bash
REGISTRY_TEST_DATABASE_URL=mysql://root:ci_only@127.0.0.1:<puerto>/registry_test \
  pnpm exec vitest run server/essential --no-file-parallelism
```

## Matriz

Leyenda de permisos (legado, sin RBAC; ver admin-users):

- **comercial** = `staffProcedure` (`crm.view`; roles `admin` y `agente`)
- **administración** = `settings.manage` (rol `admin`)

Guardián: `TRPC_ROUTER_CAPABILITIES` en `server/_core/capabilities/routeGuard.ts`.

### CRM

| Capacidad | Id | Acceso (procedimiento · pantalla) | Permiso | Guardián | Prueba | Estado | Limitaciones |
|---|---|---|---|---|---|---|---|
| Clientes y contactos | crm-contacts | `crm.clients.*` · `/admin/crm/clientes` (`ClientsManager`) | comercial | `crm.clients` → crm-contacts (antes crm-leads) | crm › «crm-contacts / crm-accounts» | FUNCIONAL | Antes no se guardaban la dirección ni las notas del alta (corregido). |
| Fichas de empresa y particulares | crm-accounts | La misma ficha `clients` (campos `company`, `nif`) | comercial | Comparte con crm-contacts | crm › «crm-contacts / crm-accounts» | FUNCIONAL CON LIMITACIONES | No hay tipo de ficha empresa/particular ni relación contacto ↔ empresa: es una sola ficha con campos de empresa. |
| Historial de actividad | crm-activity | `crm_activity_log`, que se escribe solo en altas y notas · `crm.leads.get`, `crm.clients.getHistory`, `crm.timeline.get` · dentro de CRM y Clientes | comercial | Sin capacidad propia: hereda crm-leads o crm-quotes | crm › «crm-activity» | FUNCIONAL CON LIMITACIONES | Sin pantalla propia ni registro manual de actividad sobre un cliente. `entityType` solo admite lead, quote, reservation e invoice. |
| Etiquetas y segmentación | crm-tags | `crmTags.*` (catálogo, `assign`/`unassign`, `forEntities`) y filtro `tagId` en `crm.clients.list` y `crm.leads.list` · `/admin/crm/etiquetas` (`CrmTags`) y listado de clientes (filtro, chips y diálogo de etiquetas) | comercial (admin y agente escriben; `readonly` solo consulta) | `crmTags` → crm-tags | crm › «crm-tags» (operación, persistencia, solo lectura → 403, licencia, aislamiento A/B) | FUNCIONAL CON LIMITACIONES | Tablas `crm_tags` y `crm_tag_links` (migración `0008`). Nombre único sin distinguir mayúsculas ni acentos; paleta de 6 colores. Las oportunidades admiten etiquetas y filtro en el servidor, pero la pantalla de Oportunidades aún no los muestra (solo Clientes). Sin asignación masiva. La columna heredada `clients.tags` sigue sin uso. |
| Leads y oportunidades | crm-leads | `crm.leads.*`, `crm.leadSources.*`, `crm.pipeline.summary` · `/admin/crm`, `/admin/crm/leads` | comercial (orígenes: administración) | `crm.leads` → crm-leads | crm › «crm-leads» | FUNCIONAL | El origen `CRM_MANUAL` no está sembrado: `leadSourceId` queda vacío. |
| Presupuestos y propuestas | crm-quotes | `crm.quotes.*`, `proposals.*` · `/admin/crm/presupuestos`, `/admin/crm/propuestas` | comercial | `crm.quotes`, `proposals` → crm-quotes | crm › «crm-quotes» | FUNCIONAL CON LIMITACIONES | El envío necesita remitente propio. El PDF necesita S3 (o la vista bajo demanda). El enlace de pago necesita Redsys. El envío no se ha probado aquí de extremo a extremo. |
| Recordatorios y tareas | crm-tasks | `crmTasks.*` (`list` con «Mis tareas»/equipo, vencidas y por entidad; `summary`, `assignees`, `create`, `update`, `setStatus`, `delete`) · `/admin/crm/tareas` (`CrmTasks`), Inicio (pendientes) y campana (`notifications.feed`, sección `task`). Además, `commercialFollowup.*` · `/admin/atencion-comercial` | comercial (admin y agente escriben; `readonly` solo consulta) | `crmTasks`, `commercialFollowup` → crm-tasks | crm › «crm-tasks: seguimiento comercial…» y «crm-tasks: tareas internas…» (operación, persistencia, solo lectura → 403, licencia, aislamiento A/B, avisos sin correo) | FUNCIONAL CON LIMITACIONES | Tabla `crm_tasks` (migración `0008`). Vencimiento por día (sin hora) con la fecha del servidor. Responsables: usuarios activos admin o agente. Sin avisos por correo (decisión: solo Inicio y campana), sin tareas recurrentes. Las fichas de oportunidad y presupuesto no tienen aún botón de «Tareas» (se vinculan desde el formulario de la tarea). |

### Comercio

| Capacidad | Id | Acceso | Permiso | Guardián | Prueba | Estado | Limitaciones |
|---|---|---|---|---|---|---|---|
| Catálogo | shop-catalog | `products.*`, `packs.*`, `public.getExperiences` · `/admin/productos/*` | administración (lectura pública) | `products`, `packs`, `timeSlots`, `crm.products`, `crm.catalog` | commerce › «shop-catalog» | FUNCIONAL CON LIMITACIONES | El modelo es de servicios o actividades reservables (fecha y personas). La categoría y la ubicación son obligatorias. No hay stock ni envíos (eso es Business). |
| Variantes, categorías y precios | shop-variants | `products.*Variant*`, `products.*Category*` · `/admin/productos/variantes`, `/admin/productos/categorias` | administración | Comparte con shop-catalog (`products`) | commerce › «shop-variants» | FUNCIONAL CON LIMITACIONES | Sin licencia separada de shop-catalog. Variantes de precio fijo o porcentual, sin combinaciones. |
| Tienda online y carrito | shop-store | Páginas públicas; carrito en el navegador (`CartContext`); `reservations.cartCheckout` | pública | El pago del carrito pasa por shop-checkout; el escaparate (`public.*`) no tiene guardián | commerce › «shop-store» | FUNCIONAL CON LIMITACIONES | El carrito no se guarda en el servidor. El escaparate muestra el botón de WhatsApp de Náyade (cliente, ver bloqueantes). |
| Checkout y pasarelas | shop-checkout | `reservations.createAndPay`, `reservations.cartCheckout`, `POST /api/redsys/notification` · `/checkout` | pública | `reservations.createAndPay` y `reservations.cartCheckout` → shop-checkout (antes shop-orders) | commerce › «shop-checkout» (pre-reserva, firma, IPN, cobro y factura `FAC-…-0001`; notificación cruzada a B rechazada) | FUNCIONAL CON LIMITACIONES | Solo Redsys. Exige la cuenta propia de la empresa. Antes, sin cuenta, se creaba una pre-reserva huérfana y después fallaba con un 500 (corregido: `PRECONDITION_FAILED` sin escribir nada). |
| Pedidos, estados y devoluciones | shop-orders | `crm.reservations.*`, `reservations.*`, `bookings.*`, `cancellations.*` · `/admin/crm/reservas`, `/admin/operaciones/reservas` | comercial (anulaciones: `crm.reservations.manage`, rol admin) | `crm.reservations`, `reservations`, `bookings`, `cancellations` | commerce › «shop-orders» | FUNCIONAL | La devolución se registra, pero el reembolso se ejecuta fuera (se marca a mano). Las anulaciones fallaban en una empresa nueva por la falta del flag `cancellations_module_enabled` (corregido con la siembra). |
| Cupones y descuentos | shop-coupons | `discounts.*` · `/admin/marketing/descuentos` | ver: comercial; gestionar: administración; validar: pública | `discounts` → shop-coupons | commerce › «shop-coupons» | FUNCIONAL CON LIMITACIONES | Solo porcentaje: no hay importe fijo ni condiciones. |

### Web y CMS

| Capacidad | Id | Acceso | Permiso | Guardián | Prueba | Estado | Limitaciones |
|---|---|---|---|---|---|---|---|
| CMS y editor | cms-editor | `cms.*`, `homeModules.*`, `gallery.*` · `/admin/cms/*`, `/admin/configuracion/sitio` | administración | `cms`, `homeModules`, `gallery` | web › «cms-editor» | FUNCIONAL CON LIMITACIONES | La subida de medios (`/api/upload-media`) necesita S3 y no se ha probado. El contenido de una página se edita por bloques: `cms.upsertPage` no guarda HTML. `cms.updateSiteSettings` respondía bien en una empresa nueva pero no guardaba nada (corregido con la siembra). |
| Web con dominio propio | cms-domain | Plano de control `POST /cp/v1/tenants/:id/domains`, `…/verify`, `…/activate` (operador) | operador | No aplica (registro) | web › «cms-domain» (DNS falso; la web y el sitemap se sirven en el dominio verificado) | FUNCIONAL CON LIMITACIONES | Sin autoservicio en el panel de la empresa: lo gestiona el operador. |
| Páginas y formularios de contacto | cms-pages-forms | `public.submitLead`, `public.getPublicPage`, `public.getPublicPageBlocks`, `public.getTenantPage` · `/contacto`, `/pagina/:slug`, `/:slug` | pública | Público, sin guardián | web › «cms-pages-forms» | FUNCIONAL | Los borradores se servían públicamente (corregido). Formularios fijos (contacto y presupuesto), sin constructor (eso es Business). |
| Blog | cms-blog | — | — | — | web › «cms-blog» (ni procedimientos ni tablas) | NO IMPLEMENTADA | — |
| SEO técnico básico | cms-seo | `/sitemap.xml`, `/robots.txt`, `metaTitle`/`metaDescription` por página, `seo_description` (`buildTenantMeta`) | pública / administración | Sin guardián | web › «cms-seo» | FUNCIONAL CON LIMITACIONES | Antes el sitemap llevaba `https://skicenter.es` y rutas de Náyade, y `robots.txt` apuntaba al sitemap de Náyade (corregido en multi). No hay datos estructurados, `canonical` ni `hreflang`. La inyección de metadatos solo se aplica al HTML inicial. |

### Facturación (solo empresas sintéticas)

| Capacidad | Id | Acceso | Permiso | Guardián | Prueba | Estado | Limitaciones |
|---|---|---|---|---|---|---|---|
| Facturas y abonos | bill-invoices | `crm.invoices.*`; se emiten desde venta delegada, cobro online, TPV y presupuesto · `GET /api/invoices/preview` · `/admin/crm` | comercial | `crm.invoices` → bill-invoices (antes crm-leads) | billing › «bill-invoices + bill-taxes» | FUNCIONAL CON LIMITACIONES | No hay factura libre: siempre nace de una operación. El PDF necesita S3 (la vista funciona sin él). Una factura emitida no se borra (correcto). |
| Series y numeración | bill-series | `documentNumbers.*` · `/admin/numeracion` | administración | `documentNumbers` | billing › «bill-series» | FUNCIONAL CON LIMITACIONES | Antes, cambiar el prefijo de una serie aún no usada se perdía sin aviso (corregido). Los abonos usan una serie fija `ABO-AAAA-MM-NNNN` que no se puede configurar. **Riesgo:** `document_counters` no tiene `UNIQUE(document_type, year)` en la baseline (ver pendientes). |
| Impuestos básicos | bill-taxes | `taxRate`/`fiscalRegime` por producto, `tax_rate_general` · `/admin/configuracion` | administración | Sin capacidad propia | billing › «bill-invoices + bill-taxes» (producto al 10 % → base 100 + IVA 10) | FUNCIONAL CON LIMITACIONES | La venta delegada aplicaba siempre el 21 % ignorando el tipo del producto (corregido). No hay mantenimiento de impuestos (IRPF, recargo de equivalencia). |
| Cobros y pagos | bill-payments | `crm.invoices.confirmManualPayment`, `crm.pendingPayments.*`, IPN de Redsys | comercial | `crm.pendingPayments` → bill-payments | billing › «bill-payments» | FUNCIONAL | — |
| Caja y cierre básico | bill-cash | `tpv.*` (`tpv.access`, `tpv.sell`, `tpv.open_close`; `tpv.backoffice` solo admin), `cashRegister.*` · `/admin/tpv`, `/admin/contabilidad/caja` | comercial (TPV) / administración (caja contable) | `tpv`, `cashRegister` → bill-cash | billing › «bill-cash» | FUNCIONAL CON LIMITACIONES | Una empresa nueva no podía crear cajas ni, por tanto, abrir sesión (corregido en el servidor: `tpv.createRegister`; **falta el botón en el panel**). La caja contable fallaba por el flag `cash_register_module_enabled` (corregido con la siembra). |
| Informes de ventas | bill-reports | `accounting.*` · `/admin/contabilidad`, `/admin/contabilidad/informes` | administración | `accounting` | billing › «bill-reports» | FUNCIONAL CON LIMITACIONES | Solo para administración. Informes sobre `transactions`, sin exportación propia validada aquí. |

### Administración, comunicaciones y automatización

| Capacidad | Id | Acceso | Permiso | Guardián | Prueba | Estado | Limitaciones |
|---|---|---|---|---|---|---|---|
| Panel administrativo | admin-panel | `config.*`, `onboarding.*`, `notifications.*`, `accounting.getOverview` · `/admin`, `/admin/configuracion/*` | administración | `config`, `onboarding`, `notifications` → admin-panel (antes, sin guardián) | admin › «admin-panel» | FUNCIONAL | Antes una empresa nueva no tenía filas de ajustes ni de flags: el panel no mostraba ni guardaba nada (`NOT_FOUND`) y no se podía activar ningún módulo (corregido con la siembra). |
| Usuarios y permisos estándar | admin-users | `admin.*`, `public.setPassword` · `/admin/usuarios` | administración | `admin` → admin-users (antes, sin guardián) | admin › «admin-users» (×2) | FUNCIONAL CON LIMITACIONES | Funcionan los roles estándar fijos. Los roles RBAC granulares no existen en una empresa nueva (las tablas `rbac_*` no están en la baseline) y `assignRbacRole` falla. |
| Correo transaccional | comms-email | `emailTemplates.*`, `server/mailer.ts` · `/admin/plantillas-email` | administración | `emailTemplates` → comms-email | admin › «comms-email» | FUNCIONAL CON LIMITACIONES | Depende del proveedor de la plataforma (`BREVO_API_KEY`) y del remitente de la empresa; sin remitente no se envía nada. No hay SMTP propio por empresa. Las invitaciones y la recuperación de contraseña enlazaban a `APP_URL` en lugar de a la URL de la empresa (corregido). |
| Enlaces de WhatsApp | comms-whatsapp-links | Registro manual `commercialFollowup.addNote` con `channel: "whatsapp"`; botón público con el número de la empresa (`public.getTheme` → `contact.whatsapp`) | comercial | Hereda crm-tasks | admin › «comms-whatsapp-links» | FUNCIONAL CON LIMITACIONES | Enlace manual (sin API de WhatsApp). El número sale del teléfono de la empresa; sin él no hay botón. |
| Automatizaciones básicas | auto-basic | `emailCommunications.*`, tareas por empresa (`scheduleTenantInterval`), `notifications.feed` · `/admin/atencion-comercial` | comercial (antes, cualquier sesión) | `emailCommunications` → auto-basic (antes, sin guardián) | admin › «auto-basic» | FUNCIONAL CON LIMITACIONES | Solo automatizaciones de correo sobre presupuestos y reservas. La tarea programada se siembra apagada (`email_automation_job_enabled`) y la activa la empresa en Estado del sistema. Antes no podía activarse porque faltaba la fila. |

## Correcciones hechas (servidor)

| Fallo | Corrección | Fichero |
|---|---|---|
| El guardián de capacidades solo miraba el namespace: `crm.invoices`, `crm.clients`, `crm.reservations` y `crm.pendingPayments` quedaban licenciados como crm-leads; `admin`, `config`, `onboarding`, `notifications` y `emailCommunications` no tenían guardián | Claves por procedimiento, sub-router y namespace (gana la más específica) y mapa completo de Essential | `server/_core/capabilities/routeGuard.ts` |
| Una empresa nueva no tiene filas de `system_settings` ni de `feature_flags`: ajustes imposibles de guardar o mostrar; anulaciones, caja contable y automatizaciones imposibles de activar | La siembra del aprovisionamiento añade ajustes editables vacíos (más IVA y moneda genéricos) y los flags del Core con `INSERT IGNORE`, sin pisar nada | `server/_core/provisioning/mysqlAdapters.ts` |
| `crm.clients.create` aceptaba la dirección y las notas pero no las guardaba | Se guardan | `server/routers/crm.ts` |
| La venta delegada facturaba siempre al 21 % | Tipo del producto en régimen general | `server/routers/crm.ts` |
| Seguimiento comercial y reglas de automatización abiertas a cualquier sesión | `staffProcedure` | `server/routers/commercialFollowup.ts`, `server/routers/emailCommunications.ts` |
| El seguimiento de un presupuesto inexistente (o de otra empresa) creaba filas huérfanas | `NOT_FOUND` | `server/routers/commercialFollowup.ts` |
| Checkout sin pasarela: pre-reserva huérfana y error 500 | `isRedsysConfigured()`: `PRECONDITION_FAILED` antes de escribir | `server/redsys.ts`, `server/routers.ts` |
| Borradores de página servidos públicamente | Solo páginas publicadas | `server/routers.ts` |
| Sitemap con `skicenter.es` y rutas de Náyade; `robots.txt` de Náyade | En multi: URL de la empresa, rutas del Core, páginas publicadas y `robots.txt` propio | `server/sitemapRouter.ts` |
| Invitaciones y recuperación de contraseña enlazaban a `APP_URL` | En multi, URL pública de la empresa según el registro (no derivada de la petición) | `server/_core/publicUrl.ts` |
| Prefijo de una serie aún sin usar perdido; la serie de propuestas no se podía configurar | Crea la serie con el prefijo; se añade `propuesta` | `server/documentNumbers.ts`, `server/routers.ts` |
| Sin forma de crear cajas del TPV; apertura de sesión sobre una caja inexistente | `tpv.createRegister` (backoffice) y validación de la caja | `server/routers/tpv.ts` |
| `email_from_name` se validaba como dirección de correo | Excluido de esa validación | `server/routers/configRouter.ts` |

## Pendientes y riesgos

- **Cliente** (otro agente):
  - Botón de WhatsApp de Náyade en todas las empresas (bloqueante).
  - Botón «Nueva caja» (`tpv.createRegister`).
  - Las secciones del panel de configuración muestran ahora las filas sembradas.
- **Empresas ya aprovisionadas:** hay que rellenar los ajustes y flags que faltan (la misma lista, `CORE_DEFAULT_SETTINGS` y `CORE_DEFAULT_FLAGS`).
- **`document_counters` sin `UNIQUE(document_type, year)`:** dos primeras facturas simultáneas del año pueden crear dos contadores. El índice único de `invoices.invoiceNumber` evita el duplicado fiscal, pero la segunda operación fallaría. Necesita una migración en `db/migrations`: comprobar antes los duplicados existentes y después añadir el índice. No se ha hecho aquí.
- **RBAC:** las tablas `rbac_*` no están en la baseline. Hay que decidir si se añaden y se siembran o si se retira la asignación granular del panel.
- **Sin probar aquí** (dependen de servicios externos): subida de medios y PDF a S3, envío real por el proveedor, sincronización con GHL, envío de presupuesto con enlace de pago.
