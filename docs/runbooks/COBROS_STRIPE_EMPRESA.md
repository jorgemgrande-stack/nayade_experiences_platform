# Cobros con la cuenta Stripe de cada empresa — entrega 1 (solo Prueba)

Diseño y reglas: [docs/architecture/COBROS_POR_EMPRESA_STRIPE.md](../architecture/COBROS_POR_EMPRESA_STRIPE.md).
Esta guía es el procedimiento de puesta en marcha, la ruta de la empresa (Quantum Soulrise, Indira) y lo que queda.

**Estado:** los cobros reales (modo Real) están desactivados y no se pueden activar desde esta versión. Solo existe
la conexión de **Prueba**. El Stripe corporativo de Big Elephant (`CP_STRIPE_*`, `server/stripe/*`) no se toca.

## 1. Qué se entrega

| Pieza | Dónde |
|---|---|
| Pantalla **Ajustes › Cobros con Stripe** (Prueba / Real separados, estado, interruptor) | `/admin/configuracion/cobros` |
| Cuenta vinculada y eventos por empresa (migración **0080**: `payment_accounts`, `payment_events`, `payment_checkouts`) | BD de cada empresa |
| Conexión (Account Link), lectura de estado, interruptor, sesión de pago de un presupuesto | `server/routers/cobros.ts`, `server/paymentsConnect/` |
| Webhook central de cuentas conectadas | `POST /api/stripe/connect/webhook` |
| Pago desde el enlace público del presupuesto («Aceptar y pagar» con Stripe) | `crm.quotes.getByToken` / `payWithToken` (`provider: "stripe"`) |

Qué muestra la pantalla a la empresa: estado (No conectada · Pendiente · Verificada · Restringida), cuenta vinculada
(recortada), si puede cobrar y recibir pagos, requisitos que Stripe aún pide y el **último aviso válido** de Stripe. El
webhook lo gestiona Big Elephant de forma central: la empresa no ve ni configura URL ni secreto de firma.

## 2. Puesta en marcha en la plataforma (una vez, Big Elephant)

Requiere aprobación del propietario: variables de entorno y la excepción de la pasarela.

1. **Plataforma Connect.** En Stripe, la cuenta que actúe de plataforma (decisión pendiente: ¿la corporativa u otra?)
   con Connect activado. Clave **restringida de pruebas** con permisos de Connect (cuentas, enlaces de cuenta, Checkout
   en cuentas conectadas, lectura de eventos).
2. **Destino de webhook «Cuentas conectadas»** (no el de la cuenta de la plataforma):
   - URL: `https://<host central de acceso>/api/stripe/connect/webhook` (el `CENTRAL_LOGIN_HOST` actual).
   - Eventos: `account.updated`, `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`.
   - Copiar su secreto `whsec_…`.
3. **Variables del servicio Core** (nunca en Git ni en registros):
   `CONNECT_STRIPE_MODE=test`, `CONNECT_STRIPE_API_KEY=rk_test_…`, `CONNECT_STRIPE_WEBHOOK_SECRET=whsec_…`.
   Sin `CONNECT_STRIPE_MODE` la función queda apagada y la pantalla lo indica. `live` se rechaza al arrancar.
4. **Pasarela (Caddy).** Hoy el host de entrada solo deja pasar `/api/central/*` y el resto de hosts que no son dominio
   propio llevan contraseña básica: Stripe no podría entregar el aviso. Hace falta una excepción mínima, solo para esa
   ruta (la firma del evento es la autenticación). Es un cambio de la pasarela de seguridad: **extraordinario**, en PR
   aparte. Propuesta, junto a `handle /api/central/*` en `deploy/railway/gateway/Caddyfile`:

   ```
   handle /api/stripe/connect/webhook {
   	header Cache-Control "no-store"
   	reverse_proxy {$UPSTREAM} {
   		header_up -Authorization
   		header_up X-Forwarded-For {client_ip}
   	}
   }
   ```
5. Aplicar la migración 0080 a las empresas (procedimiento normal de migraciones; sin ella la pantalla avisa y no
   rompe nada).

## 3. La ruta exacta de Indira (Quantum Soulrise)

1. Entra en el panel de Quantum como administradora → **Ajustes → Cobros con Stripe**.
2. En la tarjeta **Prueba**, pulsa **«Conectar mi cuenta de Stripe»**.
3. **Aquí autoriza la conexión: pasa a la página de Stripe** (`connect.stripe.com`). Inicia sesión o crea su cuenta de
   Stripe, y completa el alta de Stripe (datos de la empresa, representante y cuenta bancaria; en modo Prueba Stripe
   admite datos de prueba). Big Elephant no ve ni guarda esos datos. Al terminar, Stripe la devuelve a
   `/admin/configuracion/cobros?stripe=volver`.
