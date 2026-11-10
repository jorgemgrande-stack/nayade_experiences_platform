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
- **Tarifa oficial vigente en la fecha del cambio:** `settleDue` (idempotente; se ejecuta al consultar las condiciones
  de la suscripción) lee el catálogo, sustituye la partida provisional si el importe difiere y deja registrado el
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
| `GET /subscriptions/:id/terms` | Acuerdos e historial de la suscripción (resuelve antes las condiciones vencidas) |
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

## Limitaciones conocidas

- Las partidas recurrentes de un acuerdo comparten la periodicidad del acuerdo (no hay complementos mensuales dentro de
  un paquete anual negociado).
- Con cuota global, las partidas recurrentes comparten la vigencia del acuerdo.
- Los consumos (`usage`) no forman parte de un acuerdo: sus partidas no se tocan.
- Solo se encadena una condición programada detrás de otra.

## Casos de aceptación → pruebas

Se completa en cada fase. `C` = `server/subscriptionsTerms.compute.test.ts` (cálculo puro), `S` =
`server/subscriptionsTerms.service.test.ts` (servicio con la simulación de facturación real), `A` =
`server/controlPlane.commercialTerms.test.ts` (API y licencias reales), `M` = `server/subscriptionsTerms.mysql.test.ts`
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
| 20. Presentación global al cliente | Fase 3 |
| 21. Presentación desglosada | Fase 3 |
| 22. Generación y aceptación contractual | Fase 3 (hoy: S «lo que exige aceptación del cliente no se activa por adelantado») |
| 23. Renovación con precio negociado | S «Caso 23»; M «la activación materializa…» |
| 24. Impuestos de partidas diferentes | C «Caso 24» |
| 25. Idempotencia de cobros | S «Caso 23 … Caso 25» (simulación); cobros reales, fase 4 |
| 26. Concurrencia de modificaciones | S «Caso 26» y «dos ediciones del mismo borrador»; M «dos administradores desde conexiones distintas» |
| 27. Conservación de licencias | S «Caso 27»; A «Casos 27 y 28» |
| 28. Conservación de derechos adquiridos | A «Casos 27 y 28» |
| 29. Aislamiento entre tenants | S «Caso 29»; A «Caso 29» y «una empresa no puede leer ni modificar sus precios negociados» |
| 30. Actualización posterior del catálogo sin pérdida del precio negociado | S «Caso 13 … Caso 30» |
