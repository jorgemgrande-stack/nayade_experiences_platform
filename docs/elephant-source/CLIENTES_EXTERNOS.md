# Clientes externos: contratación, aceptación y cobro recurrente desde el CRM

Clientes con tecnología e infraestructura propias, fuera de Elephant Core, cuyo servicio se contrata, se acepta y se cobra desde Big Elephant CRM con Stripe Billing. El primer caso es el **piloto Nextair SL / Skicenter (SkiNet)**. El mecanismo es genérico: sirve para cualquier otro cliente externo sin desarrollo específico.

**No se aprovisiona nada en Elephant Core:** ni tenants, ni bases de datos, ni subdominios, ni licencias. El impago no detiene la infraestructura del cliente.

## Circuito

```
Comercial → Empresas → <empresa> → Nueva contratación de servicio externo
  1. Contrato del CRM con las condiciones (servicio, cuota, IVA, día de cobro, primer vencimiento, margen) — versionado
  2. Enlace de aceptación para el representante → aceptación digital con evidencias
  3. Enlace de Stripe para autorizar el método de pago (Checkout modo setup) — SIN cargo
  4. Webhook → Elephant fija el método y crea la suscripción de Stripe con trial_end = primer vencimiento
  5. Día 1 de cada mes (08:00 Europe/Madrid): Stripe factura y cobra → webhooks → estado comercial
```

| Pieza | Dónde |
|---|---|
| Servicio y reglas | `server/external/service.ts` |
| Calendario (zona horaria) | `server/external/schedule.ts` |
| Documento contractual y su huella | `server/external/document.ts` |
| Rutas de operador y página pública | `server/external/api.ts` |
| Tablas (CRM 0026) | `external_subscriptions`, `crm_contract_acceptances`, `external_subscription_events` |
| Stripe | `server/stripe/gateway.ts`: modo setup, suscripción de servicio, IVA, relojes de prueba |
| Webhooks | `server/stripe/events.ts`: la sesión de setup y la suscripción con `es_external_id` van al módulo externo |
| Margen del día 5 | Trabajador de Stripe (cada conciliación) y `POST /cp/v1/external/evaluate` |

## Aceptación digital

- El contrato del CRM lleva las condiciones económicas en su texto, y su versión queda guardada de forma inmutable (`crm_contract_versions`).
- El documento que se presenta es determinista y se identifica por su huella SHA-256 y su versión. Si el contrato cambia después de enviar el enlace, el enlace deja de valer.
- **El enlace es de un solo uso:** caduca a los 14 días y solo se guarda el hash del token. Enviar un enlace nuevo revoca los anteriores.
- La página pública es `/cp/v1/public/contract-acceptance`, en el dominio del CRM. Es HTML sin scripts, con política de seguridad estricta y límite de peticiones.
- **Evidencias que se guardan:**
  - nombre y NIF declarados;
  - declaración aceptada;
  - fecha;
  - versión y huella del documento;
  - IP seudonimizada (SHA-256 con sal);
  - navegador.
- El contrato pasa a «Firmado» con método **electrónico** y la referencia `aceptacion:<id>:<huella>`.
- **Aceptar no autoriza ningún cobro:** la autorización del método de pago es un paso posterior y separado.

## Autorización del método de pago sin cargo

- Se usa Checkout de Stripe en **modo setup**. El cliente registra la tarjeta en Stripe y Elephant solo guarda el id del método de pago.
- **El texto de la página de Stripe** dice:
  - que se autorizan cobros recurrentes;
  - la cuota (1.000 € + IVA 210 € = 1.210 € al mes);
  - el día de cobro y el primer cargo;
  - que hoy no se cobra nada;
  - que existe un portal para consultar facturas, cambiar el método o pedir la baja.
- **Al completarse** (webhook firmado `checkout.session.completed`):
  1. Elephant fija el método por defecto del Customer.
  2. Crea la suscripción de Stripe con `trial_end` en el primer vencimiento, `proration_behavior: none` y el IVA como tipo exclusivo.
  3. La clave de idempotencia es la del contrato y la fecha: repetir nunca crea otra suscripción.
- **Si la autorización llega después del primer vencimiento,** no se cobra con retroactividad. La contratación queda en «Decisión pendiente» y un operador con `orders:approve` fija una nueva fecha futura con motivo, que se registra en el contrato.

## Calendario

