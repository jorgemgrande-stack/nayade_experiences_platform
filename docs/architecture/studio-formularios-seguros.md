# Elephant Studio: formularios seguros (E-7)

Qué añade a los formularios a medida (bloque `form`) de la web de cada empresa. Todo es reutilizable por cualquier empresa y viene **apagado o equivalente al comportamiento anterior**: un formulario ya publicado funciona exactamente igual sin tocarlo.

## Flujo de un envío (`server/_core/studioFormsSubmit.ts`)
1. Origen: si el navegador manda `Origin`, debe ser el mismo sitio que atiende la petición (CSRF). Sin cabecera (llamada que no es de un navegador) se admite y manda el límite por visitante.
2. Tamaño: el cuerpo se limita (zod en el router y 20.000 caracteres en total; campos y longitudes ya acotados).
3. Formulario **publicado** (nunca lo que diga el navegador) y límite por visitante: 5 envíos / 10 min por empresa + página + IP.
4. Validación y saneado (`evaluateFormSubmission`): campo trampa, tiempo mínimo, tipos, opciones, obligatorios, condiciones. Nombres y empresa se guardan sin etiquetas.
5. Turnstile (opcional, ver abajo).
6. Duplicados: mismo correo + mismo formulario en 10 minutos no crea otra oportunidad; se **anota** en la existente (nota interna del lead + constancia con `is_duplicate = 1`). Con un bloqueo por correo y formulario para que dos envíos simultáneos no creen dos.
7. Oportunidad en el CRM (`createLead`, origen `web_formulario`) con **todas las respuestas** en el mensaje, más líneas de origen, UTM y consentimiento.
8. Constancia en `studio_form_submissions` (migración 0066).
9. Aviso al propietario por correo (si el formulario lo activa).

## Campos del formulario
- Roles de campo para el CRM: `name` (nombre completo), `first_name`, `last_name` (se unen en el nombre del lead; si hay `name`, manda éste), `email`, `phone` (móvil), `company` (se guarda en el lead y su cliente). El resto de campos (texto, selector, casilla extra…) van al mensaje/notas del CRM: nada se pierde.
- Cada campo ya admitía etiqueta, texto de ayuda (placeholder), obligatorio, opciones y condición.
- Textos del formulario en **campos separados** (traducibles por E-1): `title`, `intro`, `submitLabel`, `successMessage`, `errorMessage`, `consentText`, y las etiquetas/placeholder/opciones de cada campo.

## Consentimiento RGPD
La casilla ya se exigía. Ahora se **guarda**, en `studio_form_submissions`: `consent_given`, `consent_text` (texto exacto de la casilla del formulario o el predeterminado), `consent_version` (huella de 12 caracteres del texto: cambia si la empresa lo cambia), `consent_at` (ms), el formulario, la página de origen y las UTM. También queda una línea «Consentimiento RGPD: …» en el mensaje del lead, visible en el CRM. El texto y la versión los fija el servidor desde el formulario publicado; el navegador solo dice si se marcó.

**IP:** nunca se guarda la dirección. Se guarda `ip_hash` = HMAC-SHA256(secreto de la instalación `JWT_SECRET`, `studio-form:<empresa>:<ip>`); sin secreto, `NULL`. Misma convención que `acceptedIpHash` de las condiciones comerciales.

## Turnstile (Cloudflare), por empresa
- **Desactivado por defecto** y sin tercero. Para usarlo: la empresa guarda `siteKey` y `secretKey` en Integraciones (proveedor `turnstile`, **ambas cifradas** con la bóveda de credenciales, AAD `empresa|proveedor|campo`) y activa «Verificación antirrobots» en cada formulario (Opciones avanzadas).
- Verificación **en servidor** (`siteverify`, 5 s de límite; cualquier fallo = no verificado). Con la opción activada pero sin claves en la empresa, el formulario sigue funcionando sin captcha.
- **Cookies:** el script de Cloudflare es un tercero. Solo se carga si la persona aceptó las cookies de terceros en el aviso actual (`useMarketingConsent`). Sin aceptarlas, el formulario con Turnstile explica por qué no puede enviarse. Es el coste de activarlo: quien rechaza cookies de terceros no puede enviar ese formulario.

## Aviso al propietario
No existía para los formularios de Studio. Con «Avisarme por correo de cada envío» (apagado por defecto), se envía por el correo de la empresa (`sendManagedEmail`, plantilla `studio_form_admin`, categoría de correo **operational**, nunca marketing) al correo de reservas de la empresa (`internalNoticeEmail`; sin él, no se envía nada). Contenido escapado. Un fallo del correo nunca rompe el envío.

## Mensajes
`successMessage` (ya existía), `errorMessage` (si falla el envío; vacío = mensaje habitual), `consentText`. Texto sin formato: se guardan acotados y se pintan como texto.

## Migración 0066 (`studio_form_submissions`)
Solo crea la tabla; reversión = `DROP TABLE`. No toca `leads`. **El código funciona sin la tabla** (sin constancia ni detección de duplicados, con un aviso en el log), por lo que puede desplegarse antes de aplicarla.

## Límites
- Sin adjuntos de archivos.
- El límite por visitante está en memoria del proceso (se reinicia al reiniciar; con varias réplicas, por réplica).
- El duplicado se decide por correo exacto (minúsculas) + formulario, 10 minutos.
- Turnstile exige aceptar cookies de terceros.
