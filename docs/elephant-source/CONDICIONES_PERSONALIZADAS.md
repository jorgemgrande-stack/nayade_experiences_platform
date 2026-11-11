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

## Suscripciones económicas independientes del SaaS

Requisito del propietario (11/11/2026): un acuerdo (o paquete) puede no llevar plan de Elephant Core cuando no incluye
nada que dependa de él. Caso de referencia: una empresa que solo paga costes de infraestructura, una partida recurrente
de **44,63 € netos + 21 % (9,37 €) = 54,00 € al mes**; ningún producto de Big Elephant, ninguna plataforma, ninguna
licencia.

**Cuándo es obligatorio el plan Core.** Lo decide el catálogo, no una lista de productos (`needsCorePlan`,
`server/subscriptions/service.ts`). Un producto de catálogo necesita un plan si declara planes compatibles
(`compatibleWith`), amplía un cupo del plan (`addonFor`), concede capacidades de plataforma (`capabilities`), tiene una
activación dentro de la plataforma (`plan`, `module`, `feature`, `usage`) o no es de la familia de servicios (una
solución Net, una extensión Connect o un extra lo necesitan aunque su activación aún sea `none`, como los que están en
hoja de ruta). Solo un **servicio puro** (familia `service`, sin capacidades ni compatibilidad declarada; p. ej. el
alojamiento web) puede ir sin plan. Además:

- Como mucho un plan, y todo acuerdo necesita al menos una cuota recurrente.
- **Vigencias.** La composición se comprueba en cada inicio y fin propio de las cuotas de catálogo (`checkWindows`): la
  vigencia del plan tiene que cubrir la de todo producto que dependa de él (y la de un producto, la de los que lo
  requieren). `[partida a medida ahora, Hotel Net desde D1, Essential desde D2 > D1]` y «plan con fecha de fin y Net sin
  fin» se rechazan al guardar, con la fecha en el mensaje.
- Si el acuerdo lleva plan, el plan rige desde la entrada en vigor (como siempre): un acuerdo no deja la suscripción a
  la espera de su plan.
- Un acuerdo sin plan sobre una suscripción **en prueba** se rechaza: le quitaría el plan de la prueba.
- Las operaciones ordinarias de una suscripción (alta, cambio de plan, añadir o quitar partidas) siguen exigiendo
  exactamente un plan: la excepción es solo de los acuerdos.

**Qué es «solo económica»** (`isEconomicOnly`, una única definición para todo el servidor): una suscripción cuyas
partidas vivas o programadas no conceden nada en la plataforma, es decir, solo partidas a medida (`custom:…`) y
servicios puros del catálogo. La crea «preparar contratación» (o la aceptación del cliente) con `tenant_id` nulo, sin
partida de plan (tampoco la partida «fantasma» del alta) y sin periodo de prueba. Garantías:

- **Invisible para el circuito del SaaS.** Todo «la suscripción viva de la empresa» usa
  `SubscriptionService.liveSaas` / `saasSubscriptions`, que la excluyen: alta, ampliación, reactivación y conversión de
  la prueba gratuita (`trials/onboarding.ts`), pedido de conversión y pedido nuevo (`orchestrator/service.ts`), límites
  de la organización (`organization/service.ts`), «otra suscripción viva» de los límites del acuerdo (`licences.ts`) y
  «Mi plan» (`tenantView.ts`). Con una suscripción en prueba o de pago de la misma empresa, todo se comporta como si la
  económica no existiera; y la empresa que solo paga infraestructura puede contratar después el SaaS (por pedido o por
  prueba): se crea una segunda suscripción, con plan, y la económica no se toca.
- **No concede nada.** `TermsLicences` devuelve `not_applicable` (también a mano): no anota «pendiente de plataforma»,
  no reintenta, no la enlaza con la plataforma que la empresa tenga por otro motivo y no escribe capacidades ni
  límites. El estado para el CRM lleva `applicable: false`. Si la suscripción sí tuvo plataforma y un acuerdo posterior
  le quita todos los productos, sigue el circuito normal y se retiran sus licencias.
- **Mismo circuito económico.** Vista previa (`licences.grantsNothing: true`), documento contractual (sin partidas de
  catálogo no menciona planes ni licencias: «Estas condiciones son exclusivamente económicas…»), aceptación,
  historial, facturación simulada, renovación automática y plan de cobro (`TermsBillingService.plan`: una partida
  `custom`, 4463 céntimos, mensual, 2100 pb). El bruto es exactamente 5400 céntimos (4463 + 937) en la vista previa,
  el documento, la simulación y el historial: el impuesto se calcula una vez por tipo sobre la base sumada.
- **Estados sin plan ni plataforma.** Baja programada, cancelación al fin del periodo, reactivación (vuelve con las
  cuotas de su acuerdo; si la cancelación dejó sin efecto cuotas programadas de otras partidas, se rechaza en lugar de
  reactivar a medias) y renovaciones funcionan igual y nunca tocan licencias, límites, plataformas ni
  aprovisionamiento.
- **Compatibilidad.** Sin migración ni cambios de datos: suscripciones, acuerdos y borradores existentes quedan como
  estaban. Un borrador guardado con plan lo conserva hasta que un operador lo quita, y solo puede quitarlo si ninguna
  partida restante depende de él.

**Primer periodo: completo, sin parte proporcional.**

- Lo normal: el paquete empieza al contratarlo (o al aceptarlo el cliente) y su primer periodo es un mes (o un año)
  entero desde ese instante. Un paquete **con plan** empieza siempre así: no se ancla a futuro.
- **Paquete solo económico con fecha de inicio**: si TODAS sus cuotas recurrentes llevan un inicio propio futuro
  (`declaredServiceStart`), el servicio empieza en la primera de esas fechas, D:
  - la suscripción nace con un periodo previo [contratación, D) sin cuotas y `started_at = D`; en el CRM figura como
    «programada, empieza el D» (`effective.startsAt`). Antes de D la simulación no registra ninguna cuota y el plan de
    cobro no tiene partidas;
  - desde D sus periodos son meses (o años) de **calendario de Europe/Madrid**: del día 1 a las 00:00 al día 1 a las
    00:00, con el cambio de hora y los fines de mes resueltos. Se guarda como día de anclaje negativo
    (`anchor_day = −día`, `madridAnchor` en `subscriptions/pricing.ts`); las demás suscripciones conservan su día
    positivo y su cálculo en UTC;
  - un cargo único sin fecha se debe al contratar (se factura en el periodo previo), no en D; un ajuste de un solo uso
    sobre las cuotas se rechaza (no tendría primer periodo);
  - el documento y la vista previa enseñan la cuota real y «Entrada en vigor: D o, si la aceptación es posterior, en el
    momento de la aceptación», nunca «0,00 € al mes» (el texto depende solo de los datos del acuerdo, no de «ahora»:
    misma huella al enviar y al aceptar). Los documentos de los acuerdos existentes no cambian;
  - si D ya pasó al contratar, empieza al contratar, como cualquier otro;
  - hasta D, un acuerdo posterior no puede regir antes de D.

