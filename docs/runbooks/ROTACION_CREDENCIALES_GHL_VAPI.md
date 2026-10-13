# Procedimiento de rotación de credenciales GHL y VAPI

**Estado:** preparado, **no ejecutado**. La rotación afecta a servicios externos y requiere coordinación (ver §9).
**Motivo:** `GET /kb` y `GET /kb.json` publicaron, sin autenticación, valores de `site_settings` hasta la corrección S9 (PR #3, fusionado 2026-10-13 18:06 UTC). Lo expuesto debe considerarse conocido.

---

## 1. Qué se expuso exactamente

Claves de `site_settings` que `/kb.json` devolvía en producción antes del arreglo (comprobado):

| Clave | Naturaleza | ¿Rotar? |
|---|---|---|
| `ghlApiKey` | Token de API de GoHighLevel | **Sí** |
| `ghlInboxToken` | Token de GHL del inbox WhatsApp | **Sí** |
| `vapiApiKey` | Clave de API de VAPI | **Sí** |
| `ghlLocationId`, `ghlInboxLocationId` | Identificadores de ubicación (no son secretos) | No |
| `legalCompanyIban` | IBAN de la empresa (dato bancario, no credencial) | No se rota; ver §8 |
| `legalCompany*` (resto) | Datos legales ya públicos | No |

**No se expusieron** (no figuraban en la respuesta): `ghlInboxWebhookSecret`, `vapiWebhookSecret`, `GHL_WEBHOOK_SECRET` (variable de entorno). No es necesario rotarlos por esta causa.

> No se conoce desde cuándo estaba expuesto ni si fue consultado. La ventana de exposición es, como mínimo, hasta 2026-10-13 18:06 UTC. Por eso se rota y, además, se revisan los registros de uso (§8).

## 2. Dónde vive cada credencial y qué prevalece

| Credencial | Orden de resolución en el código (primero gana) |
|---|---|
| Token API GHL (CRM, leads, presupuestos, cancelaciones…) | `GHL_API_KEY` (env, **ausente** en producción) → `system_settings.site_ghl_api_key` → `site_settings.ghlApiKey` (heredada) |
| Token GHL del inbox WhatsApp | `GHL_PRIVATE_INTEGRATION_TOKEN` (env, ausente) → `site_settings.ghlInboxToken` → `system_settings.site_ghl_api_key` → `site_settings.ghlApiKey` |
| Clave VAPI | `VAPI_API_KEY` (env, **ausente**) → `site_settings.vapiApiKey` |
| Secreto webhook inbox GHL | `GHL_WEBHOOK_SECRET` (env, presente) → `site_settings.ghlInboxWebhookSecret` |
| Secreto webhook VAPI | `VAPI_WEBHOOK_SECRET` (env, ausente) → `site_settings.vapiWebhookSecret` → `GHL_WEBHOOK_SECRET` |
| Secreto webhook leads GHL | `GHL_LEAD_WEBHOOK_SECRET` (env, **ausente**: el webhook de leads no valida nada) |

**Punto crítico:** el arranque copia `site_settings` → `system_settings` si el destino está vacío (`server/_core/index.ts`, migración de ajustes). Es probable que el token API exista **duplicado** (`system_settings.site_ghl_api_key` y `site_settings.ghlApiKey`). Hay que actualizar ambas fuentes o la antigua seguirá activa en la heredada. Ver §4, comprobación previa.

## 3. Inventario de consumidores (qué usa cada credencial)

### Token API GHL — `getGHLCredentials()` (`server/db.ts:52`)
| Flujo | Dónde |
|---|---|
| Alta/actualización de contactos y leads | `server/db.ts:338-373` (post-reserva), `server/db.ts:2439` |
| Notificaciones de reserva pagada / cupones | `server/redsysRoutes.ts:451,615` |
| Presupuestos y propuestas | `server/routers/crm.ts:1670,1741,1983,3027,5200`, `server/routers/proposals.ts:337` |
| Cancelaciones y bonos | `server/routers/cancellations.ts:553,859,1054` |
| Ticketing / cupones de plataformas | `server/routers/ticketing.ts:474,725,753,946,1929` |
| TPV | `server/routers/tpv.ts:1341` |
| Partners | `server/routers/partners.ts:695` |
| Prueba de conexión (admin) | `server/routers.ts:811` → `testGHLConnection` (`server/ghl.ts:70`) |
| Ajuste en panel | `ConfigPanel.tsx:120` (`site_ghl_api_key`), `server/routers.ts:745-829` |

### Token GHL del inbox — `getInboxCredentials()` (`server/routes/ghlInboxRouter.ts:217`, `server/routers/ghlInbox.ts:232`)
Bandeja WhatsApp (listar, responder, nueva conversación, plantillas, sincronización). Se guarda con `ghlInbox.saveInboxCredentials` (`ghlInbox.ts:246`).

### Clave VAPI (`server/routers/vapiCalls.ts:53,217-255`)
Sincronización de llamadas (`syncCalls`) y estadísticas. Se guarda con `vapiCalls.saveCredentials` (`vapiCalls.ts:232`).

### Consumidores **externos** (fuera del repositorio)
- **Workflows de GoHighLevel** que llaman a `POST /api/ghl/inbox/webhook` (con `GHL_WEBHOOK_SECRET`) y a `POST /api/ghl/webhook` (leads, sin secreto hoy). **No dependen de la API key**: no cambian al rotarla.
- **Agente de IA de GHL** que lee `/kb`: no usa credenciales.
- **Asistentes de VAPI** que llaman a `POST /api/vapi/webhook`. **No dependen de la API key.**

> Rotar las claves de API **no** requiere tocar los workflows de GHL ni los asistentes de VAPI.

## 4. Comprobaciones previas (solo lectura)

1. **Saber en qué fuentes está cada valor y si coinciden**, sin mostrarlos (consulta en la consola MySQL de Railway):

```sql
SELECT 'site_settings' AS origen, `key`, LENGTH(`value`) AS longitud, LEFT(SHA2(`value`, 256), 8) AS huella
  FROM site_settings
 WHERE `key` IN ('ghlApiKey','ghlInboxToken','vapiApiKey','ghlInboxWebhookSecret','vapiWebhookSecret')
UNION ALL
SELECT 'system_settings', `key`, LENGTH(`value`), LEFT(SHA2(`value`, 256), 8)
  FROM system_settings
 WHERE `key` IN ('site_ghl_api_key');
```
   Resultado esperado: filas con la misma huella = el mismo valor duplicado (hay que actualizarlas todas).
2. **Salud actual**: con sesión de administrador, `GET /api/ghl/inbox/health` debe devolver `credentials.hasToken = true`.
3. **Referencia de uso normal** (para detectar uso anómalo después): anotar volumen diario habitual de mensajes y llamadas.
4. **Acceso**: administrador de la cuenta GHL (Private Integrations) y de la cuenta VAPI; administrador de la aplicación.

## 5. Procedimiento — GHL (token de API e inbox)

Diseño **sin corte de servicio**: el token nuevo se crea y se verifica **antes** de revocar el antiguo (en GHL varios tokens de integración privada pueden convivir).

1. En GHL → *Settings → Private Integrations*: **crear un token nuevo** con los mismos permisos que el actual. No eliminar el antiguo todavía.
2. Guardar el valor nuevo en el gestor de contraseñas del equipo.
3. En la aplicación (administrador):
   1. *Configuración* (`/admin/configuracion`) → integración GoHighLevel: pegar el token nuevo en **GoHighLevel API Key** (`site_ghl_api_key`). Pulsar «Probar conexión».
   2. *Atención comercial → WhatsApp* (`/admin/atencion-comercial/whatsapp`) → configuración de credenciales del inbox: pegar el mismo token nuevo en **Token**.
4. Si la comprobación previa (§4.1) mostró `site_settings.ghlApiKey` o `ghlInboxToken` con la huella antigua, **vaciar** esas filas heredadas (consulta en la consola MySQL, con copia previa de las filas):

```sql
-- Solo tras confirmar que el panel ya usa el valor nuevo
UPDATE site_settings SET `value` = '' WHERE `key` IN ('ghlApiKey');
```
   (`ghlInboxToken` se actualiza desde la pantalla del inbox; no hace falta tocarlo por SQL.)
5. **Verificación** (§7). Si todo es correcto, esperar la ventana de observación (§6) y solo entonces **eliminar el token antiguo en GHL**.

## 6. Procedimiento — VAPI

1. En VAPI → *API Keys*: **crear una clave privada nueva**. No revocar la antigua todavía.
2. En la aplicación: *Atención comercial → Agente de voz (VAPI)* → credenciales: pegar la clave nueva en **API Key** y guardar (`vapiCalls.saveCredentials`).
3. Verificación (§7): pulsar «Sincronizar» (solo lectura de llamadas).
4. Tras la ventana de observación, **revocar la clave antigua en VAPI**.

### Ventana de observación
Mantener ambas credenciales válidas **24 horas** tras el cambio. Es la reversión: si algo falla, basta con volver a pegar la antigua en la aplicación.

## 7. Verificación (sin acciones reales)

**No** enviar WhatsApp, no crear reservas de prueba, no lanzar llamadas.

| Comprobación | Cómo | Resultado esperado |
|---|---|---|
| Conexión GHL (CRM) | Panel → «Probar conexión» (`testGHLConnection`, lectura) | Conexión correcta |
| Credenciales del inbox | `GET /api/ghl/inbox/health` con sesión admin | `hasToken: true`, `hasLocationId: true` |
| Lectura de plantillas | Abrir la bandeja WhatsApp → plantillas (solo lectura) | Lista de plantillas |
| VAPI | «Sincronizar» en Agente de voz | Sin error; recuentos coherentes |
| Webhook entrante | Esperar el siguiente evento real de GHL | Evento registrado en `ghl_webhook_events` |
| El token **antiguo** ya no vale | Desde un equipo del responsable: `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer <ANTIGUO>" -H "Version: 2021-07-28" https://services.leadconnectorhq.com/locations/<LOCATION_ID>` tras revocarlo | `401`/`403` |
| La fuga está cerrada | `GET /kb.json`: ninguna clave de aspecto sensible | `settings` con 8 claves `legalCompany*` |

## 8. Después de rotar

1. **Revisar actividad en el periodo de exposición** (para detectar uso indebido):
   - GHL: registro de auditoría y mensajes salientes que nadie del equipo enviara; contactos creados de forma anómala.
   - VAPI: panel de uso y costes; llamadas salientes no previstas.
2. **IBAN expuesto:** no se rota (es un dato bancario). Avisar a la entidad bancaria / revisar domiciliaciones y adeudos no reconocidos; informar a quien gestione la tesorería.
3. **Endurecimiento pendiente (coordinado con GHL/VAPI):**
   - Definir `GHL_LEAD_WEBHOOK_SECRET` en Railway y añadir la cabecera `x-ghl-secret` en el workflow de GHL que llama a `/api/ghl/webhook`. Hasta entonces el webhook de leads **no valida nada**.
   - Definir `VAPI_WEBHOOK_SECRET` propio (hoy cae a `GHL_WEBHOOK_SECRET`) y actualizarlo en los asistentes de VAPI.
4. **RGPD:** valorar con el responsable legal si la exposición de credenciales con acceso a datos personales (contactos de GHL, conversaciones de WhatsApp) requiere notificación.

## 9. Coordinación y límites

| Aspecto | Detalle |
|---|---|
| Quién ejecuta | Administrador de GHL y de VAPI + responsable de la aplicación. **No** lo ejecuta el desarrollo automatizado |
| Cuándo | Franja de baja actividad; duración estimada 30–45 min + 24 h de observación |
| Impacto esperado | Ninguno si se respeta el orden (crear → actualizar → verificar → revocar) |
| Riesgo principal | Pegar el token en una sola de las dos fuentes (`system_settings` / `site_settings`) y que parte del flujo siga con el antiguo; se evita con §4.1 |
| Reversión | Volver a pegar la credencial antigua (válida durante la ventana de 24 h) y repetir §7 |
| Qué no se hace aquí | No se cambian variables de Railway, no se despliega, no se reescribe historial |

## 10. Lista de comprobación

- [ ] Huellas de §4.1 anotadas (qué fuentes contienen cada valor)
- [ ] Token GHL nuevo creado y guardado en el gestor
- [ ] Panel: API key GHL actualizada y «Probar conexión» correcta
- [ ] Inbox: token actualizado; `health` correcto
- [ ] Filas heredadas de `site_settings` vaciadas (si coincidían)
- [ ] Clave VAPI nueva creada; credenciales guardadas; «Sincronizar» correcto
- [ ] 24 h de observación sin incidencias
- [ ] Token GHL antiguo eliminado; clave VAPI antigua revocada
- [ ] Antiguos verificados como inválidos (§7)
- [ ] Revisión de actividad del periodo de exposición (§8.1)
- [ ] Banco informado (§8.2)
- [ ] `GHL_LEAD_WEBHOOK_SECRET` y `VAPI_WEBHOOK_SECRET` planificados (§8.3)
