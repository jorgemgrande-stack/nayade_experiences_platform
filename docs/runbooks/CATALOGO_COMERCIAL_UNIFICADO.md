# Catálogo comercial unificado: fichas, política y cotizador

Una sola fuente: los productos del catálogo comercial (`web_entries`, borrador JSON versionado). No hay migración: todos los campos nuevos son opcionales dentro del borrador.

## Qué hay en cada producto

| Campo | Dónde | Público |
|---|---|---|
| `commercial` (titular, descripción completa, problema, beneficios, exclusiones, extensiones compatibles, reglas de capacidad, integraciones, CTA, SEO) | Todos | Sí |
| `catalog.implementationLevel` (1 activable · 2 portable · 3 desarrollo nuevo) | Todos salvo planes y complementos | Sí |
| `catalog.inclusions` (extensiones incluidas, `approved` o `proposed`, tope opcional) | Planes | Solo aprobadas **y** con la política activa |
| `catalog.quotaProposals` | Planes | Nunca |
| `catalog.quoteOnRequest`, `catalog.bundleRule` | Planes / paquetes | Solo aprobadas **y** con la política activa |
| `internal.functionalGrade`, `sources`, `pendingDecisions` | Todos | Nunca |

## Interruptor de política comercial

`WebAdminService({ commercialPolicy })`, **desactivado por defecto** (el plano de control no lo activa). Desactivado, lo publicado no lleva ninguna regla y la web, las propuestas, los contratos, los pedidos y Stripe calculan exactamente como hasta ahora. Activarlo exige antes que el orquestador de pedidos y Stripe (ventana de Stripe) usen `quoteResponse`/`commercialQuote`.

## Cotizador

- `POST /cp/v1/web/quote` y `POST /cp/v1/public/site/quote`: forma de siempre + `commercial` (desglose). Sin reglas activas, idéntico a `quote()` (prueba de barrido en `server/commercialCatalog.test.ts`).
- `POST /cp/v1/web/commercial/simulate` (`web:read`): `policy: "published" | "proposed"`, cambio de plan y recomendación. Nunca crea presupuestos.
- `GET /cp/v1/web/commercial/review` (`web:read`): bloqueos de publicación, avisos y reglas pendientes por producto.

## Validaciones (server/catalog/commercial/checks.ts)

Al guardar: la política solo en su familia; sin soluciones sectoriales incluidas en planes; parciales con tope; cupos propuestos solo sobre cupos «por contrato». Al publicar: sin importes escritos, sin promesas de activación inmediata, sin reglas «propuestas» en texto, sin inclusiones afirmadas en texto con la política desactivada, slug SEO único, lo que no tiene desarrollo solo con lista de espera.

## Importar las fichas

```bash
CATALOG_DATABASE_URL=mysql://…/crm pnpm exec tsx scripts/catalog/import-commercial-specs.ts            # simulación
CATALOG_DATABASE_URL=mysql://…/crm pnpm exec tsx scripts/catalog/import-commercial-specs.ts --apply --confirm-database <bd>
```

En live y production, con el flujo «Despliegue Elephant Source»: `catalogo-fichas` (simulación) y `catalogo-fichas-aplicar` (borradores; ordinario, sin aprobación). Informa de los campos que cambia en cada producto y no guarda ningún producto en el que cambiaría algo fuera de la ficha y la política (precios, cupos, estados…); falla si cambia la versión publicada.

Solo guarda borradores (nunca publica). Los textos con inclusiones o reglas propuestas quedan como «Texto retenido…» en `internal.pendingDecisions`. La semilla (`seed-elephant-source.ts`) conserva todo lo anterior al repetirse.

## Publicar las fichas por lotes

Flujo «Despliegue Elephant Source» (acciones ordinarias, también en production). Cada una despliega `restore-drill` con el commit y hace una foto de integridad antes de empezar:

| Acción | Qué hace |
|---|---|
| `catalogo-fichas-publicar` | Simulación: qué se publicaría, qué ya está publicado y qué queda bloqueado y por qué. |
| `catalogo-fichas-publicar-aplicar` | Simulación, publicación del lote y foto de integridad después. |
| `catalogo-fichas-revertir` | Simulación de la reversión del último lote. |
| `catalogo-fichas-revertir-aplicar` | Simulación, reversión y foto después. |
| `catalogo-fichas-integridad` | Solo la foto: recuentos y huellas de suscripciones, partidas, pedidos, pagos, Stripe y licencias. Sin datos personales. |

`server/catalog/commercial/publishBatch.ts` aplica estas reglas:

- **Solo fichas ya publicadas:** vuelve a publicar únicamente productos que ya estaban publicados y cuyo borrador solo cambia en la ficha, la política o los datos internos.
- **Reversión garantizada:** si lo publicado no puede reconstruirse desde el historial, el producto se bloquea.
- **Mismas comprobaciones que el CRM:** cada producto pasa las de «Publicar», incluidas las de contenido de `checks.ts`:
  - nada de estados internos («pendiente»);
  - nada de límites o usos de IA mientras no estén decididos;
  - nada de referencias internas;
  - límites numéricos solo si son cupos aprobados;
  - en un plan, nada de extensiones cuya inclusión no se aplique.
