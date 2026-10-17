# Auditoría previa a Stripe Billing y onboarding automático

**Fecha:** 17/10/2026. **Alcance:**

| Repositorio | Rama | Commit |
|---|---|---|
| Core | `integration/elephant-source` | `a9f6766` |
| CRM | `integration/elephant-source` | `5dae4c9` |
| Web | `feat/elephant-web-portfolio` | `b2f7fac` |

También se ha revisado la configuración real de Railway del proyecto «Elephant Source»: solo nombres de variables y valores no secretos.

**Método.** Lectura del código y de los tests, más la comprobación de las afirmaciones clave directamente en el código y en Railway. **No se ha escrito código ni se ha cambiado nada.** Las rutas son relativas al repositorio indicado.

**Clasificación de cada elemento:**
- **OK**: operativo y probado.
- **PARCIAL**: implementado parcialmente.
- **SIMULADO**: existe, pero con pagos o efectos ficticios.
- **NO EXISTE**: inexistente.
- **BLOQUEADO**: depende de una decisión comercial o de credenciales.

---

## 1. Resumen

1. **No existe nada de Stripe Checkout, Billing, Customer Portal, Customer ni Subscription en ninguno de los tres repositorios.** Lo único con Stripe es un adaptador antiguo de cobro directo (`PaymentIntent` `off_session`) que no está montado en Railway y tiene defectos graves (ver C1 y C2). **No se debe reutilizar.**
2. **El circuito comercial real ya existe y está probado, pero con pago simulado.** Es este:
   - pedido del orquestador, que pasa por `requested → quoted → contracted → confirmed → subscribed → licensed → active`;
   - suscripción contractual en «modo sombra»;
   - licencias por capacidad.

   El aprovisionamiento por empresa también funciona: base propia, migraciones, administrador, subdominio y licencias, de forma idempotente y reanudable. **Es el sitio natural donde conectar Stripe.**
3. **El orquestador ya tiene el punto de enganche** (`TestPaymentPort`: `checkout` y `verify`). Hoy rechaza cualquier proveedor que no sea `simulated` (`server/orchestrator/payments.ts:108-118`).
4. **Bloqueos para un onboarding 100 % automático**, además de Stripe:
   - **Entrada:** nadie crea los pedidos salvo un operador. No hay una entrada pública ni programada.
   - **Tareas programadas:** no existe ninguna para renovaciones, impagos, vencimiento de pruebas ni reintentos de alta.
   - **Railway:** cada empresa necesita su pasarela y su dominio, y hoy se crean a mano.
   - **Panel del cliente:** no tiene gestión de la suscripción.
   - **Concurrencia:** los bloqueos funcionan solo dentro del proceso.
5. **Hay duplicidades que conviene cerrar antes:**
   - dos motores de suscripción (el antiguo «billing» y el contractual en sombra);
   - dos catálogos de planes;
   - tres implementaciones de la prueba gratuita;
   - reglas de negocio en el CRM ya desfasadas respecto al servidor.

## 2. Estado real en Railway (17/10/2026)

| Variable | Valor | Efecto |
|---|---|---|
| `CP_ORCHESTRATOR_ENABLED` | `1` | Pedidos y contratación activos |
| `CP_PAYMENTS_PROVIDER` | `simulated` | Pagos de prueba firmados por HMAC; nada de Stripe |
| `BILLING_DATABASE_URL`, `BILLING_CATALOG_FILE`, `BILLING_PROVIDER`, `STRIPE_*` | no definidas | El motor antiguo no está montado; `/cp/v1/billing/webhook` no existe allí |
| `CAPABILITY_ENFORCEMENT` (core) | `on` | Las licencias se aplican de verdad en el Core |
| `CP_TRUST_PROXY` | `2` | IP real del cliente detrás de la pasarela (corregido hoy en las pasarelas) |
| `CP_PUBLIC_TRIAL_ENABLED`, `CP_TRIAL_AUTO_PROVISION` | no definidas | Registro público y activación automática apagados |
| `CP_TRIAL_VERIFY_URL`, `CP_TRIAL_PRICING_URL`, `ELEPHANT_PRICING_URL` | no definidas | No se enviaría el enlace de verificación; el panel no enlaza a precios |
| `MAIL_MODE` | `off` | Brevo autenticado y probado; envío apagado |

