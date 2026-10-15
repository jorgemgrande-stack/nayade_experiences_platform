# Web comercial: catálogo, precios y contenidos administrables

Big Elephant CRM administra los productos, los precios y los contenidos de www.bigelephant.es. La web lee solo lo publicado. Ningún cambio comercial requiere tocar código.

## Modelo (BD del CRM, migración `0004_web_catalog`)

| Tabla | Qué guarda |
| --- | --- |
| `web_entries` | Cada elemento publicable: `product`, `promotion`, `faq`, `menu`, `seo`, `page` o `forms`. Tiene un **borrador versionado** (`draft`, `draft_version`) y, si se publica, una **copia publicada** independiente (`published`, `published_version`). |
| `web_entry_versions` | Historial inmutable: cada guardado o restauración crea una versión. |
| `web_prices` | Precios de productos. El **importe es inmutable**: un cambio es una fila nueva. Pasan de `draft` a `approved` y después a `retired`. |
| `web_events` | Auditoría de solo inserción: quién hizo qué y cuándo. |

### Producto: tres ejes independientes

- **Familia comercial** (`family`): `core_plan`, `extension`, `industry_module`, `usage` o `service`.
- **Mecanismo técnico de activación** (`activation`), que **referencia** lo que ya existe sin copiarlo:
  - `module`: un módulo de licencia del Core (`tenant_entitlements`, manifiestos `cms`, `commerce`, `tpv`, `hotel`, `spa`, `restaurants`). Es obligatorio en un sector disponible.
  - `plan`: un plan del catálogo de facturación. Puede quedar sin enlazar (`ref: null`) mientras no exista el plan de facturación.
  - `feature`: una función del núcleo.
  - `usage`, `service` o `none`.
- **Modalidad de facturación** (`billingModel`): `subscription`, `recurring_addon`, `usage`, `credits` o `one_time`.

Además, cada producto tiene:

- estado técnico (`available`, `partial` o `planned`) y estado de publicación;
- límites (con `metric` opcional del ERM: solo los medidos se aplican);
- dependencias y compatibilidades (con qué planes base);
- requisitos de configuración, costes de terceros, lo que incluye, presentación y orden.

El bloque `internal` (notas, coste, margen) **nunca** sale a la web.

## Reglas

- **Nada se publica solo.** Crear un producto o restaurar una versión deja un borrador.
- **Publicar** exige:
  - la versión revisada (`expectedVersion`);
  - que las referencias técnicas existan;
  - que las dependencias y los planes compatibles estén publicados;
  - que no haya ciclos.
- **Despublicar** se bloquea si otro producto o promoción publicados dependen del elemento.
- **Precios:**
  - Aprobar uno nuevo retira el anterior del mismo tipo, moneda y unidad; ambos quedan en el historial.
  - Un producto en hoja de ruta no puede tener precio aprobado.
  - Los precios por consumo exigen unidad.
- **Promociones:** solo con productos publicados. La web las ve únicamente entre `startsAt` y `endsAt`.
- **Sin retroactividad:**
  - Los contratos del CRM y las facturas guardan su propio importe.
  - Este catálogo **no alimenta todavía el motor de facturación**, que sigue leyendo `BILLING_CATALOG_FILE`. Ese motor toma el precio vigente del plan en cada renovación.
  - Si en el futuro se conecta, cada suscripción debe guardar su precio (instantánea) para que un cambio no afecte a quien ya contrató.

## Permisos

| Ámbito | Permite | Roles |
| --- | --- | --- |
| `web:read` | Consultar todo, incluido el historial y la auditoría | todos |
| `web:write` | Crear y editar borradores, restaurar versiones, crear precios en borrador y emitir enlaces de vista previa | administración, comercial |
| `web:publish` | Publicar, despublicar, aprobar y retirar precios | superadministración y administración |

## API

**CRM** (`/cp/v1/web`, sesión de operador):

| Ruta | Para qué |
| --- | --- |
| `GET /overview` | Resumen |
| `GET /entries?kind=` | Listado |
| `POST /entries` | Crear |
| `GET\|PATCH /entries/:kind/:key` | Ver o guardar el borrador |
| `POST /entries/:kind/:key/publish` | Publicar |
| `POST /entries/:kind/:key/unpublish` | Despublicar |
| `POST /entries/:kind/:key/restore` | Restaurar una versión |
| `POST /entries/product/:key/prices` | Crear un precio en borrador |
| `POST /prices/:id/approve` | Aprobar un precio |
| `POST /prices/:id/retire` | Retirar un precio |
| `DELETE /prices/:id` | Borrar un precio, solo si está en borrador |
| `POST /preview-token` | Emitir un enlace de vista previa |
| `GET /events` | Auditoría |
| `GET /refs` | Módulos, planes de facturación y métricas |
| `GET /site?mode=` | El sitio tal y como lo vería la web |

**Pública** (`/cp/v1/public/site`, sin autenticación, solo lectura, no exige `Origin`):

| Ruta | Para qué | Caché |
| --- | --- | --- |
| `GET /` | Lo publicado: productos con precios aprobados, promociones vigentes y contenidos | `ETag` (versión del sitio), `Cache-Control: public, max-age=30, must-revalidate` |
| `GET /preview?token=` | Los borradores, con un enlace firmado de 30 minutos que emite el CRM | `no-store`, `noindex` |

Comportamiento de la ruta pública:

- Si la BD falla, responde **503 sin caché**: nunca sirve un catálogo viejo como vigente.
- Solo se monta con la API pública configurada (`CP_PUBLIC_ORIGINS`, `CP_PUBLIC_FORM_SECRET`) y con la migración 0004 aplicada.

## Regeneración de la web

La web es estática. Al compilar lee `/public/site` y, en el navegador, revalida la versión viva: oculta precios si no puede confirmarlos y retira lo despublicado.

Para que lo publicado llegue también al HTML, el plano de control puede avisar a un hook de regeneración en cada publicación: `CP_WEB_PUBLISH_HOOK`, solo https o localhost. En producción, ese hook sería el *deploy hook* del alojamiento de la web, y configurarlo **requiere autorización**.

## Carga inicial

`scripts/web-catalog-seed.ts` importa como **borradores sin precios** lo que la web muestra hoy (`db/crm/seeds/web-catalog.seed.json`):

- Simula por defecto; `--apply` escribe.
- Nunca sobrescribe lo existente.
- `--publish-baseline` publica esa base de forma explícita.

## Despliegue (no hecho; requiere autorización)

1. Aplicar `db/crm/migrations/0004_web_catalog.sql` con el ejecutor común, dry-run primero.
2. Ejecutar la carga inicial en simulación y después con `--apply`. Publicar la base solo si se decide.
3. Configurar, si procede, `CP_WEB_PUBLISH_HOOK`.
4. Comprobar en el arranque `{"ctx":"WebAdmin","enabled":true}`.

## Dependencias entre repositorios

| Repo | Rama | Necesita |
| --- | --- | --- |
| nayade_experiences_platform | `feat/cp-web-catalog` | `feat/cp-web-leads` (#76: API pública y CORS de `/public`), con `feat/cp-operator-auth` (#75) debajo |
| big-elephant-crm | `feat/crm-web-admin` | `feat/crm-web-requests` (#9) y el plano de control anterior |
| bigelephant-web | `feat/web-catalogo` | `feat/web-captacion` (#2) y el plano de control anterior; `PUBLIC_INTAKE_URL` para leer `/public/site` |
