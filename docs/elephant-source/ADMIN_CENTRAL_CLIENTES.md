# Administrador central de clientes: internos y externos, precios negociados, cobros extraordinarios y gastos variables

Estado: propuesta de diseño (28/10/2026). Ventana de Catálogo. No cambia cobros, suscripciones, webhooks ni despliegues de Stripe.

## 1. Objetivo

Que el administrador central (CRM + plano de control) gestione en un solo sitio a todos los clientes de Big Elephant:

- **Internos:** empresas con plataforma Elephant Source (`companies.tenant_id` con valor).
- **Externos:** clientes sin plataforma, como los servicios externos tipo Nextair (`tenant_id` nulo).

Para cada cliente debe poder registrarse:

1. un **precio negociado** sobre una tarifa del catálogo;
2. **cobros extraordinarios** (únicos, con concepto libre);
3. **gastos variables** repercutibles (consumos medidos, costes de terceros).

Todo ello reutilizando los módulos que ya existen de contratos, suscripciones, facturación y contabilidad. **No hay que crear un segundo motor de cobros.**

## 2. Qué existe hoy (Core en `b31d4872`)

| Pieza | Dónde | Sirve para | Límite |
|---|---|---|---|
| Contrato del CRM | `server/crm/types.ts:150-180`, `/crm/contracts` | Cuota pactada (`amountCents`), condiciones, versiones, firma y presupuesto (`configuration`) | La cuota es un total: no se desglosa por partida |
| Suscripción interna (en sombra) | `server/subscriptions/**`, tablas de `0006` | Partidas con precio fijado y `discount` (porcentaje o importe, con fin y nota); facturas en sombra que cuadran con el contrato (`shadow.ts`) | `priceSource` admite `contract`, pero `service.ts:110` siempre fija `catalog`. Un cobro único solo existe como producto `service` del catálogo. Los consumos solo admiten partidas `usage` del catálogo |
| Contrataciones (pedidos) | `server/orchestrator/**`, tablas de `0010` | Presupuesto, contrato, confirmación por pago o por aprobación (`admin_approval` con `offline_payment`) | `PaymentPurpose` solo admite `initial`, `change` y `renewal` (`types.ts:129`) |
| Servicios externos | `server/external/**`, tablas de `0026` | Cliente sin plataforma con importe mensual pactado y libre, aceptación digital y cobro en Stripe | Solo mensual, sin cobros únicos ni consumos. **El cobro es de la ventana de Stripe** |
| Documentos fiscales | `server/stripe/fiscalDocuments.ts`, tabla de `0016` | Cola hacia el sistema de facturación legal (DF-2 sin decidir) | `order_id NOT NULL` con FK a pedidos y `stripe_invoice_id NOT NULL`: solo admite cobros de Stripe |
| Coste de recursos (ERM) | `server/_core/erm/costs.ts`, `/resources/costs` | Consumo medido por tarifa, por empresa con plataforma | Solo lectura; nunca factura. No cubre clientes externos |
| Facturación antigua | `server/_core/billing/*`, BD `billing` | Facturas numeradas por tenant | Va por tenant: no sirve para externos |

## 3. Diseño propuesto

### 3.1 Vista unificada del cliente (hecho: CRM #76)

La ficha de empresa muestra la **visión comercial**:

- si el cliente es interno o externo;
- la cuota mensual y anual pactadas;
- cada partida con su acuerdo (descuento, precio de contrato o tarifa);
- los servicios externos;
- los cobros únicos y los consumos;
- los contratos vigentes y las contrataciones en curso;
- avisos de cuadre (contrato frente a suscripción, pagos pendientes).

Es de solo lectura sobre las API existentes: no cobra ni duplica nada.

### 3.2 Precio negociado sobre una tarifa del catálogo

- **Hoy:** el acuerdo se expresa como `discount` sobre la partida, y se muestra como «descuento … (nota)». Sirve para la mayoría de casos.
- **Propuesta:** admitir en `ItemSpec` un precio de contrato (`priceSource: "contract"`, importe fijo y referencia del contrato y su versión). Los demás datos se mantienen: la tarifa de origen (`priceId`) y el IVA.
  - El enum ya existe en la base de datos, así que no hace falta migración.
  - La factura en sombra y la instantánea inmutable funcionan tal cual.
  - Requiere el visto bueno de quien lleva el motor de suscripciones: el cambio está en `server/subscriptions/service.ts:78-124`. **No lo hace esta ventana.**
