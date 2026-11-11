# Condiciones comerciales personalizadas por cliente

Sistema para negociar desde el CRM central el precio y el contenido de una contratación: precio individual por partida
o cuota global, partidas a medida, descuentos y recargos, cargos únicos, vigencias y la forma de presentarlo al cliente.
Encargo del propietario del 10/11/2026 (16 secciones, 30 casos de aceptación).

## Principios

- **Los derechos dependen de los productos contratados, no del importe.** Un descuento no quita funciones y un recargo
  no las añade. Una partida a medida (texto libre) nunca concede licencias: no lleva producto, referencia de activación
  ni capacidad, y el servidor rechaza cualquier intento de dársela.
- **El precio negociado no modifica el catálogo ni los precios oficiales de Stripe**, y el catálogo no modifica un
  acuerdo: el precio oficial se guarda en el acuerdo como referencia (instantánea).
- **Céntimos enteros, importes netos.** El impuesto se calcula por tipo sobre la base sumada.
- **Sin efectos retroactivos** sobre lo ya facturado, sin cobros ni descuentos duplicados.
- **Solo administradores centrales con permiso explícito**, motivo obligatorio, historial inmutable y concurrencia
  segura. Un tenant nunca modifica sus precios.
- **La presentación elegida** (cuota global o desglose) se respeta en oferta, propuesta, contrato, resumen y panel del
  tenant. Las facturas llevan siempre el detalle fiscal.

## Dónde vive

Todo en el plano de control (BD del CRM, carril `db/crm/migrations`): módulo `server/commercialTerms/`. El CRM
(`big-elephant-crm`) es la interfaz; el panel del tenant solo lee. Las BD de las empresas no cambian.

## Modelo (migración CRM 0048)

| Tabla | Qué guarda |
|---|---|
| `commercial_terms` | El acuerdo, una fila por versión: modo de precio (`per_item` o `global`), cuota global neta, periodicidad, presentación, nombre del paquete, vigencia, qué ocurre al vencer, aceptación, motivo y estado. `subscription_id` NULL = borrador de paquete para una contratación nueva. |
| `commercial_terms_lines` | Partidas: de catálogo (producto, precio oficial de referencia, instantánea de activación) o a medida (solo económicas). Clase de cargo: recurrente, pago inicial o trabajo extraordinario. |
| `commercial_terms_adjustments` | Descuentos y recargos: porcentuales (puntos básicos) o fijos (céntimos), por partida o globales, recurrentes (con fin opcional) o de un solo uso. |
| `commercial_terms_events` | Historial inmutable: quién, cuándo, motivo, valores anteriores y nuevos, fecha efectiva, aceptación, sincronización y efecto económico. |
| `subscription_items` (+3 columnas) | `terms_id`, `terms_line_id` y `line_amount_cents`: la partida materializada de un acuerdo y su importe neto del periodo. |

Los seis importes que el encargo pide distinguir:

| Importe | Dónde está |
|---|---|
| Precio oficial del catálogo | `commercial_terms_lines.official_unit_cents` (instantánea de referencia) |
| Precio individual negociado | `commercial_terms_lines.negotiated_unit_cents` |
| Precio global del paquete | `commercial_terms.global_amount_cents`; su asignación interna por partida la calcula `recurringAt` (resto mayor) |
| Ajustes comerciales y descuentos | `commercial_terms_adjustments`; el cálculo dice cuál aplicó cuánto, una sola vez cada uno |
| Valor contractual efectivo | `netCents` del cálculo = negociado + ajustes; se materializa en `subscription_items.line_amount_cents` |
| Importe realmente facturable | Lo da la facturación del periodo a partir de las partidas materializadas (prorrateos, abonos de un solo uso, impuestos) |

## Cálculo (`server/commercialTerms/compute.ts`)

- **Cuota global:** se reparte entre las partidas recurrentes en proporción a su valor de referencia (el oficial; en una
  partida a medida, su precio) por resto mayor: la suma de la asignación es exactamente la cuota pactada.
- **Ajustes:** primero los de cada partida, sobre su precio negociado (no se encadenan); después los globales, sobre el
  total ya ajustado, repartidos en proporción. Tampoco los globales se encadenan entre sí, y el orden es fijo (recargos antes que descuentos): el resultado no depende del orden en que se guardaron. El descuento porcentual redondea hacia arriba y el recargo hacia abajo.
  Ninguna partida queda por debajo de cero.