**Lo que debe respetar el cobro en Stripe** (rama `feat/condiciones-stripe-cobro`):

- Todo cuelga de la empresa y de la suscripción interna y su acuerdo: nunca de un tenant ni de una partida de plan
  (`tenant_id` es nulo y no hay ninguna partida `core_plan`).
- Lo que se cobra es lo que devuelve `TermsBillingService.plan`: importe NETO por partida y su tipo; el bruto esperado
  del caso de referencia es 5400 céntimos.
- El ciclo empieza en el inicio del servicio (`startedAt`: la contratación o la fecha D elegida) con un periodo
  completo; ni prueba ni prorrateo. Antes de D no hay nada que cobrar salvo los cargos únicos debidos al contratar. Si
  Stripe reescribe el periodo interno, debe conservar el día de anclaje negativo de estas suscripciones (o fijar su
  propio ciclo en la misma fecha).
- Los cambios de estado por eventos de pago usan los puntos de entrada de siempre (`scheduleCancel`, `applyRenewals`,
  `reactivate`), válidos sin plan ni plataforma. El impago no tiene estado propio en la suscripción interna (sigue
  `active` hasta su cancelación): vive en el registro de cobro.
- Un impago o una cancelación no deben llamar a licencias, límites ni aprovisionamiento; si lo hicieran, la respuesta
  es `not_applicable`, sin error ni reintento.

Pruebas: `server/subscriptionsTerms.sinCore.test.ts` (caso real, anclaje y calendario de Madrid, documento, dependencias
sobre toda la siembra del catálogo, vigencias, acuerdos posteriores, cambios de estado y límites),
`server/subscriptionsTerms.sinCoreCoexistencia.test.ts` (prueba gratuita, licencias y pedidos con una suscripción
económica de la misma empresa, y contratación posterior del SaaS), «paquete solo con partidas a medida» en
`server/controlPlane.commercialTerms.test.ts` (circuito completo por la API, con contrato y aceptación) y los casos con
MySQL real en `server/subscriptionsTerms.mysql.test.ts`.

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
  catálogo (como mucho un plan Core, obligatorio solo si algún producto depende de él; dependencias y compatibilidad).
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
- **Stripe:** una suscripción que ya cobra Stripe por el circuito ordinario (un pedido con pagos verificados) no admite
  condiciones personalizadas, tampoco con el cobro de la fase 4 encendido: ese cobro solo alcanza a las suscripciones que
  un operador pone a cobrar de forma expresa.
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
  plataforma de su empresa o a mano. Única excepción: la puesta al día de los límites (ver más abajo).

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
  ellas. Si **otro acuerdo sustituye** al vigente retirando o reduciendo una ampliación, el límite baja con él; si la
  añade, sube. Un acuerdo programado no adelanta sus ampliaciones. Si el acuerdo simplemente **termina sin partidas
  posteriores** (la suscripción deja de tener condiciones personalizadas vigentes), no hay nada que aplicar: las
  capacidades y los límites se quedan como estaban hasta que alguien aplique las licencias de la suscripción.
- **Cómo se escriben:** con origen `subscription:<id>`, solo lo que cambia (idempotente), y un evento comercial
  `entitlement.limit_changed` por cada límite que cambia, igual que «Aplicar licencias». Los cambios quedan además en
  el historial del acuerdo (`licences_applied`, campo `limits`).
- **Qué no se pisa:**
  - Las **excepciones de cupo** que concede un operador (registro 0016) viven aparte del límite contratado y siguen
    aplicándose por encima de él: aquí no se leen ni se escriben.
  - Un límite que hoy pertenece a **otra suscripción viva** de la misma empresa, o a **otro origen**, no se toca: queda
    anotado (`limitsSkipped`, motivo `other_source`) para un operador. Si esa otra suscripción está cancelada (o ya no
    existe), la del acuerdo releva el límite.
  - Una métrica **sin fila** (o con la de una suscripción ya cancelada) tampoco se escribe si la empresa tiene **otra
    suscripción viva, también en prueba, enlazada a la misma plataforma**: sin fila, la empresa aplica lo incluido en
    su plan, y esa otra suscripción puede tener más contratado sin haberlo escrito. Queda anotado (`limitsSkipped`,
    motivo `other_subscription`) y lo resuelve un operador con «Aplicar licencias» de la suscripción que corresponda.
  - Estas dos cautelas son la única diferencia con «Aplicar licencias» de la ficha
    (`POST /subscriptions/:id/licences/apply`), que escribe siempre los límites de la suscripción que se le indica.
  - **Una suscripción en prueba** o **cancelada** no cambia límites por esta vía.
- **Sin registro de límites** (migración 0013 del registro sin aplicar): se aplican las capacidades y los límites no
  se tocan.
- **Puesta al día:** una suscripción cuyas licencias ya aplicó esta función antes de que fijara los límites los
  recibe una sola vez, en la siguiente ocasión (al registrar la simulación de un periodo) o al aplicar a mano. Un
  acuerdo anterior a la aplicación automática sigue sin recibir nada solo.
- **Fallos:** si la escritura de los límites falla, queda `licences_failed` y se reintenta (las capacidades, ya
  aplicadas, no se repiten).
- **Complemento fuera del catálogo publicado:** si el plan sigue publicado pero un complemento contratado deja de
  estarlo (retirado o con la clave cambiada), su ampliación suma 0 y el límite baja a lo incluido en el plan. Ya ocurría
  con «Aplicar licencias»; ahora ocurre sin una persona delante. Riesgo conocido.
- **Dos aplicaciones simultáneas** (p. ej. aceptación y registro de una simulación a la vez) sobre una empresa sin
  filas pueden interbloquearse en MySQL: la que pierde anota `licences_failed` y el siguiente reintento lo corrige.
  No deja valores erróneos.
- **No se comprueba el uso:** si un acuerdo reduce las ampliaciones por debajo de lo que la empresa usa, el límite
  baja igualmente (como con «Aplicar licencias»). La comprobación de uso de la ficha solo existe al reducir una
  ampliación de una suscripción ordinaria; en un acuerdo la decide quien lo activa.

