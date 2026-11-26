# CRMDashboard dividido por pestañas (Core C4, paso 0)

`client/src/pages/admin/crm/CRMDashboard.tsx` tenía unas 9.865 líneas y concentraba varias pantallas como pestañas
de `/admin/crm?tab=...`. Se ha dividido **sin cambiar comportamiento, textos, estilos, rutas, permisos ni URLs**:
cada trozo se movió tal cual (cortar y pegar con ajuste de imports/exports). Así cada pestaña puede rediseñarse
por separado sin conflictos de fusión.

## Mapa pestaña a fichero

Carpeta base: `client/src/pages/admin/crm/`.

| `?tab=` | Pantalla | Fichero de la pestaña | Qué contiene |
| --- | --- | --- | --- |
| `leads` | Oportunidades | `tabs/LeadsTab.tsx` | `useLeadsController` (estado, consultas y mutaciones), `LeadsTab` (tabla) y `LeadsModals` (diálogos) |
| `quotes` | Presupuestos | `tabs/QuotesTab.tsx` | `useQuotesController`, `QuotesTab`, `QuotesModals` |
| `reservations` | Todos los pedidos | `tabs/ReservationsTab.tsx` | `useReservationsController`, `ReservationsTab`, `ReservationsModals` |
| `invoices` | Facturas | `tabs/InvoicesTab.tsx` | `useInvoicesController`, `InvoicesTab`, `InvoicesModals` |
| `anulaciones` | Anulaciones y abonos | `tabs/CancellationsTab.tsx` | `useCancellationsController`, `CancellationsTab`, `CancellationsModals` |
| `bonos` | Vales / bonos | `tabs/BonosTab.tsx` | `BonosManager` (ya era un componente aparte) |
| `pagos_pendientes` | Cobros pendientes | `tabs/PendingPaymentsTab.tsx` | `PagosPendientesTab` (ya era un componente aparte) |

Los alias heredados de `?tab=` (`reservas`, `presupuestos`, `facturas`) y las rutas `/admin/crm/presupuestos` y
`/admin/crm/reservas` siguen resolviéndose en `CRMDashboard.tsx` (`tabFromSearch`).

### Diálogos grandes (`modals/`)

Un fichero por diálogo, con el mismo nombre del componente: `LeadDetailModal`, `LeadEditModal`, `NewLeadModal`
(Oportunidades), `DirectQuoteModal`, `QuoteBuilderModal`, `QuoteEditModal`, `QuoteDetailModal` (Presupuestos),
`NewReservationModal`, `ReservationDetailModal` (Pedidos) y `AnularReservaModal` (Anulaciones, se abre desde Pedidos).

### Compartido (`shared/crmCommon.tsx`)

Tipos (`Tab`, `OpportunityStatus`, `QuoteStatus`, `Priority`, `QuoteLineItem`), constantes (`PAGE_SIZE`, `DT_FULL`,
`EUR2`, `CHANNEL_META`, `CHANNEL_FALLBACK`), formateadores y avisos (`toastQuoteMail`, `regimeLabel`), insignias
(`OpportunityBadge`, `QuoteStatusBadge`, `PriorityDot`, `AnulOpBadge`, `AnulResBadge`, `AnulFinBadge`), y piezas
usadas por varias pestañas o diálogos (`ConfirmDialog`, `FieldError`, `invalidProps`, `ProductSearchInput`,
`ProductAutocompleteInput`, `RegimeCell`, `ScheduledJobsMini`, `CrmTableState`).

Una pieza vive en `shared/` solo si la usan dos o más ficheros; si solo la usa uno, está dentro de él (por ejemplo
`QuoteTimeline` dentro de `QuoteDetailModal.tsx`, o `CounterCard` y `useCountUp` en el contenedor).

## El contenedor (`CRMDashboard.tsx`)

Queda con lo que es común a todas las pestañas: título y avisos de cabecera, panel de indicadores (KPI), selector
de pestañas, lectura de `?tab=`/`?search=`, buscador y filtros de la barra, y el montaje de la pestaña activa. Cada
pestaña se monta siempre (como antes) y decide con `tab === "..."` si pinta algo.

Patrón por pestaña (tres piezas en el mismo fichero):

1. `useXController({ tab, search, filterStatus, ... })`: el estado, las consultas y las mutaciones de esa pestaña,
   cortados tal cual del componente original. Devuelve todo lo declarado. El contenedor lo llama una sola vez, de
   modo que el ciclo de vida del estado (selecciones, páginas, diálogos abiertos) es el mismo que antes.
2. `XTab({ ctrl, ...props })`: el cuerpo de la pestaña (tabla, barra de acciones, paginación).
3. `XModals({ ctrl, ...props })`: los diálogos de esa pestaña. Se montan en el mismo lugar del árbol donde estaban.

Lo que una pestaña necesita del contenedor (`tab`, `search`, `filterStatus`, `setFilterStatus`, `setBulkConfirm`,
`handleTabChange`, `setViewResId`...) entra por props con el nombre original. Los pocos estados cruzados viven en el
contenedor: `cancelReservationId`/`cancelReservationName` (los fija Pedidos y los consume Anulaciones) y `bulkConfirm`
(diálogo de borrado masivo común a Oportunidades, Presupuestos y Pedidos). `viewResId` lo posee Pedidos y lo reciben
por prop Anulaciones y Vales.

## Pruebas que leen el código

`server/crmDashboardFuentes.ts` (`crmDashboardFuentes()`) devuelve la suma de `CRMDashboard.tsx` y de todos los
ficheros de `tabs/`, `modals/` y `shared/`. Las pruebas que antes leían un solo fichero usan ahora esa suma, así que
comprueban exactamente lo mismo estén donde estén las líneas: `adminMarco`, `cierreCosmeticos`, `escenariosPantallas`,
`facturasSinBorrado`, `formatoEsImportes`, `imagenEssential`, `invoiceAudit`, `presupuestosEssential`,
`pulidoEssential`, `restosNayadeEssential`, `sinNayadeGuard` y `vocabularioGenerico`.

Líneas base por fichero (`server/panelAdopcion.baseline.json` y `BASELINE` de `server/panelColoresGuard.test.ts`):
las cifras de `CRMDashboard.tsx` se repartieron entre los ficheros nuevos y la suma se conserva por regla
(coloresFijos 27, hexEnClases 74, textoMinusculo 48, geometriaAjena 11). El tope de `panelColoresGuard` para
`CRMDashboard.tsx` era 725, muy por encima de lo que había (93 líneas); se sustituyó por la cuenta real de cada
fichero nuevo (suma 93), lo que aprieta el trinquete sin subir nada.

## Cómo rediseñar una pestaña

Edita solo el fichero de su pestaña (y su diálogo en `modals/` si toca). Al migrar un fichero a los componentes
comunes, bájalo de la línea base de `panelAdopcion.baseline.json` y, cuando quede sin colores fijos, pásalo a
`MIGRATED` en `panelColoresGuard.test.ts`.
