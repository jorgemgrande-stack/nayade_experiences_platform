# Quantum Soulrise: Módulo 1 incluido en retiros y activación voluntaria

Estado: 26/11/2026. Decisión definitiva de Indira. **No activa ventas ni cobros.** Las reglas se crean inactivas.

## Condición comercial
El Módulo 1 de RECONNECT está incluido **solo en los retiros de seis días o más**. El acceso dura **30 días**. Cada participante decide cuándo empezar (antes, durante o después del retiro) y los 30 días cuentan desde que lo **activa**. No hay fecha automática ni vencimiento previo.

## Retiros y opciones que lo incluyen
| Producto | Opciones | ¿Incluye? |
|---|---|---|
| 26 Seelenreise, 27 Natur & Outdoor, 28 Neujahr | Einzel-Retreat · 6 Tage (15, 17, 19) y Ab 2 Teilnehmenden · 6 Tage (16, 18, 20) | **Sí** |
| 29 Seelenweg | 6 Tage Intensiv Retreat, individual y en grupo (23, 24) | **Sí** |
| 29 Seelenweg | 4 Tage Retreat (21, 22) | No |
| 30 Natur Retreat | 3–4 Tage (25, 26) | No |
| 30 Natur Retreat | 5–6 Tage (27, 28) | **Pendiente de Indira**: «5–6 días» no dice si son seis |
| 31 Wildnis, 32 Naturtag | 1 y 2 días (29–34) | No |

El módulo no se asigna por llamarse «retiro»: la regla va por opción.

## Cómo funciona
- La regla de acceso tiene la marca **activación voluntaria** (migración 0092): al confirmarse el pago (o al verificarlo la administración) se concede un derecho **pendiente de activar**, sin ventana ni fecha, y el alumno no accede todavía.
- En su área privada ve «Pendiente de activar», una explicación y un botón con confirmación en dos pasos. Al confirmar, los 30 días empiezan en ese instante exacto.
- Solo el titular activa; repetir o hacer doble clic no mueve la ventana; una matrícula revocada o suspendida no se activa; el progreso y el historial se conservan (evento «activated»).
- Un reembolso total o una disputa perdida revoca el derecho aunque siga pendiente; una disputa abierta lo suspende.
- Los derechos pendientes no caducan solos.

## Dónde está cada cosa
Rama de reglas, activación y aula en el Core; las reglas del tenant se crean tras publicar el código, inactivas.

## Retiros sin convocatoria: circuito general (sin concesiones manuales habituales)
1. **Solicitud** del retiro (con la opción elegida y, en su caso, la fecha deseada) → el equipo **confirma la disponibilidad** y emite el **presupuesto** (con la fecha confirmada). Solo el equipo emite el presupuesto: ese es el paso de confirmación previa.
2. **Pago**: pasarela autenticada o cobro manual verificado. El presupuesto queda pagado.
3. **Derecho automático**: un barrido por empresa (cada 10 min) y, a demanda, `learning.admin.grantForQuote` leen los presupuestos pagados con solicitud de un producto con regla de acceso activa y crean el derecho **pendiente de activar**. Clave de idempotencia por presupuesto + regla + persona: reintentos y barridos no duplican; no se duplica lo que ya concede una inscripción a convocatoria o un pedido de tienda del mismo presupuesto.
4. La persona **activa** desde su área privada y los 30 días empiezan ahí.

### Duración variable («5–6 días»)
La regla de la opción de duración variable lleva **días mínimos contratados = 6**. Sin duración **confirmada** (o con menos de 6) el barrido jamás concede: el presupuesto aparece en «Retiros pagados sin acceso» y la administración confirma los días acordados (`learning.admin.confirmContractedDays`, con motivo, queda registrado). Solo si alcanzan el mínimo se concede el derecho. Una reserva de cinco días nunca recibe el módulo. Las opciones de duración fija («6 Tage») no necesitan confirmación: la propia opción lo dice.

### Límites conocidos
- Un derecho por presupuesto pagado: los acompañantes de una reserva «desde 2» no tienen derecho propio hasta que existan sus datos de participante (pendiente de la decisión de datos de viajeros).
- El reembolso de un presupuesto no tiene aún enlace automático con el derecho (la administración lo revoca desde Formación); el de pedidos de tienda sí.
- Confirmar la disponibilidad es un paso humano previo al presupuesto; el sistema no la inventa ni la deduce.
