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

## Datos (migraciones 0095 y 0099, aditivas; reversión sin perder datos)
`newsletter_subscribers`, `newsletter_events`, `newsletter_mail_log`, `newsletter_exports`, `newsletter_settings`, `newsletter_imports` (0099) y las columnas `audience_kind` / `newsletter_locale` de `campaign_campaigns` (0099).

## Activar en una empresa
Panel → Newsletter → Suscriptores → «Activar la newsletter». Después, añadir el bloque **Newsletter** a una página (biblioteca → Contacto)
y publicar. Los correos salen por el servicio de correo de la empresa (remitente autorizado, política de correo y límites).
Los textos del bloque se traducen como el resto de la página; los de los correos se editan por idioma en Ajustes.

## Listas por idioma, importación histórica y Campaigns (migración 0099)

Una sola base de contactos con **una lista (segmento) por idioma público de la web**: `newsletter-<idioma>` («Newsletter Alemán» =
`newsletter-de`, «Newsletter Español» = `newsletter-es`…). Reutilizable por cualquier empresa: las listas salen de los idiomas
públicos de su configuración multidioma (`getI18nConfig` + `publicLocales`); una instalación sin multidioma tiene una sola lista.

### Modelo (0099, aditiva; `.down.sql` reversible)
`newsletter_subscribers`: `locale` (lista actual), `signup_locale` (idioma de la web de la **primera** alta; no cambia nunca),
`locale_source` (`web` | `subscriber` | `admin` | `import`), `name`, `import_id`, `imported_at`; estado nuevo **`imported`** (CHECK
`chk_newsletter_subscribers_status_v2`). Tabla `newsletter_imports` (lote: etiqueta, fichero y su SHA-256, formato, idioma por defecto,
recuentos, informe, quién y cuándo; nunca el fichero). `campaign_campaigns.audience_kind` (`tags` | `newsletter`) y `newsletter_locale`.

### Política de idioma (`shared/newsletterLocalePolicy.ts`, pura y con pruebas)
El idioma es el de la **web desde la que la persona se inscribe**, nunca el país ni la IP. Prioridad: prefijo de la ruta (`/es/…`) si es
un idioma público → idioma de la traducción validada del bloque servido (`getPublishedNewsletterBlock(...).localizedLocale`) → idioma que
declara el formulario, solo si es público (un valor manipulado no cuela otro idioma) → idioma principal. El resultado se guarda en `locale`
y, solo en la primera alta, en `signup_locale` (`locale_source = web`). Las plantillas de correo siguen existiendo en de/es/en: un idioma
sin plantilla propia usa la del idioma principal de la empresa y, si tampoco la tiene, la alemana (`templateLocale`).

### Contacto único por correo (con historial)
| Estado previo | Nueva inscripción desde la web |
|---|---|
| `active` | Sin cambios de idioma ni consentimiento; sin correo; evento `resignup_ignored` con el idioma pedido |
| `pending` | Reenvío (espera y tope de siempre); si el idioma difiere, cambia de lista (`locale_source = subscriber`, evento `updated`) |
| `unsubscribed` | Nuevo ciclo pendiente con consentimiento nuevo (como hasta ahora); `signup_locale` no cambia |
| `imported` | Primera alta legítima: pendiente con el consentimiento de la petición; conserva nombre, lote e historial; envía la confirmación |

Nunca se reactiva una baja sin una acción nueva de la persona. El cambio de idioma desde el panel solo admite idiomas públicos y deja
`locale_source = admin`. Si el CRM retira el consentimiento de marketing de un cliente (Brevo marketing, baja pública, baja leída de
Brevo), el suscriptor activo o pendiente con ese cliente o correo queda `unsubscribed` (`unsubscribed_by = crm:withdrawn`); el gancho vive en
`server/brevoMarketing/runtime.ts` → `newsletter/runtime.ts#onCrmConsentWithdrawn` (import diferido, tolerante si el módulo no está instalado).

### Panel y exportación
`newsletter.lists` (administrador) devuelve una tarjeta por lista (idiomas públicos ∪ idiomas presentes) con recuentos por estado;
`stats` añade `imported` y el desglose `byLocale`. El listado filtra por estado (incluido «Histórico (sin consentimiento)») y lista; columnas
«Nombre» e «Idioma de alta»; la ficha muestra idioma de alta, origen del idioma y lote. Exportación: `GET /api/newsletter/export?format=csv|xlsx&list=newsletter-xx`
(`list` es alias de `locale`; `newsletter_exports.filters` guarda lo pedido); columnas nuevas «Idioma de alta» y «Nombre».

### Importación histórica (preparada; en esta fase NO envía correos ni crea consentimientos)
Panel → Newsletter → Importar → «Importar contactos históricos»: CSV o Excel (≤ 5 MB, ≤ 20 000 filas) con columna de correo (alias
email/e-mail/correo/mail), nombre (o vorname+nachname) e idioma opcional (solo si es de la empresa; si no, el idioma por defecto del lote).
Vista previa (`newsletter.importPreview`) con recuentos y primeras 50 filas por acción; `newsletter.importApply` exige la **huella** de la
vista previa (fichero + idioma + etiqueta) y `sendMails` solo admite `false` (con `true` se rechaza: «no autorizado en esta fase»).
Acciones: `create` → fila `imported` (sin consentimiento, sin correos, origen `import:<etiqueta>`, cliente del CRM enlazado SOLO si ya
existía: no se crean clientes ni consentimientos), `match_active` / `match_pending` / `match_unsubscribed` / `match_imported` → no se toca
nada (la baja prevalece; como mucho se rellena el nombre vacío), `reject` (correo no válido, repetido en el fichero, fila mal formada).
Repetir el mismo fichero → 0 creados. Todo en una transacción con su fila en `newsletter_imports` y un evento `imported` por suscriptor.
Procedimiento futuro (cuando Dirección autorice el contacto): los `imported` **no** se activan desde el panel; la vía es que la persona se
inscriba desde la web (doble confirmación) o una campaña de reconsentimiento con base jurídica acreditada, fuera de esta entrega.

### Elephant Campaigns
Campaña con `audienceKind = newsletter` (+ `newsletterLocale` o null = todas las listas): audiencia = clientes con consentimiento `granted`
cuyo correo tiene una suscripción **`active`** (bajas, pendientes, históricos y consentimientos `withdrawn` quedan fuera), con los mismos
topes y la misma reconciliación antes de enviar. Las campañas existentes siguen por etiquetas (`tags`). No se activa ni envía ninguna campaña
en esta entrega.

### Pruebas
`server/newsletterListasIdioma.test.ts` (política, altas por idioma, contacto único, panel, importación, exportación por lista, audiencia,
baja desde el CRM, aislamiento, permisos del router) y `server/newsletter.mysql.test.ts` (opt-in con MySQL real: aplica 0042, 0053, 0095 y
0099, importación en transacción, reversión 0099 + 0095 sin perder datos). Datos sintéticos siempre.

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
