# Activación de Stripe live en el entorno `live`

**Estado (19/10/2026):** todo preparado salvo **dos valores que introduce el propietario**: la clave restringida y el secreto del webhook.

Activar Stripe **no abre la venta**:
- Checkout sigue bloqueado (`tax_policy_pending`) hasta que haya una política fiscal aprobada.
- Los interruptores de contratación pública siguen apagados.

Herramienta: `scripts/railway/stripe-live.ts`. Lógica y pruebas: `server/stripe/liveActivation.ts`.

## 1. Lo que ya está hecho y comprobado

| Pieza | Estado |
|---|---|
| Cuenta real `acct_1URULE9RzfmCBuai` | Essential y Business con 4 precios `tax_behavior=exclusive`, `lookup_key` `es:<plan>:<periodo>:eur:v1…v4`, coincidentes con los `web_prices` 1–4 del CRM de `live`. Portal `bpc_1URvFV9RzfmCBuaiQvTwRYW3`. 0 suscripciones y 0 webhooks |
| CRM de `live` (`es_crm`) | Migraciones hasta la 0013 (`livemode`). Catálogo cargado. 0 filas de negocio |
| `controlplane` de `live` | `CP_STRIPE_NAMESPACE=live`, URL de vuelta válidas, `NODE_ENV=production` (de la imagen). Pagos simulados y Checkout apagados. `MAIL_MODE=off` |
| Pasarela del CRM de `live` | `STRIPE_WEBHOOK_PUBLIC=1`: deja pasar **solo** `POST /cp/v1/stripe/webhook` con JSON y `Stripe-Signature`. El resto sigue tras la autenticación básica |
| CRM (SPA) | `release/live-crm-stripe`: textos de MODO REAL, bloqueo fiscal visible, botón «Sincronizar catálogo de Stripe» |

`pnpm exec tsx scripts/railway/stripe-live.ts comprobar` muestra hoy exactamente esto:
- `clave`, `secreto_webhook`, `configuracion` y `cuenta_real` en **FALLO**: falta la clave.
- `politica_fiscal` en **AVISO**.
- Todo lo demás en **OK**.

## 2. Lo que hace el propietario (unos 15 minutos)

En el Dashboard de la cuenta **real**, con el modo de prueba **apagado**.

### 2.1 Clave restringida

**Dónde:** Developers → API keys → **Create restricted key**.

**Nombre:** `elephant-source-controlplane-live`.

**Permisos** (los mismos que la de pruebas, `STRIPE_FASE_A.md` §5):

| Permiso | Nivel |
|---|---|
| Customers | Write |
| Checkout Sessions | Write |
| Customer portal | Write |
| Subscriptions | Read |
| Invoices | Read |
| Prices (Plans) | Read |
| Products | Read |
| Events | Read |
| Charges | Read |
| Disputes | Read |

Todo lo demás en **None**: sin escritura de suscripciones, precios ni productos, y sin webhooks.

### 2.2 Destino del webhook

**Dónde:** Developers → Webhooks → **Add destination**.

| Campo | Valor |
|---|---|
| Eventos | los 18 de abajo, ni uno más ni uno menos |
| Carga | **Snapshot** |
| Versión de la API | `2026-09-30.endive` |
| URL | `https://elephant-source-crm-live.up.railway.app/cp/v1/stripe/webhook` |
| Estado | **Activo** |

**Los 18 eventos:**
- `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`;
- `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`;
- `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`;
- `charge.refunded`, `charge.refund.updated`, `charge.dispute.created`, `charge.dispute.closed`, `charge.dispute.funds_reinstated`, `charge.dispute.updated`.

Mientras no haya cobros, Stripe no envía nada. Si llegara un evento antes de la activación, el controlplane responde 401 y Stripe reintenta durante días: no se pierde.

Cuando `live` pase a dominios propios, la URL cambiará a la del CRM definitivo, en una operación coordinada.

### 2.3 Guardar los dos valores en Railway

Directamente desde el portapapeles, **sin pegarlos en ningún chat, documento ni terminal con historial**.

