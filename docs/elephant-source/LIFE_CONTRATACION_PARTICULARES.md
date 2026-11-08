# Plan personal Life: contratación de particulares (borrador para revisión)

**Fecha:** 08/11/2026 · **Estado:** preparado y APAGADO. Nada de lo que describe este documento cobra, factura ni da de alta hogares hoy. Los textos son una propuesta para que Jorge y el asesor legal y fiscal los revisen antes de abrir la venta.

**Decisiones de Jorge del 08/11/2026 que aplica:** J1 plan personal independiente de Essential (un tenant por hogar), J2 `life-net` sigue como licencia `LIFE_NET` y el plan `life` la concede, J3 9 € al mes IVA incluido, J4 solo mensual con 14 días de prueba, J5 cinco miembros incluidos, J6 titular particular, J7 fuera del escaparate de empresas, J9 lanzamiento solo en España (`consumer:es_mainland`), J10 ficha pública sin requisito de Elephant Core. Antecedentes: `docs/life-net-alcance.md`.

---

## 1. Qué queda preparado en el código

| Pieza | Dónde | Estado |
|---|---|---|
| Plan `life` (`core_plan`): `life-net`, `admin-users`, `comms-email`; cupo `household_members` = 5; precio mensual 7,44 € sin IVA (21 %) = **9,00 € IVA incluido**; sin tarifa anual | `server/catalog/elephantSourceV1.ts`, `shared/personalPlans.ts`; alta en production con `server/catalog/review20261108.ts` | «Próximamente», técnico «planned»: no se puede suscribir (`subscriptions/service.ts`), ni cotizar como contratable, ni comprar |
| Cotizador: el plan personal no admite extensiones ni soluciones de empresa; Life Net no se suma a un plan de empresa; la regla «Core incluido» no se le aplica | `server/catalog/quote.ts` | Activo (solo valida) |
| Stripe: plan personal exento de la tarifa anual; Product «Elephant Life» y su Price mensual solo cuando el plan esté «available» | `server/stripe/catalog.ts` (`PERSONAL_CHECKOUT_PLANS`) | Sin Product ni Price: no se ha escrito nada en Stripe |
| Checkout y autoservicio: `plan: "life"`, solo mensual, solo particulares (`buyer.type: "consumer"`: nombre y apellidos, NIF opcional), `household.name` opcional (por defecto «Hogar de …»), sin razón social | `server/stripe/checkout.ts`, `server/stripe/selfService.ts` | Bloqueado: exige el plan «available» y las variables del punto 5 |
| Prueba gratuita de 14 días desde la activación del hogar, con el titular y el nombre del hogar | `server/trials/onboarding.ts` (`registerLife`), `POST /cp/v1/public/trial` con `plan: "life"` | Apagada: `CP_LIFE_TRIAL_ENABLED` no está definida |
| Escaparate del panel sin Life Net para empresas; un hogar solo ve lo suyo | `shared/connectMarketplace.ts` (`shownInShowcase`), `server/commerce/panelCatalog.ts` | Activo |
| Ficha pública de `life-net` y del plan `life`: particulares y familias, las siete funciones como lo que incluirá, lista de espera | `server/catalog/commercial/specs.ts` | Se publica con las acciones de fichas |

**Cálculo del precio (J3).** El catálogo guarda todos los importes sin IVA para que el Price de Stripe sea `tax_behavior: exclusive`, como el resto. Base 744 céntimos; IVA 21 % = 156,24 → 156 céntimos (redondeo por periodo del cotizador); total **900 céntimos**. A un particular siempre se le muestra el precio final: «9,00 € al mes, IVA incluido». Con Stripe Tax el cálculo es el mismo (7,44 € + 1,56 €).

---

## 2. Flujo de contratación (propuesta)

1. **Web, oferta personal** (`/elephant-net/life`): plan personal Life, 9,00 € al mes IVA incluido, hasta 5 miembros del hogar, las siete funciones. Mientras no se abra: «Quiero que me aviséis».
2. **Alta** (autoservicio o prueba): correo, nombre, apellidos, NIF opcional, nombre del hogar (opcional y editable), país España y código postal (Península o Baleares). Sin razón social ni datos de empresa.
3. **Información precontractual** (punto 4) antes de pagar, con su versión, y aceptación de las condiciones y de la privacidad.
4. **Desistimiento y comienzo del servicio** (punto 3): casilla expresa de ejecución inmediata.
5. **Pago** en Stripe Checkout: 9,00 € al mes (7,44 € + 1,56 € de IVA). Domicilio fijado antes del pago.
6. **Activación** del hogar al verificarse el pago: plataforma propia, el titular como administrador, licencias del plan y acceso a Life Net.
7. **Factura simplificada** mensual (punto 6).
8. **Baja**: en cualquier momento desde Suscripción; termina al final del mes pagado.