## 3. Matriz de auditoría

### A. Plano de control

| Componente | Estado | Evidencia en código | Carencia | Riesgo | Acción recomendada |
|---|---|---|---|---|---|
| Empresas (tenants) y ciclo de vida | **OK** | `db/registry/0000_registry.sql:21-33` (estados `provisioning…deleted`); `server/_core/tenantRegistry/lifecycle.ts:11-62`; eventos inmutables `tenant_events` | No hay relación con un Stripe Customer | Bajo | Añadir el vínculo empresa ↔ cliente de Stripe en el servidor, con unicidad |
| Licencias por capacidad | **OK** | `db/registry/0008_tenant_capabilities.sql`; `server/licensing/service.ts:64-142`; `server/_core/capabilities/model.ts:49-63` (si vence, solo lectura); caché de 30 s en `access.ts:27-55` | Los cambios tardan hasta 30 s en aplicarse en el Core | Bajo | Que Stripe actúe solo a través de `LicensingService.apply` y aceptar el retraso de 30 s o invalidar la caché |
| Planes y precios | **OK** | Semilla `server/catalog/elephantSourceV1.ts:148-205` (29/279, 79/759, 199/1.899, sin IVA, `TAX_RATE_BP=2100`); catálogo publicado en BD `web_entries` y `web_prices` (CRM 0004/0005) | Ningún producto está `available`: todos son `on_request` o `coming_soon`. Essential y Business constan como `tech: partial`; Enterprise como `planned` | **Medio-alto (comercial)** | Decidir qué se vende en autoservicio. No ofrecer en Checkout lo que no está operativo |
| Correspondencia plan ↔ precio de Stripe | **NO EXISTE** | — | No hay dónde guardar los identificadores de producto y precio de Stripe | — | Guardarlos junto al precio aprobado (`web_prices`), no repartidos por el código |
| Prueba gratuita de 15 días | **PARCIAL** | `server/trials/*`; `db/crm/migrations/0007_trials.sql`; máquina de estados en `machine.ts:15-48`; licencias con `validUntil` | El estado `expired` y los avisos son manuales (`machine.ts:6`, `POST /trials/notices/send`). No hay reenvío del enlace de verificación: una solicitud caducada bloquea el correo sin avisar | Medio | Tarea programada de vencimiento y avisos, y reenvío de la verificación |
| Pedidos y contratación (orquestador) | **OK**, pago SIMULADO | `server/orchestrator/{machine,service,api}.ts`; `db/crm/migrations/0010_commercial_orders.sql`; claves `uq_order_idempotency`, `uq_order_open_company`; aceptación en Railway (A16-A19, 33/33) | Solo los crea un operador (`orders:write`). Exige una empresa del CRM con contacto y firma registrada | **Alto** para el automatismo | Entrada nueva «solicitud de contratación provisional» desde la web, con `idempotencyKey` |
| Contratos del CRM | **OK** | `db/crm/0000_crm.sql:69-87`, `0002`, `0009`; `server/crm/service.ts:877-904` | Firma manual (`signatureRef`) | Bajo | En autoservicio, sustituir la firma por la aceptación de condiciones versionadas |
| Suscripciones contractuales («sombra») | **SIMULADO** | `server/subscriptions/*`; CRM 0006 (`subscriptions`, `subscription_items`, `shadow_invoices`…) | `mode='shadow'`: no cobra. Los intervalos mixtos están soportados desde `97a22cd` | Medio | Mantenerlo como **libro interno del contrato** y que la suscripción de Stripe sea la que cobre |
| Pagos simulados | **SIMULADO** | `server/orchestrator/payments.ts:48-118` (HMAC, `livemode:false`, BD solo `mode='test'`); webhook `/cp/v1/payments/test/webhook` | No es Stripe | — | Sustituir `SignedTestProvider` por un proveedor de Stripe en modo test con el mismo contrato |
| Motor antiguo «billing» (`_core/billing`) | **BLOQUEADO / no apto** | `server/_core/billing/providers.ts:46-130` (solo PaymentIntents); `service.ts:257-276`; montado solo con `BILLING_DATABASE_URL` + `BILLING_CATALOG_FILE` (`main.ts:108`) | Ver C1 y C2. Catálogo propio en fichero JSON. Su BD no entra en las copias | **Alto** si se enciende | **No reutilizarlo.** Retirarlo o dejarlo aislado. Decisión D-04 |
| Renovaciones, impagos y suspensión | **PARCIAL (manual)** | `POST /orders/:id/renew` y `POST /orders/review` (gracia de 7 días → `past_due` → `suspended`): `server/orchestrator/service.ts:673-755`; «nada la programa sola» (`:701-703`) | No hay tarea programada ni dunning | **Alto** | Con Stripe, el ciclo de cobro lo lleva Stripe; aquí solo queda reflejar sus eventos y una conciliación programada |
| Reactivación | **PARCIAL** | Pruebas: `server/trials/api.ts:133-151`; pedidos: `payment_recovered` (`service.ts:629-633`) | Manual | Medio | Reactivar por evento de Stripe más política configurable |
| Facturas de plataforma | **SIMULADO / NO EXISTE** | `shadow_invoices` sin número fiscal; el motor antiguo numera `SAAS-AAAA-NNNNNN` sin IVA | No hay emisor, NIF ni régimen de IVA en ningún sitio | **Alto (fiscal)** | Pendiente de las decisiones fiscales (§5) |
| Tareas programadas | **NO EXISTE** (cobro) | `server/controlPlane/main.ts:163,178`: solo alertas y envío de correo | Nada programa `review`, `renew`, vencimientos ni `provisioning.retry` | **Alto** | Planificador con exclusión entre procesos (bloqueo en BD) |
| Auditoría administrativa | **OK** | `tenant_events`, `tenant_capability_events`, `subscription_events`, `trial_events`, `commercial_order_events`, `cp_operator_events`… | — | Bajo | Añadir eventos de Stripe con `event.id` |
| Idempotencia | **OK** (pedidos y pagos de prueba) | `0010_commercial_orders.sql:37-40,82,88-89`; evento y efecto en la misma transacción (`server/orchestrator/store.ts:389-409`) | El motor antiguo registra el evento antes de procesarlo (C1) | — | Reutilizar el patrón del orquestador |
| APIs internas | **OK** | Ámbitos `server/controlPlane/auth.ts:17-48`; `orders:*`, `subscriptions:*`, `billing:*` | Sin limitar por empresa (todo token actúa sobre todas). `POST /billing/:id/subscribe` acepta `customerId` del cuerpo (`api.ts:1187`) | Medio-alto | Ámbitos nuevos y estrechos para Checkout y Portal; el cliente de Stripe se resuelve en el servidor |
| APIs públicas | **OK** | `/cp/v1/public/site`, `/site/quote`, `/form-ticket`, `/requests` (con `Idempotency-Key`); `/trial` apagado | No hay ruta de contratación | — | Nueva ruta pública de solicitud de contratación |

