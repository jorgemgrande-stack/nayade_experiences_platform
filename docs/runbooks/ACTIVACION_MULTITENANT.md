# Runbook: del modo `single` al modo `multi`

Estado: **preparado, no ejecutado.** Producción permanece en `TENANT_MODE=single` hasta completar la validación multiempresa y una autorización específica.

## Variables (todas nuevas; ninguna toca la configuración existente)
| Variable | Uso |
|---|---|
| `TENANT_MODE` | `single` (defecto) · `shadow` · `multi` |
| `REGISTRY_DATABASE_URL` | BD del registro, usuario de **solo lectura** (Core) |
| `REGISTRY_ADMIN_DATABASE_URL` | Usuario de escritura; solo la CLI de operador, nunca el Core |
| `REGISTRY_KEYS` / `REGISTRY_ACTIVE_KEY_ID` | Claves AES-256-GCM de DSN (`id:base64`, separadas por coma) |
| `TENANT_SHADOW_CURRENT_ID` | Tenant que hoy atiende todo el tráfico (defecto `nayade`) |
| `TENANT_LEGACY_SESSION_TENANT` | Tenant al que se atribuyen las sesiones previas sin `tid` (evita cierre masivo) |

## Secuencia
1. **Registro**: crear la BD del registro (una instancia aparte), aplicar `db/registry/0000_registry.sql`, crear usuario de solo lectura para el Core.
2. **Alta de Náyade** con la CLI (`scripts/tenants/cli.ts`): `create`, `domain-add` (sus dominios), `db-register --dsn-env`, `db-activate`, `status … trial|active`. Todo en dry-run hasta `--apply`.
3. **Sombra** (`TENANT_MODE=shadow` + `REGISTRY_DATABASE_URL`): el Core resuelve cada host y compara con el comportamiento actual **sin efecto**. Métrica `tenant.shadow` y avisos `TenantShadow`. Criterio de paso: ningún `mismatch`/`unknown_domain` para tráfico legítimo durante el periodo acordado.
4. **Preproducción multi** con dos tenants de prueba y la suite de aislamiento (`server/tenantIsolation*.test.ts`) en verde.
5. **Producción multi**: solo con autorización específica. Reversión inmediata: `TENANT_MODE=single`.

## Garantías implementadas (con pruebas)
- Dominio desconocido → 404 sin tocar BD; nunca `DATABASE_URL` como respaldo.
- Tenant resuelto solo por `Host` → registro; se ignoran cabeceras, query y cuerpo.
- Sesión con `tid` validado contra el tenant resuelto; token de un tenant no vale en otro.
- Suspendido: sin web pública, sin escrituras de negocio; archivado/eliminado: 410.
- Registro caído: hasta 10 min de continuidad con lo ya resuelto; después, 503 (falla cerrado).
- Jobs: `runForEachTenant` (un contexto por tenant con escrituras); sin contexto, `getTenantId()` lanza.
- Pools por tenant con expulsión LRU; DSN descifrado solo en memoria, nunca en logs ni auditoría.

## Pendiente antes de `multi` real
- Cachés en proceso con clave por tenant (settings, flags, HTML, emisor SSE).
- Prefijo de almacenamiento de ficheros por tenant.
- Programador de tareas (cron de `_core/index.ts`) envuelto en `runForEachTenant`.
- Verificar titularidad/DNS de `elephantsource.es` y definir el CNAME de plataforma.
