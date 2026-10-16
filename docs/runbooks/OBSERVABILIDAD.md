# Observabilidad mínima (Fase P1)

Qué mirar para operar con los primeros clientes: correlación de peticiones, eventos estructurados, salud, alertas e historial por empresa.

## 1. Identificador de correlación (`X-Request-Id`)

- **Core** (`server/_core/ops/requestContext.ts`, montado en `server/_core/index.ts`) y **plano de control** (`server/controlPlane/api.ts`).
- Se acepta el valor entrante solo si cumple `^[A-Za-z0-9._:-]{8,64}$`; si no, se genera un UUID. Nunca se refleja un valor arbitrario.
- Se devuelve siempre en la cabecera `X-Request-Id`, también en errores y 404. En el plano de control está expuesto por CORS (`Access-Control-Expose-Headers`).
- Viaja en AsyncLocalStorage: cada línea de `opsLog` de la petición lleva `requestId` y, si hay empresa resuelta, `tenantId`. Un segundo middleware (`rebindRequestContext`) recupera el contexto después de leer el cuerpo de la petición.
- Plano de control: el identificador se guarda en la auditoría del registro (`tenant_events.request_id`). Para seguir una operación del CRM, el CRM puede enviar su propio `X-Request-Id`.

## 2. Eventos estructurados

Formato: una línea JSON `{ ctx, event, …, tenantId?, requestId? }` (`server/_core/ops/log.ts`). Antes de escribir se aplica esta limpieza:

- Las claves sensibles (contraseñas, tokens, secretos, DSN, cookies, firmas, hashes) se sustituyen por `[redactado]`.
- Los correos se enmascaran: `a***@dominio`.
- Los JWT y los tokens largos se sustituyen por `[token]`.
- Los textos se recortan a 200 caracteres y de los errores solo se registra el tipo (`Error.name`).

| ctx / event | Dónde | Datos |
|---|---|---|
| `Auth / login_failed` | `server/localAuth.ts` | `reason`: `invalid_credentials`, `locked`, `cross_origin`, `db_unavailable`, `account_inactive` o `session_error`. Nunca el correo ni si la cuenta existe. |
| `Licensing / capability_denied`, `module_denied` | guardas de licencias del Core | capacidad o módulo, estado, si es escritura |
| `Licensing / capability_check_failed`, `module_check_failed` | ídem | no se pudo verificar la licencia (503) |
| `Provisioning / step_failed` | `server/_core/provisioning/service.ts` | empresa, paso, intentos, tipo de error |
| `Orders / internal_error`, `payment_event_failed`, `payment_effect_pending` | orquestador | método, tipo de error, pedido |
| `Subscriptions / internal_error` | API de suscripciones | método, tipo de error |
| `Mailer / provider_error`, `send_failed` | `server/mailer.ts` (Core) | canal, código HTTP o SMTP. Sin destinatarios ni asunto. |
| `Trials / *_failed`, `*_sent`, `*_not_sent` | `server/trials/emailNotifier.ts` | prueba o empresa, proveedor. Sin dirección. |
| `ControlPlane / internal_error`, `unhandled_error` | plano de control | método, tipo de error |
| `Health / registry_unavailable` | `/readyz` del plano de control | — |
| `Diagnostics / tenant_not_healthy` | diagnóstico por empresa | comprobaciones fallidas |
| `Alerts / threshold_exceeded` | alertas por repetición | tipo, número de fallos, ventana |

Además, los logs de envíos correctos del Core (`[Mailer] ✓ …`) ya no muestran la dirección completa del destinatario.

## 3. Salud

| Servicio | Vivo | Listo |
|---|---|---|
| Core, modo single/shadow | `GET /healthz` | `GET /readyz`: `checks.database` (BD de la aplicación) |
| Core, modo multi | `GET /healthz` | `GET /readyz`: `checks.registry` (BD del registro) y, si el `Host` es el dominio de una empresa servible, `checks.tenantDatabase` (BD de esa empresa) |
| Plano de control | `GET /healthz` | `GET /readyz`: `checks.registry` |

- Las respuestas son públicas y sin detalles internos: solo `ok` o `error` por comprobación, con 200 o 503. No muestran mensajes, hosts ni versiones.
- Detalle por empresa, solo para operadores: `GET /cp/v1/tenants/:id/diagnostics` (ámbito `ops:read`). Revisa el estado, los dominios, la BD activa y alcanzable, el esquema y las licencias, sin DSN ni claves.

## 4. Alertas críticas mínimas

`server/_core/ops/failureAlerts.ts` usa una ventana deslizante en memoria. Al alcanzar el umbral:

- emite `Alerts / threshold_exceeded`;
- en el plano de control, abre o actualiza una incidencia deduplicada `rate:<tipo>` en `ops_incidents`. Es el mismo mecanismo que el resto de alertas: aviso por `CP_ALERT_WEBHOOK` solo al abrir, reabrir o escalar.

| Tipo | Umbral | Severidad |
|---|---|---|
| `provisioning.failed` (altas fallidas) | 3 en 60 min | crítica |
| `mail.send_failed` (correo) | 5 en 15 min | crítica |
| `orders.failed` (pedidos, pagos de prueba, suscripciones) | 3 en 30 min | crítica |
| `licensing.check_failed` | 10 en 5 min | aviso |

- Las incidencias `rate.*` no se cierran solas: un operador las revisa y las resuelve (`POST /cp/v1/incidents/:id/resolve`).
- En el Core (solo lectura del registro), la alerta queda únicamente en el log y la recoge el agregador de logs.
- Los contadores viven en memoria del proceso: se reinician al reiniciar el servicio y no se suman entre réplicas.

## 5. Historial de eventos por empresa (dónde está)

| Qué | Tabla (BD) | Consulta |
|---|---|---|
| Ciclo de vida, dominios, BD, cuotas, licencias de módulo | `tenant_events` (registro). Incluye actor y `request_id`. | `GET /cp/v1/tenants/:id/events`; cuotas en `GET /cp/v1/tenants/:id/quotas/history` |
| Licencias por capacidad | `tenant_capability_events` (registro 0008) | `GET /cp/v1/tenants/:id/capabilities` (`events`) |
| Prueba gratuita | `trial_events` (CRM 0007) | `GET /cp/v1/trials/:id` (`events`, añadido en esta fase) |
| Suscripción | `subscription_events` (CRM 0006) | `GET /cp/v1/subscriptions/:id` (`events`) |
| Pedidos y pagos de prueba | `commercial_order_events`, `commercial_payment_events` (CRM 0010) | `GET /cp/v1/orders/:id` (`events`, `payments`) |
| Tickets de soporte | `support_ticket_events` (registro 0006) | `GET /cp/v1/tickets/:id` |
| Incidencias operativas | `ops_incidents` (registro 0005) | `GET /cp/v1/incidents?tenantId=` |

La prueba, la suscripción y el pedido se enlazan con la empresa a través de su `tenantId` o de la empresa del CRM. No hay una vista única que lo agregue todo: queda pendiente para el CRM interno.