- **Impuesto:** por tipo, redondeado una vez sobre la base sumada y repartido a las líneas. Así «129,00 € + 21 %» da
  156,09 € en la oferta, en el contrato y en la factura.
- **Importes únicos:** los cargos (pagos iniciales y trabajos extraordinarios) van en su fecha y una sola vez. Un ajuste
  de un solo uso sobre un cargo lo reduce; sobre las cuotas recurrentes es un abono del primer periodo, que no se
  prorratea.
- **Vigencias:** `materialize` traduce el acuerdo a partidas con fechas, una por partida y tramo de importe constante.
  Las fechas futuras entran en vigor solas.
- **Fin de una condición temporal** (elección expresa del administrador, recogida en el contrato):
  - `official_snapshot` (por defecto): la tarifa oficial fijada al formalizar el acuerdo;
  - `official_current`: la tarifa oficial vigente en la fecha del cambio; hasta entonces figura, como provisional, la
    de hoy, y al llegar la fecha se lee el catálogo y se registra el importe aplicado;
  - `next_terms`: otra condición ya programada.

## Cómo se aplica a una suscripción (`server/commercialTerms/service.ts`)

- **Activar un acuerdo no crea otra suscripción.** En una sola mutación de la suscripción (bloqueo, versión esperada y
  evento `terms_applied`) se cierran las partidas vigentes y se abren las del acuerdo, con `price_source = 'contract'`,
  el importe efectivo en `line_amount_cents` y sin descuento: nada se aplica dos veces. Lo que ya leía partidas
  (simulación de facturación, calendario, plan de licencias, eventos comerciales, ficha del CRM) sigue funcionando.
- **Partidas a medida:** se materializan con una clave `custom-…` que no existe en el catálogo, familia `service` y
  `activation_kind = 'none'`. La API las valida con un esquema estricto (cualquier campo de producto, activación o
  capacidad es un 400), el servicio vuelve a comprobarlo y la base de datos tiene su `CHECK`.
- **Partidas de catálogo:** solo productos contratables por esa empresa. No entran los que están en hoja de ruta,
  «próximamente», sin publicar, internos o heredados, salvo que la suscripción ya los tenga; «bajo solicitud» sí (venta
  asistida). Un producto por empresa y sin unidad de cobro se contrata una sola vez. Se comprueba la composición del
  catálogo (un plan Core, dependencias y compatibilidad).
- **Vigencia del cambio:** inmediata (`effectiveFrom` nulo), en la próxima renovación o en una fecha futura. La fecha
  efectiva real nunca es anterior al momento de activar ni al inicio del periodo en curso (sin efectos retroactivos).
  Los instantes se guardan en UTC y se presentan en `Europe/Madrid`.
- **Cambio a mitad de periodo:** cada tramo factura solo la diferencia hasta el fin del periodo (su importe por lo
  que queda menos la parte no consumida del anterior, ya cobrada). Varios cambios seguidos no cobran dos veces. Una
  bajada no genera abono (regla D-S3 de las suscripciones).
- **Cargos únicos:** cada uno es una partida `one_time` en su fecha y se factura una sola vez. Un cargo futuro de un
  acuerdo sustituido antes de su fecha queda anulado. El punto de partida para modificar (`base`) no arrastra cargos ya
  llegados ni ajustes de un solo uso ya aplicados.
- **Ajuste de un solo uso sobre las cuotas:** es una partida de abono que se aplica en la primera renovación desde su
  fecha, una vez y sin prorratear.
- **Condición siguiente ya programada:** se activa junto con la primera, en la misma mutación.
- **Tarifa oficial vigente en la fecha del cambio:** `settleDue` (idempotente; lo lanza la facturación antes de
  calcular un periodo) lee el catálogo, sustituye la partida provisional si el importe difiere y deja registrado el
  importe aplicado. Si no se ejecutara, seguiría valiendo la tarifa provisional (la fijada al pactar).
- **Cambio de periodicidad:** dentro de un acuerdo, con los precios de referencia de la nueva periodicidad y solo con
  fecha efectiva en la próxima renovación.
- **Restaurar tarifas oficiales:** es un acuerdo más (con su historial): las partidas de catálogo pasan al precio
  oficial vigente ese día y las partidas a medida conservan el suyo.
- **Paquete para una contratación nueva:** borrador sin suscripción (`subscription_id` nulo); «preparar contratación»
  crea la suscripción con el plan Core del paquete y le aplica el acuerdo desde su primer instante.
