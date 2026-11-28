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

## Correo de suscripción durante la prueba gratuita

La prueba solo deja salir correo a los buzones propios de la empresa. Para que la doble confirmación y la bienvenida lleguen
a las personas que se inscriben, existe una excepción **acotada y por empresa** (`server/trialRestrictions.ts`):

- Solo para correos marcados `trialException: "subscription"` con categoría `operational` (los que envía este módulo).
- La plataforma debe autorizar a la empresa en `TRIAL_SUBSCRIPTION_MAIL_TENANTS` (ids separados por comas; vacío = nadie).
  Ninguna empresa lo tiene por defecto y no depende de un ajuste que la propia empresa pueda cambiar.
- Un solo destinatario, sin copia, con remitente configurado, y tope propio de 24 h (`TRIAL_SUBSCRIPTION_MAIL_DAILY`, 30 por
  defecto, máximo 500) medido sobre `newsletter_mail_log`. Si no se puede medir, no sale.
- No toca el estado comercial, ni el tope general de la prueba, ni el resto del correo a terceros (campañas, presupuestos…).
- El servicio de correo conserva su propio modo (`MAIL_MODE` off/sandbox/live y su lista de destinatarios autorizados).

## Textos del bloque de la home de Quantum (alemán principal, español e inglés)

| Campo | Alemán (principal) | Español | Inglés |
|---|---|---|---|
| Antetítulo | Newsletter | Newsletter | Newsletter |
| Título | Ein Impuls für deine Seele, jede Woche. | Un impulso para tu alma, cada semana. | A spark for your soul, every week. |
| Descripción | Erhalte Inspiration, Reflexionen und Neuigkeiten von Indira direkt in dein Postfach. | Recibe inspiración, reflexiones y novedades de Indira directamente en tu correo. | Receive inspiration, reflections and news from Indira straight to your inbox. |
| Etiqueta del correo | Deine E-Mail-Adresse | Tu correo electrónico | Your email address |
| Texto de ayuda | deine@email.de | tu@correo.com | you@email.com |
| Botón | Newsletter erhalten | Quiero recibir la newsletter | Get the newsletter |
| Consentimiento | Ich möchte den wöchentlichen Newsletter erhalten und stimme der Datenschutzerklärung zu. Ich kann mich jederzeit abmelden. | Quiero recibir la newsletter semanal y acepto la política de privacidad. Puedo darme de baja en cualquier momento. | I would like to receive the weekly newsletter and I accept the privacy policy. I can unsubscribe at any time. |
| Enlace de privacidad | Datenschutzerklärung | Política de privacidad | Privacy policy |
| Mensaje tras inscribirse | Danke! Wir haben dir eine E-Mail gesendet, um deine Anmeldung zu bestätigen. | ¡Gracias! Te hemos enviado un correo para confirmar tu inscripción. | Thank you! We have sent you an email to confirm your subscription. |

Los mensajes de error (correo no válido, falta de consentimiento, fallo, demasiados intentos, formulario no disponible) salen por
defecto en el idioma del visitante (`shared/newsletterMessages.ts`) cuando el bloque no define los suyos o conserva el español de fábrica.
El campo «Aspecto» (`tone`) no se traduce.

## Página de prueba aislada

`/newsletter-prueba` (sin enlazar, fuera del menú y sin indexar): sirve para probar el circuito completo con el bloque publicado
sin exponerlo en la home. Con «Inscripción pública» desactivada en Newsletter › Ajustes el formulario responde con un error
honesto («no disponible»), nunca con un falso «te hemos enviado un correo».
