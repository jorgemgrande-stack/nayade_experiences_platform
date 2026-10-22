# Rotación de la clave de cifrado de copias (`bk1` → `bk2`)

**Estado:** preparado y probado en local. **No aplicado en Railway.** Aplicarlo requiere una autorización aparte (paso 2 en adelante).

## 1. Motivo

El 18/10/2026, durante la preparación del ensayo de restauración, un fragmento del valor de `BACKUP_KEYS` (unos 24 caracteres en base64 de la clave `bk1`) apareció en la salida de una terminal de una sesión de Claude Code. El filtro que debía ocultarlo se aplicó después de recortar la salida y no llegó a actuar.

- **Qué queda expuesto:** aproximadamente 18 de los 32 bytes de `bk1`. Los 14 restantes (unos 112 bits) siguen fuera del alcance de un ataque por fuerza bruta, pero la clave se trata como comprometida.
- **Dónde queda:** el registro de esa conversación, guardado en el equipo del propietario.
- **Qué no queda expuesto:** ninguna otra variable. `REGISTRY_KEYS`, las URL de las bases de datos y las credenciales S3 no aparecieron.

## 2. Cómo funciona el llavero (sin cambios de código)

- `BACKUP_KEYS = id:base64(32 bytes),id2:…` y `BACKUP_ACTIVE_KEY_ID`.
- **Copias nuevas:** se cifran (AES-256-GCM) y se firman (HMAC del manifiesto) con la clave **activa**.
- **Copias existentes:** cada objeto lleva en su cabecera el identificador de su clave, y cada manifiesto, su `keyId`. Al restaurar se usa esa clave, así que una copia antigua necesita que `bk1` siga en el llavero.
- **Dónde está el llavero:** solo en los servicios `backup-job` y `restore-drill` (nombres de variables comprobados el 18/10/2026). `controlplane` y `core` no lo tienen.
- **Paquete de recuperación:** lista los identificadores de clave (`keyIds`), nunca sus valores.

## 3. Herramienta

Script: `scripts/railway/rotar-clave-copias.mjs`.

| Fase | Qué hace |
|---|---|
| `estado` | Muestra, por servicio, los identificadores, la clave activa y la huella de cada clave |
| `anadir --id bk2` | Genera `bk2` con `crypto.randomBytes(32)` y la **añade** a `BACKUP_KEYS` en los dos servicios. No la activa |
| `activar --id bk2` | Fija `BACKUP_ACTIVE_KEY_ID=bk2` en los dos servicios |
| `revertir --id bk1` | Vuelve a activar `bk1`. `bk2` se conserva |

**Garantías del script:**
- **Simulación** salvo `--apply`.
- **No borra ni sustituye** ninguna clave existente: no hay ninguna fase para retirarlas.
- **Lectura y escritura sin exponer valores:** lee con la CLI de Railway dentro del proceso y escribe con `--stdin --skip-deploys`. Ninguna clave pasa por la línea de órdenes, el historial ni los logs.
- **Salida sin secretos:** solo identificadores y huellas (HMAC-SHA256 con etiqueta fija, 12 caracteres hexadecimales, no reversibles).
- **Coherencia entre servicios:** se niega a seguir si dos servicios tienen claves distintas con el mismo identificador.
- **Relectura posterior:** después de escribir, vuelve a leerlo todo y comprueba que ninguna clave anterior falta o ha cambiado.
- **Idempotencia:** repetir `anadir` tras un fallo a medias reutiliza la `bk2` ya escrita, no genera otra.

**Pruebas:**

| Fichero | Qué comprueba | Resultado |
|---|---|---|
| `server/backupKeyRotationScript.test.ts` | Script, con la CLI simulada | 7/7 |
| `server/backupKeyRotation.mysql.test.ts` | Copia y restauración del CRM con MySQL 8.4 real | 5/5 |
| `server/backupSecurity.test.ts` | Cifrado | 20/20 |

Escenarios cubiertos por la prueba con MySQL real:
1. Copia con `bk1`.
2. Rotación: la copia nueva va con `bk2` y la antigua no cambia.
3. Las dos copias se restauran y verifican (SHA-256, HMAC, tablas, filas, `CHECKSUM TABLE` y triggers), sin tocar la base original.
4. Sin `bk1`, la copia antigua se rechaza **antes de crear ninguna base**.
5. Reversión: las tres copias se restauran.