- **Aceptación:** un acuerdo que exige la aceptación del cliente no se activa hasta que conste aceptado.
- **Stripe:** una suscripción cobrada por Stripe no admite condiciones personalizadas mientras no se habilite (fase 4).
- **Fallos parciales:** si el proceso se corta entre la mutación de la suscripción y el marcado del acuerdo, repetir
  la activación completa el segundo paso sin volver a materializar.
- **Licencias:** aquí no se concede ni se retira ninguna. El plan de licencias y `LicensingService` siguen derivando
  las capacidades de la clave de producto de las partidas vigentes; los derechos adquiridos tienen otro origen y no se
  tocan.

## Presentación al cliente, contrato y aceptación

- **Una sola vista para todo** (`server/commercialTerms/presentation.ts`, `presentTerms`): la oferta, la propuesta, el
  contrato, el resumen de contratación y el panel de la empresa salen de la misma vista, así que la presentación
  elegida se respeta en todos.
  - `global`: nombre del paquete, productos y servicios incluidos, cuota global, impuestos, total, periodicidad y
    condiciones. Nunca precios por partida, ni la tarifa oficial, ni la asignación interna.
  - `breakdown`: cada producto y servicio con su precio, sus descuentos o recargos, impuestos y total negociado.
  - Los impuestos, los pagos únicos, la vigencia y los cambios de precio programados se muestran siempre. La tarifa
    oficial de referencia es un dato interno del administrador: el cliente solo la ve cuando el acuerdo dice que al
    vencer se vuelve a ella.
  - Las facturas no usan esta vista: llevan siempre el detalle fiscal por concepto.
- **Contrato** (`renderTermsDocument`): texto determinista (misma huella mientras el acuerdo no cambie) con empresa
  contratante, productos y servicios, precio, periodicidad, impuestos, pagos iniciales, vigencia, condiciones
  especiales, renovación, cambios de precio programados y aceptación. Recoge expresamente qué ocurre al vencer una
  condición temporal: la tarifa oficial fijada en el acuerdo (con su importe) o la vigente en esa fecha.
- **Se reutiliza lo existente** (`server/commercialTerms/acceptance.ts`):
  - los contratos del CRM (`crm_contracts` y sus versiones): cada acuerdo que exige aceptación tiene SU contrato; el
    que ya tuviera la suscripción queda como antecedente (`previous_contract_id`) y no se toca. Un contrato firmado
    nunca se sobrescribe;
  - el circuito de aceptación electrónica de los servicios externos (`crm_contract_acceptances`): enlace personal de
    un solo uso del que solo se guarda la huella, huella SHA-256 del documento exacto, identidad declarada, fecha, IP
    seudonimizada y navegador. La página pública cuelga de la misma ruta
    (`/cp/v1/public/contract-acceptance/condiciones`).
- **Nada se activa antes de aceptar.** Enviar a aceptación deja el acuerdo «pendiente de aceptación» (ya no se edita:
  hay que retirarlo, lo que revoca el enlace). Si el documento cambia, el enlace antiguo deja de valer. Al aceptar se
  firma el contrato, se activan las condiciones (o se crea la suscripción del paquete) y la suscripción queda enlazada
  con el contrato firmado. Si la activación automática falla, la aceptación ya consta y el administrador la completa.
- **Panel de la empresa** (`server/commercialTerms/tenantView.ts`, «Mi plan»): solo lectura, con la misma vista, la
  cuota que rige hoy y las condiciones ya pactadas para más adelante. Una empresa nunca ve las de otra ni tiene
  ninguna ruta para modificar sus precios.
- El enlace de aceptación lo entrega hoy el administrador (se devuelve al enviarlo); no se envía un correo automático.

## Licencias: aplicación automática (`server/commercialTerms/licences.ts`)

Los derechos salen de los **productos de catálogo** de las partidas vigentes de la suscripción, nunca del importe. Los
calcula el servicio de licencias de siempre (`LicensingService.preview`), con origen `subscription:<id>`.

- **Aplicación restringida** (más prudente que el «Aplicar licencias» manual de la ficha): solo da de alta capacidades
  que la empresa no tiene (o propias ya canceladas), da de baja las propias que ya no corresponden y ajusta la
  caducidad de las propias activas. Nunca reactiva una licencia suspendida o en solo lectura (impago, bloqueo de un
  operador) y nunca toca una licencia de otro origen aunque sea de la misma capacidad (queda anotada como «sin tocar»
  en el historial).