### B. Onboarding

| Componente | Estado | Evidencia | Carencia | Riesgo | Acción |
|---|---|---|---|---|---|
| Registro público de prueba | **BLOQUEADO** (decisión) | `server/trials/api.ts:32-57` (límite por IP, campo trampa, respuesta genérica); `CP_PUBLIC_TRIAL_ENABLED` | Apagado | — | Lo decide el propietario |
| Alta por operador o desde el CRM | **OK** | `POST /cp/v1/trials` (`onboarding.ts:96-105`); `POST /crm/companies/:id/onboard`; usado en Railway | Manual | — | Se mantiene para Enterprise |
| Verificación de correo | **PARCIAL** | Token de 256 bits con hash y 24 h (`server/trials/service.ts:100-158`) | No hay reenvío; falta `CP_TRIAL_VERIFY_URL` en Railway | Medio | Reenvío y configuración |
| Administrador de la empresa | **OK** | `server/_core/provisioning/mysqlAdapters.ts:227-263` (invitación de 7 días, `/establecer-contrasena`) | — | Bajo | Reutilizar |
| Base MySQL por empresa | **OK** | `mysqlAdapters.ts:42-53`; DSN cifrado (`service.ts:246-257`); varios servidores (`servers.ts`) | `ensureDatabase` rota la contraseña en cada pasada (`:49`) | Medio con concurrencia | Bloqueo entre procesos por empresa |
| Migraciones al aprovisionar | **OK** | Baseline + `db/migrations` con `GET_LOCK` y suma de control (`mysqlAdapters.ts:101-153`) | Las migraciones de módulos sectoriales no están conectadas (`ModuleInstaller` no se pasa en `main.ts:85-97`) | Bajo hoy | Pendiente de cuando se vendan módulos |
| Configuración, plan y licencias | **OK** | `mysqlAdapters.ts:161-324`; licencias desde la suscripción (`orchestrator/service.ts:514-518`) | Solo se crea el rol `admin` | Bajo | Reutilizar |
| URL de la empresa | **PARCIAL** | Subdominio `<tenant>.<CP_PLATFORM_DOMAIN>` (`service.ts:286-292`); dominios propios con verificación DNS (`api.ts:428-485`) | **En Railway, cada empresa necesita una pasarela y un dominio creados a mano** (runbook §6) | **Alto** para el automatismo | Dominio propio con comodín (`*.app.<dominio>`) y una sola pasarela, o automatizar la API de Railway. Decisión con DNS |
| Correo de bienvenida | **PARCIAL** | Bandeja de plataforma con plantillas `trial_activated` y `tenant_welcome` (`server/mail/platform.ts:46-70`); Brevo autenticado y probado | `MAIL_MODE=off`; el `WelcomeNotifier` del aprovisionamiento no está conectado | Medio | Activar con autorización |
| Recuperación de fallos parciales | **OK** (manual) | Pasos persistidos con 3 reintentos (`provisioning/service.ts:154-197`); `retry` y `abort` con compensación (`:94-99,204-222`); `tenantId` determinista | Nada reintenta solo. Un alta fallida que nadie toca deja la base y el tenant en `provisioning`. Bloqueos solo en memoria (`inflight`) | **Alto** | Reintento programado, alerta y bloqueo en BD |
| Sin duplicados al repetir | **OK** (en un solo proceso) | `uq_trial_idempotency`, `uq_trial_tenant`, `uq_order_*`; probado en `server/provisioning.test.ts`, `trialJourney.mysql.test.ts` | No garantizado con varias réplicas | Medio | Bloqueo en BD |

