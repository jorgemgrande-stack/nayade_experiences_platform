# Elephant POS sobre el TPV del Core: propuesta de frontera (09/11/2026)

> **Propuesta para decidir. No cambia precios, estados ni licencias.** `connect-pos` sigue «Bajo solicitud» (25 €/mes por sede + IVA), sin Price de Stripe y con venta asistida. Responde al punto D de las decisiones de Jorge del 09/11: reutilizar el TPV del Core, separar lo básico incluido de lo avanzado y no cobrar dos veces la misma función.

## 1. Qué hay hoy en el Core

Todo el TPV se licencia hoy con **una sola capacidad**, `bill-cash` («Caja y cierre básico»), incluida en Essential y, por herencia, en Business y Enterprise. La capacidad `pos-advanced` de Elephant POS **no controla ninguna ruta**. Su único uso es mostrar el ajuste «Datáfono» en Configuración, que también se muestra con Finance Sync.

| Función | Dónde | Licencia hoy |
|---|---|---|
| Terminal de venta: catálogo (experiencias, packs, SPA, alojamiento, Lego Packs), descuentos por línea y de ticket, reglas de precio, cliente del CRM, desglose de IVA (si falla el registro de una venta, queda anulada con motivo y sin hueco de numeración) | `server/routers/tpv.ts` (`getCatalog`, `pricingPreview`, `createSale`), `TpvScreen.tsx` | `bill-cash` |
| Anulación posterior de una venta con reposición | `server/routers/dailyControl.ts` (`cancelOperation`, `restockTpvSale`) | Control diario (sin capacidad propia) |
| Cobro en efectivo, tarjeta, Bizum u otros, y pago dividido | `createSale`, `TpvSplitPayment.tsx` | `bill-cash` |
| Ticket impreso y por correo | `TpvTicket.tsx`, `sendTicketEmail` | `bill-cash` |
| Sesión de caja: apertura, cierre con arqueo, movimientos de efectivo y traspaso a la caja central | `openSession`, `closeSession`, `addCashMovement` | `bill-cash` |
| **Varias cajas** y caja asignada a una sede | `createRegister`, `setRegisterSite`, `getRegisterStatus` (filtrada por las sedes del usuario) y `openSession` (`userMayUseSite`) | `bill-cash`, sin límite |
| Backoffice del TPV (ventas por sesión y por producto) | `getBackoffice`, `getBackofficeSalesByProduct` (permiso `tpv.backoffice`) | `bill-cash` |
| Informes de caja por fechas, caja y sede: ventas por cajero, anulaciones y cierres con descuadre por caja y cajero, con exportación CSV | `server/routers/tpvReports.ts`, `TpvReports.tsx` | `bill-cash` |
| Caja contable: cuentas, cierres, **revisión de cierres**, ajustes, aceptación de diferencias, notas, alertas y verificación | `server/routers/cashRegister.ts` (`/admin/contabilidad/caja`) | `bill-cash` |
| Permisos por acción (`tpv.access`, `tpv.sell`, `tpv.open_close`, `tpv.backoffice`, `accounting.cash.view`, `accounting.cash.manage`) y rol «Comercial + caja» (`sales_cashier`) | `permissionProcedure`, `shared/roleLabels.ts` | RBAC del plan |
| Datáfono: operaciones, remesas, conciliación y buzón de tickets | `cardTerminalOperations`, `emailTpvIngestionService` | Finance Sync (`bank-import-pos`) |
| Cobro de comandas (Restaurant Net), fianzas del alquiler (Ski Net), bonos y SPA (Care Net) y cargo a habitación | `restaurantNetDb.ts`, `skiRental/depositService.ts`, `careNetDb.ts` | Producto Net de cada sector, sobre la caja del plan |

**Consecuencia.** La ficha publicada de POS ofrece «varias cajas, rol de cajero, backoffice y revisión de cierres», y **todo eso ya lo tienen hoy los clientes de Essential**. Si se activara POS tal cual, se cobraría dos veces lo mismo. A la inversa, la ficha de Essential excluye «varias cajas, rol de cajero y backoffice del TPV (Elephant POS)», y eso tampoco es cierto hoy.

## 2. Principios

1. **No se quita nada a quien ya lo usa.** Lo que hoy funciona con Essential sigue funcionando sin pagar más (derecho adquirido, ver §5).
2. **Una función, un producto.** Cada función se cobra en un único sitio: plan, POS, Finance Sync o producto Net.
3. **Los productos Net no exigen POS.** Restaurant, Ski, Care y Hotel cobran en la caja del plan. Lo que necesitan para su recorrido sectorial (comandas, fianzas, cargo a habitación) va en el Net, que ya se paga.
4. **El datáfono es de Finance Sync.** POS no incluye conciliación, remesas ni el buzón de tickets, aunque sí puede mostrarlos si la empresa tiene ambos.
5. **POS se paga por sede**, como dice el catálogo, y solo por lo que va más allá de una caja normal.

## 3. Propuesta de reparto