- **Límites y cupos, también solos:** a la vez que las capacidades se fijan los límites contratados de la empresa
  (registro 0013, `tenant_entitlement_limits`): **usuarios**, **sedes** y **almacenamiento (GB)**. No hace falta
  «Aplicar licencias». Ver el apartado siguiente.
- **Una suscripción en prueba no se toca:** sus licencias las gobierna la prueba gratuita.
- **Nunca retroactivo:** un acuerdo activado antes de existir esta función no recibe nada solo; sí al dar de alta la
  plataforma de su empresa o a mano.

- **Cuándo se aplican solas:** al entrar en vigor un acuerdo (activación directa o aceptación del cliente), al
  resolverse el fin de una condición temporal y cuando la empresa recibe su plataforma desde el CRM (alta en la
  plataforma). Las pendientes o fallidas se reintentan al registrar la simulación de un periodo (nunca en una consulta).
- **Empresa sin plataforma:** no hay dónde aplicar. Queda «pendiente de plataforma» en el historial del acuerdo
  (`licences_pending`) y se aplican al darla de alta. La suscripción toma la plataforma de SU empresa (evento
  `tenant_linked` en su historial); una suscripción nunca cambia de plataforma.
- **Qué no se toca:** las licencias de otro origen (derechos adquiridos del TPV, operador, otras suscripciones) y las
  de otras empresas. Una partida a medida no existe en el catálogo: no concede nada, se llame como se llame.
- **Idempotente:** repetirlo no cambia nada si ya está aplicado. Si un acuerdo retira un producto, se retiran solo las
  licencias de esa suscripción que ya no corresponden.
- **Fallos:** si la propagación falla, el acuerdo queda activado igualmente, el fallo queda en el historial
  (`licences_failed`) y se reintenta; también se puede aplicar a mano.
- **Fechas:** los cambios que dependen solo de la fecha (un acuerdo programado que empieza, una partida con fin
  propio) se aplican la siguiente vez que se registra la simulación de un periodo de la suscripción; no hay todavía
  una tarea periódica que lo haga a la hora exacta.
- **Interruptor:** la aplicación automática viene ENCENDIDA. Solo se apaga con `CP_CUSTOM_TERMS_AUTO_LICENCES=0` (no hay
  que crear ninguna variable para que funcione). Apagada, el enlace de la plataforma y la aplicación siguen a mano.
- **Riesgo asumido:** con la facturación en simulación, las licencias se conceden sin que haya un cobro detrás (igual
  que hoy con «Aplicar licencias» de la ficha). La decisión de contratar la toma el administrador central al activar
  el acuerdo o el cliente al aceptarlo.
- **A mano:** `GET /subscriptions/:id/terms/licences` (plataforma, licencias y límites que corresponden y último
  resultado) y `POST /subscriptions/:id/terms/licences/apply` (permiso de precios personalizados y
  `entitlements:write`). La aplicación a mano hace exactamente lo mismo que la automática (capacidades y límites, con
  las mismas cautelas) y sigue disponible con la automática apagada; ya no es un paso necesario.
- **Qué ve el CRM:** `plan.pending` cuenta solo lo que la aplicación haría (altas, bajas y caducidades de capacidades
  propias, más los límites que cambiarían): tras aplicarse es 0. Lo que se deja sin tocar a propósito va aparte, en
  `plan.skipped` (capacidades de otro origen, suspendidas o en solo lectura) y `plan.limits.skipped`.
  `plan.limits.contracted` son los límites que corresponden al acuerdo; `plan.limits` es null si el plano de control
  no tiene registro de límites.

### Límites y cupos (usuarios, sedes, almacenamiento)

- **De dónde salen:** del mismo cálculo que las licencias de cualquier suscripción (`LicensingService.limitsFor`), sobre
  las partidas **vigentes hoy** de la suscripción (las que deja el acuerdo en vigor): lo **incluido en el plan** del
  acuerdo (`quotas` del producto del catálogo, con su herencia: Business ⊃ Essential) **más las ampliaciones**
  contratadas, `unidades × paso` de cada complemento (`addonFor`: usuario adicional = 1 usuario, sede adicional = 1
  sede, bloque de almacenamiento = 10 GB). Un valor «por contrato» del plan queda sin tope técnico (`NULL`). Una
  métrica que el plan no define no se toca. **El importe no interviene**: ni un descuento del 100 % reduce un límite ni
  una partida a medida («10 usuarios adicionales» de texto libre) lo amplía.
