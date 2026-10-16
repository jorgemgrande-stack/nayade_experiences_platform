# Catálogo comercial de Elephant Source (v1)

**Una sola fuente de verdad** para capacidades, planes, límites, productos Net y Connect, paquetes, complementos, tarifas y estados.

| Pieza | Dónde |
|---|---|
| Capacidades (74, ids estables del contrato técnico) | `server/catalog/capabilities.ts` |
| Semilla v1: productos, tarifas, límites, paquetes | `server/catalog/elephantSourceV1.ts` |
| Almacén editable (borrador → publicación, precios con aprobación, historial y auditoría) | `server/web/*`, BD del CRM (`web_entries`, `web_prices`, `web_events`) |
| Cotizador (puro, sin dependencias) | `server/catalog/quote.ts` |
| Catálogo publicado → cotizador | `server/catalog/snapshot.ts` |

## Modelo

- **Capacidad** (`kind = capability`): clave = id estable del registro. El nombre y la descripción son editables; el id no.
- **Producto** (`kind = product`). Su `catalog` describe:
  - el estado comercial (`unpublished`, `coming_soon`, `on_request`, `available`);
  - las capacidades que concede;
  - el plan del que hereda (planes acumulativos);
  - la familia Net o el grupo Connect;
  - el ámbito (empresa o sede);
  - los componentes, si es un paquete;
  - los cupos incluidos (`null` = por contrato);
  - el complemento de cantidad (métrica, paso y planes);
  - la unidad de cobro.
- **Familias:**
  - `core_plan`;
  - `net_module` y `net_bundle`;
  - `connect` y `connect_bundle`;
  - `extra`, `service` y `addon`;
  - y las anteriores: `extension`, `industry_module` y `usage`.
- **Tarifas:** inmutables, en céntimos y sin IVA (21 % aparte). Aprobar una nueva retira la anterior del mismo tipo, y la historia queda en `web_prices`. Las anuales son importes propios, **nunca** 12 × mensual. La vigencia sale de `approved_at` y `retired_at`.
- **Honestidad:**
  - `available` exige estado técnico `available`. Hoy **nada** lo es: no hay instalación multiempresa desplegada.
  - Un producto en hoja de ruta **puede** tener tarifa aprobada (la web enseña el portfolio con precios), pero no se contrata. Su estado comercial lo bloquea en el cotizador (`contractable`) y en el motor de suscripciones.
- **Precio de catálogo frente a precio contratado:** las suscripciones guardan una instantánea inmutable del precio aceptado (`server/subscriptions`). Cambiar el catálogo no altera lo contratado.

## Cargar la semilla

1. Aplicar las migraciones del CRM hasta `0008_catalog_capabilities`, con el ejecutor y como paso explícito, **nunca al arrancar**.
2. Simular (no escribe nada):
   ```bash
   CATALOG_DATABASE_URL=mysql://…/crm pnpm exec tsx scripts/catalog/seed-elephant-source.ts
   ```
3. Aplicar, con autorización:
   ```bash
   CATALOG_DATABASE_URL=mysql://…/crm pnpm exec tsx scripts/catalog/seed-elephant-source.ts --apply --confirm-database <nombre>
   ```

**Propiedades:**
- Idempotente: la segunda ejecución informa `unchanged`.
- Nunca despublica ni borra.
- Cada cambio queda auditado con el autor `catalogo:elephant-source-v1`.
- Si una clave existe con otra familia, lo informa en `conflicts` y no la toca.

## Instantánea para la web

```bash
pnpm exec tsx scripts/catalog/export-snapshot.ts ../bigelephant-web/src/data/catalog.generated.json
```

- Es determinista y solo contiene lo público.
- En producción la web lee `/cp/v1/public/site` al compilar; la instantánea es el respaldo de desarrollo.
- **Nunca** se editan precios en la web.

## API

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET /cp/v1/public/site` | público (orígenes de la web) | Catálogo publicado (incluye `catalog.capabilities`) y contenidos |
| `POST /cp/v1/public/site/quote` | público, limitado por IP | Cotiza una configuración sobre lo publicado; no admite `owned`; no guarda nada; `no-store` |
| `GET /cp/v1/web/catalog` | `web:read` | Catálogo en formato cotizador y capacidades (CRM) |
| `POST /cp/v1/web/quote` | `web:read` | Igual que la pública, más `owned` (lo ya contratado) para propuestas de cambio |

**Petición** (`server/catalog/request.ts`):

```json
{
  "plan": "business",
  "interval": "year",
  "items": [{ "key": "hotel-net-complete" }, { "key": "connect-pos", "quantity": 2 }],
  "users": 17,
  "sites": 2,
  "storageGb": 60
}
```

**Respuesta:**
- líneas con su estado (`charged`, `included_in_bundle`, `no_price`);
- totales mensual, anual y anualizado, con el IVA aparte;
- ahorros de los paquetes y sugerencias de paquete;
- capacidades resultantes;
- costes variables;
- `contractable` (`self_service`, `request` o `not_available`) y `blocking`.

## Decisiones marcadas como propuesta (pendientes de negocio)

- Composición de los paquetes Connect:
  - Communications = WhatsApp AI + Voice + Reception AI;
  - Marketing = Ads Manager + Campaigns + SEO Control + GEO Control;
  - Finance = Tax + Finance Sync + Partners;
  - AI Suite = Copilot avanzado + Automatizaciones avanzadas.
- Dependencias entre submódulos de cada Net (por ejemplo, Channel Manager requiere PMS, y Cursillos requiere Escuela).
- Travel Net Complete incluye 1 integración de conectores.
- Los complementos sin tarifa anual (Net, Connect, extras) se cotizan **mensuales** también en una contratación anual. Además, el motor de suscripciones exige hoy que todas las partidas tengan el intervalo de la suscripción: falta admitir intervalos mixtos.

Todas están en `internal.notes` de cada producto. Esas notas nunca se publican.

## Pruebas

| Suite | Contenido |
|---|---|
| `server/catalog.test.ts` | Registro de capacidades, tarifas oficiales exactas, semilla idempotente, reglas de honestidad, cotizador y adaptador del motor de suscripciones |
| `server/controlPlane.webCatalog.test.ts` | API pública y del CRM del cotizador |
| `server/catalog.mysql.test.ts` | Semilla completa sobre MySQL, idempotencia, cotización y reversión de `0008` |
