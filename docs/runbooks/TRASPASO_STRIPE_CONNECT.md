# Traspaso — Stripe Connect por empresa (Sandbox) — sesión 52

Documento para continuar el trabajo desde una única ventana de Claude Code. Complementa
[COBROS_STRIPE_EMPRESA.md](COBROS_STRIPE_EMPRESA.md) (runbook técnico) y
[../architecture/COBROS_POR_EMPRESA_STRIPE.md](../architecture/COBROS_POR_EMPRESA_STRIPE.md) (diseño). **No contiene ningún secreto**: solo
nombres de variables y su estado.

> Estado a 20/11/2026. Solo Sandbox. Stripe Connect **Live** está desactivado y el código lo rechaza.

## 1. Qué hay (arquitectura)

- **Dos Stripe distintos, nunca mezclados.** (a) El corporativo de Big Elephant (suscripciones SaaS: `CP_STRIPE_*`, `server/stripe/*`,
  CP-9, `CP_CUSTOM_TERMS_BILLING_ENABLED`) **no se toca**. (b) Connect por empresa: cada empresa cobra a sus clientes en SU cuenta de
  Stripe (cobro directo); el dinero no pasa por Big Elephant. Variables y código propios (`CONNECT_STRIPE_*`, `server/paymentsConnect/*`).
- **Pantalla:** Ajustes → Cobros con Stripe (`/admin/configuracion/cobros`). Prueba y Real separados; Real no se puede conectar.
- **Conexión:** `cobros.connect` crea una cuenta conectada NUEVA con la API (`accounts.create`, clave de la plataforma) y devuelve el enlace de
  alta alojado de Stripe; la empresa lo autoriza con sus datos. **No vincula cuentas ya existentes** (ver §6).
- **Webhook central** (un solo destino para todas las empresas): `POST https://app.bigelephant.es/api/stripe/connect/webhook`. La empresa se
  identifica por `event.account` mediante un **índice global** en el registro (`tenant_payment_accounts`, PK = `acct_…`), reservado por el
  plano de control con una petición firmada (`SUPPORT_JWT_SECRET`). El metadato `tenant_id` solo se contrasta. La firma se verifica en el Core
  antes de hacer nada (sin firma válida: 400).
- **Datos por empresa** (BD de cada empresa, migración 0080): `payment_accounts` (estado, `online_enabled`, último evento válido),
  `payment_events` (PK `event_id`: idempotencia), `payment_checkouts` (sesión → presupuesto o pedido; `pending→paid` atómico).