**Prueba gratuita (alternativa al pago inmediato).** 14 días desde la activación del hogar, sin tarjeta. Al terminar, el hogar queda en solo lectura hasta contratar. La prueba no es un contrato de pago: el plazo de desistimiento empieza cuando se contrata.

---

## 3. Desistimiento (14 días)

**Texto propuesto (para revisión legal):**

> Derecho de desistimiento. Tienes derecho a desistir de este contrato en un plazo de 14 días naturales desde su celebración, sin indicar el motivo. Para ejercerlo, entra en tu cuenta → Suscripción → «Desistir del contrato aquí», o escríbenos a [correo de soporte] con una declaración inequívoca. Te devolveremos los pagos recibidos en un plazo máximo de 14 días desde que recibamos tu decisión, por el mismo medio de pago.
>
> Comienzo del servicio durante el plazo. Si nos pides que el servicio empiece ya, al desistir te descontaremos la parte proporcional del periodo ya prestado hasta que nos comuniques el desistimiento. [Casilla obligatoria para empezar ya: «Quiero que el plan Life empiece ahora, durante el plazo de desistimiento, y sé que si desisto pagaré la parte del servicio ya prestada».]

**La cuestión de empezar el servicio durante el plazo (decisión pendiente):**

- **Opción A, ejecución inmediata con reconocimiento** (`CP_CONSUMER_WITHDRAWAL=immediate_execution_ack`, lo que ya implementa el código): el hogar se activa al pagar si el particular marca la casilla; si desiste, se reembolsa lo pagado menos la parte proporcional prestada (con 9 € al mes, unos 0,30 € por día). Es la opción preparada.
- **Opción B, sin ejecución inmediata:** el servicio no empezaría hasta pasados los 14 días. Contradice la prueba de 14 días y la experiencia del producto; no está implementada.
- **La prueba gratuita no consume el plazo:** como no hay contrato de pago, el plazo se cuenta desde la contratación posterior.
- **Sin información precontractual registrada** (sin `CP_PRECONTRACT_VERSION` en el consentimiento) el plazo se amplía 12 meses (art. 105 TRLGDCU): por eso la contratación de particulares exige esa variable.

El registro, la evaluación y la resolución ya existen (`server/withdrawals/`, `docs/elephant-source/DESISTIMIENTO.md`). Los reembolsos y las bajas los ejecuta una persona.

---

## 4. Información precontractual (texto propuesto)

> **Big Elephant · Plan personal Life**
> - **Prestador:** [razón social, NIF, domicilio, correo y teléfono de Big Elephant].
> - **Servicio:** plan personal para un hogar con Life Net: organización personal, gestión familiar, calendario y agenda, tareas y recordatorios, actividades compartidas, organización de miembros del hogar y seguimiento de actividades y compromisos. Hasta 5 miembros del hogar. Sin funciones de empresa.
> - **Precio:** 9,00 € al mes, IVA incluido (7,44 € + 1,56 € de IVA al 21 %). Sin tarifa anual ni permanencia. Sin costes adicionales.
> - **Pago:** con tarjeta, por adelantado cada mes, a través de Stripe.
> - **Duración y baja:** contrato mensual que se renueva solo; puedes darte de baja cuando quieras y el servicio sigue hasta el final del mes pagado.
> - **Prueba gratuita:** 14 días desde la activación de tu hogar, sin tarjeta y sin compromiso.
> - **Desistimiento:** 14 días naturales desde la contratación (ver condiciones), con la regla de la parte prestada si pides empezar ya.
> - **Ámbito:** contratación disponible para particulares con domicilio en la Península o Baleares.
> - **Datos personales:** [enlace a la política de privacidad]. Tus datos y los de tu hogar están separados de los de cualquier otro cliente.
> - **Reclamaciones:** [canal de atención y, en su caso, sistema de resolución de litigios].

Se publica con una versión (`CP_PRECONTRACT_VERSION`) que queda registrada en el consentimiento de cada compra.

---

## 5. Impuestos (IVA incluido)