- **Idempotente:** repetir no publica ni registra nada nuevo.
- **Reversión:** devuelve cada ficha del último lote a su versión anterior, salvo las que alguien haya cambiado después.
- **Sin efectos económicos:** no cambia precios (la orden lo comprueba) ni activa reglas.
- **La web** se regenera con la siguiente publicación del Core (`workflow_dispatch` del CI en `integration/elephant-source`).

La salida de cada orden es una línea JSON. Railway la guarda en los atributos del registro de `restore-drill`.

La semilla (`seed-elephant-source.ts`) ya no publica borradores pendientes que no ha escrito ella, como las fichas importadas o las ediciones del CRM. Los informa como `pending`.

## Reglas comerciales preparadas (desactivadas)

`server/catalog/commercial/rules.ts` reúne las siete reglas de la fase de cierre, con su estado, dónde viven y qué falta para activarlas. `GET /cp/v1/web/commercial/review` las devuelve en `rules`; ninguna está activa.

1. Cupos base de Enterprise.
2. People en Business con 15 empleados.
3. POS con caja básica en el plan.
4. Paquetes con descuento solo sobre lo facturable.
5. Copilot con consumo medido. Su límite es `null` hasta que se decida.
6. Implantación separada de la cuota.
7. Ampliaciones de Enterprise por presupuesto.

## Elephant Net completo con Elephant Core incluido (decisión del 27/10/2026)

**Modelo.** Una solución Elephant Net completa equivale a Elephant Core Essential más la solución sectorial, por el precio total del paquete. Essential incluye 3 usuarios, 1 sede y sus capacidades. Una empresa nunca paga Elephant Core dos veces.

**Qué productos lo llevan.** Solo las soluciones completas (familia `net_bundle`):

| Solución | Precio mensual |
|---|---|
| Hotel | 119 € |
| Ski | 99 € |
| Travel | 119 € |
| Restaurant | 59 € |
| Care | 69 € |
| Social Token | 59 € |

Los módulos Net sueltos (`net_module`, incluido Life Net, que no tiene paquete) siguen siendo módulos individuales que requieren un plan de Elephant Core. Las extensiones, extras, servicios y complementos no cambian.

**Dato.** `catalog.coreIncluded` del paquete contiene:

- `plan` y `status`;
- `upgrade` (`difference`);
- `additional` (`core_credit`).

La política lo lee de los productos (`fromCatalog.ts`). La importación lo carga en los borradores con este estado:

| Regla | Estado |
|---|---|
| Inclusión de Core | Aprobada |
| Ampliación (`upgrade`) | Propuesta |
| Net adicional (`additional`) | Propuesta |

La proyección pública lo quita mientras la política esté apagada y, con la política activa, solo publica lo aprobado.

**Cotizador** (`commercialQuote.ts`, `composeNetCore`):

| Caso | Cálculo |
|---|---|
| Plan incluido o inferior | 0 € (`included_in_net`) |
| Business o Enterprise | Solo la diferencia de tarifas aprobadas en la misma periodicidad (`core_upgrade`) |
| Net adicional, o más unidades del mismo | Su precio menos la tarifa mensual de Essential (`net_additional`) |
| Sin la regla aprobada de ampliación o de Net adicional | Por presupuesto (`on_quote`) |

`discounts.coreIncludedCents` y `netCore` explican la composición. Con la política vigente o publicada, los importes son los de siempre (prueba de regresión en `server/netCoreIncluded.test.ts`).

**Simulaciones.** `GET /cp/v1/web/commercial/net-simulations?policy=proposed|published` (`web:read`) cubre cada solución con siete escenarios:

1. Net solo.
2. Net + Business.
3. Net + Enterprise.
4. Dos Nets.
5. Net + extensión.
6. Net con plan anual.
7. Bajada de Business a Essential.

Detecta:

- Core cobrado dos veces;
- precio mostrado distinto del calculado;
- partidas duplicadas;
- componentes ya contratados que se cobran otra vez;
- incompatibilidades;
- derechos de uso incompletos;
- Nets sin Core incluido.

**Texto.** Mientras la inclusión no se aplique en la contratación, ninguna ficha puede decir «Elephant Core incluido» (`NET_CORE_RE`).

**Activación.** Requiere el producto compuesto en pedidos, licencias y Stripe (contrato v3 de `docs/elephant-source/CONTRATO_CATALOGO_COMERCIAL_STRIPE.md`). Después:

1. Encender la política.
2. Volver a publicar los seis Net.

Los contratos existentes no se migran. Cada contratación debe guardar la versión del catálogo y de la política con que se calculó, para poder reproducir su precio.
