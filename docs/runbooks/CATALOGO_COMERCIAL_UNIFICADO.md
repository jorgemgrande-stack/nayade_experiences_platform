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

La salida de cada orden es una línea JSON. Railway la guarda en los atributos del registro de `restore-drill`.

La semilla (`seed-elephant-source.ts`) ya no publica borradores pendientes que no ha escrito ella, como las fichas importadas o las ediciones del CRM. Los informa como `pending`.

### Después de publicar: recompilar la web

**La web pública no se actualiza sola con las fichas.** Big Elephant Web lee el catálogo **al compilar** (meta `be-site-version` de cada página). En el navegador solo se confirman precios y visibilidad, nunca textos. Una ficha publicada no aparece en www.bigelephant.es hasta que la web se vuelve a compilar.

La publicación del Core no basta: compila la web **antes** de que se apliquen las fichas. Pasos, en este orden:

1. Ejecutar `catalogo-fichas-publicar-aplicar` en production y en live.
2. Comprobar que `version` de `https://www.bigelephant.es/cp/v1/public/site` ha cambiado. La acción termina «success» aunque el lote no publique nada; el informe real solo está en los registros de Railway.
3. Recompilar la web: `gh workflow run publicacion.yml --ref integration/elephant-source -f solo=web`. Compila la rama base de la web (`WEB_BRANCH` en `scripts/deploy/esRailwayLib.ts`), nunca PR pendientes.
4. Comprobar que `<meta name="be-site-version">` de www.bigelephant.es coincide con la versión del paso 2.
5. Regenerar la instantánea de la web para el CI: `node scripts/sync-catalog.mjs --from-api https://www.bigelephant.es/cp/v1/public/site --expect <versión>` en el repo de la web.

**Campos nuevos de la ficha:** cualquier campo que se añada a `commercialBlock` (`server/web/schemas.ts`) debe ser opcional y sin `.default()`. Con un valor por defecto, lo ya publicado deja de reconstruirse exactamente desde el historial y el lote bloquea todas las fichas (caso de `forWho`, corregido en la PR #495).

## Reglas comerciales preparadas (desactivadas)

`server/catalog/commercial/rules.ts` reúne las reglas de la fase de cierre, con su estado, dónde viven y qué falta para activarlas. `GET /cp/v1/web/commercial/review` las devuelve en `rules`; ninguna está activa.

1. Cupos base de Enterprise.
2. POS con caja básica en el plan.
3. Paquetes con descuento solo sobre lo facturable.
4. Copilot con consumo medido. Su límite es `null` hasta que se decida.
5. Implantación separada de la cuota.
6. Ampliaciones de Enterprise por presupuesto.

Elephant People no se incluye en ningún plan (decisión del 01/11/2026): es una extensión de pago por empresa para Essential, Business y Enterprise. La regla «People en Business con 15 empleados» se retiró.

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

### Política final aprobada (cierre Elephant Net + Core, 27/10/2026)

Todo está aprobado en los borradores y **sin efecto** mientras la política siga apagada.

1. **Core incluido:** cada Net completo incorpora Core Essential en su precio anunciado.
2. **Ampliación a Business:** +50 €/mes o +480 €/año (diferencia de tarifas aprobadas, `yearlyPlans: ["business"]`).
3. **Ampliación a Enterprise:** +170 €/mes. La anual se presupuesta: no hay tarifa anual aprobada para esa ampliación.
4. **Una sola licencia Core** por empresa.
5. **Net adicionales:** −29 €/mes cada uno (solo mensuales). El mismo Net dos veces es un error.
6. **Sin cuota anual de Essential:** con Essential incluido no existe una cuota anual aparte; la línea queda a 0 € y en mensual.
7. **Capacidades adicionales** (usuarios, sedes y almacenamiento): con sus complementos de catálogo, calculados a partir del total pedido.
8. **Contratos históricos:** `contractModel: "legacy"` (dos cuotas, nunca se migran). La migración es voluntaria y con aceptación expresa.

**Versión inmutable.** Cada cotización lleva `policyVersion`, la huella de las reglas exactas aplicadas. Con `catalogVersion` permite reproducir el precio contractual: el pedido debe guardar ambas.

**Core único por empresa.** `catalogo-fichas-integridad` devuelve `coreUnico` con tres listas de identificadores internos de empresa:

| Campo | Significado |
|---|---|
| `coreCobradoDosVeces` | Empresas con más de una licencia Core cobrada. Una bajada programada a fin de periodo puede aparecer hasta su fecha: hay que revisarla. |
| `netConCoreAparte` | Clientes históricos: Net y Core cobrados aparte, legítimo. |
| `netSinCore` | Net sin partida de Core. |

**Sondeo de Stripe en sandbox.** `scripts/catalog/netCoreStripeSandbox.ts` (para la ventana de Stripe, con `ES_SANDBOX_STRIPE_KEY=sk_test_…`) compara la mecánica de cupón con la de tarifa derivada en estos casos:

- alta;
- prorrateo, comprobando que el importe aceptado es el cobrado;
- renovaciones;
- plan anual;
- Business → Enterprise;
- bajada;
- Net adicional;
- pago rechazado y reintento;
- precio contractual;
- idempotencia.
