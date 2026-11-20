# Cobros con la cuenta Stripe de cada empresa — piloto en modo Prueba

Diseño y reglas: [docs/architecture/COBROS_POR_EMPRESA_STRIPE.md](../architecture/COBROS_POR_EMPRESA_STRIPE.md).
Esta guía es el procedimiento de puesta en marcha, la ruta de la empresa (Quantum Soulrise, Indira), la aplicación de
las migraciones, la reversión y el estado real de las pruebas.

**Estado:** solo conexión de **Prueba**. Los cobros reales (modo Real) están desactivados y `live` se rechaza al arrancar.
El Stripe corporativo de Big Elephant (`CP_STRIPE_*`, `server/stripe/*`) no se toca. El piloto usa una **cuenta de plataforma
Connect dedicada**, distinta de la que cobra las suscripciones.

## 1. Qué hay

| Pieza | Dónde |
|---|---|
| Pantalla **Ajustes › Cobros con Stripe** (Prueba / Real separados, estado, interruptor) | `/admin/configuracion/cobros` |
| Vinculación, eventos y sesiones por empresa (migración **0080**: `payment_accounts`, `payment_events`, `payment_checkouts`) | BD de cada empresa |
| **Índice global de cuentas** (registro **0018**: `tenant_payment_accounts`, clave = `acct_…`) | registro (plano de control) |
| Webhook central de cuentas conectadas | `POST /api/stripe/connect/webhook` (Core) |
| Reserva de la cuenta, firmada Core → plano de control | `POST /cp/v1/internal/payment-accounts/claim` |
| Pago desde el enlace público del presupuesto («Aceptar y pagar» con Stripe) | `crm.quotes.getByToken` / `payWithToken` (`provider: "stripe"`) |
| Excepción de la pasarela Caddy (solo esa ruta, solo POST) | PR #897 (aparte, extraordinario) |
| Compra directa en la tienda web | PR apilado sobre este (§9) |

La empresa **no configura webhooks**: el destino es central y lo gestiona Big Elephant. En pantalla ve estado de verificación,
cuenta vinculada (recortada), si puede cobrar y recibir pagos, requisitos pendientes y el **último aviso válido** de Stripe.

## 2. Cómo identifica el webhook a la empresa (bases separadas)

La vinculación de cada empresa vive en **su** base, y una restricción de unicidad local no impide que dos empresas guarden
la misma `acct_…`. Por eso hay un **índice global** en el registro, con la cuenta como clave primaria:

1. Al conectar, el Core crea la cuenta en Stripe (clave de idempotencia `connect-acct-v2-<empresa>-<modo>` (Accounts v2: `POST /v2/core/accounts`; Stripe rechaza `/v1/accounts` en integraciones nuevas)) y **antes de
   guardarla** pide la reserva al plano de control (petición firmada, secreto compartido, token de tipo propio de 60 s y
   de un solo uso). El plano de control inserta `(acct, empresa, modo)`: **una cuenta, una empresa; una cuenta por
   empresa y modo**. Si ya es de otra, la reserva falla (409) y **no se guarda nada** en la empresa.
2. El webhook verifica la firma (secreto del destino Connect), busca **`event.account` en el índice** y obtiene la empresa.
   Ningún metadato decide: si el metadato `tenant_id` del evento contradice al índice, el evento se aísla.
3. En la base de esa empresa se vuelve a exigir que `event.account` sea exactamente la cuenta que tiene vinculada y que la
   sesión (`payment_checkouts`) sea suya. Cuenta desconocida o empresa no servible: 200 sin efecto.

Comprobado (pruebas automáticas): 25 empresas pidiendo a la vez la misma cuenta sobre MySQL real → exactamente una la
consigue; una empresa pidiendo a la vez dos cuentas del mismo modo → solo una; la misma empresa repitiendo → idempotente;
tokens ajenos (sin firma, otro secreto, de soporte, caducados, repetidos) → 401/409; empresa inexistente → 404.
Si el plano de control no responde, el Core **falla cerrado** (error «inténtalo de nuevo»; la cuenta ya creada en Stripe
se reutiliza en el reintento por su clave de idempotencia).

