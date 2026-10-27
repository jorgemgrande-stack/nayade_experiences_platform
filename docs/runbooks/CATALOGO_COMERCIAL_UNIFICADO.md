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

Solo guarda borradores (nunca publica). Los textos con inclusiones o reglas propuestas quedan como «Texto retenido…» en `internal.pendingDecisions`. La semilla (`seed-elephant-source.ts`) conserva todo lo anterior al repetirse.