## Facturación y Stripe (fase 4): implementado sobre el Stripe existente y APAGADO

Decisión del propietario (11/11/2026): el cobro de las condiciones personalizadas **reutiliza la integración de Stripe
Live que ya existe** en el plano de control: la misma clave restringida, la misma versión de API, el mismo prefijo de
entorno, los mismos Customers, el mismo destino de webhooks, la misma conciliación y la misma política fiscal
(`stripe_tax_exclusive`: importes sin IVA y Stripe Tax). No hay Sandbox aparte, ni claves nuevas, ni otro webhook.

Hoy **no cobra nada**: el interruptor no existe en ningún entorno. Con él apagado no sale ninguna llamada a Stripe por
este camino (probado con una pasarela que falla en cualquier llamada).

### Piezas

| Pieza | Qué hace |
|---|---|
| `server/commercialTerms/billing.ts` (`TermsBillingService`) | Plan de cobro (lo que la suscripción tiene HOY), sincronización idempotente y conciliación. Ya existía; ahora admite el modo de impuesto de Stripe Tax y el fin programado. |
| `server/commercialTerms/stripeGateway.ts` (`StripeNegotiatedGateway`) | Adaptador REAL de `NegotiatedBillingGateway` sobre `server/stripe/gateway.ts`. |
| `server/commercialTerms/stripeBilling.ts` (`NegotiatedBillingService`) | Puesta en cobro por un operador (Checkout), enlace por webhook, estado de pago, licencias y conciliación global. |
| `server/commercialTerms/billingStore.ts` + migración CRM `0049` | Registro de lo que un operador puso a cobrar (`commercial_terms_billing`) y de sus facturas (`commercial_terms_billing_invoices`). Aditiva. |
| `server/stripe/events.ts`, `reconcile.ts`, `alerts.ts` | El procesador de webhooks y la conciliación de siempre reconocen las suscripciones negociadas y las entregan a su módulo. |

### Cerrojos (todos necesarios)

1. **Interruptor** `CP_CUSTOM_TERMS_BILLING_ENABLED=1`. Apagado: ninguna llamada a Stripe, ninguna fila nueva.
2. **Stripe montado** en el entorno, con la migración `0049` y las URLs de Checkout (`CP_STRIPE_SUCCESS_URL`…). En
   live, además, política fiscal decidida.
3. **Puesta en cobro expresa**: un administrador con el permiso de precios personalizados pulsa «poner a cobrar» en
   ESA suscripción (`POST /subscriptions/:id/terms/billing/start`). Es lo único que crea su fila en
   `commercial_terms_billing`; sin fila no hay enlace y la sincronización responde «sigue en simulación». **Encender
   el interruptor no cobra a nadie.**
4. **La pasarela solo toca lo suyo**: antes de leer o escribir relee la suscripción de Stripe y exige que conste en el
   registro, que lleve `metadata.es_negotiated=1`, que sea de este entorno (`es_env`) y que no sea de un pedido
   (`es_order_id`) ni de un servicio externo. Una suscripción ordinaria de un cliente nunca pasa de ahí, ni siquiera
   con un registro manipulado (probado).
5. Una suscripción que ya cobra el circuito ordinario (un pedido con pagos de Stripe) **no admite condiciones
   personalizadas ni puesta en cobro** (409 `stripe_billed`), tampoco con el interruptor encendido.

La línea de arranque `{"ctx":"CommercialTerms", …}` dice el estado: `stripeBilling` = `off` | `on` |
`switch_on_blocked` (con `stripeBillingReasons`: `crm_migration_0049_missing`, `stripe_not_mounted`,
`checkout_urls_missing`, `tax_policy_pending`), `stripeBillingMode` (`test`/`live`) y
`stripeBillingScope: "explicit_start_only"`.

### Cómo viajan las partidas a Stripe

- **Precio en línea de ESA suscripción** (`price_data`): un producto de catálogo sobre su Product de Stripe ya
  enlazado (`stripe_prices`, por su `lookup_key` `es:<producto>:…`); una partida a medida y los cargos únicos, sobre
  UN Product genérico (`es_terms_custom_service`, o el id de `CP_CUSTOM_TERMS_STRIPE_PRODUCT`). No se crea ni se
  modifica ningún Price público ni ningún Product del catálogo: el adaptador no tiene operación para ello. En pruebas
  el Product genérico se crea solo; **en live nunca**: lo crea el propietario (sin él, una partida a medida no se pone
  a cobrar y el error lo dice).
- Cada partida lleva `metadata.es_line` (su clave). Las que crea Checkout no la llevan: la primera sincronización tras
  enlazar reconoce cada una por su Product, su importe, su periodicidad y su cantidad y **solo le pone la clave** (un
  cambio de metadatos de la partida, sin tocar precio ni cantidad). **Lo que el cliente acaba de pagar nunca se
  sustituye**; lo mismo cuando un acuerdo nuevo da claves nuevas a partidas que no cambian. Solo se sustituye la partida
  cuyo importe, Product o periodicidad cambia de verdad. Se leen TODAS las partidas (la suscripción solo trae embebidas
  las 10 primeras; con más, se listan paginadas).
- Una cuota recurrente total de 0 no se pone a cobrar. En una suscripción YA enlazada cuyo acuerdo pasa a 0 (un
  descuento temporal del 100 %), el cobro se pone **en pausa** (`pause_collection`, `behavior=void`): Stripe no cobra
  nada mientras dura y sus partidas no se tocan (así no hay paso de gratis a de pago, que reiniciaría el ciclo). Al
  volver a ser de pago se quita la pausa y se dejan las partidas vigentes. El cliente nunca sigue pagando el importe
  anterior. Un cobro en pausa sin cuota 0, o una cuota 0 sin pausa, son diferencias de conciliación.
- La sesión de pago admite **solo tarjeta**: el primer pago se resuelve en la página, sin cobros asíncronos que fallen
  días después. (Si aun así el primer cobro fallara sin cobrarse nada, la contratación vuelve a poder iniciarse y se avisa.)