- **Cuándo:** en las mismas ocasiones que las capacidades (activación o aceptación del acuerdo, fin de una condición
  temporal, alta de la plataforma de la empresa, reintento al registrar la simulación de un periodo) y justo después de
  ellas. Si un acuerdo nuevo retira o reduce una ampliación, el límite baja con él; si la añade, sube. Un acuerdo
  programado no adelanta sus ampliaciones.
- **Cómo se escriben:** con origen `subscription:<id>`, solo lo que cambia (idempotente), y un evento comercial
  `entitlement.limit_changed` por cada límite que cambia, igual que «Aplicar licencias». Los cambios quedan además en
  el historial del acuerdo (`licences_applied`, campo `limits`).
- **Qué no se pisa:**
  - Las **excepciones de cupo** que concede un operador (registro 0016) viven aparte del límite contratado y siguen
    aplicándose por encima de él: aquí no se leen ni se escriben.
  - Un límite que hoy pertenece a **otra suscripción viva** de la misma empresa, o a **otro origen**, no se toca: queda
    anotado (`limitsSkipped`) para un operador. Si esa otra suscripción está cancelada (o ya no existe), la del
    acuerdo releva el límite. Esta es la única diferencia con «Aplicar licencias» de la ficha
    (`POST /subscriptions/:id/licences/apply`), que escribe siempre los límites de la suscripción que se le indica.
  - **Una suscripción en prueba** o **cancelada** no cambia límites por esta vía.
- **Sin registro de límites** (migración 0013 del registro sin aplicar): se aplican las capacidades y los límites no
  se tocan.
- **Puesta al día:** una suscripción cuyas licencias ya aplicó esta función antes de que fijara los límites los
  recibe una sola vez, en la siguiente ocasión (al registrar la simulación de un periodo) o al aplicar a mano. Un
  acuerdo anterior a la aplicación automática sigue sin recibir nada solo.
- **Fallos:** si la escritura de los límites falla, queda `licences_failed` y se reintenta (las capacidades, ya
  aplicadas, no se repiten).
- **No se comprueba el uso:** si un acuerdo reduce las ampliaciones por debajo de lo que la empresa usa, el límite
  baja igualmente (como con «Aplicar licencias»). La comprobación de uso de la ficha solo existe al reducir una
  ampliación de una suscripción ordinaria; en un acuerdo la decide quien lo activa.

## Facturación y Stripe (fase 4): implementado con dobles y APAGADO

`server/commercialTerms/billing.ts` conecta el acuerdo con el cobro. Hoy **no cobra nada**: las suscripciones con
condiciones personalizadas siguen en simulación de facturación.

- **Fuente del cobro:** las partidas ya materializadas en la suscripción (las mismas que factura la simulación), con
  su importe neto del periodo y su tipo de impuesto. Stripe recibe exactamente lo que la simulación factura.
- **Sin tocar el catálogo de Stripe:** las partidas viajan como precio en línea de ESA suscripción. Un producto de
  catálogo usa su Product ya existente; una partida a medida, un Product genérico. No se crean Products ni Prices
  públicos por negociación y los Prices oficiales no se modifican (la pasarela `NegotiatedBillingGateway` ni siquiera
  tiene una operación para ello).
- **Cargos únicos y abonos de un solo uso:** importes únicos de la próxima factura, una sola vez y cuando vencen.
- **Idempotencia:** las partidas recurrentes se comparan siempre con lo que Stripe tiene (si coinciden no se envía
  nada); cada importe único se busca en Stripe por su clave antes de enviarlo, así que un reintento tardío, con la
  clave de idempotencia de Stripe ya caducada, tampoco lo duplica. Además, cada llamada lleva su clave estable.
- **Fallos parciales, errores y reintentos:** `commercial_terms.sync_status` (`none`, `synced`, `failed`) y
  `sync_detail` (pasos completados, intentos, último error); cada intento deja un evento `sync` en el historial. El
  reintento continúa por donde se quedó.
- **Conciliación:** `GET /subscriptions/:id/terms/billing` compara lo que rige hoy con lo que Stripe tiene: partidas,
  moneda e importes únicos vencidos.