## 4. Procedimiento (requiere autorización)

**Antes de empezar:**
- La PR de este procedimiento, integrada en `integration/elephant-source`.
- La última ejecución de `backup-job`, correcta.
- Un ensayo de restauración del CRM hecho con éxito, como referencia.

**Importante:** en Railway, un cambio de variables con `--skip-deploys` no llega a los servicios hasta su siguiente despliegue. Cada paso de variables va seguido de un despliegue con `railway up` del export verificado del commit autorizado (nunca `redeploy`; ver `RAILWAY_ELEPHANT_SOURCE.md` §8). Ese despliegue necesita el permiso de despliegue en producción.

| # | Paso | Aceptación | Si falla |
|---|---|---|---|
| 1 | `node scripts/railway/rotar-clave-copias.mjs estado` | Los dos servicios tienen `bk1` con la misma huella y está activa | Parar: llaveros distintos |
| 2 | `anadir --id bk2` (simulación) y después `--apply` | `estado`: `bk1` y `bk2` en los dos servicios, `bk1` activa | Repetir `anadir`: reutiliza la `bk2` escrita |
| 3 | `railway up` de `backup-job` y `restore-drill` | Arranque sin errores de llavero. La siguiente copia, correcta y con `clave` = `bk1` | Volver al despliegue anterior. `bk2` en el llavero no molesta |
| 4 | **Custodia:** el propietario copia `bk2` desde el Dashboard de Railway (`backup-job` → Variables → `BACKUP_KEYS`) **directamente** a su gestor de contraseñas, junto a la custodia de `bk1`. No se pega en ningún chat, terminal ni documento | Confirmación por escrito del propietario | No activar `bk2` sin custodia: si se perdiera Railway, las copias nuevas serían irrecuperables |
| 5 | `activar --id bk2` (simulación) y después `--apply`, y `railway up` de los dos servicios | `estado`: `bk2` activa en los dos | Paso 7 (reversión) |
| 6 | **Verificación** | Ver la lista de abajo | Paso 7 (reversión) |
| 7 | **Reversión** (solo si hace falta): `revertir --id bk1 --apply` y `railway up` de los dos servicios | `bk1` activa y `bk2` sigue en el llavero | — |

**Verificación del paso 6:**
- Siguiente ejecución de `backup-job`: `ok`, y la columna `clave` de `backup-job.js list --limit 12` es `bk2` en las copias nuevas.
- El paquete `config/recovery` se genera (requiere la corrección de la PR #133).
- Ensayo de restauración con `restore-drill` en bases **nuevas**: una copia del CRM con `bk1` y otra con `bk2`, las dos con `verification.ok: true`.

**Nunca retirar `bk2`** una vez que haya cifrado alguna copia, ni siquiera al revertir.

## 5. Retirada de `bk1` (más adelante, con otra autorización)

- **Cuándo:** solo cuando no quede ninguna copia cifrada con `bk1` en ningún destino. Se comprueba con `backup-job.js list` (columna `clave`) y, si se configura, también en el secundario.
- **Plazo:** con la retención 30/12/12 (diarias, semanales y mensuales), unos **12 meses** después de activar `bk2`.
- **Cómo:** el script no tiene esa fase a propósito. Se hará con una revisión aparte.
- **Alternativa más rápida:** volver a cifrar con `bk2` las copias antiguas. Supone modificar copias existentes y hoy **no está autorizado**.

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| Activar `bk2` sin custodia fuera de Railway | Paso 4 obligatorio antes del 5 |
| Llaveros distintos entre `backup-job` y `restore-drill` | El script se niega a seguir. Los despliegues van juntos |
| Variables cambiadas, pero el servicio sigue con las anteriores | Despliegue explícito tras cada paso y aceptación en los logs |
| Un `redeploy` reconstruye una imagen distinta | Solo `railway up` desde el export verificado |
| Pérdida de `bk1` antes de tiempo | No hay orden de retirada. La prueba con MySQL demuestra que sin `bk1` lo antiguo no se restaura |