- **Impuestos, como el resto del cobro live**: importes sin IVA (`tax_behavior=exclusive`) y `automatic_tax` en la
  suscripción; no se envían tipos fijos. Por eso Stripe no tiene un tipo por partida: `current()` devuelve
  `taxRateBp = null` («lo decide Stripe en cada factura») y la comparación de partidas **no compara el tipo cuando es
  null**. A cambio: (a) la conciliación comprueba que la suscripción calcula el impuesto como dice la política
  (`tax.mode` frente a `tax.expected`; si no, diferencia `impuestos:…`), y (b) el impuesto REAL de cada factura
  cobrada se contrasta con lo pactado (la base esperada y, con un único tipo, el impuesto y el total exactos del
  acuerdo) y se guarda en `commercial_terms_billing_invoices.tax_check`; si no cuadra, alerta
  `stripe.negotiated_invoice_mismatch` (base) o `stripe.negotiated_tax_mismatch` (impuesto), y cuenta como diferencia
  en la conciliación. Con tipos fijos
  en la partida (si alguna vez se usan) la comparación sigue siendo exacta.
- En live, antes de abrir el pago se pasa el **mismo control de elegibilidad fiscal** que el Checkout ordinario, con
  los datos fiscales de la empresa del CRM (empresa, país, código postal, NIF, domicilio; VIES si el escenario es de
  inversión del sujeto pasivo). Sin escenario aprobado o sin datos válidos no se crea nada en Stripe.
- **Sin efectos retroactivos**: `proration_behavior=none`. Un cambio de condiciones rige desde la próxima factura.
- **Cargos únicos**: los ya vencidos al poner a cobrar van en el primer pago del Checkout; los posteriores, como
  importe único de la próxima factura (`/v1/invoiceitems`, con `metadata.es_key`). Un **abono de un solo uso** no cabe
  en Checkout (no admite importes negativos): va a la factura siguiente, una vez; la respuesta de la puesta en cobro
  lo avisa (`deferredCredits`).
- **Idempotencia**: claves `es-<ns>-…` en cada escritura; las partidas se comparan con lo que Stripe tiene antes de
  enviar; cada importe único se busca en Stripe por su clave antes de crearlo (un reintento días después, con las
  claves de Stripe caducadas, no duplica).

### Puesta en cobro sin duplicados

`POST /subscriptions/:id/terms/billing/start` (permiso de precios personalizados, sesión de persona):

1. Comprueba: interruptor, suscripción activa con condiciones activas y cuotas recurrentes, que no la cobre el circuito
   ordinario, política fiscal, Products de Stripe de cada partida y, en live, elegibilidad fiscal.
2. **Customer**: el que la empresa ya tenga en `stripe_customers`; solo si no tiene, se crea (con la misma clave de
   idempotencia que el Checkout ordinario: dos altas simultáneas reciben el mismo). Nunca un segundo Customer.
3. **Sesión de Checkout** en modo suscripción con las partidas pactadas: el CLIENTE pone su método de pago en la
   página de Stripe. La respuesta trae la URL para entregársela, la cuota recurrente y el primer pago (sin impuestos).
4. Repetir la acción devuelve la **misma sesión** mientras siga viva y ofrezca lo mismo (`reused: true`). Si las
   condiciones cambian antes de pagar, la sesión anterior se cierra y se abre otra. Una sesión huérfana (caída entre
   crearla y guardarla) se encuentra por sus metadatos: si está abierta se cierra; si ya está pagada, se adopta. Dos
   operadores a la vez: una sola sesión (arrendamiento por suscripción).
5. Al pagar, los **webhooks de siempre** (`checkout.session.completed`, `customer.subscription.*`, `invoice.paid`)
   enlazan la suscripción de Stripe con la interna. Desde ahí `link()` la resuelve y cambiar las condiciones es la
   sincronización de siempre (automática al activar un acuerdo, o `POST …/terms/billing/sync`).
6. Si aparece una **segunda** suscripción de Stripe para una contratación ya enlazada, no se enlaza y salta la alerta
   `stripe.negotiated_duplicate` (hay que cancelar la sobrante a mano).

### Estado de pago (mismas reglas que el cobro ordinario)

Los eventos de una suscripción negociada no pasan por la comprobación de precios del circuito ordinario (sus precios
en línea no son del catálogo enlazado: sería una discordancia) ni este toca sus partidas; y al revés, una suscripción
de un pedido nunca llega a este módulo. El efecto se calcula releyendo la suscripción y su factura en Stripe: un evento
repetido o fuera de orden no cambia nada.

| Stripe | Contratación (`commercial_terms_billing.status`) | Licencias propias (`subscription:<id>`) |
|---|---|---|
| Primer pago cobrado | `active` | Las del contrato (`licences.ts`); el pago no añade ninguna |
| Renovación cobrada | `active`; factura registrada; el periodo interno avanza | Sin cambios |
| `past_due` | `past_due`, gracia de 7 días (`GRACE_DAYS`) | Sin cambios durante la gracia |
| Gracia vencida, o `unpaid` | `suspended` | Suspendidas (solo las propias activas) |
| Cobro recuperado | `active` | Se devuelven SOLO las que suspendió el impago (no las que bloqueó un operador) |
| `cancel_at_period_end` | `cancel_scheduled` | Sin cambios hasta el fin |
| `canceled`, con fin querido (contratación terminada dentro, o fin ordenado por un operador) | `canceled`; la suscripción interna termina en el acto | Solo lectura 30 días (`READ_ONLY_DAYS`) |
| `canceled` por IMPAGO (venía de impago o suspensión, o su última factura quedó sin cobrar) | `canceled`; la suscripción interna termina | Solo lectura 30 días: nunca licencias activas sin cobro |
| `canceled` porque las condiciones terminaron sin sucesor (fin programado por la sincronización) | `canceled`; la contratación interna sigue su curso | Sin cambios |
| `canceled` SOLO en Stripe, al corriente (nadie lo pidió dentro) | `canceled` + alerta `stripe.negotiated_ended_in_stripe`; la contratación interna NO se toca | Sin cambios; una persona decide (volver a ponerla a cobrar o terminarla) |
| Reembolso total o disputa perdida del último periodo | `suspended` hasta un pago nuevo | Suspendidas |

Las licencias siguen saliendo del **contrato** (productos del acuerdo); el pago solo las suspende, las deja en solo
lectura o las devuelve. Las de otro origen (derechos adquiridos, operador, otra suscripción) no se tocan.

**Fin de la contratación:** siempre al final del periodo ya pagado; nunca hay cancelación inmediata ni abono desde
aquí. Vías: el operador (`…/terms/billing/cancel` y `…/resume`; la orden queda registrada) o cancelar la suscripción
interna (la sincronización, o la conciliación en su siguiente pasada, programa el fin en Stripe). El portal de cliente
tiene desactivadas la cancelación y el cambio de suscripción. Cada orden de fin lleva una clave de idempotencia
distinta (versión de la suscripción interna u orden del operador): una baja deshecha y vuelta a pedir el mismo día
llega a Stripe.