### C. Web, CRM y panel del cliente

| Componente | Estado | Evidencia | Carencia | Riesgo | Acción |
|---|---|---|---|---|---|
| Página de precios y comparador | **OK** | Web `src/pages/precios.astro`, `comparador-de-planes.astro`; precios del catálogo publicado, IVA «21 % aparte», «desde» en Enterprise; e2e en CI | — | Bajo | Reutilizar |
| Botones de contratación | **PARCIAL** | Todos llevan a «Solicitar contratación» (`/contratacion?plan=`); «Nada se contrata automáticamente» (`contratacion.astro:17`) | No hay Checkout | — | Nuevo botón «Contratar» solo para los planes aprobados para autoservicio |
| Formulario de contratación y leads | **OK** | `src/lib/intake.ts:44-114` → `POST /cp/v1/public/requests` (esquema estricto en el Core, `server/crm/publicApi.ts:43-92`) | La periodicidad y las cantidades solo viajan como texto dentro de `message` | Medio | Datos estructurados (plan, intervalo, cantidades) en la solicitud de contratación |
| Páginas de retorno | **NO EXISTE** | Solo `404.astro` y `prueba-gratuita/verificar.astro` | No hay éxito, cancelación ni progreso del alta | Medio | Página de estado que consulta el servidor (nunca «éxito» por la URL) |
| Textos legales | **BLOQUEADO** (legal) | `src/pages/legal/*` en borrador y `noindex`; pago, renovación, desistimiento y devoluciones pendientes | — | **Alto (legal)** | Redactar y versionar las condiciones antes de cobrar |
| Pasarela de la web | **OK** (restringida) | Todo tras autenticación básica (`deploy/railway/Caddyfile`) | Impide un lanzamiento público | — | Se mantiene hasta abrir la beta |
| CRM: leads, empresas, propuestas y contratos | **OK** | Pantallas `Crm.tsx`, `CrmCompany.tsx`, `Proposal.tsx`, `CrmContracts.tsx`; e2e manuales | Los e2e del CRM no corren en CI | Medio | Integrarlos en CI |
| CRM: pedidos (orquestador) | **NO EXISTE** en el CRM | No hay ninguna llamada a `/orders` en `src/` | El circuito principal no tiene pantalla | Medio | Pantalla de pedidos y del estado de Stripe (solo lectura y acciones de operador) |
| CRM: duplicidades | **PARCIAL** | Regla obsoleta de intervalos mixtos (`src/catalog.ts:416,450`); `priceId` elegido en el navegador (`:418-460`); usa los dos catálogos (`TenantView`/`Onboarding` el antiguo) | La lógica de negocio está en el cliente | Medio | Retirar la regla, mover la elección de precio al servidor y quitar el motor antiguo del CRM |
| Panel del cliente: suscripción | **PARCIAL** | Core `client/src/pages/admin/subscription/SubscriptionPage.tsx` (solo lectura: plan, estado, días, límites); botón a `ELEPHANT_PRICING_URL` (no definida) | No hay facturas, métodos de pago, cancelación ni cambio de plan | **Alto** para la autogestión | Botón «Gestionar suscripción» → Customer Portal, mediante un puente seguro (D2) |