- **Se planifica por suscripción, no por acuerdo:** se envía lo que la suscripción tiene HOY. Un acuerdo programado no
  cambia lo que se cobra hoy; al terminar un tramo o vencer una condición temporal se envía lo que rige después; un
  cargo vencido de un acuerdo ya sustituido se sigue enviando. Nunca se envía una lista vacía.
- **Cuándo se sincroniza:** al activar unas condiciones y al resolverse el fin de una condición temporal (si el cobro
  está abierto), y a mano desde el CRM. Los cambios que dependen solo de la fecha (fin de un descuento temporal, un
  cargo que vence) necesitan una tarea periódica que aún no existe: es un requisito para encender el cobro.
- **Tres cerrojos**, todos necesarios para que salga una sola llamada:
  1. el interruptor `CP_CUSTOM_TERMS_BILLING_ENABLED=1` (no existe en ningún entorno: apagado);
  2. una pasarela validada: hoy solo existe el doble de pruebas (`billingTesting.ts`). El plano de control arranca SIN
     pasarela, así que aun con el interruptor encendido la respuesta es «pendiente de la validación en Stripe Sandbox»;
  3. que la suscripción esté enlazada a una suscripción de Stripe.
- Mientras el cobro no esté abierto (cerrojos 1 y 2), una suscripción cobrada por Stripe no admite condiciones
  personalizadas (409 `stripe_billed`).

### Qué falta para validar en Stripe Sandbox (necesita al propietario)

1. **Claves de Stripe Sandbox** del plano de control en live (no las hay todavía): clave restringida de pruebas y
   secreto de firma del webhook de ese entorno.
2. **Escribir el adaptador real** de `NegotiatedBillingGateway` sobre la API de Stripe (no se ha escrito a ciegas):
   - `applyItems`: `POST /v1/subscriptions/:id` con `items[]` (`price_data`: `currency`, `product`, `unit_amount`,
     `recurring[interval]`, `tax_behavior=exclusive`; `tax_rates[]`; `metadata[es_line]`), marcando `deleted` las partidas
     anteriores, con `proration_behavior=none` e `Idempotency-Key`;
   - `addOneOff`: `POST /v1/invoiceitems` (`customer`, `subscription`, `amount` con signo, `currency`, `tax_rates[]`,
     `description`) con `Idempotency-Key`;
   - `current`: `GET /v1/subscriptions/:id` con las partidas y su `metadata[es_line]`;
   - `findOneOff`: búsqueda del importe único por su metadato (`es_key`) entre los de la suscripción.
   - Tipos de impuesto con `ensureTaxRate` (ya existe para los servicios externos) y Product genérico de servicios a
     medida con `ensureServiceProduct` (ídem). Un único Product genérico: lo crea el adaptador en Sandbox; en Live
     debe autorizarlo el propietario.
3. **Enlace de la suscripción con Stripe** para una contratación negociada nueva: reutilizar el circuito de los
   servicios externos (autorización del método de pago en modo `setup`, sin cargo, y alta de la suscripción con precio
   en línea) o el alta por Checkout con las tarifas oficiales seguida de la sincronización del acuerdo. Decisión
   pendiente del propietario.
4. **Decisión fiscal:** la política de impuestos de Live sigue pendiente (`CP_STRIPE_TAX_POLICY`, decisiones DF-2, DF-3
   y DF-5). El acuerdo lleva tipo de impuesto por partida; hay que decidir si en Live manda ese tipo fijo o Stripe Tax.
5. **Recorrido de validación en Sandbox** (con relojes de prueba de Stripe): alta del paquete de 129 €, primera factura
   con implantación, renovación, cambio de cuota a mitad de periodo, descuento de un solo uso, fin de un descuento
   temporal, reintento tras fallo, conciliación y un impago. Sin cargos reales.
6. **Tarea periódica de sincronización** en las fechas de corte (fin de tramos, cargos que vencen), con bloqueo para
   que dos réplicas no la ejecuten a la vez. Sin ella, esos cambios solo llegan a Stripe al sincronizar a mano.
7. **Periodicidades mezcladas:** comprobar en Sandbox qué admite Stripe; hoy un acuerdo usa una sola periodicidad.
8. **Autorización del propietario** para encender `CP_CUSTOM_TERMS_BILLING_ENABLED` en cada entorno (operación protegida).

## Permisos (`server/commercialTerms/permission.ts`)

Una sola función (`canManageCustomPricing` / `requireCustomPricing`):

- Permiso propio `commercial.subscription.custom_pricing.manage` (decisión del propietario, 10/11/2026), separado de los
  de suscripciones y de aprobación de pedidos, solo para administradores y superadministradores.