**Fin programado solo en Stripe** (alguien lo puso en el Dashboard; ni la contratación termina dentro ni lo ordenó un
operador): es una diferencia de conciliación (`fin_solo_en_stripe`) que se avisa. No se deshace solo (volvería a cobrar
sin que nadie lo decida) y, si Stripe llega a terminar, **no se da por terminada la contratación ni se tocan sus
licencias**: Stripe deja de cobrar, salta la alerta y un operador decide; puede volver a ponerla a cobrar (suscripción
de Stripe nueva). Es la opción que no puede ni cobrar ni cancelar por error. Mientras nadie lo resuelve, la contratación
sigue apareciendo en cada pasada de la conciliación (`terminada_solo_en_stripe`). Esto vale solo con todo al corriente:
si Stripe cancela por impago, se aplican las reglas del impago (tabla).

**Importes únicos, por contratación.** Lo ya cobrado o abonado consta por contratación, no por suscripción de Stripe:
al volver a poner a cobrar con una suscripción de Stripe nueva, ni el Checkout repite los cargos únicos ni se emite
otra vez un abono.

**Condiciones que terminan sin sucesor.** Si el acuerdo vence y la suscripción se queda sin condiciones
personalizadas vigentes, Stripe no sigue cobrando sus partidas: la conciliación programa el fin de la suscripción de
Stripe al final del periodo ya pagado y avisa (`stripe.negotiated_terms_ended`). El periodo ya cobrado no se abona. La
contratación interna y sus licencias siguen su curso (ya no dependen de ese cobro). Para seguir cobrando hace falta un
acuerdo sucesor antes de la fecha.

**Envíos que fallan.** Un envío que falla se reintenta solo cada vez más espaciado (15 min, 1 h, 4 h, 16 h y después
una vez al día), deja UN evento en el historial por error distinto y cuenta como diferencia (`sincronización_fallida`)
en cada pasada hasta que se resuelva.

**Reloj.** Una vez enlazada, manda el reloj de Stripe: el periodo de la suscripción interna pasa a ser el que Stripe
está cobrando y lo sigue en cada evento (no hay deriva; un fin programado dentro termina con el periodo de Stripe).
Qué se cobra según cuándo se ponga a cobrar:

| Cuándo se pone a cobrar | Qué pasa |
|---|---|
| Con el acuerdo ya en vigor | El cliente paga al completar la página: primer periodo COMPLETO desde ese momento. **Si paga unos días después del inicio del acuerdo, esos días no se cobran** y el ciclo (interno y de Stripe) queda anclado al día del pago. |
| Antes del inicio, con más de 48 h | El cliente autoriza ya su método de pago (factura de 0) y **el primer cargo es el día del inicio**, por el periodo completo, con los cargos y abonos únicos de esa fecha. Ciclo anclado al inicio del acuerdo (`subscription_data.trial_end`). |
| Antes del inicio, con menos de 48 h | Se rechaza con la fecha (Stripe no admite aplazar con tan poco margen): se pone a cobrar al llegar el inicio. |

Un acuerdo activado con inicio futuro consta guardado como «programado»; lo que cuenta es su estado efectivo en la fecha.

**Fechas de corte.** Cuando lo pactado cambia por una FECHA (termina una condición temporal, empieza un acuerdo
programado, vence un cargo único) o el último envío falló, la conciliación periódica (cada 15 minutos con el worker de
Stripe) lo deja en Stripe sola: solo para suscripciones enlazadas y con el interruptor encendido, y solo envía lo que
rige DENTRO. Lo que alguien cambie en Stripe a mano nunca se corrige solo: se avisa.

**Cambios ordinarios.** Una suscripción con acuerdo no admite los cambios de la ficha (plan, añadir o retirar
partidas): se cambia desde el acuerdo, y Stripe no se toca por esa vía. Un pedido ordinario de esa empresa sería OTRA
suscripción (interna y de Stripe), con el mismo Customer; nunca modifica la negociada.

**Interruptor apagado con suscripciones ya enlazadas** (`stripeBilling: "off_with_linked"` en el arranque): no se
inicia ningún cobro ni se envía ningún cambio de condiciones, pero Stripe SIGUE cobrando lo enlazado. Siguen
funcionando: los webhooks (estado de pago y licencias), la conciliación (sigue comparando y avisando) y el FIN (una
cancelación interna o la orden de un operador siguen llegando a Stripe; deshacer un fin exige el interruptor). **Para
dejar de cobrar a un cliente hay que programar el fin de SU suscripción**, no apagar el interruptor.

Mientras la contratación está `pending` (sesión abierta, sin cobro) no se toca ninguna licencia: siguen como las dejó
el contrato. Es el mismo riesgo asumido que con la facturación en simulación.

### Acuerdos sin plan Core (solo partidas a medida, sin plataforma ni licencias)

Requisito del propietario (11/11/2026): un acuerdo formado solo por partidas económicas a medida, sin plan de Elephant
Core, sin plataforma (tenant) y sin licencias, se cobra entero por Stripe: al empezar y en cada renovación. Caso de
referencia: una partida recurrente de **44,63 € netos + 21 % = 54,00 € al mes**, y nada más.

El cobro no depende de que exista un plan: **todo cuelga de la EMPRESA y de la suscripción interna (su acuerdo)**.

- **Sin catálogo.** La partida viaja como precio en línea sobre el Product genérico de servicios a medida; no hace
  falta ningún Product ni Price de catálogo enlazado, y en ningún punto se supone una partida de plan (sesión de pago,
  `current()`, conciliación, estado).
- **Sin plataforma.** El Customer de Stripe es el de la empresa (`stripe_customers.tenant_id` queda NULL); los metadatos
  de la sesión y de la suscripción llevan la empresa, la suscripción interna y el acuerdo, nunca un tenant. Los
  webhooks de estas suscripciones no pasan por el circuito de pedidos (que es el que busca plataforma): no hay avisos
  de «empresa desconocida» ni eventos descartados.
- **Sin licencias ni altas.** El cobro no concede nada: no llama al registro de licencias, ni a la aplicación de
  licencias de los acuerdos, ni al aprovisionamiento, ni escribe límites. Sin plataforma, las reglas de «las licencias
  siguen al pago» no tienen nada que tocar y no fallan: el impago solo cambia el estado contractual de la contratación
  (`past_due` → `suspended` → `active`, o `canceled`), que queda en el historial del acuerdo.