4. La pantalla relee el estado **desde Stripe** (no se fía de la vuelta del navegador). Verá «Verificada» cuando Stripe
   permita cobrar y recibir pagos; si queda «Pendiente», **«Continuar o revisar en Stripe»** retoma el alta.
5. Marca **«Cobrar en línea con esta cuenta (Prueba)»** (solo se puede con la cuenta verificada).
6. Los presupuestos de **pago único** de Quantum muestran entonces el pago con tarjeta en Stripe.

Importante: la cuenta que se vincula en Prueba es una cuenta de **prueba**; para cobrar de verdad hará falta una
conexión **Real** aparte (no incluida; se activa de forma explícita y autorizada).

## 4. Prueba piloto (tarjeta de prueba)

1. Presupuesto de una inscripción (Convocatorias → **Preparar presupuesto**), enviado a la persona.
2. La persona abre el enlace → **«Aceptar y pagar»** → página de pago de Stripe → tarjeta `4242 4242 4242 4242`.
3. Al volver, el presupuesto sigue **pendiente de confirmación** (aviso en pantalla; no se da por pagado por la
   redirección).
4. Cuando Stripe entrega el evento firmado: el presupuesto pasa a **aceptado y pagado**, se emite la factura y la
   persona lo ve pagado (la página se actualiza sola).
5. En Convocatorias, la inscripción se lee como **pagada** y se confirma **sin motivo**. *Pagar sigue sin confirmar
   la inscripción por sí solo* (regla actual de #865; decisión de producto si se quiere automático).

Comprobado en pruebas automáticas (MySQL real, dos empresas, firma real del SDK): vuelta del navegador = pendiente; evento
firmado = pago + factura + inscripción pagada y confirmable; evento repetido (mismo id o con otro id para la misma
sesión) = una sola factura; evento de otra cuenta = aislado sin efecto; firma inválida/ausente = 400; empresa
desconocida = 200 sin efecto; `account.updated` restringe y apaga el interruptor.
**No comprobado:** ninguna llamada real a Stripe (alta de cuenta, Account Link, creación de la sesión de Checkout y
entrega real del webhook), porque no hay claves de la plataforma Connect ni cuenta de Indira todavía. Esos pasos solo
tienen pruebas con la pasarela simulada.

## 5. Compra directa en la tienda web (no incluida)

El checkout de la tienda (`/checkout`, `reservations.cartCheckout`) paga con **Redsys** y se confirma en
`/api/redsys/notification` (`finalizePaidShopOrder`: factura única del pedido, stock, puntos, correos). Hoy **no hay
nada de Stripe para compradores de una empresa**. Para que un comprador pague directamente en la web con Stripe falta:

1. Sesión de Checkout creada desde el **carrito** (importes y moneda calculados en servidor, como `cartCheckout`),
   con las reservas en `pending_payment` y su `merchantOrder`, reutilizando la misma cuenta (`payment_accounts`).
2. Extraer del IPN de Redsys el tratamiento posterior al pago (hoy en línea, ~300 líneas en `redsysRoutes.ts`) a una
   función común que llamen Redsys y el evento de Stripe, para no duplicar factura, stock, puntos ni correos.
3. Botón/selector de Stripe en `Checkout.tsx` y páginas de vuelta (`/reserva/ok`, `/reserva/error`) que no den el pago
   por hecho.
4. Pruebas de repetición/aislamiento sobre ese camino (`tiendaPedidos.e2e.mysql.test.ts` como base).

## 6. Límites conocidos de esta entrega

- Pago único. Un presupuesto con **plan de pagos (cuotas)** sigue por Redsys/manual: la sesión de Stripe se rechaza con aviso.
- El método de pago queda registrado como «otro» con la referencia `stripe:<pago>` (se reutiliza el cobro de siempre
  `crm.quotes.confirmPayment`, llamado como «Sistema (Stripe)»).
- Reembolsos y disputas (`charge.refunded`, `charge.dispute.*`) y comisión de plataforma: no incluidos.
- Visibilidad para operadores (Ficha 360) de la cuenta de cada empresa: no incluida; el registro vive en la BD de la
  empresa, no en el plano de control (ver diseño).
- El nombre de la migración puede cambiar de número al fusionarse (cola serie de `db/migrations`).