- **Efectos de un pago de presupuesto:** `crm.quotes.confirmPayment` (usuario sintético «Sistema (Stripe)», método «otro»). La inscripción NO se
  confirma sola (regla #865): queda «Presupuesto pagado» a la espera de la confirmación manual.
- **Compra directa en la tienda** (#898, migración 0081): `reservations.cartCheckout` con `provider: "stripe"`; importe calculado en el servidor;
  el pedido queda pendiente hasta el evento firmado; la finalización es la MISMA de Redsys (`applyPaymentResult`).
- **Recuperación tras fallo parcial:** si el pago consta pero el pedido no se cerró (sin factura), Stripe recibe 500 y reintenta; el reintento
  completa lo pendiente sin repetir lo aplicado. Redsys: un aviso repetido lo completa pasado `PAYMENT_RECOVERY_MIN_AGE_MS` (60 s).
- **Soporte:** `cobros.connect/refresh/setOnline` están vetados en sesiones de soporte (`server/_core/support/policy.ts`). **Control correcto; no
  modificarlo ni eludirlo.**
- **Gateway:** excepción de Caddy limitada a esa ruta (solo POST, 1 MB, sin `Authorization`/`Cookie` hacia el Core). Comprobado en production:
  GET → 405.

## 2. PR y commits

| PR | Contenido | Estado |
|---|---|---|
| #897 | Excepción de Caddy del webhook | Fusionado `691df06f`; pasarela desplegada en production |
| #896 | Cobros por empresa (0018 registro, 0080 empresa), webhook central, runbook | Fusionado `62cf0670`; publicado «Publicado 62cf0670ca51 en production» |
| #898 | Compra directa (0081) + recuperación | Se fusionó sobre la rama de #896 (`aae6b49d`); llevado a integración con **#904** (`ec146657`) y desplegado por la vía protegida (§9) |
| #901–#903 | Studio (tarjetas comerciales, formularios traducidos) — no es Connect | Fusionados y publicados (`d079db50`) |

Trampa: **un PR apilado se fusiona en su rama base, no en `integration/elephant-source`.** Comprobar siempre `git log origin/integration/elephant-source`.

## 3. Migraciones

- Registro `0018_payment_account_index`: aplicada en production (con copia verificada previa, por la cadena ordinaria).
- Empresas `0080_payment_accounts`: aplicada en TODAS las empresas de production (canario primero, `error: null`). Tabla nueva, aditiva.
- Empresas `0081_payment_checkouts_shop_orders`: aplicada en production por la vía protegida (§9), con copia verificada previa.
- Los `.down.sql` borran las vinculaciones: **no ejecutarlos sin exportar antes**. Reversión del despliegue sin perder vinculaciones: runbook §6.

## 4. Entornos y variables (solo nombres y estado)

| Variable | Servicio / entorno | Estado |
|---|---|---|
| `CONNECT_STRIPE_MODE` (= `test`) | `core`, production | Cargada por Dirección |
| `CONNECT_STRIPE_API_KEY` (clave restringida del Sandbox) | `core`, production | Cargada por Dirección |
| `CONNECT_STRIPE_WEBHOOK_SECRET` (destino `big-elephant-connect-sandbox`) | `core`, production | Cargada por Dirección |
| `SUPPORT_JWT_SECRET` | `core` y `controlplane` | Existente (canal Core→plano de control) |
| `PAYMENT_ACCOUNT_CLAIM_URL` | `core` | Opcional (por defecto el plano de control interno) |
| `PAYMENT_RECOVERY_MIN_AGE_MS` | `core` | Opcional (60000 por defecto) |
| `APP_ENTRY_HOST` (`app.bigelephant.es`), `PUBLIC_HOSTS` | `core-gateway` | Verificado por comportamiento (sin credenciales responde 200); la lectura de variables en Railway está denegada a las sesiones de Claude |

Stripe (hecho por Dirección): Sandbox de Iron Elephant Consulting con Connect (cobros directos), cuenta conectada de demostración, destino de
webhook `big-elephant-connect-sandbox` con los 5 eventos de cuentas conectadas. La única cuenta visible para el MCP de Stripe es la corporativa en
modo real (`acct_1URULE9RzfmCBuai`): **nunca conectarla como comercio de ninguna empresa.**

## 5. Estado de pruebas

Hecho (con evidencia):
- Receptor en production tras cargar las variables: POST sin firma → 400 `invalid_request`; POST con firma falsa → 400 `invalid_signature`; GET → 405.
- Pantalla de Quantum: plataforma lista (`platformReady: true`) en Prueba; Real no conectable.
- Suites automáticas (MySQL real, firma real del SDK): efectos en presupuesto/factura/inscripción, un evento repetido se aplica una vez, evento de
  otra cuenta aislado, misma `acct_` en dos empresas (25 altas simultáneas: una gana), carrito pendiente hasta el evento, Redsys intacto,
  recuperación tras fallo parcial (stock y puntos una sola vez), Stripe y Redsys.

Pendiente (necesita una conexión Sandbox real, ver §6–§7):
- Evento firmado REAL aceptado y registrado (no se puede firmar sin el secreto; lo debe emitir Stripe).
- Pago de presupuesto y de carrito de punta a punta en Sandbox.

## 6. Cómo iniciar la conexión Sandbox (procedimiento exacto)

Requiere una **sesión de administrador PROPIA de la empresa** (rol con `settings.manage`), nunca una sesión de soporte (la acción devuelve 403 por
diseño). Preferible: un tenant técnico de prueba; si no lo hay, el administrador de Quantum (modo Prueba, sin Live).

1. Entrar en la empresa con su cuenta de administrador (no «Soporte Big Elephant · Con modificación»).
2. Ajustes → Cobros con Stripe → bloque **Prueba** → «Conectar mi cuenta de Stripe». Stripe abre su alta alojada (sandbox).
3. En el alta de Stripe en modo prueba, rellenar con los datos de prueba que ofrece la propia página («usar datos de prueba» / «omitir»);
   no introducir datos reales. Al terminar, Stripe vuelve a `…/admin/configuracion/cobros?stripe=volver`.
4. La pantalla relee la cuenta en Stripe: debe pasar a **Verificada** (cobros y pagos habilitados). Si queda «Pendiente», volver a «Conectar»
   para continuar donde se dejó (misma cuenta).
5. Marcar «Cobrar en línea con esta cuenta (Prueba)» (solo se habilita con la cuenta verificada).
6. Comprobar el webhook: tras el alta llegan `account.updated`; la pantalla muestra «último evento válido» (prueba de que el destino central y la
   firma funcionan).

**¿Sirve la cuenta conectada de demostración que ya existe en Stripe?** No por este flujo: `cobros.connect` siempre crea una cuenta nueva con la API
(clave de la plataforma) y no admite vincular una existente. Cada empresa de prueba obtiene su propia cuenta de Sandbox en el alta alojada. La de
demostración sirve de referencia (o de destino de pruebas manuales en el panel de Stripe), no se puede asignar a una empresa. Vincular cuentas
existentes exigiría otro flujo (OAuth) que no está implementado y no se ha pedido.

## 7. Prueba de punta a punta (con una conexión Sandbox válida)

1. Presupuesto de una inscripción → enlace público → «Pagar con Stripe» → tarjeta `4242 4242 4242 4242`.
2. Al volver del navegador el pago sigue **pendiente** hasta el evento firmado; después: presupuesto «aceptado», 1 factura (método «otro»), inscripción
   «Presupuesto pagado» (confirmación manual).
3. Reenviar el evento desde el panel de Stripe → `duplicate`, sin segunda factura.
4. Carrito de la tienda (empresa con Stripe verificado y activado): pedido pendiente → evento → reservas pagadas, 1 factura, 1 correo, stock y
   puntos una vez.
5. Aislamiento: un evento de otra cuenta no toca la empresa (resultado `isolated`).
6. Recuperación: ver `server/tiendaStripe.recuperacion.mysql.test.ts` (fallo provocado y reenvío).

## 8. Decisiones que no deben cambiarse

- Separación total del cobro SaaS corporativo (nada de `CP_STRIPE_*`, CP-9 ni `CP_CUSTOM_TERMS_BILLING_ENABLED`).
- Connect Live desactivado: el código rechaza `live` (`connectConfigFromEnv`).
- `cobros.connect/refresh/setOnline` vetados en soporte.
- La inscripción no se confirma por el pago (regla #865).
- Sin comisiones de plataforma, reembolsos, disputas ni plan de cuotas con Stripe (no definidos por Dirección).
- Productos comerciales de Quantum sin condiciones de venta confirmadas NO se habilitan; el catálogo de Viaje Atlántico sigue en modo solicitud.

## 9. Estado real de production (20/11/2026, 00:35)

| Servicio | Commit servido |
|---|---|
| `core` | `ec14665776499462a543e0b5e9d8e3c3aeda2690` (fusión de #904, que lleva #898) |
| `controlplane` | `ec14665776499462a543e0b5e9d8e3c3aeda2690` |
| `core-gateway` | `ec14665776499462a543e0b5e9d8e3c3aeda2690` |

Verificado con la acción `estado` (`release-plan`): los tres «al-dia», decisión «sin-cambios».

- Migraciones: registro 0018, empresas 0080 y 0081 aplicadas (canario primero, `error: null`), con copia verificada previa.
- Receptor del webhook: GET 405; POST sin firma o con firma falsa 400 (`invalid_request` / `invalid_signature`).
- Modo Live: rechazado por el código; la pantalla de Quantum muestra Real como no conectable.

### Cómo se publicó #898 (lección)

1. #898 estaba apilado sobre la rama de #896: al «fusionarlo» entró en esa rama, no en integración. Se llevó con #904.
2. La publicación ordinaria de production se BLOQUEÓ («bloqueado-protegido»): la 0081 relaja `quote_id` a NULL y el clasificador la marca
   «no aditiva». Es segura (columnas nuevas con valor por defecto), pero exige la vía protegida con aprobación de Dirección (dada).
3. Se usó la vía protegida **por pasos**, no `aplicar-production`, porque este incluye `catalog-review --apply` (estados del catálogo de
   Big Elephant), fuera del alcance autorizado. Pasos, todos sobre el mismo commit con `confirm=production`: `migraciones-plataforma-aplicar`
   (copia + registro + CRM) → `migraciones-aplicar` (empresas) → `desplegar-controlplane` → `desplegar-core` → `desplegar-core-gateway`.
4. Un PR que cambie una migración «no aditiva» exigirá lo mismo; la aprobación queda ligada al contenido del fichero.

## 10. Incidencias y pendientes

- Falta una conexión Sandbox real (acción humana: sesión de administrador propia).
- Variantes 17–20 de los productos 27/28 de Quantum (copia del precio 1.290/1.190 de Viaje del Alma): decisión de Dirección (la sesión no pudo
  modificarlas por permisos).
- Quedan en el CRM de Quantum 5 leads de prueba (ids 8–12, «PRUEBA TÉCNICA»).
- Reembolsos, disputas, plan de cuotas, vista de operador (Ficha 360) de la cuenta de cada empresa: no incluidos.

## 11. Coordinación

- Sesión 7f: RECONNECT, Quantum y almacenamiento (limpieza de almacenamiento de Quantum del 20/11, sin despliegues). No interferir con sus datos.
- Sesión 02: #899 (Core) y #176 (CRM), a la espera de Dirección.
- No hay worktrees ni sesiones cerradas por esta sesión. Worktrees de esta línea de trabajo: `wt-cobros-stripe`, `wt-caddy-connect`, `wt-tienda-stripe`,
  `wt-studio-tarjetas` (los tres primeros ya sin trabajo pendiente tras la fusión).

## 12. Guion para completar la conexión y las pruebas E2E (listo para ejecutar)

**Condición previa (humana):** Indira concede a Jorge el rol Administrador en Quantum (Usuarios → Jorge Grande → «Administrador») y Jorge entra
con su sesión propia (no la de soporte). Comprobación de solo lectura posterior: `admin.getUsers` desde cualquier sesión de la empresa debe mostrar
a Jorge con rol `admin`.

### A. Conexión (Jorge, sesión propia)
1. `https://t12-quantum-soulrise.app.bigelephant.es/admin/configuracion/cobros` → bloque **Prueba** → «Conectar mi cuenta de Stripe».
2. Alta alojada de Stripe en modo prueba: datos de prueba que ofrece la propia página; volver a Ajustes → Cobros.
3. Debe pasar a **Verificada** (si queda «Pendiente», «Conectar» de nuevo continúa con la misma cuenta). Marcar «Cobrar en línea (Prueba)».
4. Comprobación (cualquier sesión de la empresa, solo lectura): `GET /api/trpc/cobros.status` →
   `modes[0]` (`test`) con `status: "verificada"`, `chargesEnabled: true`, `onlineEnabled: true`, `lastEventType` y `lastEventAt` rellenos
   (prueba de que el destino central recibe y valida los eventos `account.updated`).

### B. Presupuesto → pago → webhook (Claude, tras A)
1. En el CRM de Quantum crear un lead «PRUEBA TÉCNICA Stripe» (correo `…@example.invalid`) y un presupuesto de **1 €** de una inscripción; copiar
   el enlace público (`/presupuesto/<token>`) **sin enviarlo por correo** (los avisos de una empresa salen de verdad).
2. `crm.quotes.getByToken` debe devolver `stripeAvailable: true`; el enlace muestra «Pagar con Stripe».
3. Pagar con la tarjeta `4242 4242 4242 4242` (cualquier fecha futura y CVC). Al volver de Stripe el pago sigue **pendiente** (`?stripe=volver`)
   hasta el evento firmado.
4. Tras el evento: presupuesto «aceptado», 1 factura (método «otro»), inscripción «Presupuesto pagado» (se confirma a mano), `payment_checkouts`
   en `paid`, `payment_events` en `applied`. Cotejar con la tabla del §3 del runbook COBROS_STRIPE_EMPRESA.md.
5. **Idempotencia:** en el panel de Stripe (Workbench → destino `big-elephant-connect-sandbox` → evento → «Reenviar»): la respuesta del Core es
   `duplicate` y no aparece una segunda factura.
6. **Evento firmado real aceptado y registrado:** `cobros.status` muestra `lastEventType` = `checkout.session.completed` y la hora.

### C. Carrito (Claude, tras A y con productos de tienda de la empresa)
1. Solo con productos de la tienda con condiciones de venta confirmadas. **No habilitar productos comerciales de Quantum sin condiciones
   confirmadas** (Viaje Atlántico sigue en modo solicitud). Si no hay producto vendible, usar una empresa técnica de prueba.
2. `public.getTheme` → `storefront.payments.stripe: true`; pagar desde el carrito; el pedido queda `pending_payment` al volver; tras el evento:
   reservas `paid`, 1 factura, 1 correo, stock y puntos una vez.

### D. Aislamiento y recuperación (sin cuenta conectada ya cubiertos por suites; repetir en vivo si hay segunda empresa)
- Evento de otra cuenta (`event.account` distinta) → `isolated`, sin cambios.
- Recuperación: `server/tiendaStripe.recuperacion.mysql.test.ts` (fallo provocado tras registrar el pago y reenvío).

### E. Qué anotar
`acct_…` recortado, fecha del primer evento válido, importe, ids de factura/inscripción, resultados de B.5 y C, incidencias. Sin secretos ni
capturas de claves. Actualizar §5 y §9 de este documento y `COBROS_STRIPE_EMPRESA.md` §8.