- **Importe.** A Stripe se envía **4463 céntimos, sin impuestos incluidos (`tax_behavior=exclusive`), mensual, cantidad
  1**, con `automatic_tax`. El impuesto (9,37 €) y el total (54,00 €) **los calcula Stripe Tax**, no se envían. Cada
  factura cobrada se contrasta con lo pactado: la base tiene que ser exactamente la esperada (el primer pago ofrecido,
  o la cuota vigente más los importes únicos de esa factura) y, con un único tipo pactado, el impuesto y el total
  exactamente los del acuerdo (base × tipo, redondeado una vez). Un céntimo de diferencia se guarda como
  `amount_mismatch` o `tax_mismatch` en `commercial_terms_billing_invoices.tax_check`, abre su alerta y aparece en la
  conciliación como diferencia de tipo `invoice` hasta que una factura posterior salga bien.
- **Primer periodo.** La sesión no lleva periodo de prueba, ni ancla de ciclo, ni prorrateo: la suscripción de Stripe
  empieza cuando el cliente completa el pago, con un primer periodo COMPLETO y sin línea de prorrateo. Si se pone a
  cobrar antes del inicio del acuerdo (con más de 48 h), el primer cargo es el día del inicio; si se pone después, el
  ciclo empieza el día en que el cliente paga y los días entre el inicio y el pago no se cobran (ver «Reloj»).

**Secuencia exacta** (los pasos 1–3 ya existían; el cobro empieza en el 4):

1. El administrador prepara el acuerdo (solo partidas a medida) y lo envía a aceptación
   (`POST /commercial-terms/:id/acceptance`).
2. El cliente lo acepta en la página pública: se firma el contrato y se activan las condiciones (se crea la
   suscripción interna, sin plataforma). Aquí todavía no se cobra nada.
3. Con el interruptor encendido, `GET /subscriptions/:id/terms/billing/stripe` dice `canStart: true`.
4. El administrador pulsa «poner a cobrar» (`POST …/terms/billing/start`): se resuelve o crea el Customer de la
   empresa y se abre la sesión de Checkout. La respuesta trae la `url`.
5. El administrador entrega la `url` al cliente (hoy a mano; no se envía sola). El cliente pone y autoriza su método de
   pago en la página alojada por Stripe y paga el primer periodo (44,63 € + el impuesto que calcule Stripe).
6. Stripe emite `checkout.session.completed`, `customer.subscription.created` e `invoice.paid`: el webhook de siempre
   enlaza la suscripción de Stripe con la interna, registra la factura y deja la contratación `active`.
7. Cada mes Stripe renueva y cobra solo; cada `invoice.paid` registra la factura y avanza el periodo interno. Un cobro
   fallido sigue los reintentos de Stripe y las reglas de estado de arriba.

Pruebas: `T` «acuerdos sin plan Core…» (4 pruebas) y `G` «acuerdo sin plan: UNA partida a medida de 44,63 €…». La regla
que hoy impide activar un acuerdo sin plan Core la retira otra rama (`feat/condiciones-sin-core`); el cobro no depende
de ella y las pruebas simulan su resultado.

Solo se puede confirmar con Stripe real: que Stripe Tax da 9,37 € para ese cliente (depende de su dirección, de su
NIF y del código fiscal del Product genérico) y cómo redondea con varias líneas en una factura (por línea o por
factura: con una sola línea no hay diferencia).

### Conciliación

- `GET /subscriptions/:id/terms/billing`: compara lo que rige hoy con lo que Stripe tiene: partidas, importes,
  periodicidad, moneda, importes únicos vencidos, modo de impuesto y estado (fin sin programar, cancelada en Stripe).
- La conciliación periódica de Stripe (`StripeReconciler`, `POST /stripe/reconcile`) relee las suscripciones
  negociadas (pagos no aplicados, gracia vencida), cierra sus sesiones caducadas y compara todas las enlazadas. El
  resultado va en `negotiated` (comparadas, con diferencias, errores) y queda en `stripe_sync_state`
  (`terms_billing_reconcile`). Una diferencia abre la alerta `stripe.negotiated_drift`; **nunca se corrige sola**
  (salvo programar el fin): la corrige un operador al sincronizar.
- Alertas nuevas (`server/stripe/alerts.ts`): `stripe.negotiated_drift`, `stripe.negotiated_duplicate`,
  `stripe.negotiated_invoice_mismatch` (la base de una factura no es la pactada) y `stripe.negotiated_tax_mismatch`.

### Permisos de la clave restringida

Lo que el adaptador llama y el permiso que le corresponde. La columna «documentado» es lo que
`STRIPE_FASE_A.md` §5 dice que tiene la clave; **no se ha comprobado contra la clave real** (no se ha hecho ninguna
llamada a Stripe).

| Llamada | Para qué | Permiso | ¿Documentado en §5? |
|---|---|---|---|
| `POST /v1/customers`, `GET /v1/customers/:id` | Customer de la empresa (solo si no tiene) | `customer_write` | Sí |
| `POST /v1/checkout/sessions` (con `price_data`), `GET`, `expire`, listado por cliente | Sesión de pago | `checkout_session_write` | Sí. **Por comprobar:** si crear precios en línea (`price_data`) exige además escritura de Prices (`plan_write`) |
| `GET /v1/products/:id` | Product genérico de partidas a medida | `product_read` | Sí |
| `GET /v1/subscriptions/:id` | Leer partidas y estado | `subscription_read` | Sí |
| `GET /v1/subscription_items?subscription=`, `POST /v1/subscription_items/:id` (solo metadatos) | Leer todas las partidas (más de 10) y ponerles su clave | `subscription_read` / `subscription_write` | Lectura sí; escritura **no** |
| `POST /v1/subscriptions/:id` | Sustituir partidas (`price_data`), programar el fin | `subscription_write` | **No** (§5 lo excluye expresamente). El código de compras y de cancelación de autoservicio ya usa esta llamada: puede que la clave real ya lo tenga |
| `POST /v1/invoiceitems` | Importes únicos y abonos | Escritura de Invoices (`invoice_write`) | **No** (§5 solo da lectura) |
| `GET /v1/invoiceitems?customer=` | Buscar un importe único por su clave | Lectura de Invoices | Sí (`invoice_read`), por comprobar que cubre los invoice items |
| `GET /v1/invoices/:id`, `GET /v1/charges/:id`, `GET /v1/events` | Webhooks y conciliación | Lecturas ya usadas | Sí |