- El cobro es el día 1 a las **08:00 Europe/Madrid**. Stripe ancla los cobros mensuales al mismo día y hora UTC: a las 08:00 de Madrid el cobro cae el día 1 en invierno y en verano. A medianoche, el día 1 de Madrid sería el último día del mes en UTC.
- **Un cargo ordinario por periodo:** lo emite Stripe. Elephant nunca crea cargos sueltos. Cada factura se identifica por su mensualidad (p. ej. «noviembre de 2026»).
- Cambiar el calendario exige registrar el cambio en el contrato.

## Impagos (días 1 a 5)

- **Día 1, cobro fallido:** la contratación pasa a «Pago pendiente», con margen hasta el día 5 a las 23:59 (Madrid). Queda en el historial y salta la alerta `external.payment_failed`.
- **Reintentos:** los de Stripe (Smart Retries de la cuenta). Si se recupera, se cobra **la misma factura**; nunca hay un segundo cargo por el periodo.
- **Día 5 cumplido:** evaluación automática y alerta administrativa `external.overdue_after_grace`, una sola vez por factura, con nota en el contrato.
- **El servicio del cliente no se detiene.**
- **El cliente puede actualizar su método de pago** desde el portal de facturación (enlace desde el CRM).
- **Avisos al cliente:** los envía Stripe según la configuración de la cuenta (correos de pago fallido y de actualización de tarjeta). Elephant no envía todavía comunicaciones propias.

## Fiscalidad

- **IVA:** tipo exclusivo **fijo** de Stripe (`TaxRate`, 21 %, país ES), reutilizado si ya existe uno igual. No depende de Stripe Tax.
- **Es correcto para** una empresa establecida en la Península o Baleares que recibe un servicio de un prestador español. **No sirve** si el cliente está en Canarias, Ceuta o Melilla (no hay IVA, sino IGIC o IPSI), si es de otro país de la UE (inversión del sujeto pasivo) o si es de fuera de la UE.
- **Antes de emitir facturas reales** hay que confirmar el domicilio fiscal y el NIF de Nextair SL.
- **Factura legal:** la de Stripe es el justificante de cobro. La emisión de la factura legal sigue el circuito de facturación aprobado (`server/stripe/fiscalDocuments.ts`), que hoy está pendiente de decisión.

## Pruebas

- **`server/controlPlane.externalServices.test.ts`:** aplicación real del plano de control y doble de Stripe con firmas reales del SDK. Cubre:
  - contratación sin duplicados;
  - aceptación con evidencias;
  - autorización sin cargo;
  - suscripción programada para el día 1;
  - cobro de 1.210 €;
  - renovación;
  - impago y recuperación de la misma factura;
  - alerta del día 5 una sola vez;
  - webhooks repetidos;
  - ningún aprovisionamiento;
  - autorización tardía con decisión.
- **`scripts/stripe/externalSandboxE2E.ts`:** el mismo circuito contra el **sandbox real** de Stripe con **Test Clocks**. Necesita una clave de pruebas en `ES_SANDBOX_STRIPE_KEY`; se niega con cualquier clave live.
  - Para la tarjeta usa el mecanismo oficial de pruebas: SetupIntent confirmado con `pm_card_visa`, porque la página de Checkout exige navegador.
  - Para el impago usa `pm_card_chargeCustomerFail`.

## Activación en Stripe Live (pendiente de autorización)

1. Confirmar la fiscalidad de Nextair SL (domicilio y NIF) y el tipo de IVA aplicable.
2. Aprobar el texto contractual definitivo: condiciones del servicio, duración, baja y preaviso.
3. Configurar en la cuenta live:
   - los reintentos (Smart Retries) dentro del margen de 5 días;
   - los correos de Stripe de pago fallido;
   - el portal de facturación.
4. Aplicar la migración 0026 en el entorno con Stripe live. Allí el módulo solo se monta con la tabla y un origen https del CRM en `CP_ALLOWED_ORIGINS`.
5. Con autorización expresa: enviar el contrato real a la representante de Nextair, que autoriza su tarjeta real. El primer cargo será el 01/11/2026 si la autorización llega antes.

## Entornos y Stripe (comprobado el 27/10/2026 en los registros de arranque)

| Entorno | Stripe | Módulo de clientes externos |
|---|---|---|
| production (`admin.bigelephant.es`) | **Sin configurar** | Contrato, aceptación y seguimiento. La autorización de pago y los cobros responden que Stripe no está configurado |
| live (`elephant-source-crm-live.up.railway.app`) | Cuenta **real** (clave restringida live) | Completo, con los cobros bloqueados salvo `CP_EXTERNAL_LIVE_ENABLED=1` |

El sandbox de Stripe no está configurado en ningún entorno. La validación en sandbox se hace con `scripts/stripe/externalSandboxE2E.ts` y una clave de pruebas.