En PowerShell, desde la carpeta enlazada al proyecto:

```powershell
Get-Clipboard | railway variable set CP_STRIPE_API_KEY --stdin --skip-deploys -s controlplane -e live
# copiar el «Signing secret» del destino creado
Get-Clipboard | railway variable set CP_STRIPE_WEBHOOK_SECRET --stdin --skip-deploys -s controlplane -e live
Set-Clipboard -Value " "
```

Alternativa: Dashboard de Railway → entorno `live` → `controlplane` → Variables → **New variable**, sin desplegar.

**Reglas:**
- `--skip-deploys` es obligatorio: el servicio no debe arrancar con la clave y sin el modo.
- No crees `CP_STRIPE_MODE`: lo fija el paso 3.

## 3. Lo que hace la ventana de `live` después

| # | Paso | Aceptación |
|---|---|---|
| 1 | `stripe-live.ts comprobar` (y `CP_STRIPE_WORKER_ENABLED=1` para la conciliación) | Solo queda `politica_fiscal` en AVISO; `webhook` en AVISO si la clave no lee webhooks. Los 4 precios en OK |
| 2 | Comprobar en el Dashboard la URL, el estado activo y los 18 eventos | Lo confirma el propietario o el MCP de Stripe (solo lectura) |
| 3 | `stripe-live.ts activar` (simulación) y después `activar --apply` | `CP_STRIPE_MODE=live` escrito sin desplegar |
| 4 | `railway up` del export verificado del controlplane de `live` (hoy `release/live-correo`, `b1e3786`) | Arranque limpio: `Stripe enabled=true mode="live" keyKind="restricted" namespace="live" taxPolicy="pending"`, `checkoutBlocked="tax_policy_pending"` |
| 5 | `stripe-live.ts verificar` | Webhook montado (firma falsa → 400) y CRM protegido (401) |
| 6 | CRM → Comercial → Contrataciones → **Sincronizar catálogo de Stripe** | 4 enlazados, 0 sin crear, 0 discordancias. El banner dice «MODO REAL… bloqueado hasta aprobar la política fiscal» |
| 7 | Stripe (MCP, solo lectura) | 0 suscripciones, 0 cobros |

Después de esto, Stripe live está **conectado, pero sin cobrar**.

Las siguientes decisiones son autorizaciones separadas:
- `CP_STRIPE_TAX_POLICY=stripe_tax_exclusive`, con la política fiscal aprobada;
- `CP_STRIPE_CHECKOUT_ENABLED`, `CP_PUBLIC_CHECKOUT_ENABLED` y `CP_PUBLIC_SELF_SERVICE_ENABLED`;
- el primer cobro real.

## 4. Marcha atrás

1. Borrar `CP_STRIPE_MODE`, `CP_STRIPE_API_KEY` y `CP_STRIPE_WEBHOOK_SECRET` del controlplane de `live`. Las tres a la vez: una clave sin modo impide arrancar.
2. `railway up` del mismo export. Stripe vuelve a quedar sin montar.
3. En Stripe, **revocar** la clave restringida y **desactivar** el destino del webhook.

No hay datos que deshacer: sin Checkout no se crea ningún Customer ni ninguna suscripción.

## 5. Garantías del script

- Simulación salvo `--apply`. Solo escribe `CP_STRIPE_MODE`.
- Aplica las mismas reglas que el servidor (`stripeConfigFromEnv` y `liveStartupProblem`), como si ya estuviera en modo live:
  - solo `rk_live_`;
  - `whsec_`;
  - `CP_STRIPE_NAMESPACE=live`;
  - nada de `CP_STRIPE_*LIVE*` ni `CP_STRIPE_ADMIN*`.
- Se niega a activar si hay pagos simulados o si algún interruptor de apertura está encendido.
- En Stripe solo hace lecturas: los 4 precios y, si la clave puede, los destinos del webhook.
- Nunca imprime una clave, un secreto ni el mensaje de error de Stripe (puede contener parte de la clave). Solo muestra el estado HTTP, el tipo y el código.