Si falta un permiso, Stripe responde 403: la puesta en cobro o la sincronización fallan con el error a la vista
(`sync_status = failed`) y no queda nada a medias que se cobre dos veces.

### Procedimiento para encenderlo (propietario)

1. Publicar por el procedimiento habitual y aplicar la migración `0049` del CRM.
2. Revisar los permisos de la clave restringida (tabla anterior) y añadir los que falten: `subscription_write`,
   escritura de Invoices y, si Stripe lo pide, `plan_write`.
3. Si se van a cobrar partidas a medida o cargos únicos: crear en Stripe el Product genérico (nombre visible en la
   factura, con su código fiscal de Stripe Tax). Si se crea por API con el id `es_terms_custom_service` no hace falta
   nada más; si se crea en el Dashboard, poner su id en `CP_CUSTOM_TERMS_STRIPE_PRODUCT`.
4. Comprobar que los productos de catálogo de los acuerdos tienen su Product enlazado (`stripe_prices`).
5. Encender `CP_CUSTOM_TERMS_BILLING_ENABLED=1` (operación protegida) y comprobar la línea de arranque:
   `stripeBilling: "on"`, `stripeBillingMode: "live"`.
6. Primera contratación real, acompañada: poner a cobrar UNA suscripción, revisar la sesión antes de entregarla,
   comprobar tras el pago el enlace, la primera factura (`tax_check`), `GET …/terms/billing` (`consistent: true`) y,
   en la primera renovación, el importe y el impuesto.
7. Para parar: apagar el interruptor impide iniciar cobros y enviar cambios, pero **no deja de cobrar** lo ya enlazado
   (ver «Interruptor apagado con suscripciones ya enlazadas»). Para dejar de cobrar a un cliente: programar el fin de su
   suscripción (`…/terms/billing/cancel`, permitido también con el interruptor apagado).

### Validación supervisada antes de encender

Ninguna prueba de este repositorio llama a Stripe. Antes del primer cobro real, y antes en modo pruebas de Stripe (con
reloj de pruebas), hay que recorrer esta lista, tomada de las dos revisiones independientes:

1. Checkout acepta `price_data` con `product` existente + `recurring` + `tax_behavior=exclusive` + `automatic_tax` con
   un cliente existente y solo tarjeta, y **la clave restringida tiene los permisos** (tabla de arriba): hoy constan
   `customer_write`, `checkout_session_write`, `subscription_read`, `invoice_read`, `plan_read`, `product_read`,
   `event_read`, `charge_read`, `dispute_read`; faltan por documentación `subscription_write` (sustituir partidas,
   poner claves, programar el fin) y escritura de Invoices (importes únicos), y quizá `plan_write` (precios en línea).
2. `subscription_data.metadata` llega a la suscripción (`es_negotiated`, `es_terms_subscription`, `es_company_id`,
   `es_env`): sin ello ningún webhook la enlaza.
3. Tras el primer pago, poner la clave a las partidas (cambio de solo metadatos) no genera factura ni cargo ni mueve
   `current_period_end`; y una sustitución real de una partida con `proration_behavior=none` tampoco, también con el
   modo de facturación por defecto de la versión de API en uso.
4. Stripe Tax da 9,37 € (total 54,00 €) para ese cliente con la dirección y el NIF que él mismo introduce en Checkout
   (puede cambiarlos) y con el código fiscal del Product genérico.
5. Primera renovación: base 4463, impuesto 937, `tax_check = ok`, periodo interno igual al de Stripe, sin alertas.
6. Un abono enviado como importe único negativo con `tax_behavior=exclusive` entra en la segunda factura de ESA
   suscripción y reduce base e impuesto.
7. Impago real: `past_due` → gracia de 7 días → suspensión en la pasada de conciliación; recuperación; `unpaid` o
   `canceled` según la configuración de reintentos de la cuenta.
8. Reembolso total de la última factura desde el Dashboard → suspensión; y baja programada → `cancel_at_period_end`
   sin cargo ni abono.
9. Qué permite el portal de cliente de Stripe sobre esta suscripción (comparte Customer con el circuito ordinario).

Además: el cobro en pausa (`pause_collection` con `behavior=void`: que no cobre nada mientras dura, que la suscripción
siga `active` y que al quitarla no reinicie el ciclo ni cobre lo pausado), y el primer cargo aplazado (`trial_end` en la fecha de inicio, con más de 48 h): factura de
0 al autorizar, primer cargo completo ese día con los importes únicos, y periodo anclado a esa fecha.

### Verificado y pendiente de validar con Stripe real

**Verificado con dobles** (sin red): lo descrito arriba; ver la tabla de pruebas (`T`, `G`, `H`, `N`).

**No verificado contra Stripe real** (no se ha hecho ninguna llamada):

- Que la API (versión `2026-09-30.endive`) acepte exactamente estos parámetros: `price_data` con `product` existente
  y `recurring` en Checkout y en `POST /v1/subscriptions/:id`; `tax_behavior` en `/v1/invoiceitems`; importes
  negativos en invoice items con Stripe Tax.
- Que sustituir partidas con `proration_behavior=none` no genere factura ni mueva el ciclo de cobro.
- Que Stripe Tax calcule el tipo pactado para cada cliente (depende de su dirección, su NIF y el código fiscal de
  cada Product). La comprobación por factura lo detecta después de cobrar, no antes.
- Los permisos reales de la clave.
- Checkout con cliente ya existente: recogida de dirección y NIF (`customer_update`), y métodos de pago asíncronos.
- El portal de cliente de Stripe frente a una suscripción con precios en línea (qué deja cambiar).

### Limitaciones y riesgos abiertos

- **Nombre en la factura de Stripe:** las partidas a medida y los cargos del primer pago salen con el nombre del
  Product genérico (una partida de suscripción no admite descripción propia). Los importes únicos posteriores sí
  llevan su nombre. Alternativa (un Product por servicio) pendiente de decisión.
- **Cambio a mitad de periodo:** la simulación factura la diferencia hasta el fin del periodo; Stripe, con
  `proration_behavior=none`, aplica el importe nuevo desde la renovación y no cobra esa diferencia. Si el contrato la
  exige, hay que enviarla como importe único (no implementado).
- **Cambio de periodicidad** de una suscripción ya enlazada: no se aplica solo (reiniciaría el ciclo de cobro en
  Stripe); la sincronización queda en `failed` con el motivo.
- **Abono de un solo uso al empezar a cobrar:** va a la segunda factura, no a la primera.
- **Fechas de corte**: las aplica la conciliación periódica (hasta 15 minutos después de la fecha, con el worker de
  Stripe encendido). Si una renovación cayera en ese margen, se cobraría lo anterior y saltaría `amount_mismatch`.