## 3. Qué cambia al recibir el webhook (presupuesto, factura, matrícula)

Medido en la prueba `server/cobrosConnect.e2e.mysql.test.ts` (aplicación real, MySQL real). Presupuesto de 400 € de una
inscripción, `checkout.session.completed` firmado con `payment_status = paid` y el importe del presupuesto:

| | Antes del evento | Tras el evento | Tras «confirmar» la inscripción |
|---|---|---|---|
| Presupuesto | «visualizado», sin pagar, sin factura | **«aceptado», con fecha de pago y nº de factura**; método «otro» | igual |
| Factura | ninguna | **1**, estado «generada», 400 €, método «otro» (no «redsys») | igual |
| Reserva operativa | 0 | **1** (canal ONLINE_ASISTIDO) | igual |
| Contabilidad (transacción) | 0 | **1** | igual |
| Cliente potencial (lead) | en proceso / «nueva» | **«convertido» / «ganada»** | igual |
| Registro de actividad del presupuesto | creado, visto | + `payment_confirmed` (actor «Sistema (Stripe)») | igual |
| Inscripción | «solicitada», 0 plazas ocupadas, «Presupuesto visto por el cliente», no pagada | **sigue «solicitada»**, 0 plazas, **«Presupuesto pagado»** | **«confirmada»**, 1 plaza, sin pedir motivo |
| Sesión de pago (`payment_checkouts`) | pendiente | **pagada** (con el `pi_…`) | igual |
| Cuenta (`payment_accounts`) | — | último evento válido anotado | igual |

