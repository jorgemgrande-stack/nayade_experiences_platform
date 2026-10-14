# Cifrado de campo de credenciales heredadas

Estado: **implementado y probado; NO ejecutado en producción.** `TENANT_MODE=single`, valores actuales en claro.
Las credenciales externas GHL/VAPI **no se rotan** con este procedimiento (ver `ROTACION_CREDENCIALES_GHL_VAPI.md`).

## Alcance
Claves cubiertas (todas con lectores adaptados):

| Tabla | Clave |
|---|---|
| `system_settings` | `site_ghl_api_key` |
| `site_settings` | `ghlApiKey`, `ghlInboxToken`, `ghlInboxWebhookSecret` |

VAPI y los secretos de webhook GHL/VAPI viven en variables de entorno (`integrationEnv`), no en BD: no hay nada que cifrar en base de datos.

## Formato
`enc:v1:<keyId>:<base64(iv12 | tag16 | ciphertext)>` — AES-256-GCM, AAD `legacy|<tabla>|<clave>`.
Un valor sin prefijo `enc:` es un heredado en claro y se sigue leyendo (compatibilidad). Si un valor cifrado no puede leerse
(sin claves, clave desconocida o corrupto) el lector devuelve vacío y registra solo el código del fallo; nunca el valor.

## Claves
Reutiliza `INTEGRATION_KEYS` / `INTEGRATION_ACTIVE_KEY_ID` (32 bytes base64; ver B9). Para rotar la clave activa: añade la
nueva a `INTEGRATION_KEYS`, cámbiala en `INTEGRATION_ACTIVE_KEY_ID` y conserva las anteriores mientras queden valores con su `keyId`.

## Interruptores
| Variable | Efecto |
|---|---|
| `INTEGRATION_KEYS` presente | los lectores pueden descifrar (necesario **antes** de migrar) |
| `LEGACY_CREDENTIALS_ENCRYPT=on` | las escrituras desde el panel guardan cifrado; por defecto texto plano |

Orden: 1) desplegar este código (lectores compatibles) → 2) definir claves → 3) migrar → 4) opcionalmente activar `LEGACY_CREDENTIALS_ENCRYPT=on`.

## Procedimiento
1. **Backup verificado** (B7) de las dos tablas y restauración de prueba en un entorno aislado:
   `mysqldump --single-transaction <bd> system_settings site_settings > legacy_settings_<fecha>.sql`
2. **Plan** (solo lectura): `LEGACY_CREDENTIALS_DATABASE_URL=… pnpm tsx scripts/legacy-credentials.ts plan`
   → estados `plaintext | encrypted | empty | absent | unreadable` por campo.
3. **Simulacro**: `… apply` (sin `--execute`) → informe de lo que cifraría; no escribe.
4. **Ejecución**: `… apply --execute --backup-confirmed`. Idempotente y reanudable (relanzar es seguro); cada fila se
   verifica descifrando antes de escribir y solo se actualiza si el valor sigue siendo el leído (conflicto → no se pisa).
   La auditoría queda en `legacy_credential_audit` (fecha, actor, tabla, clave, acción, `keyId`; sin valores).
5. **Verificación**: `… plan` → ningún `plaintext`; comprobar `/api/ghl/templates` (401 esperado), inbox GHL y creación de lead con GHL.
6. **Después**, en ventana aparte, rotar las credenciales externas (runbook de rotación): ya se guardarán cifradas.

## Reversión
- Inmediata y sin pérdida: `… rollback --execute --backup-confirmed` restaura el texto plano desde el cifrado (requiere las claves).
- Si faltaran las claves: restaurar el volcado del paso 1.
- El código es compatible en ambos sentidos; no hace falta redeploy para revertir los datos.

## Notas de seguridad
- La salida del CLI, los informes y los errores nunca contienen valores ni fragmentos.
- Otros consumidores genéricos de `system_settings` (p. ej. el editor de ajustes del panel por `settingKeys`) verían el texto
  `enc:v1:…` en lugar de la clave; se muestran enmascarados por `isSensitive`. Revisar antes de ejecutar en producción.
- `ghlInbox.getInboxCredentials` devuelve `webhookSecret` a perfiles *staff*: deuda preexistente anotada para la Fase 01B.
