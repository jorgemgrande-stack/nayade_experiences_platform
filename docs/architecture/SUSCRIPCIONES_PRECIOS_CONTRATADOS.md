# Suscripciones con precios contratados — diseño (fase 5)

**Estado:** diseño para aprobación (D8). **No implementa cobros ni toca el motor actual.** Acompaña a `docs/roadmap/FASE5_INTEGRACION.md`.

## 1. Punto de partida (auditado)

- **El motor está en `main`** (`server/_core/billing`, PR #42 y #59), **apagado y sin desplegar**:
  - El plano de control no se ejecuta en producción.
  - No hay `BILLING_DATABASE_URL` ni catálogo.
  - El proveedor de pagos queda desactivado salvo que `BILLING_PROVIDER=stripe` y `BILLING_CHARGES_ENABLED=true` coincidan.
  - **`tick()` no lo llama nadie** fuera de los tests.
  - **Hoy no se factura nada por SaaS.**
- **Cómo calcula el precio:**
  - La suscripción guarda solo `planId` y `modules`.
  - Cada factura lee el precio **vigente** del JSON (`periodLines`, `service.ts:316-325`). Un cambio de tarifa es retroactivo desde la siguiente renovación.
  - Si un plan desaparece del JSON, `tick` traga el error y la suscripción queda sin renovar y sin alerta.
- **Riesgos de doble cobro (motor actual):**
  - **Carreras:** no hay concurrencia controlada; el upsert del documento JSON es ciego.
    - Dos `tick` simultáneos emiten dos facturas con claves de cobro distintas.
    - El webhook y el reintento se pisan.
  - **Reintentos:** la clave de idempotencia es `charge:<factura>:<intento>` (`service.ts:361`), así que **cambia en cada reintento**.
    - Tras un error de red, Stripe puede cobrar dos veces.
    - `processing` y `requires_action` cuentan como fallo y se reintentan con una clave nueva.
  - **Webhooks:** se registra el evento **antes** de procesarlo. Si el procesamiento falla, el reintento del proveedor sale como «duplicado» y el pago se pierde.
- **Bajas y suspensiones:**
  - Una suscripción en `past_due` con `cancelAtPeriodEnd` se sigue reintentando.
  - Un pago tardío reactiva un periodo.
  - Un pago sobre una suscripción `ended` se marca pagado sin reembolso.
- **Desconexión con el CRM y las licencias:**
  - Los contratos del CRM guardan su importe (`amountCents`), pero **nada los une a una suscripción**. La activación real no arranca la facturación (`createContractActivation` sin `billing`).
  - El MRR del panel suma contratos anuales como mensuales.
  - Las licencias pueden concederse a mano sin fecha de fin (perpetuas).
- **Catálogo comercial (#77):** guarda precios inmutables con id, que sirven como «versión de precio aceptada». Su aprobación no es atómica (F17).

## 2. Principios

1. **El precio que paga un cliente es el que aceptó.** Se guarda con su versión, importe, moneda, periodicidad, impuesto y descuento. **Ningún cambio del catálogo lo modifica.** Solo una **enmienda contractual** explícita, con preaviso y auditada, cambia lo contratado, y siempre a partir de un periodo futuro.
2. **Una factura por periodo y concepto**, garantizada por la BD, no por el código.
3. **Una clave de idempotencia por cobro lógico**, estable entre reintentos. Un resultado incierto (red, `processing`) **no es un fallo**: se consulta antes de reintentar.
4. **Ningún cobro sin estado que lo justifique.** Antes de cobrar se comprueba el estado de la suscripción dentro de la misma transacción.
5. **La licencia sigue a la facturación, no al revés.** Los módulos se conceden por partidas activas, con fecha de fin. Una concesión manual exige motivo y caducidad.
6. **Todo cambio deja historial inmutable**, con quién, cuándo, por qué y el antes y después.
7. **Lo dudoso se bloquea.** Un caso sin precio contractual identificable no se cobra: va a revisión manual.

## 3. Modelo: la suscripción como composición

```
Suscripción (tenant, contrato CRM, moneda, periodicidad, periodo actual, estado, versión)
 ├─ Partida core_plan        (1, obligatoria)          Elephant Core
 ├─ Partidas extension        (0..n)                    Elephant Extensions
 ├─ Partidas industry_module  (0..n)                    Elephant Industries
 ├─ Partidas usage            (0..n, precio por unidad) Consumos
 └─ Partidas service          (0..n, pago único)        Servicios
```

Cada **partida** guarda una instantánea de lo aceptado: producto, versión de precio (id de `web_prices`), importe unitario, moneda, tipo (mensual, anual, único o por unidad), impuesto, descuento y vigencia. La partida **referencia** el mecanismo técnico (módulo de licencia o plan) del catálogo publicado, sin copiarlo.

### Tablas (BD de facturación; propuesta, sin crear todavía)

```sql
-- Suscripción: estado y periodo. version = concurrencia optimista (UPDATE … WHERE version = ?)
billing_subscriptions_v2 (
  id CHAR(26) PK, tenant_id VARCHAR(63) NOT NULL,
  crm_contract_ref VARCHAR(32) NULL,            -- CT-…: enlace con el contrato firmado
  status ENUM('pending_review','trialing','active','past_due','suspended','canceled','ended') NOT NULL,
  currency CHAR(3) NOT NULL, billing_interval ENUM('month','year') NOT NULL,
  started_at BIGINT NOT NULL, current_period_start BIGINT NOT NULL, current_period_end BIGINT NOT NULL,
  next_renewal_at BIGINT NULL, trial_end BIGINT NULL, grace_end BIGINT NULL,
  cancel_at_period_end TINYINT(1) NOT NULL DEFAULT 0, canceled_at BIGINT NULL,
  version INT NOT NULL DEFAULT 1, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  UNIQUE KEY uq_sub_tenant_active (tenant_id, active_flag)   -- active_flag: columna generada (1 si no ended/canceled, NULL si sí)
)

-- Partidas contratadas (instantánea inmutable del precio aceptado)
billing_subscription_items (
  id CHAR(26) PK, subscription_id CHAR(26) NOT NULL FK,
  family ENUM('core_plan','extension','industry_module','usage','service') NOT NULL,
  product_key VARCHAR(63) NOT NULL,              -- clave del catálogo comercial
  accepted_price_id INT NULL,                    -- web_prices.id (NULL = precio heredado, ver §6)
  accepted_price_source ENUM('catalog','contract','legacy_review') NOT NULL,
  activation_kind VARCHAR(20) NOT NULL, activation_ref VARCHAR(64) NULL,   -- módulo de licencia o plan de facturación
  price_kind ENUM('recurring','one_time','usage') NOT NULL,
  unit_amount_cents BIGINT NOT NULL, unit VARCHAR(40) NULL, quantity INT NOT NULL DEFAULT 1,
  tax_rate_bp INT NOT NULL, tax_included TINYINT(1) NOT NULL,
  discount_kind ENUM('percent','amount') NULL, discount_value INT NULL, discount_ref VARCHAR(80) NULL, discount_ends_at BIGINT NULL,
  status ENUM('scheduled','active','removed') NOT NULL,
  effective_from BIGINT NOT NULL, effective_to BIGINT NULL,
  created_at BIGINT NOT NULL, created_by VARCHAR(100) NOT NULL
  -- el importe nunca se actualiza: una enmienda cierra la partida (effective_to) y crea otra
)

-- Historial contractual inmutable (solo inserciones; trigger que impide UPDATE/DELETE, como tenant_events)
billing_subscription_events (
  id BIGINT PK, subscription_id CHAR(26) NOT NULL, kind VARCHAR(40) NOT NULL,  -- created, item_added, item_removed, plan_changed, amended, renewed, canceled, suspended, migrated…
  before_json JSON NULL, after_json JSON NOT NULL, reason VARCHAR(500) NULL,
  actor VARCHAR(100) NOT NULL, created_at BIGINT NOT NULL
)

-- Consumos (deduplicados por origen)
billing_usage_records (
  id BIGINT PK, item_id CHAR(26) NOT NULL, period_start BIGINT NOT NULL,
  quantity BIGINT NOT NULL, source VARCHAR(40) NOT NULL, idempotency_key VARCHAR(128) NOT NULL,
  UNIQUE KEY uq_usage_idem (idempotency_key)
)

-- Facturas y líneas (instantáneas fiscales)
billing_invoices_v2 (
  id CHAR(26) PK, number VARCHAR(32) NULL UNIQUE,      -- se numera al emitir, no antes de cobrar
  subscription_id CHAR(26) NOT NULL, kind ENUM('renewal','proration','one_time','usage','manual') NOT NULL,
  period_start BIGINT NOT NULL, period_end BIGINT NOT NULL,
  status ENUM('draft','open','paid','void','uncollectible','credited') NOT NULL,
  currency CHAR(3) NOT NULL, subtotal_cents BIGINT NOT NULL, tax_cents BIGINT NOT NULL, total_cents BIGINT NOT NULL,
  customer_snapshot JSON NOT NULL,                      -- datos fiscales del cliente al emitir
  created_at BIGINT NOT NULL, issued_at BIGINT NULL, paid_at BIGINT NULL,
  UNIQUE KEY uq_invoice_period (subscription_id, kind, period_start)   -- UNA renovación por periodo
)
billing_invoice_lines (invoice_id, item_id, accepted_price_id, description, quantity, unit_amount_cents, discount_cents, tax_rate_bp, tax_cents, total_cents)

-- Intentos de cobro: la clave de idempotencia es de la FACTURA, no del intento
billing_charges (
  id CHAR(26) PK, invoice_id CHAR(26) NOT NULL, idempotency_key VARCHAR(80) NOT NULL,   -- 'inv:<invoice_id>' estable
  attempt INT NOT NULL, status ENUM('pending','succeeded','failed','unknown') NOT NULL,
  provider_ref VARCHAR(120) NULL, error VARCHAR(200) NULL, created_at BIGINT NOT NULL, settled_at BIGINT NULL,
  UNIQUE KEY uq_charge_attempt (invoice_id, attempt)
)

-- Webhooks: el evento se marca procesado en la MISMA transacción que su efecto
billing_events_v2 (provider_event_id VARCHAR(255) PK, status ENUM('processing','processed','failed') NOT NULL, received_at BIGINT, processed_at BIGINT NULL, error VARCHAR(200) NULL)
```

### Invariantes (garantizadas por la BD o por transacción)

| Invariante | Cómo |
|---|---|
| Una suscripción viva por tenant | `UNIQUE (tenant_id, active_flag)` |
| Una factura de renovación por periodo | `UNIQUE (subscription_id, kind, period_start)` |
| Un cobro lógico por factura | `idempotency_key = 'inv:<id>'` constante en todos los reintentos |
| Sin escrituras concurrentes perdidas | `version` y `UPDATE … WHERE version = ?`; si no se actualiza ninguna fila, se reintenta leyendo |
| Cobro solo con estado válido | En la transacción del cobro: `status IN ('active','past_due') AND NOT (cancel_at_period_end AND now ≥ current_period_end)` |
| Precio contratado inmutable | No hay ninguna ruta de código que haga UPDATE de `unit_amount_cents`; las enmiendas cierran la partida y crean otra |
| Historial completo | Toda mutación de la suscripción o de sus partidas inserta en `billing_subscription_events` dentro de la misma transacción |
| Licencia con respaldo | Una partida `active` con `activation_kind = module` concede el módulo con `validUntil = current_period_end (+ gracia)`; sin partida no hay concesión automática |

## 4. Operaciones

| Operación | Regla |
|---|---|
| **Alta** (activar un contrato) | Se crean la suscripción y sus partidas desde las **líneas del contrato firmado**, que pasan a llevar `accepted_price_id`, importe, periodicidad, impuesto y descuento. Se enlaza por `crm_contract_ref`. Prueba: `trial_end` desde el contrato o el onboarding (una sola fuente; hoy hay dos que pueden divergir). |
| **Alta de complemento** | Se comprueban: dependencias (`dependencies` del catálogo publicado y licencias vigentes de lo requerido), compatibilidad con el plan (`compatibleWith`) y precio aprobado y publicado en el momento de aceptarlo. Se crea una partida `active` desde ahora (prorrateo opcional, ver abajo) o `scheduled` desde el próximo periodo. |
| **Baja de complemento** | Por defecto, al fin de periodo (`effective_to = current_period_end`). Inmediata solo con motivo y sin reembolso, salvo decisión explícita (D-S3). Se rechaza si otra partida activa depende de él. |
| **Cambio de plan** | **Subida:** inmediata, con prorrateo de la diferencia. **Bajada:** al fin de periodo, sin abono por defecto (D-S3). Cierra la partida `core_plan` y crea otra, con un evento `plan_changed` que guarda el antes y el después. |
| **Prorrateo** | `(precio_nuevo − precio_actual) × segundos_restantes / segundos_del_periodo`, redondeado al céntimo **a favor del cliente**. Factura `proration` con su propia clave única `(sub, 'proration', period_start + partida)`. Si el cobro del prorrateo falla, **el cambio no se aplica** (todo en una transacción y estado `pending_change`), y un pago posterior aplica el cambio o lo anula, nunca reactiva la suscripción por sí solo. |
| **Consumos** | Se registran desde el ERM con clave idempotente `(item, métrica, periodo, origen)`. Al cierre del periodo, una factura `usage` con la cantidad × precio aceptado. Se emiten con un periodo de retraso para no facturar consumo incompleto. |
| **Servicios de pago único** | Partida `one_time` que genera una sola factura `one_time` (clave única por partida) y nunca se renueva. |
| **Renovación** | Un único proceso programado con bloqueo global (`GET_LOCK('billing_renewal')`) y, por suscripción, `SELECT … FOR UPDATE`. Crea la factura del periodo (la clave única impide la segunda) con las **partidas vigentes** y su **precio aceptado**, y después cobra. |
| **Cobro** | Primero se crea `billing_charges(status='pending')` en una transacción; después se llama al proveedor con la clave estable; por último se liquida. Los resultados de **red, `processing` o `requires_action`** se tratan como `unknown`: se consulta el estado en el proveedor, sin reintentar a ciegas. Los reintentos reutilizan la misma clave. |
| **Pago fallido** | `past_due`, gracia y reintentos programados. Una factura `open` **no** cuenta como pagada en ningún sitio. |
| **Webhook** | Se inserta el evento `processing` y se aplica el efecto en la misma transacción, que marca el evento `processed`. Si el efecto falla, el evento queda `failed` y el reintento del proveedor vuelve a procesarlo. Un pago sobre una factura de una suscripción `ended` o `canceled` va a revisión y reembolso, nunca reactiva. |
| **Baja de la suscripción** | `cancel_at_period_end`; al llegar el fin de periodo, `canceled`. **Toda ruta de cobro comprueba el estado**, de modo que no hay reintentos ni renovaciones después. Las facturas `open` pendientes pasan a `void` con evento. |
| **Enmienda de precio** (cambio de tarifa para un cliente existente) | Solo explícita, por un operador con `billing:write`, con **preaviso** (`noticeDays` del contrato), efectiva desde un periodo futuro, auditada y con una nueva versión del contrato en el CRM. El catálogo nunca dispara enmiendas. |

### Intervalos mixtos (implementado en `server/subscriptions/`, sin migración)

- El **plan Core** fija la periodicidad y el periodo de la suscripción. Cada complemento recurrente tiene la **suya**, que es la de su precio aceptado (`price_kind` de la partida, que ya existía): no hace falta columna nueva. Un complemento nunca tiene periodicidad más larga que el Core (plan anual + complementos mensuales, sí; plan mensual + complemento anual, no).
- **Periodo propio:** los complementos mensuales de un plan anual dividen el año del Core en 12 periodos con el mismo anclaje; renuevan cada mes por su cuenta (factura sombra `renewal` con concepto `interval:month` y su propio periodo) y el último coincide con la renovación del Core. El detalle de la suscripción expone `schedule` (periodicidad, periodo en curso y `renewsAt` de cada partida).
- **Baja o vencimiento de un complemento:** «a fin de periodo» es el fin del periodo **del complemento** (su mes), no el del Core. Sin abonos (D-S3). El Core no cambia.
- **Cambio de plan a mitad de periodo:** la regla existente sin cambios: subida inmediata prorrateada sobre el periodo del Core (se descuenta la parte no consumida del plan anterior), bajada al fin del periodo del Core. Los complementos conservan su precio y su calendario.
- **Cambio de periodicidad:** solo el plan Core (y lo que quedaría más largo que la nueva) necesita precio nuevo; los demás complementos conservan el suyo.
- **Paquetes con componentes ya contratados:** misma regla que el cotizador (`bundleReplaces`, `owned → replaces`): el paquete sustituye a los componentes al final de su periodo en curso, sin solapes ni dobles cobros; un componente cubierto por un paquete vivo no se contrata aparte.
- **Licencias:** una capacidad que solo conceden partidas con fin fijado caduca entonces (`valid_until`), salvo que otra partida ya programada la siga concediendo sin hueco; al reaplicar después, pasa a `cancelled` sin tocar el resto.
- Lo ya registrado nunca cambia (las facturas sombra son únicas por periodo y concepto) y nada de esto cobra.

## 5. Relación con el catálogo, el CRM y las licencias

- **Catálogo comercial (#77):** `web_prices.id` es la **versión de precio aceptada**. Un precio `retired` sigue valiendo para quien lo contrató. Hay que corregir antes la aprobación no atómica (F17): una transacción con `SELECT … FOR UPDATE` sobre la entrada, o una restricción única con columna generada.
- **Contratos del CRM:** añadir **líneas de contrato** (`crm_contract_lines`, que forman parte de la instantánea versionada) con `product_key`, `accepted_price_id`, importe, periodicidad, impuesto y descuento. La firma congela las líneas, y la activación crea la suscripción con esas líneas exactamente. Corregir de paso el MRR, normalizando a mensual.
- **Motor de facturación:** `periodLines` deja de leer `BILLING_CATALOG_FILE` y lee las partidas. El JSON queda solo como **definición técnica** de planes (módulos incluidos y cuotas), no de precios.
- **Licencias:** concesión automática solo desde partidas activas, con caducidad. Las concesiones manuales (API y CLI) pasan a exigir motivo y `validUntil`, salvo que un superadministrador marque una excepción auditada.

## 6. Transición desde el JSON y clientes existentes

**Situación real:**

- No hay suscripciones SaaS en producción: el plano de control no está desplegado.
- Náyade está activo en el registro **por CLI, sin suscripción**, con licencias concedidas a mano (posiblemente sin fecha de fin).
- En el CRM puede haber contratos con `amountCents` (en local y en pruebas). En producción no consta ninguna BD del CRM.

**No se asume que nadie tenga un precio identificable.**

### Inventario y clasificación (proceso de solo lectura, ejecutable cuando se autorice)

| Clase | Situación | Tratamiento |
|---|---|---|
| **A — contractual completo** | Contrato firmado o activo con importe, moneda, periodicidad, plan reconocible y módulos con precio o explícitamente incluidos | Se migra a partidas con `accepted_price_source = 'contract'`, el **importe del contrato** (aunque difiera del catálogo) y un evento `migrated`. Queda `pending_review` hasta que un operador confirme. |
| **B — suscripción del motor actual** | Fila en `billing_subscriptions` con `planId`, sin contrato | **Bloqueada.** El precio del JSON en el momento de migrar **no prueba** lo aceptado. Revisión manual con la documentación del cliente. |
| **C — tenant sin contrato ni suscripción** (p. ej. Náyade) | Activo en el registro y con licencias | **Bloqueado** como `pending_review`. No se cobra nada ni se tocan sus licencias. Decisión comercial explícita (D-S4). |
| **D — ambiguo** | Contrato sin periodicidad, importe nulo, módulos sin precio, moneda distinta, contrato anual frente a mensual dudoso, varias suscripciones | **Bloqueado** con el motivo concreto. |

### Pasos

1. **Congelar** el `BILLING_CATALOG_FILE` actual: se versiona en el repositorio como referencia histórica, sin usarlo para precios nuevos.
2. **Migraciones aditivas** de las tablas v2. No se tocan las v1.
3. **Inventario en simulación:** produce el informe por clases A, B, C y D, sin escribir.
4. **Revisión humana:** de las clases A (confirmación) y B, C y D (resolución). Cada resolución es un evento con su autor.
5. **Modo sombra:**
   - Durante al menos un ciclo completo, el motor v2 calcula las facturas que emitiría y las compara con lo contratado.
   - Los cobros siguen **apagados**.
   - Una diferencia se trata como incidencia.
6. **Activación por cliente:** se pasa de `pending_review` a `active` solo con doble control (dos operadores), y nunca de forma masiva.
7. **Retirada del motor v1** cuando no quede ninguna suscripción en él.

## 7. Pruebas de seguridad financiera

Cada prueba indica el riesgo que cubre. Se necesita MySQL real (concurrencia), un proveedor simulado que pueda responder con errores de red, `processing`, latencia y webhooks desordenados, y un reloj controlado.

| # | Prueba | Cubre |
|---|---|---|
| T1 | Un cambio de tarifa pública (aprobar un precio nuevo y retirar el viejo) **no altera** las partidas ni la siguiente factura de un contrato existente | Retroactividad |
| T2 | Dos renovaciones simultáneas (dos procesos y dos conexiones) del mismo periodo producen **una** factura y **un** cobro | Doble cargo por concurrencia |
| T3 | Renovación tras cambio de catálogo y de plan programado: la factura usa **exactamente** el precio aceptado de cada partida vigente, con el descuento hasta su caducidad | Precio contractual correcto |
| T4 | Baja al fin de periodo: no hay renovación, reintento ni cobro después. Un webhook de pago tardío sobre una suscripción cancelada no la reactiva y va a revisión | Cargos indebidos tras la baja |
| T5 | Subida y bajada de plan: los eventos guardan antes y después, la partida anterior queda cerrada (no se borra) y una consulta histórica reconstruye lo facturado en cada periodo | Historial |
| T6 | Alta de una extensión cuya dependencia no tiene licencia vigente, o incompatible con el plan: se rechaza y no se concede ningún módulo | Extensión sin licencia |
| T7 | Pago fallido: la factura sigue `open`, la suscripción pasa a `past_due` y ningún informe ni el MRR la cuentan como cobrada | Fallido ≠ cobrado |
| T8 | Error de red tras cobrar en el proveedor: el reintento usa **la misma clave**, el proveedor simulado devuelve el cobro existente y hay un solo cargo | Duplicado por reintento |
| T9 | `processing` o `requires_action` se trata como `unknown`, no como fallo, y se consulta antes de reintentar | Doble cargo por estado incierto |
| T10 | Webhook procesado con error: el evento queda `failed` y el reintento del proveedor lo aplica (no «duplicado») | Pago perdido |
| T11 | Webhook y renovación a la vez sobre la misma suscripción: la versión optimista impide sobrescribir el estado | Carrera |
| T12 | Prorrateo con cobro fallido: el cambio de plan no se aplica, y un pago posterior del prorrateo no reactiva una suscripción en mora | Prorrateo |
| T13 | Consumos: la misma lectura dos veces (misma clave) cuenta una sola vez; la factura de consumo se emite una vez por periodo | Duplicado de consumo |
| T14 | Servicio de pago único: una factura y nunca en renovación | Servicios |
| T15 | Plan o producto retirado del catálogo con contratos vivos: la renovación sigue con el precio aceptado y **alerta** si falta la referencia técnica, nunca silencia el error | Errores tragados |
| T16 | Migración: los casos B, C y D quedan `pending_review` y no generan facturas en modo sombra; los A coinciden al céntimo con el contrato | Transición |
| T17 | Dos aprobaciones simultáneas de precio en el catálogo dejan un solo precio vigente | F17 |
| T18 | Numeración: las facturas anuladas o en borrador no consumen número fiscal; no hay huecos por cobros fallidos | Fiscalidad |

## 8. Decisiones que requieren autorización

| Id | Decisión |
|---|---|
| D-S1 | Aprobar este modelo (tablas v2 aditivas en la BD de facturación; líneas de contrato en el CRM). |
| D-S2 | Proveedor de pagos (Stripe ya adaptado, ¿Redsys?) y datos fiscales (IVA por cliente, intracomunitario, emisor). Bloqueo B11. |
| D-S3 | Política de reembolsos y abonos: bajadas de plan, bajas inmediatas, pagos tardíos sobre cancelaciones. |
| D-S4 | Situación comercial de Náyade y de cualquier cliente sin contrato (clase C). |
| D-S5 | Doble control para activar cobros por cliente y para enmiendas de precio. |
| D-S6 | Preaviso mínimo de las enmiendas de precio y cómo se comunica al cliente. |
| D-S7 | Restringir las concesiones manuales de licencias (motivo y caducidad obligatorios). |

Hasta que se aprueben: **cobros apagados**, `tick` sin programar y el catálogo comercial sin conectar a la facturación.