- **Regla:** el precio negociado nunca cambia la tarifa pública. El catálogo sigue siendo la referencia y la diferencia queda trazada (tarifa frente a pactado), como ya muestra la visión comercial.

### 3.3 Cobros extraordinarios (únicos)

Un **cargo** por cliente con:

- concepto libre;
- importe e IVA;
- fecha;
- contrato o pedido de referencia;
- estado (`borrador`, `aprobado`, `facturado` o `anulado`);
- autor y aprobación.

**Cómo se liquida, sin un motor nuevo:**

- **Cliente interno:** como partida única de la suscripción (la mecánica que ya existe para `service`), ampliada para admitir concepto libre con aprobación.
- **Cliente externo, o cobro fuera de Stripe:** con la confirmación `admin_approval` + `offline_payment` que ya existe (transferencia u otro medio, con referencia). La factura sale del sistema de facturación.
- **Cobro con tarjeta:** el mismo cargo se envía al cobro de Stripe. Lo decide y lo implementa la ventana de Stripe. Aquí solo se registra y se aprueba.

**Prerrequisitos del cobro** (no de esta ventana):

- un `PaymentPurpose` para cargos únicos;
- una cola fiscal que admita orígenes que no son de Stripe: o se relaja `order_id` y `stripe_invoice_id` en `fiscal_documents`, o se crea un origen nuevo.

Afecta a la conciliación de Stripe, así que se decide con la ventana de Stripe.

### 3.4 Gastos variables repercutibles

- **Consumos medidos** de clientes internos: el ERM ya calcula consumo por tarifa. El puente es convertir, al cierre del periodo, el consumo de una métrica pactada en una partida `usage` (`recordUsage`, idempotente). Requiere una tarifa de consumo en el catálogo, que es cosa del catálogo.
- **Costes de terceros** (telefonía, IA, mensajería, para internos y externos): un registro de gasto por cliente con:
  - proveedor y periodo;
  - coste;
  - margen pactado (porcentaje o importe);
  - importe repercutible.

  Al aprobarse se convierte en un cargo extraordinario (3.3). Así no hace falta otro circuito de cobro.
- El catálogo ya declara qué costes son variables (`thirdPartyCosts`, «Costes variables: … se facturan aparte según uso»). La ficha y el gasto usan el mismo texto.

### 3.5 Reutilización de facturación y contabilidad

- **Facturas:** las emite un único sistema legal (DF-2, pendiente). Los cargos y gastos aprobados se encolan en `fiscal_documents` cuando la cola admita orígenes que no son de Stripe (3.3).
- **Contabilidad:** el dashboard y las transacciones existentes leen de las mismas fuentes. No se crean libros paralelos.

## 4. Fases y responsables

| Fase | Contenido | Responsable | Depende de |
|---|---|---|---|
| 1 | Visión comercial del cliente (solo lectura) | Catálogo (CRM #76) | — |
| 2 | Modelo de cargos y gastos (tabla por `company_id`, API con scope nuevo `charges:read/write`, pantalla en la ficha), **sin cobrar**: borrador, aprobación y trazabilidad | Catálogo | Migración aislada; visto bueno de Jorge |
| 3 | Precio de contrato en la suscripción (`priceSource: contract`) | Motor de suscripciones | Visto bueno de quien lo lleva |
| 4 | Liquidar cargos: partida única interna, `offline_payment` y cola fiscal con origen no Stripe | Ventana de cobros y Stripe | DF-2 (sistema de facturación) |
| 5 | Puente ERM → consumos facturables | Catálogo (tarifas) y motor de suscripciones | Fase 3 |

## 5. Decisiones para Jorge

1. ¿Los cargos extraordinarios necesitan doble aprobación a partir de un importe? Propuesta: aprobación de administración siempre; doble a partir de 1.000 €.
2. Costes de terceros: ¿margen por defecto, o siempre pactado en el contrato? Propuesta: pactado en el contrato; sin pacto, se repercute a coste.
3. ¿El precio negociado sustituye a la tarifa (precio de contrato) o se expresa siempre como descuento? Propuesta: descuento por defecto; precio de contrato solo para Enterprise y acuerdos marco.
4. ¿Sistema de facturación legal (DF-2)? Sin él, los cargos se registran y aprueban, pero no se emite factura.

## 6. Lo que esta ventana no hace

- No modifica pagos, suscripciones, webhooks ni sus despliegues.
- No crea otro motor de cobros.
- No activa Net + Core.
- Las fases 3 y 4 solo se proponen aquí; las implementa quien lleva esos módulos.
