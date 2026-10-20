# Comprobaciones del Checkout: simuladas y pendientes con servicios reales

**Estado (20/10/2026).** Todo lo de la columna «Simulado» pasa en las pruebas automáticas. En ellas Stripe y VIES son dobles, la firma de los webhooks usa la criptografía real del SDK de Stripe, y las suites `*.mysql` usan una base MySQL real. La columna «Pendiente real» es lo que **solo** se puede comprobar contra los servicios reales, en el sandbox de Stripe o en la apertura controlada.

| Escenario | Simulado (prueba) | Pendiente real |
|---|---|---|
| Registro de particulares | `selfService.test.ts` (consentimientos, precontractual, ejecución inmediata) y `stripeLive` «particular de la Península» | Recorrido en la web publicada, con los textos legales aprobados |
| Registro de empresas (CIF) | `stripeLive` «empresa con CIF»: Customer con `es_cif` y Checkout sin volver a pedirlo | Que Stripe acepte el `es_cif` en el Customer (sandbox) |
| **Autónomos con NIF de persona física** | `stripeLive` «autónomo»: el Customer lleva `eu_vat ES<DNI>`, Checkout no pide el NIF, alta activa con IVA del 21 % | **Sandbox:** que Stripe admita `eu_vat` «ES12345678Z» para un cliente español y que Stripe Tax cobre el 21 % (es una operación interior) |
| NIF-IVA europeo y VIES | `vies.test.ts` (respuestas y errores), `stripeLive` «empresa de Francia» (VIES caído → bloqueo; válido → Customer con su NIF-IVA y factura sin IVA) y `vies.mysql` | **VIES real** con un NIF-IVA válido y otro no válido. **Sandbox:** inversión del sujeto pasivo de Stripe Tax con `eu_vat` |
| Países y territorios habilitados | `eligibility.test.ts` (matriz) y `stripeLive` | Configuración aprobada por el asesor (`CP_STRIPE_*`) |
| Rechazo de territorios no aprobados | `stripeLive` «territorios no aprobados»: Canarias, Japón y particular de Francia → 409 sin crear nada en Stripe | — |
| Domicilio fiscal | `gateway.live.test.ts` y `checkout.test.ts`: domicilio fijado (`customer_update.address=never`) | **Sandbox:** que la página de Stripe muestre la dirección y no deje cambiarla |
| Precios finales | `eligibility.test.ts` y `selfService.test.ts`: 29 € → 35,09 € para particulares con el 21 % | Mostrarlos en la web (repositorio de la web) |
| Checkout | `stripeLive` (Stripe Tax, aviso legal, sesión live), `checkout.test.ts` | **Sandbox:** sesión real con `automatic_tax` y el registro de España en Stripe Tax |
| Alta de suscripción y activación del tenant | `stripeLive` (pago → webhook firmado → activa) y `lifecycle.mysql` (4 planes) | Primer alta real en `live` (apertura controlada) |
| Renovación | `lifecycle.mysql` «renovación cobrada en Stripe» | Primera renovación real (al mes) |
| Pago fallido | `lifecycle.mysql` «impago → gracia → recuperación» y circuito de punta a punta 2 | Correos de Stripe de pago fallido activados |
| Cancelación | `lifecycle.mysql` «cancelación programada (Portal) → reactivación → fin» | Customer Portal real con las URL legales |
| Desistimiento | `withdrawals.test.ts`, `stripeLive` «particular… desistimiento» (justificante, sin reembolso automático) y `store.mysql` | Política jurídica de reembolso; reembolso manual en Stripe |
| Webhooks: duplicados, desorden, firma y otro entorno | `lifecycle.mysql` y circuito de punta a punta 6 | Webhook real de `live` con sus 21 eventos |
| Aislamiento entre empresas | circuito de punta a punta 5 (tokens, permisos, empresa ajena e importes del navegador) | — |

## Para la apertura controlada (orden)

1. **Sandbox de Stripe**, con la clave `rk_test_` que falta: un alta de autónomo (DNI), una de empresa (CIF) y una de empresa de la UE (VIES real). Comprobar en cada factura el IVA y el identificador fiscal.
2. **Live**, tras desplegar y migrar: una compra real de Essential mensual con la propia empresa, que se pueda reembolsar. Comprobar el cobro, el IVA, la factura de Stripe, el alta del tenant, el acceso y el correo.
3. Revisar las alertas (`invoice_tax_mismatch`, `buyer_tax_id_missing`) en las incidencias.
