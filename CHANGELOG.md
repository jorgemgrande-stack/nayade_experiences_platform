# Registro de cambios de Elephant Core

Todos los cambios relevantes de Elephant Core se anotan aquí, con el formato
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado semántico.

## Reglas de versión

- La versión publicada vive en un único sitio: `shared/version.ts` (`CORE_VERSION` y
  `CORE_RELEASED_AT`). `package.json` no es la fuente.
- **PATCH** (`1.0.x`): correcciones sin funciones nuevas ni cambios de base de datos.
- **MINOR** (`1.x.0`): funciones nuevas o migraciones aditivas (tablas o columnas nuevas que no rompen
  nada de lo existente).
- **MAJOR** (`x.0.0`): una migración no aditiva (borrar o cambiar columnas o datos existentes) o un
  cambio que rompe el `coreRange` de los módulos (un módulo que declara `^1.0.0` deja de ser compatible).
- Cada versión publicada se etiqueta como `core-vX.Y.Z` sobre el commit desplegado, con
  `node scripts/release/etiquetar-core.mjs <sha>`, que comprueba que este fichero tiene la sección de esa
  versión con la misma fecha que `CORE_RELEASED_AT`.
- Mientras se trabaja, los cambios se anotan en `[Sin publicar]`; al publicar, esa sección pasa a ser la
  de la nueva versión.

## [Sin publicar]

### Corregido

- La empresa puede corregir su razón social, NIF y domicilio en «Datos de la empresa»: se usan en las facturas,
  abonos y tickets que emita desde ese momento y en los textos legales de su web (los datos del alta solo como valor
  inicial). NIF/CIF, código postal, correo, teléfono e IBAN se validan también en el servidor.
- Cada factura nueva guarda una copia de los datos del emisor y de su marca: las facturas emitidas no cambian aunque
  la empresa cambie después sus datos. Las anteriores se siguen viendo exactamente como antes.
- El abono nuevo es una factura rectificativa: título, factura rectificada (número y fecha), motivo, importes en
  negativo por tipo de IVA y mención del art. 15 del Reglamento de facturación. Facturas y abonos nuevos con los
  colores de la marca. En el listado, el abono muestra la forma de pago de la factura que rectifica.
- Al facturar un ticket de caja, cada línea conserva su tipo de IVA y el desglose es el del ticket.

### Migraciones

- `0020_invoice_issuer_snapshot` (aditiva): `invoices.issuerSnapshot` (JSON, NULL en las facturas ya emitidas) y la
  tabla `invoice_issuer_baseline` con los ajustes fiscales y de marca al aplicarla. Se aplica antes del código.

## [1.1.0] - 2026-11-01

Primera entrega de la evolución hacia Elephant Core 2.0 (PR #526 a #537).

### Añadido

- **Elephant Connect — Amplía tu empresa** (`/admin/ampliar`): catálogo de extensiones con categorías,
  búsqueda, filtros, ficha comercial con el precio del catálogo y estado real (disponible, contratada,
  pendiente de configuración, en activación, no disponible para tu plan, bajo solicitud, próximamente,
  suspendida). La contratación usa el flujo existente del plano de control y Stripe, con clave de
  idempotencia; la licencia solo se activa con la confirmación del servidor, nunca al volver del pago.
- Candados discretos de extensiones no contratadas en CRM, seguimiento comercial, comunicaciones,
  usuarios y ajustes, que abren su ficha.
- Menú dinámico por extensiones: los módulos declaran en su manifiesto (contrato 1.2) sus secciones,
  entradas, pestañas, ajustes, rutas y API; el panel las muestra según licencia, rol y `coreRange`, y se
  actualiza al contratar o suspender sin cerrar sesión.
- Bienvenida a Elephant Core y asistente de configuración nuevo, persistente y recuperable, adaptado al
  tipo de actividad y a lo contratado; portada con estado de configuración, actividad reciente, tareas,
  clientes, ventas y accesos rápidos, solo con datos reales.
- Factura libre con líneas e IVA 21/10/4/0 %; importar y exportar clientes en CSV con detección de
  duplicados y revisión previa.
- Pantalla única «Datos de la empresa»; aviso «No incluido en tu plan» en rutas no contratadas.
- Versión visible en el Centro de ayuda («Acerca de Elephant Core»); `CHANGELOG.md` y etiquetas
  `core-vX.Y.Z`.

### Cambiado

- Vocabulario genérico para las empresas por licencias (pedidos, oportunidades, productos o servicios);
  los textos sectoriales solo aparecen con su módulo. La instalación de una sola empresa no cambia.
- TPV: categorías propias de la empresa, selector de caja, diseño para tablet y móvil, búsqueda de
  cliente existente y venta enlazada a su ficha.
- Ajustes filtrados por plan, sin opciones técnicas; mensajes de error en español y sin detalles internos.
- Anular una factura emite un abono total (la factura queda «abonada»); los abonos copian el desglose de
  IVA y admiten importe parcial o por líneas.
- En una pyme, los documentos nuevos toman los datos fiscales de «Datos de la empresa».
- Web pública: título de portada con el nombre de la empresa, mapa del sitio según lo publicado y
  contratado.

### Corregido

- El panel ya no muestra el menú ni el logotipo de Náyade cuando falla la consulta del plan.
- El contador de facturas y abonos no puede retroceder; la numeración usa el año de Madrid y salta
  números ocupados.
- El cierre de caja cuadra con ventas anuladas; las ventas del TPV son atómicas e idempotentes.
- Los correos programados no se envían dos veces; los tokens de recuperación e invitación se guardan
  con hash; límite de peticiones por procedimiento público.
- Presupuestos y cobros no admiten líneas a 0 €; el enlace de un presupuesto pagado sigue mostrándolo.
- Las direcciones inexistentes de la web pública responden 404; `/admin/spa` se bloquea sin licencia.

### Migraciones

- `0018_tpv_idempotencia_cliente` (aditiva): `tpv_sales.idempotencyKey` y `tpv_sales.clientId`,
  `reservations.client_id`. Se aplica antes del código.

### Compatibilidad de módulos

- Contrato de módulo 1.2.0, compatible con 1.1 (campos nuevos opcionales). Los módulos con
  `coreRange ^1.0.0` siguen siendo compatibles. En multiempresa, `hotel`, `spa` y `restaurants` exigen
  además su capacidad.

## [1.0.0] - 2026-10-31

Primera versión estable de Elephant Core (commit `af76033c`).

- Plataforma multiempresa: cada empresa con su base de datos, su dominio y sus licencias por capacidad.
- Panel de la empresa con CRM, catálogo, pedidos, facturación, caja, CMS con blog y web pública.
- Módulos con manifiesto y `coreRange` (`cms`, `commerce`, `tpv`, `hotel`, `spa`, `restaurants` y
  `ski_rental`).
- Migraciones de empresa `0001` a `0017` sobre la baseline.
