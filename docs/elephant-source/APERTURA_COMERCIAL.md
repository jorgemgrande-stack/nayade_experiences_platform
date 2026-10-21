# Apertura comercial: fases 4 y 5

Requisito: la fase 3 está hecha, con `live` migrado y desplegado según `DESPLIEGUE_LIVE.md`. Cada paso marcado **[TÚ]** necesita tu autorización o tu acción.

## 1. Estado verificado de Stripe Live (20/10/2026, solo lectura)

| Pieza | Estado |
|---|---|
| Cuenta | `acct_1URULE9RzfmCBuai` (Iron Elephant Consulting), live |
| Precios | 4 activos, `tax_behavior: exclusive` y sin duplicados. Essential 29 €/mes y 279 €/año; Business 79 €/mes y 759 €/año |
| Webhook | `we_1USAv39RzfmCBuaiop8nwv1v`, activo, con los **21 eventos** que procesa el código (incluidos los 3 que añadiste) |
| Clave del plano de control | **Restringida de modo real** (`rk_live_…`). Secreto del webhook `whsec_…` presente |
| Plano de control de `live` | `CP_STRIPE_MODE=live`, orquestador y conciliación encendidos. Checkout, autoservicio y política fiscal **sin definir**: no se cobra nada |
| Stripe Tax | Activo, pero **sin ningún registro**: hay que registrar España (decisión 2) |
| Customer Portal | Cancelación a fin de periodo; faltan las URL de condiciones y privacidad |

## 2. Orden de apertura

1. **[TÚ]** Decisiones 1 y 2 de `DECISIONES_PROPIETARIO.md`. Registro de España en Stripe Tax.
2. **[TÚ]** Textos legales aprobados y publicados (web `5ea5be6` o equivalente). Fijar `CP_TERMS_VERSION`, `CP_TERMS_URL`, `CP_PRIVACY_VERSION` y `CP_PRIVACY_URL`, y poner las URL en el Customer Portal.
3. **[TÚ]** Correo (`CORREO_PROVEEDOR.md`):
   - proveedor y DNS;
   - prueba de cada plantilla en modo sandbox;
   - después, `MAIL_MODE=live` y `MAIL_LIVE_AUTHORIZED=1`;
   - `CP_ALERT_EMAIL` con el equipo.
4. **[TÚ]** Traslado de dominios (`docs/runbooks/DOMINIOS_LIVE.md`): primero `admin`, después `www` y el apex, y por último `app` y `*.app`.
5. **Configuración fiscal aprobada** en el `controlplane` de `live`:
   - `CP_STRIPE_TAX_POLICY=stripe_tax_exclusive`;
   - `CP_STRIPE_FISCAL_SCENARIOS`, `CP_STRIPE_TAX_EXPECTATIONS`, `CP_STRIPE_SCENARIO_COUNTRIES` y `CP_STRIPE_CONSUMER_RATES`, según lo aprobado.
6. **[TÚ]** `CP_STRIPE_CHECKOUT_ENABLED=1`, sin autoservicio todavía. **Primera compra controlada** (§3).
7. **[TÚ]** Con la primera compra correcta: Essential y Business a «disponible» en el catálogo, publicar y `CP_PUBLIC_SELF_SERVICE_ENABLED=1`.
8. Supervisión reforzada la primera semana (§4).

## 3. Primera compra controlada (Essential mensual)

Con tu empresa y una tarjeta real. **Reembolsable.**

| Comprobación | Dónde | Esperado |
|---|---|---|
| Precio | Página de Stripe | 29,00 € + IVA = 35,09 € (empresa de la Península) |
| Impuesto | Página de Stripe y factura | 21 %; NIF en la factura y domicilio fijado |
| Cobro | Stripe → Payments | `succeeded`, live |
| Webhook | CRM → Contrataciones (pedido) e incidencias | Pago `stripe/live`; sin `invoice_tax_mismatch` ni `buyer_tax_id_missing` |
| Suscripción | Stripe y CRM → Suscripciones | Activa, Essential mensual |
| Empresa (tenant) | CRM → Empresas clientes | Aprovisionada y activa |
| Acceso | Correo de bienvenida → crear contraseña → `app.bigelephant.es` | Entra; la suscripción muestra Essential |
| Factura | Correo de Stripe y Customer Portal | Emisor IRON ELEPHANT CONSULTING, S.L. y NIF. **Validez legal: decisión 6** |
| Correo | Bandeja de salida (`mail_outbox`) | Bienvenida, contratación, pago y factura, una vez cada uno |
| Registro administrativo | CRM → pedido → historial; `/cp/v1/commercial-events` | Pedido, pago y alta registrados |

