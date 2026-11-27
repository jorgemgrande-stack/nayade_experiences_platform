# Newsletter (Elephant Core)

Inscripción pública a una newsletter con **doble confirmación**, gestión de suscriptores en el panel y exportación. Capacidad
reutilizable: **apagada por defecto en todas las empresas** (`newsletter_settings.enabled = 0`); no toca licencias ni tarifas.

## Flujo
1. La persona escribe su correo y marca la casilla (desmarcada de fábrica, obligatoria) del bloque **Newsletter** del Studio.
2. `newsletter.subscribe` valida (origen de la propia web, límite por visitante, campo trampa, tiempo mínimo, tope de 200 altas/hora)
   y crea una suscripción **pendiente** con el texto legal **del bloque publicado** (no el del navegador), su versión (huella) y fecha.
3. Correo de confirmación con enlace individual (256 bits, solo se guarda su SHA-256, caduca a las 48 h, un solo uso).
   La página `/newsletter/confirmar/<token>` pide pulsar un botón (los escáneres de enlaces no confirman).
4. Al confirmar: activa, localiza o crea el cliente del CRM (origen `newsletter`, sin duplicar) y le concede el consentimiento de
   marketing (`customer_marketing_consents`, el mismo que usa Elephant Campaigns/Brevo) y envía **una** bienvenida.
5. Baja: enlace firmado `/newsletter/baja/<id>.<firma>` (no caduca) o baja administrativa con motivo. Retira la suscripción y el
   consentimiento de marketing del cliente. Reactivar exige consentimiento nuevo y confirmar otra vez.

## Garantías
- Respuesta pública idéntica exista o no el correo (no se averigua quién está suscrito).
- Idempotencia: cada correo reserva una clave única (`newsletter_mail_log.idempotency_key`); reintentos y réplicas no duplican.
- No existe ninguna operación de «activar» para el personal: solo la confirmación de la persona activa una suscripción.
- Aislamiento: tablas en la base de cada empresa; los enlaces de baja se firman con la empresa.
- Exportación (`/api/newsletter/export`): solo administrador, todo el filtro, fórmulas neutralizadas, sin enlaces ni huellas, con
  constancia (`newsletter_exports`).

## Datos (migración 0095, aditiva; reversión = renombrar, sin perder datos)
`newsletter_subscribers`, `newsletter_events`, `newsletter_mail_log`, `newsletter_exports`, `newsletter_settings`.

## Activar en una empresa
Panel → Newsletter → Suscriptores → «Activar la newsletter». Después, añadir el bloque **Newsletter** a una página (biblioteca → Contacto)
y publicar. Los correos salen por el servicio de correo de la empresa (remitente autorizado, política de correo y límites).
Los textos del bloque se traducen como el resto de la página; los de los correos se editan por idioma en Ajustes.

## Pendiente (siguiente entrega)
Campañas semanales y segmentación en Elephant Campaigns (los suscriptores ya quedan como clientes con consentimiento y origen `newsletter`).
