# Auditoría de numeración (solo lectura) y compatibilidad con #955

Procedimiento `documentNumbers.auditSeries`: devuelve agregados numéricos de la numeración de UNA empresa, sin escribir nada.
Sirve para decidir, empresa por empresa, si la serie propia de devoluciones de #955 (`DEV-AAAA-NNNN`, contador `devolucion`) es compatible con los DEV históricos.

## Garantías

- Solo lectura: se ejecuta en una transacción `START TRANSACTION READ ONLY` (MySQL rechaza cualquier escritura). Sin migración.
- Autenticación y autorización existentes: `adminProcedure` (sesión del administrador de la empresa, permiso `settings.manage`). Sin sesión: 401; sin rol: 403.
- Aislamiento: la consulta usa la conexión de la empresa del host de la petición; nunca cruza empresas. Una sesión de A no sirve en el host de B.
- Sin datos personales ni importes: solo nombres de serie (prefijo), años y enteros. Salida determinista (ordenada, sin marcas de tiempo).

## Cómo ejecutarlo en una empresa

1. Entrar en el panel de la empresa (`https://<empresa>.<dominio>`) con su administrador.
2. Con la sesión abierta, abrir en el navegador (o `curl` con la cookie de sesión):
   `https://<empresa>.<dominio>/api/trpc/documentNumbers.auditSeries`
   El resultado viene en `result.data.json`. Repetir por empresa; no hace falta (ni se puede) cruzar.
3. Guardar solo la salida (no contiene datos personales).

## Campos

| Campo | Significado |
|---|---|
| `counters[]` | Por serie y año: prefijo, `currentNumber` y `rows` (filas del contador; >1 = duplicado heredado) |
| `devTransactions[]` | Transacciones `DEV-AAAA-N` por año: `count`, `min`, `max`, `distinct`, `gaps` (= max - distinct) |
| `devNonConforming` | Transacciones con número `DEV-…` que no cumple `DEV-AAAA-N`; #955 no las cuenta |
| `invoiceSeries[]` | Facturas `PREFIJO-AAAA-N` por prefijo y año: `count`, `min`, `max`, `gaps` |
| `invoiceNonConforming` | Facturas con número que no cumple el formato |
| `facturaNumbersConsumedByRefunds[]` | Números de la serie `factura` consumidos por devoluciones (contexto `cancellations:refundTransaction:*` / `partialLineRefund:*`); explican los huecos de facturas previos a #955 |
| `assessment[]` | Por año con DEV o contador `devolucion`: `devCounter`, `devMaxEmitted`, `needsAdvance`, `duplicateCounterRows`, `duplicateDev` |

## Cómo interpretar el resultado respecto a #955

#955 calcula el mayor `DEV-AAAA-N` existente en `transactions` y adelanta el contador `devolucion` con `GREATEST` (nunca retrocede) antes de numerar.

- Sin `devTransactions` y sin contador `devolucion`: compatible; la serie arranca en `DEV-AAAA-0001`.
- `needsAdvance: true`: caso esperado en empresas con DEV históricos; #955 adelantará el contador a `devMaxEmitted`. Compatible. Los `gaps` en DEV son normales (los DEV históricos saltaban al ritmo de las facturas).
- `needsAdvance: false` con DEV históricos: el contador ya cubre el máximo; compatible.
- `duplicateCounterRows: true`: bloquea hasta limpiar (#955 usa la fila de menor id; revisar que sea la correcta).
- `duplicateDev: true`: no debería ocurrir (índice único); investigar antes de publicar.
- `devNonConforming > 0`: informativo; esos números no colisionan con la serie nueva pero conviene revisarlos.
- `devMaxEmitted` > 9999: los números exceden el relleno de 4 dígitos; el formato sigue siendo válido (`DEV-AAAA-10000`) pero se debe saber.
- Las facturas (`invoiceSeries`) no se tocan por #955: sus huecos (`facturaNumbersConsumedByRefunds`) son previos y no cambian. Tras publicar #955 no deben aparecer huecos nuevos por devoluciones.

Ejecutar antes y después de publicar #955 y comparar: tras publicar, `devCounter` debe ser >= `devMaxEmitted` en los años con devoluciones nuevas y `invoiceSeries` no debe ganar huecos.

## Pruebas

`server/numberingAudit.mysql.test.ts` (MySQL real, opt-in con `REGISTRY_TEST_DATABASE_URL`): resultado correcto, determinismo, aislamiento, solo lectura (instantánea de tablas y comprobación estática), 401/403 y ausencia de datos personales.