- **Huecos de la conciliación.** Se detectan: partidas, importes, periodicidad, moneda, importes únicos, modo de
  impuesto, fin sin programar, fin solo en Stripe, cancelada en Stripe, cupón, cobro en pausa, cobro no automático,
  periodo sin cargo inesperado y, por factura, base, impuesto, total y cobrado distinto del total (saldo a favor o cobro
  fuera de Stripe). NO se detectan: un Product distinto con el mismo importe (cambiaría el código fiscal; se vería en el
  impuesto de la factura), un calendario (`schedule`) puesto a mano, y los cargos únicos del primer pago, que se dan por
  cobrados por la oferta de la sesión (contrastada con la base de la primera factura), no por una lectura propia.
- Una segunda suscripción de Stripe para la misma contratación solo se avisa; cancelarla es manual.
- Un abono pendiente se pierde si la suscripción termina antes de la siguiente factura.
- Solo se miran las 100 últimas sesiones de Checkout del cliente al buscar sesiones huérfanas.
- **Documento fiscal propio:** las facturas de estas suscripciones se registran en `commercial_terms_billing_invoices`
  pero no entran en la cola de documentos fiscales del circuito ordinario (va ligada a pedidos).
- **Reembolsos parciales y disputas abiertas:** solo avisan (como en el circuito ordinario).
- **Licencias nuevas durante una suspensión:** si se activa un acuerdo que añade un producto mientras la contratación
  está suspendida por impago, la capacidad nueva nace activa (la aplicación de licencias no conoce el estado de pago).
- El Checkout usa el Customer de la empresa con actualización de dirección: si esa empresa tiene además una suscripción
  ordinaria, un cambio de dirección en la página afecta al impuesto de sus facturas ordinarias siguientes (igual que en
  el Checkout ordinario de un cliente existente).

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
| `POST /subscriptions/:id/terms/billing/sync` | Deja en Stripe lo que la suscripción tiene hoy (sin los cerrojos no hace nada) |
| `GET /subscriptions/:id/terms/billing/stripe` | Estado del cobro en Stripe: si se puede poner a cobrar y qué lo impide, sesión de pago, estado, gracia, fin programado y facturas |
| `POST /subscriptions/:id/terms/billing/start` | Pone a cobrar la suscripción: abre (o reutiliza) la sesión de pago de Stripe para el cliente. Idempotente |
| `POST /subscriptions/:id/terms/billing/cancel` y `/resume` | Programa el fin de la suscripción de Stripe al final del periodo pagado, o lo deshace |

Las cuatro rutas de `…/terms/billing/…` de Stripe solo existen donde Stripe está montado con la migración `0049`.
Consultar pide `subscriptions:read`; las acciones, el permiso de precios personalizados y sesión de persona. Códigos:
409 `disabled` (interruptor apagado), 409 `invalid_state` (con el motivo), 409 `conflict` (otra puesta en cobro en
curso), 503 `unavailable` (falta algo en Stripe: Product, política fiscal, elegibilidad), 502 `stripe_error`.

Respuesta de `start`: `{ status: "pending", sessionId, url, expiresAt, reused, currency, recurringCents,
firstChargeCents, taxTreatment, deferredCredits[] }` (la `url` es la página de pago que se entrega al cliente),
`{ status: "processing", message }` (el cliente ya completó la página y falta la confirmación del cobro) o
`{ status: "linked", stripeSubscriptionId, state }`.

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

Cobro en Stripe con la pasarela real (fase 4), siempre sin red ni claves: `T` = `server/subscriptionsTerms.stripe.test.ts`
(cerrojos, puesta en cobro sin duplicados, enlace por webhook, estado de pago, licencias, acuerdos sin plan Core, conciliación e idempotencia, con
el procesador de webhooks y la conciliación reales), `G` = `server/stripe/gateway.negotiated.test.ts` (qué se envía a
Stripe, con el SDK contra un servidor local), `H` = `server/controlPlane.termsStripeBilling.test.ts` (por HTTP con la
aplicación real: interruptor, permisos, webhook firmado) y `N` = `server/subscriptionsTerms.stripe.mysql.test.ts`
(migración 0049 y recorrido con MySQL real).

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
| 23. Renovación con precio negociado | S «Caso 23»; M «la activación materializa…»; B «Caso 23 — Stripe recibe exactamente lo que factura la simulación»; T «renovación cobrada: factura registrada y el periodo interno avanza» y «un acuerdo nuevo sustituye las partidas en línea sin prorrateo» |
| 24. Impuestos de partidas diferentes | C «Caso 24»; B «Caso 24 — cada concepto viaja con su tipo de impuesto» (tipos fijos, con el doble); T «con Stripe Tax no hay tipo fijo por partida…» (política live: el tipo lo calcula Stripe y se contrasta en cada factura) |
| 25. Idempotencia de cobros | S «Caso 23 … Caso 25» (simulación); B «Caso 25 — idempotencia de cobros y recuperación ante fallos» (3 pruebas, con el doble de Stripe); T «conciliación e idempotencia» (5 pruebas, con la pasarela real: repetir, dos a la vez, fallo parcial con las claves de Stripe caducadas, Stripe caído) y «un webhook repetido o fuera de orden no cambia nada»; N «recorrido completo con almacenes reales». Pendiente: validarlo con Stripe real |
| 26. Concurrencia de modificaciones | S «Caso 26» y «dos ediciones del mismo borrador»; M «dos administradores desde conexiones distintas» |
| 27. Conservación de licencias | S «Caso 27»; A «Casos 27 y 28»; L «Caso 27 — el paquete de 129 € concede exactamente las licencias de sus tres productos» y «el precio no interviene» |
| 28. Conservación de derechos adquiridos | A «Casos 27 y 28»; L «Caso 28 — los derechos adquiridos y las licencias de otro origen no se tocan» |
| 29. Aislamiento entre tenants | S «Caso 29»; A «Caso 29» y «una empresa no puede leer ni modificar sus precios negociados» |
| 30. Actualización posterior del catálogo sin pérdida del precio negociado | S «Caso 13 … Caso 30» |

**Caso final del propietario** (Essential + Hotel Net + WhatsApp Connect por 129 €/mes + IVA, desde el CRM, con
licencias y facturación simulada coherentes): A «caso final — Essential + Hotel Net + WhatsApp Connect por 129 €/mes + IVA»
y, con contrato y aceptación del cliente, A «Caso 22».