- Mientras ese ámbito no exista en `SCOPES` (su alta se publica por el procedimiento protegido), regla provisional:
  `subscriptions:write` y `orders:approve` a la vez. En cuanto existe, se exige solo el permiso propio, sin cambiar código.
- Siempre una persona: un token de servicio no gestiona precios aunque lleve el ámbito. El token del Core con el que
  actúa el panel de una empresa no tiene ninguna ruta de escritura ni de lectura aquí.
- Consultar (acuerdos, historial, punto de partida y vista previa) pide `subscriptions:read`.

## API (`/cp/v1`)

| Ruta | Qué hace |
|---|---|
| `GET /commercial-terms/access` | Si quien pregunta puede gestionar precios personalizados |
| `GET /subscriptions/:id/terms` | Acuerdos e historial de la suscripción, con la cuota que rige hoy |
| `GET /subscriptions/:id/terms/base` | Punto de partida para modificar: lo que la suscripción tiene ahora |
| `POST /subscriptions/:id/terms` | Borrador de condiciones |
| `POST /subscriptions/:id/terms/restore-official` | Restaura las tarifas oficiales |
| `GET /commercial-terms?companyId=` | Acuerdos y paquetes de una empresa |
| `POST /commercial-terms/packages` | Borrador de paquete para una contratación nueva |
| `GET /commercial-terms/:id` y `/preview` | Detalle con historial; vista previa (antes, después, diferencia, fecha efectiva, prorrateo, próximo cobro y licencias) |
| `PUT /commercial-terms/:id` | Guarda una revisión del borrador (`expectedRevision`) |
| `POST /commercial-terms/:id/activate` | Activa (`expectedRevision` y `expectedVersion` de la suscripción) |
| `POST /commercial-terms/:id/cancel` | Anula un borrador |
| `POST /commercial-terms/:id/prepare-contracting` | Crea la suscripción de un paquete y le aplica el acuerdo |
| `GET /commercial-terms/:id/document` | Documento contractual (texto, huella y vista del cliente) |
| `GET /commercial-terms/:id/acceptance` | Estado de la aceptación: contrato, firmante y evidencias (nunca el enlace) |
| `POST /commercial-terms/:id/acceptance` | Envía a aceptación: contrato del CRM y enlace personal del firmante |
| `POST /commercial-terms/:id/acceptance/withdraw` | Retira unas condiciones enviadas (revoca el enlace; vuelven a borrador) |
| `GET`/`POST /public/contract-acceptance/condiciones?token=` | Página pública del firmante (sin sesión; HTML sin scripts) |
| `GET /subscriptions/:id/terms/licences` | Plataforma, licencias y límites que corresponden, lo pendiente de aplicar y último resultado |
| `POST /subscriptions/:id/terms/licences/apply` | Enlaza la plataforma de la empresa (si falta) y aplica las licencias y los límites (lo mismo que hace sola) |
| `GET /subscriptions/:id/terms/billing` | Plan de cobro de hoy y conciliación con Stripe (sin interruptor: solo el plan) |
| `POST /subscriptions/:id/terms/billing/sync` | Deja en Stripe lo que la suscripción tiene hoy (sin los tres cerrojos no hace nada) |

## Limitaciones conocidas

- Las partidas recurrentes de un acuerdo comparten la periodicidad del acuerdo (no hay complementos mensuales dentro de
  un paquete anual negociado).
- Con cuota global, las partidas recurrentes comparten la vigencia del acuerdo.
- Los consumos (`usage`) no forman parte de un acuerdo: sus partidas no se tocan.
- Solo se encadena una condición programada detrás de otra.
- Un acuerdo ya programado se deja sin efecto aplicando otro (o restaurando las tarifas oficiales); no hay una anulación aparte.
- En una suscripción con acuerdo, las operaciones ordinarias de la ficha (cambiar plan, añadir o retirar partidas, cambiar cantidades) se rechazan: se modifica desde el acuerdo.

## Casos de aceptación → pruebas

Se completa en cada fase. `C` = `server/subscriptionsTerms.compute.test.ts` (cálculo puro), `S` =
`server/subscriptionsTerms.service.test.ts` (servicio con la simulación de facturación real), `A` =
`server/controlPlane.commercialTerms.test.ts` (API y licencias reales), `P` =
`server/subscriptionsTerms.presentation.test.ts` (presentación y contrato), `B` =
`server/subscriptionsTerms.billing.test.ts` (cobro con el doble de Stripe), `L` =
`server/subscriptionsTerms.licences.test.ts` (licencias reales por capacidad y límites contratados), `M` = `server/subscriptionsTerms.mysql.test.ts`
(MySQL real).

