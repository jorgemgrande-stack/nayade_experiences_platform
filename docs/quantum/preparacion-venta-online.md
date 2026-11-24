# Quantum Soulrise: preparación para venta online (Stripe Connect)

Estado: documento técnico, 23/11/2026. **No cambia ningún dato de catálogo.** Los cobros reales siguen desactivados (Stripe Connect solo en modo Prueba) y ningún producto cambia de modalidad: todos siguen en «Precio visible, solo por solicitud» (`priced_request`).

## 1. Qué se ha construido

- **Comprobador** `shared/saleReadiness.ts` (puro y determinista, con pruebas en `server/saleReadiness.test.ts`). Dado un producto, sus variantes, sus convocatorias y las reglas de la empresa devuelve comprobaciones `ok` / `warning` / `blocker`, cada una marcada como **técnica** o **comercial**, y dos resultados separados:
  - `verdict`: «técnicamente preparado» (ningún bloqueo técnico) o «faltan datos».
  - `commercialPending`: lo que decide la Dirección o Quantum y sigue abierto.
- **Panel de administrador** «Preparación para venta online» en la edición de cada producto (`ExperiencesManager`), en español y alemán (`shared/i18n/locales/{es,de}/saleReadiness.ts`). Solo informa.
- **Guarda del servidor** (`products.update`): al pasar un producto a «Precio fijo» **desde otra modalidad**, se rechaza con un mensaje claro si hay bloqueos; si solo hay avisos, exige la confirmación explícita del administrador (`confirmReadiness`). No afecta a productos que ya son de precio fijo ni a su edición ordinaria (Náyade, Skicenter…). La creación de un producto nuevo (que nace en precio fijo) no pasa por la guarda.

Qué se comprueba: precio base o de variantes positivo y coherente (un precio base 0 con variantes de pago **no** es gratuito: bloquea si ninguna variante es obligatoria); variantes a 0 € o caducadas; moneda; IVA y régimen fiscal; mínimo y máximo de participantes y precio por unidad; ubicación; fechas, convocatorias y plazas; política de cancelación/devolución (`site_settings.cancellation_policy`); datos que se recogen del participante; qué recibe el cliente tras pagar; y cuenta Connect verificada con el interruptor de cobros en línea encendido (o, en su defecto, la pasarela Redsys configurada).

## 2. Resultado por producto

Evaluación **sobre los datos del encargo** (modalidad `priced_request`, IVA 21 % general, EUR), no sobre la base de datos de producción: el veredicto vivo de cada producto lo da el panel al abrirlo. «Pendiente» = no consta en los datos recibidos; no se ha inventado nada.

| Id | Producto | Precio (EUR) | Variantes | Modalidad preparada | Estado técnico (precio, IVA, moneda) | Datos comerciales pendientes | Bloqueos / avisos |
|---|---|---|---|---|---|---|---|
| 1 | RECONNECT | base 555 | 6 (111 a 777) | Precio fijo (hoy `priced_request`) | Coherente. | Fechas y plazas (si aplican): pendiente. Cancelación/devolución: pendiente. Datos de cada participante: pendiente. Entrega tras pagar (matrícula LMS): pendiente de confirmar. | Aviso: sin variante obligatoria se compra al precio base 555. Aviso: obligatoriedad de variantes no consta. |
| 2 | Healer Activation | base 1444 | Basis 1444 / Premium 2222 | Precio fijo | Coherente. | Fechas, plazas, cancelación, datos de participante, entrega: pendiente. | Bloqueo si el producto necesita fechas y no hay convocatoria abierta. |
| 3 | Healer Mastery | base no indicada | Basis 2444 / Premium 2888 | Precio fijo | Coherente si ambas variantes son obligatorias o hay precio base; **con base 0 y sin variante obligatoria bloquea**. | Fechas, plazas, cancelación, datos de participante, entrega: pendiente. | Bloqueo condicionado al precio base (pendiente). |
| 4 | Healer Initiation | 1888 | ninguna | Precio fijo | Coherente. | Fecha por anunciar («Oktober 2027»): sin convocatoria no hay venta. Plazas, cancelación, datos de participante, entrega: pendiente. | **Bloqueo comercial**: sin fecha ni convocatoria. |
| 24 | Morning Impulse | 49 | ninguna | Precio fijo | Coherente. | Si tiene fecha o sesión, plazas, cancelación, entrega: pendiente. | Sin bloqueos técnicos conocidos. |
| 26 | Retiro Atlántico (ficha 1) | individual 1290; ab 2 Teilnehmenden 1190 por persona | tarifa por nº de participantes: forma de modelarla pendiente | Precio fijo | Precio coherente; **la tarifa por número de participantes no se aplica sola** (ver 3.1). | Fechas, plazas, ubicación exacta, cancelación, datos de cada participante, entrega (reserva): pendiente. | **Bloqueo comercial**: sin convocatorias. Aviso: tarifa por nº de personas. |
| 27 | Retiro Atlántico (ficha 2) | 1290 / 1190 | ídem | Precio fijo | ídem | ídem | ídem |
| 28 | Retiro Atlántico (ficha 3) | 1290 / 1190 | ídem | Precio fijo | ídem | ídem | ídem |
| 29 | Seelenweg | base 990 | 4 (990, 890, 1390, 1190) | Precio fijo | Coherente. | Fechas, plazas, cancelación, datos de participante, entrega: pendiente. | Bloqueo comercial si no hay convocatoria abierta. Aviso: variante opcional. |
| 30 | Natur Retreat | base 990 | 4 (990, 890, 1190, 1090) | Precio fijo | Coherente. | ídem | ídem |
| 31 | Wildnis | base 99 | 4 (111, 99, 490, 430) | Precio fijo | Coherente. | ídem | ídem |
| 32 | Naturtag | 144 / 244 | 2 | Precio fijo | Coherente (base no indicada: igual que el producto 3). | ídem | Bloqueo condicionado al precio base (pendiente). |

