# Captación comercial desde la web (www.bigelephant.es)

La web comercial envía las solicitudes de sus formularios a una API pública del plano de control. Cada envío queda registrado en el CRM como **solicitud de un lead**: no existe una bandeja aparte. El lead sigue su ciclo normal (estado, responsable, historial, conversión a empresa y oportunidad).

## Qué puede hacer la API pública (y qué no)

| Ruta | Para qué |
|---|---|
| `GET /cp/v1/public/form-ticket` | Entrega un ticket firmado que el formulario debe devolver al enviar. |
| `POST /cp/v1/public/requests` | Registra una solicitud. Responde solo `{status, reference, type, duplicate}`. |

- **No puede** leer datos del CRM, crear tenants, activar licencias, aprovisionar ni hacer ninguna operación administrativa. Cualquier otra ruta bajo `/public` devuelve 404, y el resto del plano de control sigue exigiendo autenticación.
- **La web no lleva credenciales.** No hay tokens ni cookies: la protección es la que se describe abajo.

## Tipos de solicitud

`trial` (prueba de 15 días), `onboarding` (sesión), `contact`, `configuration` (desde «Construye tu Elephant»), `extension_info` y `module_info`. Los dos últimos exigen `interest`, y `configuration` exige la configuración elegida.

- **Prueba:** queda **pendiente**. No se aprovisiona nada. La activación sigue siendo manual desde el CRM: convertir el lead y lanzar el alta desde la ficha de empresa, que ya exige `provisioning:write`. El tipo y el estado de la solicitud son el punto de enganche para automatizarla en el futuro, con autorización expresa.
- **Onboarding:** se guarda la preferencia horaria del visitante. **No es una cita**: el equipo propone la fecha.

## Protección

| Medida | Detalle |
|---|---|
| Origen | Solo los de `CP_PUBLIC_ORIGINS` (exactos). Sin `Origin`, o con otro, la respuesta es 403. CORS sin credenciales; cabeceras `content-type` e `idempotency-key`. |
| Ticket | HMAC con `CP_PUBLIC_FORM_SECRET`. Debe tener entre 3 s de antigüedad (tiempo mínimo para rellenar) y 2 h (caducidad). Es de un solo uso, salvo para reintentar exactamente la misma solicitud. |
| Campo trampa | `website`: si llega relleno, la respuesta es un 202 neutro y no se guarda nada. |
| Límites | 10 envíos y 60 tickets por IP cada 10 min; 5 solicitudes nuevas por correo y hora; además, el límite general del plano de control. Al superarlos: 429 con `Retry-After`. |
| Validación | zod estricto: un campo desconocido devuelve 400. Los errores indican solo el nombre del campo, nunca los valores recibidos. Cuerpo máximo de 16 KB. |
| Idempotencia | La cabecera `Idempotency-Key` (UUID) es obligatoria. Misma clave y mismo contenido devuelven la misma respuesta; misma clave con otro contenido devuelve 409. La BD lo garantiza con una clave única, también entre réplicas. |
| Duplicados | Un lead abierto con el mismo correo se reutiliza y solo se rellenan sus campos vacíos: **nunca se sobrescriben datos comerciales**. El mismo envío repetido en 24 h no crea otra solicitud. Si el cliente ya estaba convertido, se crea un lead nuevo enlazado a su empresa. |
| Datos personales | La IP se guarda solo como HMAC (seudónimo, para abuso). El historial del lead no copia teléfonos ni mensajes. El registro (`ctx: PublicIntake`) no lleva correos ni nombres. Los consentimientos se guardan por separado: privacidad (obligatorio, con versión del texto) y comunicaciones comerciales (opcional). |
| Errores | Un fallo transitorio de BD devuelve 503 con `Retry-After: 30` (el ticket no se consume). Cualquier otro error devuelve 500 `{error:"internal_error"}`, sin detalles. |

## Gestión en el CRM (`/cp/v1/crm`, sesión de operador o token con `crm:*`)

- `GET /crm/requests?type&status&owner&q`: bandeja. Cada fila es una solicitud con su lead. `owner=-` filtra las que no tienen responsable.
- `GET /crm/leads/:id`: incluye `requests` (sin clave de idempotencia, huella ni IP).
- `POST /crm/requests/:id/status {status: pending|attended|discarded}`: requiere `crm:write`. Al atender la primera solicitud, un lead nuevo pasa a «contactado».
- `GET /crm/assignees`: operadores activos con permisos comerciales, para elegir responsable.
- `GET /crm/dashboard`: incluye `webRequests` (pendientes por tipo).
- Seguimiento, asignación y conversión a oportunidad usan las rutas de leads y actividades de siempre.

## Puesta en marcha

1. Aplicar la migración del CRM `db/crm/migrations/0003_crm_web_requests.sql` **antes** de desplegar el código, con el ejecutor común (dry-run primero; ver `db/crm/migrations/README.md`).
2. Configurar `CP_PUBLIC_ORIGINS=https://www.bigelephant.es` y `CP_PUBLIC_FORM_SECRET` (≥ 32 caracteres aleatorios, solo en el servidor). Configurar también `CP_TRUST_PROXY` detrás de un proxy, para que los límites por IP usen la IP real.
3. En el arranque, el registro `{"ctx":"PublicIntake","enabled":true,…}` confirma que está activa. Con `enabled:false`, el campo `reason` indica qué falta.
4. Compilar la web con `PUBLIC_INTAKE_URL=https://<plano-de-control>/cp/v1/public`.

## Retención

Las solicitudes viven mientras viva su lead. Queda pendiente definir con asesoría legal el plazo de conservación de leads no convertidos y la purga correspondiente. No se activa ninguna eliminación automática sin autorización expresa.