**Reembolso de la prueba [TÚ]:** reembolso en Stripe y, si procede, cancelación. Comprobar la rectificativa `pending` en `fiscal_documents` y la nota de crédito según la decisión 7.

## 4. Supervisión inicial

Todas las alertas abren una incidencia deduplicada y avisan por `CP_ALERT_WEBHOOK` o `CP_ALERT_EMAIL`.

| Riesgo | Alertas |
|---|---|
| Errores de alta | `provisioning.failed`, `stripe.self_service_failed` |
| Fallos de Checkout | `stripe.gateway_error`, `stripe.session_mismatch` |
| Webhooks fallidos | `stripe.webhook_invalid_signature`, `stripe.webhook_store_failed`, `stripe.event_failed`, `stripe.worker_failed` |
| Suscripción cobrada sin empresa | `orders.tenant_sync_failed`, `orders.failed` |
| Cobros sin conciliar | `stripe.reconcile_backlog`, `stripe.refund_unallocated`, `stripe.items_drift` |
| Impuesto o comprador | `stripe.invoice_tax_mismatch`, `stripe.buyer_territory_mismatch`, `stripe.buyer_tax_id_missing`, `stripe.vat_no_longer_valid` |
| Correo | `mail.send_failed`, `notifications.dead` |
| Errores críticos | `stripe.failed`, `licensing.check_failed`, `stripe.namespace_mismatch`, `stripe.live_event_rejected` |
| Acceso | Sin alerta propia: los fallos de inicio de sesión tienen límite de intentos y quedan en los registros; revisar las incidencias de soporte |

## 5. Operación desde el CRM

| Necesidad | Dónde |
|---|---|
| Clientes | Comercial → Empresas; Clientes SaaS → Empresas clientes |
| Suscripciones | Comercial → Suscripciones |
| Pagos y enlaces de pago | Comercial → Contrataciones (pedido): pagos y enlace de Checkout en modo real. **Sincronizar catálogo de Stripe** |
| Incidencias | Clientes SaaS → Operación SaaS → Errores y Alertas |
| Solicitudes | Comercial → Leads (solicitudes de la web); Atención al cliente → Tickets |
| Desistimientos | Atención al cliente → **Desistimientos** (CRM PR #28) |

## 6. Armado técnico de Checkout y autoservicio (paso humano; preparado el 21/10/2026)

El clasificador de seguridad del entorno de Claude Code bloquea este cambio, así que lo ejecuta el propietario. **No abre cobros:** con estas tres variables, Checkout y autoservicio siguen inactivos mientras falten `CP_STRIPE_TAX_POLICY`, `CP_STRIPE_FISCAL_SCENARIOS` y `CP_TERMS_VERSION`.

**Antes (comprobado el 21/10/2026 en `live`):**
- política fiscal, escenarios, condiciones, privacidad, precontractual y desistimiento, sin definir;
- prueba gratuita pública y alta automática, sin definir.

Ningún escenario es elegible y ninguna empresa comercial se puede crear.

**Paso 1, [TÚ]: variables sin desplegar**, en una de estas dos formas:
- **Panel:** Railway → `live` → `controlplane` → Variables.
- **CLI:**
  ```
  railway variables -s controlplane -e live --skip-deploys --set "CP_STRIPE_CHECKOUT_ENABLED=1" --set "CP_PUBLIC_CHECKOUT_ENABLED=1" --set "CP_PUBLIC_SELF_SERVICE_ENABLED=1"
  ```
  O bien `node rw-live.cjs armar`, la orden limitada a esas tres variables.

**Paso 2 (equipo técnico): despliegue** de `controlplane` con el commit vigente (`node rw-live.cjs up controlplane live-export-core-aa79d4b`).

**Después (equipo técnico):**

| Comprobación | Esperado |
|---|---|
| Arranque del `controlplane` | `ctx="Stripe"` con `checkout=false`, `checkoutReason="tax_policy_pending"`, `selfService=false`, `termsPublished=false` |
| `POST https://elephant-source-web-live.up.railway.app/cp/v1/public/checkout/start` | 404 (el autoservicio no se monta sin Checkout) |
| `GET …/cp/v1/public/checkout/status?session_id=cs_live_x` | 400 o 404: no expone nada |
| Registros | Ningún Customer ni Checkout Session nuevo en Stripe; 0 empresas y 0 pedidos nuevos en el CRM |

**Cuándo empiezan a cobrar:** solo cuando, además, se aprueben y fijen las decisiones fiscales (`PROPUESTA_DECISIONES_FISCALES.md`) y las condiciones (`CP_TERMS_VERSION`). Y solo en los escenarios aprobados.