Pendientes **comunes** a los doce (decisión de Dirección/Quantum): política de cancelación y devolución (no hay ninguna publicada en los datos recibidos), fechas y plazas de cada convocatoria, datos que se piden a cada participante (hoy el pedido solo recoge nombre, correo y teléfono de quien compra), qué recibe la persona al pagar (reserva o matrícula) y quién lo concede, y la autorización de Dirección para cada paso a precio fijo.

Pendientes **técnicos** comunes: cuenta Connect de Quantum verificada y con el interruptor de cobros en línea encendido (hoy solo modo Prueba, que el panel avisa) y que el carrito no descuenta plazas de las convocatorias (ver 3.1).

## 3. Notas

### 3.1 Tarifa por número de participantes
El pedido cobra `precio por persona × personas` con **un único precio por persona** (más variantes). «Individual 1290 / desde 2 personas 1190 por persona» no se aplica automáticamente por número: si se modela como dos variantes, quien compre para 3 personas podría elegir «individual». Opciones, a decidir por Dirección: dos variantes con máximo de participantes por compra acorde, o una regla de precios por cantidad (el servidor ya admite reglas de la empresa en el cálculo del precio). No se ha implementado nada.

### 3.2 Plazas
El carrito reserva por fecha elegida y **no consta** que descuente plazas de las convocatorias (`edition_enrollments`). El comprobador lo señala como aviso técnico en todo producto con convocatorias: hay que verificar o controlar el aforo a mano antes de vender.

### 3.3 Cómo pasar un producto a compra directa
Cuando Dirección autorice y los bloqueos estén resueltos: Administrador > Productos > editar > modalidad «Precio fijo»; el panel pide marcar la confirmación si quedan avisos. El servidor lo vuelve a comprobar. Los cobros reales siguen exigiendo su propia autorización (modo Real).

## 4. Estudio: anticipo o reserva (solo diagnóstico, sin implementar)

**Pregunta:** ¿puede Core cobrar solo un anticipo y el resto más tarde, con Stripe Connect?

**Lo que existe**
- **Abonos parciales (`server/abonosParciales*.test.ts`, `invoiceCalc`)**: son **notas de abono (rectificativas) parciales** de facturas. No tienen relación con cobrar un anticipo.
- **Planes de pago fraccionado** (`payment_plans`, `payment_installments`, `quotes.payment_plan_id`): un presupuesto puede tener un plan de cuotas, con cuotas «obligatorias para confirmar» (`isRequiredForConfirmation`), recordatorios y confirmación de la reserva al pagar las obligatorias (`checkAndConfirmInstallmentPlan` en `server/routers/crm.ts`). Cada cuota se cobra por **Redsys** con su propio pedido (prueba E2E: `server/cuotasEnlacePago.e2e.mysql.test.ts`) o a mano.
- **Stripe Connect** (`server/paymentsConnect`): `startQuoteCheckout` cobra el total del presupuesto en un pago único y **rechaza** los presupuestos con plan de pagos (`unsupported_quote`: «el cobro por cuotas con Stripe aún no está disponible»). `startShopCheckout` (carrito) también cobra el pedido entero.
- Otros depósitos existentes son específicos (fianzas de alquiler de esquí, `skiRentalDeposits`; depósito por comensal de restaurantes) y no son un anticipo genérico.

**Cómo se activaría (propuesta, sin construir un segundo motor)**
1. Reutilizar el plan de pagos que ya existe: la reserva de un producto de Quantum se prepara como presupuesto con plan de dos cuotas (anticipo obligatorio + resto).
2. Hacer que `startQuoteCheckout` acepte planes: crear la sesión de Stripe por el importe de **una cuota** (la primera pendiente), con `metadata.installment_id`, y marcar esa cuota como pagada en el manejador de eventos (`handleConnectEvent`), llamando a `checkAndConfirmInstallmentPlan` como ya hace Redsys.
3. Dejar el resto a las cuotas posteriores por el mismo enlace del presupuesto (el E2E de cuotas por enlace ya cubre el patrón con Redsys).

**Qué falta**
- Soporte de cuotas en el servicio de Stripe Connect (punto 2), con su idempotencia por cuota y la comprobación de importe (`amount_mismatch`) por cuota y no por presupuesto.
- Que el carrito público (producto a precio fijo) pueda terminar en presupuesto con plan, o un producto «con anticipo» que lo genere: hoy el carrito no admite planes.
- Decisión comercial: importe o porcentaje del anticipo, fecha límite del resto, devolución del anticipo ante cancelación (depende de la política de cancelación, aún pendiente) y facturación (anticipo con su IVA, factura final).
- Pruebas con MySQL y cuenta en modo Prueba antes de cualquier uso real.

**Conclusión:** hay soporte seguro para planes de cuotas con Redsys y para pago único con Stripe Connect; **no** hay hoy cobro de anticipo con Stripe Connect. Es un cambio acotado sobre un motor existente (tarea para la ventana responsable de Stripe/cobros), no un motor nuevo. Hasta entonces, un anticipo se gestiona fuera del cobro online (solicitud + presupuesto con plan por los medios actuales).