### D. Seguridad y operaciones

| Componente | Estado | Evidencia | Carencia | Riesgo | Acción |
|---|---|---|---|---|---|
| Autenticación del plano de control | **OK** | Tokens con hash y comparación en tiempo constante (`auth.ts:60-100`); sesión de operador HttpOnly, `Strict`, con CSRF y Argon2id (`operatorAuth.ts`); OIDC opcional | No hay MFA para operadores | Medio | MFA antes de la beta pública |
| **Puente empresa → plano de control** | **NO EXISTE** | El Core no llama a `/cp/v1`; `SUPPORT_JWT_SECRET` va en sentido inverso | Necesario para Checkout de cambio de plan y para el Portal | **Alto** | Endpoint tRPC en el Core (solo propietario o `admin`) → llamada servidor a servidor con un ámbito estrecho y la empresa resuelta por Host |
| CSRF y CORS | **OK** | `auth.ts:145-151`; CORS sin comodín (`api.ts:236-264`); `requestOrigin.ts:34-46` | — | Bajo | Las URL de retorno de Stripe se construyen en el servidor |
| Aislamiento entre empresas | **OK** | La empresa sale solo del `Host` y falla cerrado (`tenantMiddleware.ts`); sesión ligada a `tid`; 27/27 hoy en Railway | — | — | Tests de cliente de Stripe cruzado entre empresas |
| **Webhooks** (antiguo `/billing/webhook`) | **No apto** | C1: el evento se registra **antes** de procesarlo (`_core/billing/service.ts:259-260`), así que si el proceso falla el reintento se descarta y **se pierde**. C2: solo `payment_intent.*`; acepta un único `v1`; sin límite de peticiones | — | **Alto** | Webhook nuevo de Stripe: cuerpo crudo propio, verificación oficial, tabla `stripe_events` con estados en la misma transacción, relectura del objeto desde la API, límite de peticiones y alerta |
| Webhooks (pagos de prueba, Brevo) | **OK** | Pagos: evento y efecto en una transacción, importe y moneda, no retrocede (`orchestrator/service.ts:595-615`). Brevo: token y límite (verificado hoy) | — | — | Patrones a reutilizar |
| Secretos | **OK** | AES-256-GCM (`tenantRegistry/crypto.ts`, `credentials/vault.ts`); `opsLog` redacta; validación `sk_`/`whsec_` | No hay candado test/live para Stripe | Medio | Clave restringida de test y rechazo de live salvo autorización explícita (como `MAIL_LIVE_AUTHORIZED`) |
| Reintentos y alertas | **PARCIAL** | Correo y orquestador sí; `recordFailure` y alertas en memoria | No hay regla `stripe.*` ni conciliación programada | Medio | Conciliación con Stripe y alertas |
| Límites de peticiones | **OK** (por IP real) | Corregido y verificado hoy (Core #124, CRM #19/#20, Web #8) | En memoria, sin contexto de empresa (ver «Mejora pendiente» en `OVERNIGHT_5_OPERATIONS.md`) | Medio | Límites en el webhook de Stripe y en Checkout y Portal por empresa y usuario |
| Copias de seguridad | **OK** (registro, CRM y empresas) | `backupJob.ts`, `backupRestore.ts`; ensayos de restauración | La BD del motor antiguo no se copia | Alto si se usara | Guardar el estado de Stripe en la BD del CRM (sí se copia) |
| Proxy de confianza | **OK** | `CP_TRUST_PROXY=2` en Railway | Obligatorio solo por documentación | Bajo | Hacerlo obligatorio al arrancar en producción |

## 4. Hallazgos críticos

1. **C1. Pérdida de eventos en el webhook antiguo.** Registrar el evento antes de procesarlo hace que un fallo intermedio pierda el evento para siempre. Por eso no se reutiliza. **No está desplegado en Railway.**
2. **C2. El motor antiguo cobra por su cuenta** (PaymentIntents con renovación propia y claves de idempotencia que cambian en cada reintento: `_core/billing/service.ts:361`). Riesgo de doble cobro documentado (`docs/architecture/SUSCRIPCIONES_PRECIOS_CONTRATADOS.md:17-28`). Con Stripe Billing, **el ciclo de cobro debe ser de Stripe**, no nuestro.
3. **C3. Nada está programado.** Renovaciones, impagos, vencimientos de prueba y reintentos de alta dependen de un operador.
4. **C4. Un pedido requiere un operador.** No hay entrada automática.
5. **C5. Una pasarela por empresa en Railway**, creada a mano.
6. **C6. No hay emisor fiscal ni régimen de IVA definidos.**
7. **C7. Ningún producto figura como disponible.** Essential y Business constan como parcialmente operativos y Enterprise como planificado. Antes de cobrar en autoservicio hay que confirmar que lo que se vende funciona.

## 5. Decisiones pendientes (no las tomo yo)

### Comerciales

| Id | Decisión | Opciones |
|---|---|---|
| DC-1 | Qué planes se contratan por autoservicio | Recomendado: Essential y Business; Enterprise solo por propuesta |
| DC-2 | Modalidad de la prueba | Sin tarjeta / con tarjeta / pago inmediato (ver Fase 4) |
| DC-3 | Complementos (Net, Connect, usuarios extra) en Checkout | Desde el primer día / más adelante |
| DC-4 | Política de impago | Días de gracia, solo lectura frente a suspensión, plazo de conservación de datos |
| DC-5 | Cambio de plan y de periodicidad | Prorrateo inmediato o al final del periodo; si se permite bajar de plan |
| DC-6 | Cancelación | Al final del periodo (recomendado) o inmediata; reembolsos |
| DC-7 | Motor único (D-04) | Retirar el motor antiguo «billing» (recomendado) |

### Fiscales y legales

| Id | Decisión |
|---|---|
| DF-1 | Entidad jurídica que factura, NIF y domicilio fiscal |
| DF-2 | Países de venta (¿solo España, o la UE?) |
| DF-3 | Solo B2B (exigir NIF/VAT) o también B2C |
| DF-4 | Tratamiento del IVA: 21 % en España, inversión del sujeto pasivo intracomunitaria con NIF-IVA válido, ventas fuera de la UE. ¿Stripe Tax o tipos fijos? |
| DF-5 | Emisor de facturas: Stripe Invoicing (factura de Stripe con nuestra numeración) o facturación propia (Stripe solo cobra). Requisitos españoles: Reglamento de facturación, numeración correlativa, y Verifactu/TicketBAI según régimen y fechas |
| DF-6 | Condiciones de contratación: renovación automática, desistimiento (si hay B2C), devoluciones, cancelación |

**Hasta resolverlas no se emitirán facturas fiscales definitivas.**

### Técnicas

| Id | Decisión | Recomendación |
|---|---|---|
| DT-1 | URL de las empresas en Railway | Dominio propio con comodín y una sola pasarela (requiere DNS: autorización) |
| DT-2 | Dónde guardar el estado de Stripe | BD del CRM (se copia) |
| DT-3 | Planificador | Temporizador del plano de control con bloqueo en BD, o servicio cron de Railway como `backup-job` |

## 6. Arquitectura preliminar (para aprobar antes de programar)

**Principio:** Stripe es la fuente de verdad del **cobro**. El plano de control es la fuente de verdad del **derecho de acceso** (licencias) y del **estado operativo** (tenant). Se reutiliza el circuito existente y no se crea ningún motor nuevo.

1. **Catálogo.** Los precios aprobados (`web_prices`) llevan el identificador del Price de Stripe test, en una tabla de correspondencia por precio aprobado. Hay un script idempotente que crea o reconcilia Products y Prices en Stripe test buscando por `lookup_key` o metadatos, sin duplicar. Enterprise no se publica en Checkout.
2. **Solicitud de contratación provisional.**
   - Nueva ruta pública: plan, intervalo, empresa, administrador, aceptación de condiciones versionadas e `Idempotency-Key`.
   - Crea la empresa y el contacto en el CRM y un pedido del orquestador en un estado nuevo, «pendiente de pago».
   - **El importe sale del servidor**, nunca del navegador.
3. **Stripe Checkout** (modo `subscription`, test).
   - El servidor crea la sesión con el Price del catálogo, `client_reference_id` y metadatos con el pedido y la empresa, e idempotencia.
   - `success_url` lleva a una **página de estado** que consulta el servidor.
4. **Webhook nuevo de Stripe.**
   - Ruta propia con cuerpo crudo y verificación oficial de la firma.
   - Tabla `stripe_events` con estados y efecto en la misma transacción.
   - **Relectura del objeto desde la API de Stripe** antes de aplicarlo, para tolerar desorden y duplicados.
   - Se comprueba que el Customer, la Subscription y la empresa coinciden con el pedido.
5. **Proveedor `stripe_test`** en el puerto del orquestador. Sustituye a `SignedTestProvider` y conserva el veto a live salvo autorización. Una suscripción en estado activo (o en prueba, según la decisión DC-2) confirma el pedido. Después el orquestador hace lo que ya hace: aprovisionar, crear la suscripción contractual, aplicar las licencias y enviar la bienvenida.
6. **Ciclo de vida.** Los eventos de suscripción y factura de Stripe se traducen a los estados existentes:
   - pedido: `past_due`, `suspended`, `cancel_scheduled`, `cancelled`;
   - licencias: `active` o `read_only`.

   Las políticas de gracia y conservación son configurables. **Nunca se borran datos automáticamente.**
7. **Customer Portal.** El botón del panel del cliente llama a un tRPC del Core (solo propietario o `admin`). El Core llama al plano de control servidor a servidor, con un ámbito nuevo. El plano de control resuelve el Customer de esa empresa y devuelve la URL del Portal.
8. **Planificador con bloqueo en BD** para tres tareas: conciliar con Stripe, reintentar altas fallidas y vencer pruebas y avisos.
9. **CRM.** Pantalla de pedidos y del estado de Stripe. Se quitan del CRM la regla de intervalos mixtos y el motor antiguo.

**Antes de implementar** comprobaré en la documentación oficial vigente de Stripe:
- los nombres exactos de eventos y parámetros (Checkout Sessions, Subscriptions, Invoices, Customer Portal, firma de webhooks y Stripe Tax si se elige);
- el comportamiento de los periodos de prueba con y sin método de pago.

## 7. Qué necesito para pasar a la Fase 2

1. **Aprobación de esta arquitectura** o los cambios que quieras.
2. **Las decisiones DC-1, DC-2 y DC-7.** Las demás pueden esperar al diseño detallado, pero las fiscales bloquean la emisión de facturas.
3. **Claves de Stripe en modo test.** No las introduzcas todavía. Cuando la arquitectura esté aprobada te indicaré exactamente qué variables poner, en qué servicio de Railway y con qué permisos (clave restringida y secreto del webhook).