| Caso | Prueba |
|---|---|
| 1. Essential con descuento porcentual | C «Caso 1» |
| 2. Essential con descuento fijo | C «Caso 2» |
| 3. Essential con precio superior al catálogo | C «Caso 3» |
| 4. Essential + Hotel Net con precio global | C «Caso 4»; S «Casos 17, 18 y 19» |
| 5. Essential + Hotel Net + WhatsApp con cuota global | C «Caso 5»; S «Casos 5 y 16» |
| 6. Precio individual diferente para cada producto | C «Caso 6» |
| 7. Servicio personalizado no existente en catálogo | C «Caso 6»; S «Caso 27» y «una partida a medida no puede llevar clave de producto»; A «una partida a medida con clave de producto… (400)» |
| 8. Servicio recurrente adicional | C «Caso 6»; S «Casos 5 y 16» |
| 9. Pago inicial de implantación | C «Caso 9»; S «Caso 9»; M «la activación materializa…» |
| 10. Cargo extraordinario | C «Caso 10»; S «Caso 10» |
| 11. Descuento de un solo uso | C «Caso 11»; S «Caso 9 … Caso 11» |
| 12. Descuento recurrente | C «Caso 12»; S «Caso 12» |
| 13. Precio temporal | C «Caso 13»; S «Caso 13 — vuelta a la tarifa oficial fijada al pactar» |
| 14. Precio indefinido | C «Caso 14» |
| 15. Retorno automático al precio pactado | C «Caso 15»; S «Casos 13 y 15» |
| 16. Modificación de paquete activo | S «Casos 5 y 16», «Casos 17, 18 y 19» |
| 17. Adición de un producto | S «Casos 17, 18 y 19» |
| 18. Retirada de un producto | S «Casos 17, 18 y 19» |
| 19. Cambio de cuota global | C «Caso 19»; S «Casos 17, 18 y 19» |
| 20. Presentación global al cliente | P «Caso 20» (vista y contrato); S «Caso 20 — con cuota global la empresa ve…» (panel); A «el documento respeta la presentación de cuota global» |
| 21. Presentación desglosada | P «Caso 21»; S «Caso 21 — con desglose…» (panel) |
| 22. Generación y aceptación contractual | A «Caso 22 — contrato y aceptación del cliente (paquete de 129 €/mes)» (8 pruebas); S «lo que exige aceptación del cliente no se activa por adelantado» |
| 23. Renovación con precio negociado | S «Caso 23»; M «la activación materializa…»; B «Caso 23 — Stripe recibe exactamente lo que factura la simulación» |
| 24. Impuestos de partidas diferentes | C «Caso 24»; B «Caso 24 — cada concepto viaja con su tipo de impuesto» |
| 25. Idempotencia de cobros | S «Caso 23 … Caso 25» (simulación); B «Caso 25 — idempotencia de cobros y recuperación ante fallos» (3 pruebas, con el doble de Stripe). Pendiente: repetirlo en Stripe Sandbox |
| 26. Concurrencia de modificaciones | S «Caso 26» y «dos ediciones del mismo borrador»; M «dos administradores desde conexiones distintas» |
| 27. Conservación de licencias | S «Caso 27»; A «Casos 27 y 28»; L «Caso 27 — el paquete de 129 € concede exactamente las licencias de sus tres productos» y «el precio no interviene» |
| 28. Conservación de derechos adquiridos | A «Casos 27 y 28»; L «Caso 28 — los derechos adquiridos y las licencias de otro origen no se tocan» |
| 29. Aislamiento entre tenants | S «Caso 29»; A «Caso 29» y «una empresa no puede leer ni modificar sus precios negociados» |
| 30. Actualización posterior del catálogo sin pérdida del precio negociado | S «Caso 13 … Caso 30» |

**Caso final del propietario** (Essential + Hotel Net + WhatsApp Connect por 129 €/mes + IVA, desde el CRM, con
licencias y facturación simulada coherentes): A «caso final — Essential + Hotel Net + WhatsApp Connect por 129 €/mes + IVA»
y, con contrato y aceptación del cliente, A «Caso 22».