- **Lanzamiento solo en España peninsular y Baleares** (`consumer:es_mainland`): IVA español al 21 %, ya incluido en los 9,00 €.
- **Canarias, Ceuta y Melilla, resto de la UE y fuera de la UE:** no se abren. La elegibilidad responde «no podemos cobrar en línea a este tipo de cliente o país».
- **Código de producto de Stripe Tax:** hoy el de la cuenta es SaaS para empresas (`txcd_10103001`). Para particulares el asesor debe decidir si corresponde otro (SaaS de uso personal) antes de crear el Product «Elephant Life».

---

## 6. Factura simplificada

- Un particular sin NIF recibe **factura simplificada** (límite de 400 € IVA incluido; 9 € al mes queda muy por debajo). Con NIF, si lo pide, factura completa con su NIF (art. 7.2 del Reglamento de facturación).
- **Contenido:** número y serie, fecha, NIF y nombre de Big Elephant, descripción («Plan personal Life, mes de …»), tipo de IVA (21 %), importe total IVA incluido y, si se pide, la cuota desglosada.
- Lo emite `server/invoicing` (caso `consumer:es_mainland`, en estado `ready` en la matriz fiscal) con `CP_INVOICING_FISCAL_CASES` y `CP_INVOICING_SIMPLIFIED=1`.

---

## 7. Variables que habría que activar (NINGUNA está activada)

| Variable | Valor para Life en España | Hoy |
|---|---|---|
| `CP_CONSUMER_WITHDRAWAL` | `immediate_execution_ack` (tras la decisión legal del punto 3) | sin definir (`pending`): particulares bloqueados |
| `CP_PRECONTRACT_VERSION` | versión publicada del texto del punto 4 | sin definir |
| `CP_TERMS_VERSION` / `CP_PRIVACY_VERSION` | versiones vigentes, con el anexo de particulares | las de empresa (revisar) |
| `CP_STRIPE_FISCAL_SCENARIOS` | añadir `consumer:es_mainland` | solo `business:es_mainland` |
| `CP_STRIPE_TAX_EXPECTATIONS` | añadir `consumer:es_mainland=taxed` | sin el escenario de particulares |
| `CP_STRIPE_CONSUMER_RATES` | `ES=2100` (precio final mostrado) | sin definir |
| `CP_INVOICING_FISCAL_CASES` | añadir `consumer:es_mainland` | sin particulares |
| `CP_INVOICING_SIMPLIFIED` | `1` | sin definir |
| `CP_PUBLIC_SELF_SERVICE_ENABLED` | `1` solo si se abre el autoservicio público (hoy cerrado para todos) | sin definir |
| `CP_COMMERCE_PURCHASES_ENABLED` | no hace falta para Life (no se compra desde el panel) | `1` por People; no se toca |
| `CP_LIFE_TRIAL_ENABLED` | `1` para abrir la prueba de 14 días (exige además `CP_PUBLIC_TRIAL_ENABLED=1` para la ruta pública) | sin definir: apagada |

**Pasos para habilitar los cobros (en este orden, cada uno con su autorización):**

1. Life Net operativo (lo construye el módulo `life_net`) y estado técnico del plan `life` a `partial`.
2. Decisiones legales y fiscales de los puntos 3 a 6; publicar los textos y sus versiones.
3. Decidir el código de producto de Stripe Tax para particulares.
4. Pasar el plan `life` a «Disponible» en el CRM (con su autorización anotada).
5. Planificar el catálogo de Stripe (`GET /cp/v1/stripe/catalog/plan`): saldrán `create_product` «Elephant Life» y `create_price` mensual de 744 céntimos `exclusive`. Los crea una persona; después, `POST /catalog/sync` los enlaza.
6. Activar las variables del punto 7 (publicación protegida).
7. Prueba de punta a punta en pruebas (sandbox) con un particular y su factura simplificada; después, en live con un buzón autorizado.

---

## 8. Decisiones pendientes para Jorge

1. Desistimiento: confirmar la opción A (ejecución inmediata con reconocimiento) y el texto del punto 3.
2. Textos legales: precontractual, condiciones y privacidad de particulares (con el asesor).
3. Código de producto de Stripe Tax para el uso personal.
4. Si un miembro del hogar puede ser una ficha sin acceso (por ejemplo, un menor): lo define el módulo Life Net; el cupo de 5 cuenta miembros.
5. Si el plan `life` necesita también `admin-panel` (portada, avisos y ajustes generales del panel). Hoy concede solo `life-net`, `admin-users` y `comms-email`, como decidió J2.
6. Fecha de apertura de la prueba (`CP_LIFE_TRIAL_ENABLED`) y de la venta.
