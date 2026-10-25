# Avisos internos de las solicitudes de la web

Cada solicitud válida de www.bigelephant.es (demostración, contacto, prueba, contratación y el resto de tipos)
avisa por correo al equipo que la atiende. El aviso solo va al equipo: el cliente no recibe nada.

## Recorrido

1. Formulario → `POST /cp/v1/public/requests`. Antes de registrar nada se aplican:
   - comprobación de origen;
   - ticket firmado;
   - campo trampa;
   - límites por IP y por correo;
   - validación;
   - `Idempotency-Key`.
2. `WebRequestService.receive` **guarda la solicitud** en el CRM, en `crm_lead_requests`, ligada a su lead. Después responde al visitante.
3. Después del registro y sin retrasar la respuesta, `LeadNoticeService.onCreated` encola un aviso por destinatario en la bandeja de la plataforma (`mail_outbox`). La clave es `lead-request:<solicitud>:o<operador>`.
4. La bandeja envía por Postmark:
   - reintenta los fallos temporales con espera creciente y un límite de intentos;
   - marca como `failed` los rechazos definitivos;
   - aplica rebotes y quejas por el webhook de Postmark: el destinatario queda suprimido.
5. Cada 5 minutos, un barrido recupera las solicitudes de las últimas 2 horas que no tienen ningún aviso: por ejemplo, si el proceso se reinició o la base falló al encolar.

Si el correo falla, la solicitud sigue registrada y el fallo queda anotado en el historial del lead.

## Configuración (CRM → Leads → Avisos)

Solo administración puede cambiarla (`operators:write`).

- **Interruptores:** uno general y uno por tipo de solicitud. Apagar los avisos no detiene la captación.
- **Destinatarios:** se eligen por tipo, y solo entre operadores del CRM que estén activos, tengan correo y tengan rol comercial, de administración o de superadministración. No se escriben direcciones a mano.
- **Historial:** cada cambio queda guardado con autor y fecha. Recuperar una versión crea una versión nueva. La tabla es `crm_settings_history` (migración CRM `0025`).
- **Aviso de prueba:** se envía a los destinatarios de un tipo y no crea ninguna solicitud ni oportunidad.

En la bandeja «Solicitudes web» aparece el estado del aviso de cada solicitud: enviado, entregado, pendiente o fallido. Desde la ficha se ve cada destinatario (con la dirección enmascarada), los intentos y el último error, y se puede reenviar con una clave nueva (como mucho 5 veces).

**Interruptor de entorno:** `CP_LEAD_NOTICES=off`. Está por encima de la configuración del CRM.

## Política de correo

La política manda siempre: este módulo no puede ampliar a quién sale un correo.

- **Live:** el plano de control está en `sandbox`, con la lista de buzones propios de pruebas.
- **Production:** se activa con la acción protegida `avisos-solicitudes-activar`, que exige aprobación y la entrada «destinatarios».
  - El plano de control queda en `MAIL_MODE=sandbox`, con `MAIL_SANDBOX_ALLOWLIST` = los buzones internos indicados.
  - Además se fijan `MAIL_SCOPE_TENANTS=platform`, `MAIL_SCOPE_CATEGORIES=lead_request_notice`, `MAIL_RATE_RECIPIENT_PER_HOUR=30` y `CP_CRM_URL=https://admin.bigelephant.es`.
  - El token es el del servidor de Postmark de production que ya usa `core`. Si ese servidor envía eventos a live, la acción se para.
  - El webhook de rebotes va al CRM de production.
  - Ningún otro correo del plano de control sale: ni pruebas, ni pedidos, ni clientes.
  - `core` no se toca, y tampoco el correo de acceso de Skibox.
- **Para apagarlo:** `avisos-solicitudes-desactivar` pone `MAIL_MODE=off` en el plano de control. `avisos-solicitudes-estado` solo lee.

## Contenido del aviso

El aviso incluye:

- el logotipo;
- el tipo de solicitud;
- la fecha y hora de Madrid;
- la empresa y el sector;
- el nombre, el correo y el teléfono que escribió la persona;
- el producto o servicio pedido;
- el mensaje;
- la referencia;
- el responsable;
- el botón «Abrir en el CRM» (`#/comercial/leads/<id>`), que exige iniciar sesión.

Nunca lleva tokens, claves, huellas, seudónimos de IP ni datos internos.
