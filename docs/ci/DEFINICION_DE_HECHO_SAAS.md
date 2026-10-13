# Definición de Hecho «SaaS-ready» para funcionalidad nueva

El desarrollo funcional continúa de forma permanente. Para que cada funcionalidad nueva **no añada deuda** que luego haya que pagar en cada módulo, el CI aplica un *ratchet*: la deuda existente no bloquea nada, pero **no puede aumentar**.

## Reglas (se comprueban con `node scripts/ci/ratchet.cjs`)

| Regla | Qué evitar | Qué hacer |
|---|---|---|
| `db-pool-fuera-del-registro` | `mysql.createPool(` / `createConnection(` en un router o servicio | Usar `getDb()`; el pool lo gestiona `_core/dbRegistry` y, en el futuro, resolverá el tenant |
| `database-url-suelta` | Leer `process.env.DATABASE_URL` | Idem: `getDb()` |
| `rol-admin-heredado` | `role === "admin"` en un procedimiento | Usar `permissionProcedure("clave", [...roles heredados])` o `staffProcedure`/`adminProcedure` |
| `marca-o-dominio-fijo` | Dominio, marca o e-mail de un cliente en código | Leerlo de la configuración (`getSystemSetting…`, `APP_URL` vía `getTrustedBaseUrl()`) |
| `env-suelto` | `process.env.X` disperso por el código | Centralizar en `_core/env.ts` o `config/` |

Además, por convención (no automatizable aún):
- Tablas o columnas nuevas **solo por migración aditiva**, nunca por DDL en el arranque.
- Acceso a almacenamiento por `storagePut` (preparado para prefijo de tenant).
- Si emites un consumo medible (correo, almacenamiento, API de terceros), usa `meter()` de `_core/metering`.

## Cómo funciona el ratchet

`scripts/ci/ratchet-baseline.json` guarda los recuentos por regla y por fichero.

- **Más** líneas que la línea base en un fichero (o un fichero nuevo con incumplimientos) → el paso falla y lista el fichero.
- **Menos** líneas → informa de la mejora; corrígela en la línea base con `node scripts/ci/ratchet.cjs --update` **en el mismo PR**.

> Si tu cambio legítimamente necesita aumentar un recuento (p. ej. mover código entre ficheros), actualiza la línea base en el PR y explícalo en la descripción.

## Estado
El paso de CI es **informativo** (no bloquea el merge) mientras el equipo se acostumbra. Se volverá obligatorio por decisión explícita, con vía de excepción para hotfix.