### Caja básica (incluida en Essential, Business y Enterprise: `bill-cash`)
- Todo el terminal de venta: catálogo, descuentos, reglas de precio, cliente del CRM, IVA, anulaciones, pagos mixtos y divididos, y ticket impreso y por correo.
- Sesiones de caja con apertura, cierre, arqueo y movimientos de efectivo.
- **Una caja abierta a la vez por sede.** Se pueden tener varias cajas definidas, por ejemplo una de reserva; el límite está en las sesiones abiertas a la vez.
- Historial de cajas, backoffice del TPV (ventas por sesión y por producto) e informes de caja por fechas, por cajero y por caja, con CSV.
- Caja contable con sus cierres y alertas.
- Permisos por acción y el rol «Comercial + caja».

### Elephant POS (por sede: `pos-advanced`): lo que pasaría a POS

La primera función la tienen hoy todas las empresas con el plan: pasa a POS solo para las empresas nuevas, y quien ya la usa la conserva por derecho adquirido (§5). Las demás son nuevas (hoy el rol de cajero existe, pero no la asignación a cajas concretas).
- **Varias cajas abiertas a la vez en la misma sede**, cada una con su cajero, su arqueo y su cierre.
- **Cajero dedicado por caja.** Un usuario con rol de cajero solo ve y cobra en las cajas que tiene asignadas, y el cierre lo firma su responsable.
- **Comparativa entre cajas y cajeros**: tabla caja contra caja y clasificaciones por cajero en el tiempo, sobre `tpvReports`. Los informes por cajero de hoy (ventas, anulaciones y descuadres) siguen en el plan.
- **Venta por unidad de negocio**, portada de hotelnayade: cada caja imputa a su unidad o centro de coste.
- Opcional, según demanda: modo de mostrador rápido (teclado y escáner) y cajón o impresora de tickets dedicados por caja.

### Lo que POS no cobra
| Función | Se paga en |
|---|---|
| Vender y cobrar en mostrador con una caja | Plan (Essential o superior) |
| Conciliación del datáfono, remesas y buzón de tickets | Finance Sync |
| Comandas, cocina y cobro de mesa | Restaurant Net |
| Fianzas y cargos por daños del alquiler | Ski Net |
| Bonos, sesiones y SPA en la caja | Care Net |
| Cargo a habitación desde restaurante o SPA | Hotel Net (el folio), desde la comanda de Restaurant Net o el SPA de Care Net |
| Cupones de terceros (Groupon y similares) | Deals |
| Revisión de cierres de la caja contable (ajustes, diferencias, notas) | Plan (se queda para todos) |

## 4. Cómo se haría (cuando Jorge decida)

Es un cambio pequeño y aditivo, sin migraciones destructivas:
1. **Comprobación en el servidor, no en el menú.**
   - `openSession` comprueba `pos-advanced` solo cuando ya hay otra sesión abierta en la misma sede.
   - La asignación de cajeros a cajas comprueba `pos-advanced` con `getCapabilityAccess().check`.
   - Sin licencia, el mensaje lleva a «Ampliar».
2. **Derecho adquirido.** Una marca por empresa (ajuste de la empresa o «grant» en licencias) para quien ya haya usado varias cajas abiertas a la vez en una sede antes de la fecha de corte. Se calcula con una consulta de solo lectura a `cash_sessions`.
3. **Datáfono:** quitar `ctx.can("pos-advanced")` de la condición del ajuste «Datáfono» (`client/src/pages/admin/settings/configSections.ts`), que pasa a depender solo de Finance Sync.
4. **Fichas** con una revisión de catálogo honesta, sin cambio de estado ni de precio y con simulación previa como siempre:
   - la de POS, con lo que añade frente a la caja del plan y lo que no incluye;
   - la de Essential (y, si hace falta, la de Business), que hoy excluye funciones que ya da.
5. **Pruebas.**
   - Una sede con dos sesiones, con y sin licencia.
   - Una empresa con derecho adquirido.
   - Los productos Net siguen cobrando sin POS.
   - Finance Sync sigue mostrando el datáfono sin POS.

## 5. Decisiones que necesito de Jorge

1. **Límite de la caja básica:** una caja abierta a la vez por sede, como propongo, o dos.
2. **Revisión de cierres:** la recomendación es que se quede en el plan para todos, porque es parte del control de la caja. Si Jorge prefiere llevarla a POS, sería solo para las empresas nuevas.
3. **Derecho adquirido:** fecha de corte y si es indefinido o hasta la renovación.
4. **Business:** si incluye POS en su primera sede, ya que tiene varias sedes y equipos, o lo mantiene como extensión, como hoy.
5. **Precio y venta:** se mantienen los 25 €/mes por sede y la venta asistida, sin Price de Stripe, hasta que la frontera esté programada.

Hasta que se decida, POS sigue igual: «Bajo solicitud», sin Price y sin control de rutas. La ficha actual promete funciones que hoy ya da el plan; conviene corregirla en cuanto se cierre la frontera.