Puntos a decidir/conocer:
- **El evento no confirma la inscripción por sí solo** (regla de #865: «pagar no confirma solo»). La deja *pagada* y la
  persona responsable la confirma sin motivo. Si se quiere confirmación automática, es una decisión de producto.
- La factura por esta vía sale «generada» (como el cobro manual del CRM); la del cobro Redsys de presupuesto sale «cobrada».
  Es el comportamiento actual de `crm.quotes.confirmPayment`, que se reutiliza.
- Hallazgo: `confirmPayment` no asigna método a la factura (queda el valor por defecto de la tabla, «redsys», **también en
  los cobros manuales de siempre**). Para Stripe se corrige a «otro» (la referencia `stripe:<pago>` queda en la nota de la
  reserva y en `payment_checkouts`). Añadir un valor «stripe» al enum exige migración y tocar los tipos: no incluido.
- Repetición: el mismo evento, o el mismo pago con otro `event.id`, no duplica factura, reserva ni transacción (comprobado).
  Si falla aplicar el pago, el evento queda «failed» y Stripe lo reintenta; se aplica una sola vez.

## 4. Puesta en marcha en la plataforma (Big Elephant, una vez)

1. **Cuenta de plataforma Connect dedicada** (nueva, solo piloto; no la de las suscripciones): crearla en Stripe, activar
   Connect y trabajar en modo prueba (sandbox). Crear una **clave restringida de pruebas** (`rk_test_…`) con permisos de
   Connect (cuentas y enlaces de cuenta), Checkout Sessions en cuentas conectadas y lectura de eventos.
2. **Destino de webhook «cuentas conectadas»** (no el de la cuenta de la plataforma):
   - URL: `https://<APP_ENTRY_HOST>/api/stripe/connect/webhook` (host de entrada de empresas).
   - Eventos: `account.updated`, `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`.
   - Copiar su secreto `whsec_…`.
3. **Variables del servicio Core** (nunca en Git ni en registros): `CONNECT_STRIPE_MODE=test`,
   `CONNECT_STRIPE_API_KEY=rk_test_…`, `CONNECT_STRIPE_WEBHOOK_SECRET=whsec_…`. Sin `CONNECT_STRIPE_MODE` la función
   queda apagada. Además, Core y plano de control necesitan el mismo `SUPPORT_JWT_SECRET` (≥ 32 caracteres; ya existe) y,
   si el plano de control no está en `controlplane.railway.internal:4100`, `PAYMENT_ACCOUNT_CLAIM_URL` en el Core.
4. **Pasarela:** fusionar #897 (excepción de Caddy limitada a la ruta del webhook) y comprobar que el host de entrada
   está en `PUBLIC_HOSTS` en production.

## 5. Plan de aplicación de las migraciones (0080 en cada empresa y 0018 en el registro)

Ambas son **aditivas** (tablas nuevas y vacías, sin claves foráneas, sin tocar datos). El código funciona sin ellas (la
pantalla avisa, la tienda de presupuestos no ofrece Stripe y el webhook ignora); el orden inverso no rompe nada.

1. **Copia verificada** de cada base afectada (procedimiento de `MIGRACIONES_ELEPHANT_SOURCE.md`: `mysqldump
   --single-transaction`, restaurar en una base temporal y comparar recuentos).
2. **Registro 0018** (antes que el código): plan y aplicación explícitos, nunca al arrancar:
   ```bash
   REGISTRY_MIGRATE_URL=mysql://…/<registro> pnpm exec tsx scripts/registry-migrate.ts                         # plan
   REGISTRY_MIGRATE_URL=mysql://…/<registro> pnpm exec tsx scripts/registry-migrate.ts --execute --confirm-database <registro>
   ```
   El usuario de **solo lectura** del Core necesita `SELECT` sobre `tenant_payment_accounts`; el del plano de control,
   escritura (revisar que las concesiones sean por base, no por tabla).
3. **Empresas 0080**, por el mismo procedimiento que 0078/0079 (carril `db/migrations`; la numeración se asigna al fusionar):
   ```bash
   MIGRATE_DATABASE_URL=mysql://…/<empresa> pnpm exec tsx scripts/db/migrate.ts status --dir db/migrations
   MIGRATE_DATABASE_URL=mysql://…/<empresa> pnpm exec tsx scripts/db/migrate.ts up --dir db/migrations                 # plan
   MIGRATE_DATABASE_URL=mysql://…/<empresa> pnpm exec tsx scripts/db/migrate.ts up --dir db/migrations --apply --confirm-database <empresa>
   ```
   Empezar por **Quantum** y comprobar `payment_accounts`, `payment_events` y `payment_checkouts`.
4. **Despliegue del código** (Core y plano de control al mismo commit). Variables del paso 4.3 en último lugar: hasta
   entonces la función sigue apagada.
5. Verificar: pantalla `/admin/configuracion/cobros` en Quantum («Prueba · No conectada»), `GET /readyz`, y el destino de
   webhook en Stripe con «enviar evento de prueba» (la firma correcta debe dar 200; sin ella, 400).

## 6. Cómo revertir conservando las vinculaciones

Las tablas **no se tocan** al revertir; solo el código y la configuración:

- **Apagar sin revertir código:** quitar `CONNECT_STRIPE_MODE` del Core. La pantalla pasa a «no preparado», el webhook
  responde 404 y no se ofrece Stripe en ningún presupuesto. Las cuentas vinculadas siguen en `payment_accounts` y en el índice.
- **Revertir el despliegue:** volver Core y plano de control al commit anterior. El código anterior ignora las tablas nuevas.
  Stripe reintenta durante días los avisos que falten (el webhook responde 404/401 sin la ruta): al volver a desplegar, se
  aplican una sola vez. Un presupuesto pagado en Stripe mientras la función estuvo revertida se aplica entonces; si no puede
  esperar, se cobra a mano (`crm.quotes.confirmPayment`) y el evento posterior se ignora por importe/estado.
- **No ejecutar los `down` salvo decisión expresa.** `0080.down` y `0018.down` hacen `DROP TABLE` y **perderían** qué cuenta
  es de cada empresa. Si fuese imprescindible: exportar antes (`mysqldump <empresa> payment_accounts payment_events
  payment_checkouts` y `mysqldump <registro> tenant_payment_accounts`), y para volver a poner el servicio, reimportar y
  reaplicar la migración. (La prueba `paymentAccountIndex.mysql.test.ts` comprueba que `0018.down` + reaplicar funciona.)
- La excepción de Caddy (#897) se revierte aparte; sin ella Stripe recibe 401 y reintenta.

## 7. La ruta exacta de Indira (Quantum Soulrise)

1. Entra en el panel de Quantum como administradora → **Ajustes → Cobros con Stripe**.
2. En la tarjeta **Prueba**, pulsa **«Conectar mi cuenta de Stripe»**.
3. **Aquí autoriza la conexión: pasa a la página de Stripe** (`connect.stripe.com`). Inicia sesión o crea su cuenta de
   Stripe y completa el alta (datos de la empresa, representante y cuenta bancaria; en modo Prueba Stripe admite datos de
   prueba). Big Elephant no ve ni guarda esos datos. Al terminar, Stripe la devuelve a
   `/admin/configuracion/cobros?stripe=volver`.
4. La pantalla relee el estado **desde Stripe**. «Verificada» cuando Stripe permita cobrar y recibir pagos; si queda
   «Pendiente», **«Continuar o revisar en Stripe»** retoma el alta.
5. Marca **«Cobrar en línea con esta cuenta (Prueba)»** (solo con la cuenta verificada).
6. Los presupuestos de **pago único** de Quantum muestran entonces el pago con tarjeta en Stripe.

La cuenta que se vincula en Prueba es de **prueba**; para cobrar de verdad hará falta una conexión **Real** aparte (no incluida).

## 8. Pago de prueba contra Stripe con Quantum — estado

**No realizado todavía.** Hace falta (no existe en este entorno): la clave `rk_test_…` y el secreto `whsec_…` de la cuenta de
plataforma dedicada, el destino de webhook creado, #897 fusionada y la migración aplicada en Quantum, y que Indira (o quien
ella autorice) complete el alta de **su** cuenta de prueba en la página de Stripe (el alta alojada es humana; no se puede
automatizar). Pasos y qué anotar al ejecutarlo:

1. Conectar y verificar la cuenta (§7). Anotar: estado tras volver, `acct_…` recortado, fecha del primer aviso válido.
2. Presupuesto de una inscripción de Quantum → enlace → «Aceptar y pagar» → tarjeta `4242 4242 4242 4242`.
3. Anotar: vuelta (¿«pendiente de confirmación»?), tiempo hasta «pagado», evento en el panel de Stripe (entregado 200),
   y la tabla del §3 (presupuesto, factura, reserva, inscripción) contrastada con la real.
4. Repetir el envío del evento desde Stripe («reenviar»): debe quedar `duplicate`.

Resultado: _pendiente de ejecutar_ (se documentará aquí).

## 9. Compra directa en la tienda web (PR aparte, apilado sobre este)

Reutiliza la conexión por empresa de este PR y **conserva Redsys**. Qué cambia:

- **Checkout** (`/checkout`): si la empresa tiene Stripe verificado y activado (`public.getTheme › storefront.payments`), el comprador
  elige «Tarjeta (pasarela del banco)» o «Tarjeta (Stripe)»; con solo Stripe, Stripe; sin Stripe, exactamente lo de siempre.
- **Pedido pendiente hasta Stripe:** `reservations.cartCheckout` (`provider: "stripe"`) crea las reservas en `pending_payment`
  (igual que con Redsys), calcula el importe en el servidor (descuentos incluidos) y abre la sesión en la cuenta de la
  empresa (caduca a los 31 min). `/reserva/ok?order=…` solo consulta el estado (no confirma nada).
- **Efectos una sola vez:** el evento firmado llama a `applyPaymentResult`, el tratamiento posterior al pago que antes
  estaba en línea en el aviso de Redsys y que ahora comparten los dos (movido sin cambios; solo el método de cobro, el
  canal de origen y el actor del registro dependen del proveedor). La puerta es la actualización condicional de las
  reservas `pending_payment → paid`, además de la idempotencia por evento y por sesión de este PR.
- Migración **0081** (aditiva): `payment_checkouts.kind`, `merchant_order` y `quote_id` opcional.
- Pago fallido (`async_payment_failed`): el pedido pasa a «fallido» y no se factura; sesión caducada: la limpieza de pedidos
  abandonados de siempre.

Comprobado (MySQL real, dos empresas): pedido pendiente tras el carrito (sin factura, sin cliente, sin correo), vuelta del
navegador = pendiente, evento firmado = reservas pagadas + **una** factura (método «otro») + cliente + correo; repetido,
otro id, otro tipo y 5 entregas simultáneas = una sola vez; otra cuenta, otro importe, otro modo y sin firma = sin efecto;
Redsys sigue creando y cerrando pedidos (incluida su repetición) con Stripe activado. Defectos hallados y corregidos al
probar: la factura única del pedido llevaba «tarjeta_redsys» fijo y el código de respuesta de fallo no cabía en la columna
(10 caracteres).

### 9.1 Recuperación de un pedido pagado que no llegó a cerrarse

Si tras marcar las reservas como pagadas falla un paso posterior (reparto del importe, cliente, factura…), el pago consta
pero el pedido queda a medias. Antes, un reenvío se descartaba al ver la reserva ya pagada. Ahora:

- **Stripe:** el evento se da por **fallido** (500) si el pedido queda pagado y **sin factura**, aunque el error lo absorbiera el
  cierre del pedido; Stripe reintenta. El reintento completa lo pendiente sin repetir lo ya aplicado. Se reabre de uno en
  uno (la sesión vuelve a «pendiente» y el evento a «fallido»), así que no hay ejecuciones simultáneas.
- **Redsys:** su aviso ya se respondió «OK»; un aviso repetido de un pedido pagado y sin factura lo completa pasado un margen
  (`PAYMENT_RECOVERY_MIN_AGE_MS`, 60 s por defecto) para no pisar un aviso anterior en curso. Con el pedido cerrado, repetir
  el aviso no hace nada, como siempre.
- **Qué se rehace y qué no:** stock, puntos, plazas, cliente, contabilidad y booking son idempotentes; factura, expediente REAV
  y correo llevan su guarda; el reparto del importe entre reservas se fija en absoluto. No se repiten CAPI, GHL ni el registro
  de actividad. Pedidos con presupuesto conservan su propia guarda (`quotes.paidAt`).
- **Límite:** un fallo absorbido que NO deja el pedido sin factura (p. ej. no se pudo crear el cliente o emitir los puntos) no
  fuerza el reintento; se ve en los registros (`[upsertClientFromReservation]`, «Error emitiendo los puntos»).
- Prueba: `server/tiendaStripe.recuperacion.mysql.test.ts` (provoca el fallo en MySQL con un disparador, reenvía y comprueba).

### 9.2 Pago de prueba desde el carrito de Quantum (pendiente de ejecutar)

Requisitos: los de §8 (cuenta verificada de Indira, `CONNECT_STRIPE_*`, #897 y migraciones 0018/0080/0081 aplicadas) y la
tienda con Stripe ofrecido (`public.getTheme` → `storefront.payments.stripe = true`). Pasos y qué anotar:

1. Añadir un artículo al carrito y pagar con «Tarjeta (Stripe)» (o solo Stripe si Redsys no está configurado). Tarjeta `4242 4242 4242 4242`.
2. Al volver de Stripe, el pedido debe seguir **pendiente** hasta que llegue el evento (anotar el tiempo hasta «pagado»).
3. Con el evento entregado (200 en el panel de Stripe): reservas pagadas, **una** factura (método «otro»), cliente, correo del pedido, stock
   y puntos si la empresa los tiene contratados. «Reenviar» el evento desde Stripe debe quedar `duplicate`.
4. **Acceso del comprador si el artículo es un curso:** hoy el cierre del pedido de la tienda NO crea matrícula en Elephant
   LMS. El acceso a un curso solo lo libera `learningFlow` desde una inscripción CONFIRMADA con presupuesto cobrado
   (`grantFromPayment`, sin llamada desde el pedido de la tienda). Una compra de curso desde el carrito deja factura y correo, pero
   **ningún acceso al contenido**: queda como decisión de producto (y trabajo aparte) antes de vender cursos directamente en la web.

## 10. Límites conocidos

- Pago único. Un presupuesto con **plan de cuotas** sigue por Redsys/manual (la sesión de Stripe se rechaza con aviso).
- Reembolsos y disputas (`charge.refunded`, `charge.dispute.*`) y comisión de plataforma: no incluidos.
- Visibilidad para operadores (Ficha 360) de la cuenta de cada empresa: el índice del registro lo hace posible; pendiente de pantalla.
- El número de la migración 0080 puede cambiar al fusionarse (cola serie de `db/migrations`).

## 9. Modo Real para empresas autorizadas (vínculo OAuth de la cuenta existente)

**Estado:** apagado por defecto. Solo se activa para las empresas listadas en `CONNECT_STRIPE_LIVE_TENANTS` y solo si existen las cuatro
variables siguientes (nombres; los valores los carga Dirección en Railway, servicio `core`, nunca por chat). **No se crea ninguna cuenta:** la
empresa autoriza en Stripe la cuenta que YA tiene.

| Variable | Contenido |
|---|---|
| `CONNECT_STRIPE_LIVE_API_KEY` | Clave RESTRINGIDA real (`rk_live_…`) de la plataforma Connect DEDICADA. Permisos: Connect OAuth (escritura), Checkout Sessions (escritura), Cuentas conectadas (lectura). Nunca la del Stripe corporativo (`CP_STRIPE_*`): el arranque la rechaza si coincide. |
| `CONNECT_STRIPE_LIVE_WEBHOOK_SECRET` | `whsec_…` del destino real «cuentas conectadas» (misma URL central que Prueba). |
| `CONNECT_STRIPE_LIVE_CLIENT_ID` | `ca_…` real de la plataforma (Ajustes › Connect › OAuth). |
| `CONNECT_STRIPE_LIVE_TENANTS` | Identificadores exactos, separados por comas (p. ej. `t12-quantum-soulrise`). Sin comodines. |

**Pasos humanos en el panel de Stripe (plataforma dedicada, modo real):**
1. Activar Connect en la cuenta de plataforma y habilitar **OAuth** (Ajustes › Connect › Opciones de incorporación › OAuth).
2. Registrar la dirección de retorno EXACTA: `https://<host de la empresa>/admin/configuracion/cobros` (para Quantum:
   `https://t12-quantum-soulrise.app.bigelephant.es/admin/configuracion/cobros`).
3. Crear la clave restringida con los permisos de la tabla y el destino de webhook de «cuentas conectadas» en modo real hacia
   `https://app.bigelephant.es/api/stripe/connect/webhook` con los eventos `account.updated`, `account.application.deauthorized`,
   `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded` y `checkout.session.async_payment_failed`.
4. Cargar las cuatro variables en Railway (`core`) y redesplegar.

**Flujo de la empresa:** Ajustes › Cobros con Stripe › Real › «Vincular mi cuenta de Stripe» → Stripe (inicia sesión, elige su cuenta,
autoriza) → vuelve con `?code=&state=` → el servidor comprueba el `state` firmado (empresa + administrador + 15 min), cambia el código por la
cuenta, la reserva en el índice global (una cuenta, una empresa), lee su estado y, si está verificada, se puede encender «Cobrar en línea (Real)».

**Garantías:** en modo Real nunca se llama a `createAccount`; una cuenta ya vinculada no se sustituye por otra; si la empresa desautoriza la
plataforma (`account.application.deauthorized`) los cobros en línea se apagan al instante; el webhook identifica el modo por el secreto que
verifica la firma y un evento real solo se aplica con la configuración real. La empresa cobra en Real solo si el modo está configurado, está
autorizada y su cuenta real está verificada con el interruptor encendido; en cualquier otro caso se usa Prueba.

**Reversión inmediata:** vaciar `CONNECT_STRIPE_LIVE_TENANTS` (o quitar las variables) apaga el modo Real sin tocar datos; el interruptor de la
empresa también se puede apagar desde Ajustes. Los `.down.sql` no cambian: no hay migración nueva.
