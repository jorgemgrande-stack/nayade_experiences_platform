# Bloqueos externos: Elephant Voice (Netelip) y Elephant WhatsApp AI (Meta)

Estado al 09/11/2026. Este documento recoge **solo lo que necesita una persona**: lo que la plataforma ya hace no se repite aquí como tarea.

Fuentes:
- Voice: PR #740 (`server/voiceSetup.ts`, `server/routers/voiceSetup.ts`, `client/src/pages/admin/commercial/VoiceSetup.tsx`) y la matriz `docs/elephant-net-connect-integration-matrix.md`.
- Netelip: la integración de Skicenter (fuente de solo lectura: `server/services/netelip*.ts`, `docs/HUMAN_ACTION_BACKLOG.md`, filas NETELIP-05 y NETELIP-06A) y la documentación oficial de API Voice (https://apidoc.netelip.com/v1/voice/).
- WhatsApp: PR #743 (`server/whatsappCloud/*`, `shared/whatsappCloud.ts`, proveedor `whatsapp_cloud` de `server/_core/credentials/catalog.ts`, `client/src/pages/admin/commercial/WhatsAppCloud.tsx`) y la documentación de WhatsApp Cloud API de Meta.
- Railway: https://docs.railway.com/reference/static-outbound-ips.

---

## 1. Elephant Voice

### Lo que ya está preparado

- **Voice funciona con Vapi, sin IP fija.** La pantalla «Llamadas IA › Puesta en marcha» (`/admin/atencion-comercial/agente-ia/puesta-en-marcha`, capacidad `voice-ai`, solo administración) hace el alta:
  - valida la clave privada de Vapi de la empresa y la guarda cifrada en su bóveda;
  - conecta el asistente y el número de Vapi al webhook `<dominio de la empresa>/api/vapi/webhook`;
  - genera la clave de verificación (mínimo 24 caracteres);
  - muestra el estado por pasos.
- Los minutos los factura Vapi en la cuenta de cada empresa. La plataforma no cobra nada nuevo.
- `connect-voice` sigue «Bajo solicitud», sin Price de Stripe.

### Lo que falta: Netelip

Netelip es la telefonía propia (número español y centralita). **El Core todavía no tiene conector de Netelip**: solo existe en Skicenter (matriz de integraciones: tipo C, «bloqueado»). Para traerlo hacen falta estas decisiones y acciones humanas.

#### Lo que se sabe de Netelip (comprobado en Skicenter)

- La **API Voice** (`https://api.netelip.com/v1/voice`) se autentica con el **token de seguridad** de la cuenta y el **nombre de la API Voice** creada en el panel.
  - La restricción por IP de origen es **opcional**: solo se aplica si se rellena la IP en el panel de Netelip.
- La **API Cloud** (`cloud.netelip.com`, listado de grabaciones de la vPBX) **no se desbloquea con una IP fija**. Netelip respondió el 01/09/2026 que «solo es accesible a integradores o proveedores de servicios SaaS».
  - Big Elephant sí podría pedirla como integrador SaaS. Es una gestión comercial con Netelip, no técnica.
  - Las grabaciones llegan igualmente por la notificación `callrecording` en la URL de eventos de API Voice.

Además, según la documentación de API Voice (no comprobado en Skicenter), las redes de confianza de Netelip son 185.8.244.0/24 (Europa) y 192.99.91.144/29 (América). Que los avisos salgan de ahí no está confirmado: hay que pedírselo por escrito a Netelip antes de filtrar por IP.

#### Pasos humanos

**1. Decisión de Jorge.** ¿Netelip entra en Elephant Voice como telefonía propia, o se sigue solo con Vapi?
- Con Vapi no hace falta nada de lo que sigue.
- Si entra, hay que encargar el conector en el Core (credenciales por empresa en la bóveda, como dice la regla de integraciones por empresa).

**2. IP de salida fija en Railway.** Solo hace falta si se quiere filtrar por IP en Netelip (recomendable) o si Netelip la exige al dar de alta a Big Elephant como integrador.
1. Railway → proyecto de Elephant Source → entorno **production** → servicio **`core`** (es el que llamará a `api.netelip.com`).
2. Settings → Networking → **Enable Static IPs**. Requiere el plan **Pro** de Railway.
3. Apuntar las direcciones IPv4 que muestra Railway. Hoy son tres, con alta disponibilidad, y el tráfico se reparte entre ellas: hay que autorizar las tres.
4. **Redesplegar** el servicio `core`: sin redespliegue, la salida no usa las IP nuevas.
5. Avisos:
   - las IP **pueden ser compartidas** con otros clientes de Railway, así que no sirven como única autenticación (el token sigue siendo obligatorio);
   - si el servicio cambia de región, cambian las IP;
   - requiere el plan Pro; el precio hay que confirmarlo en Railway (en Skicenter el servicio `netelip-egress` con IP estática se señaló como coste sin uso).
6. Si también se quiere en el entorno `live`, repetir los pasos en su servicio `core`.

**3. Panel de cliente de Netelip.** Lo hace cada empresa cliente con su propia cuenta, o Big Elephant con la suya si actúa como integrador.
1. Contratar **API Voice** y crear una API Voice. Anotar su **nombre** exacto.
2. Panel de control → datos personales → **Token de seguridad**. Copiarlo y guardarlo en la bóveda de la empresa cuando exista el conector. **Nunca se envía por chat ni por correo.**
3. En la API Voice, si se activa el filtro por IP: escribir las IP fijas del paso 2.
4. Configurar las URL de la API Voice (nombres del panel de Netelip). Las rutas exactas las fijará el conector del Core. En Skicenter son:
   - «URL eventos de llamada»: `https://<dominio>/api/netelip/events` (también trae las grabaciones);
   - «URL de reporte de llamadas»: `https://<dominio>/api/netelip/call-report`;
   - «URL de control para llamadas salientes»: `https://<dominio>/api/netelip/voice-control`;
   - «URL de control para llamadas entrantes»: `https://<dominio>/api/netelip/inbound-voice-control` (en Skicenter no está configurada ni probada con tráfico real).
5. vPBX:
   - activar la grabación **integrada con vDrive** en las extensiones (en Skicenter Netelip tuvo que activarlo a mano);
   - asignar el número que usará la API Voice como identificador de llamada saliente.
6. Hacer una llamada real de prueba, **contestarla** y comprobar que llega el evento y la grabación.

---

## 2. Elephant WhatsApp AI (WhatsApp Cloud API de Meta)

### Lo que ya está preparado

- Cada empresa conecta **su propio número**. Big Elephant no necesita app ni número propios.
  - Las credenciales van en la bóveda de la empresa, proveedor `whatsapp_cloud`.
  - La comprobación es de solo lectura contra `https://graph.facebook.com/v21.0`.
  - La v21.0 de la Graph API se retira el 21/01/2027: hay que actualizar `GRAPH_VERSION` (`shared/whatsappCloud.ts`) antes. Es una tarea del Core, no humana.
- Bandeja en `/admin/atencion-comercial/whatsapp-business` (capacidad `whatsapp-ai`), con la pestaña «Conexión con Meta» para administradores. Esa pestaña muestra los datos que faltan y la **dirección del webhook** que hay que copiar en Meta: `<dominio de la empresa>/api/whatsapp/webhook`.
- Webhook `GET/POST /api/whatsapp/webhook`:
  - comprueba `hub.verify_token` y la firma `X-Hub-Signature-256` con el App Secret de la empresa;
  - solo acepta su `phone_number_id`;
  - es idempotente por `wamid`.
- Bandeja:
  - texto libre dentro de la ventana de 24 h;
  - fuera de ella, solo **plantillas aprobadas** de la WABA, que se leen de Meta.
- IA apagada por defecto. El modo automático tiene horario, tope diario y traspaso a una persona.
- `connect-whatsapp-ai` está «Bajo solicitud» desde el 09/11/2026, sin checkout. Los mensajes de plantilla los factura Meta a la empresa.

### Pasos humanos (los hace cada empresa cliente, con ayuda del equipo en la implantación)

Los datos que pide el panel son cinco. Ninguno lo crea la plataforma:

| Campo del panel | Dónde se obtiene |
|---|---|
| Identificador del número (`phoneNumberId`) | App de Meta → WhatsApp → Configuración de la API |
| Identificador de la cuenta de WhatsApp Business (`wabaId`) | Misma pantalla, o la configuración del negocio |
| Clave de acceso (`accessToken`) | Token de un **usuario del sistema** (paso 4) |
| Clave secreta de la app (`appSecret`) | App de Meta → Configuración de la app → Básica |
| Clave de verificación (`verifyToken`) | La elige la empresa: 24 caracteres como mínimo |

1. **Portfolio comercial (Business Manager) verificado.**
   - business.facebook.com → Configuración del negocio → Centro de seguridad → **Verificación del negocio**.
   - Hay que aportar documentación legal: escritura o CIF, una factura de suministros o similar, y un dominio o teléfono verificable.
   - Meta tarda de días a semanas.
   - Es recomendable, no bloqueante. Sin verificar, el portfolio empieza con un límite de 250 destinatarios únicos cada 24 h fuera de la ventana de atención, compartido por todos sus números.
   - Verificar el negocio es la vía directa para subir de nivel. También se sube enviando 2.000 plantillas entregadas en 30 días.
2. **App de Meta de tipo «Business»** (o creada con el caso de uso «Connect with customers through WhatsApp») en developers.facebook.com, asociada a ese portfolio, con el producto **WhatsApp** añadido.
   - Al añadirlo, Meta crea o vincula la cuenta de WhatsApp Business (WABA).
   - Pasar la app a modo **Activo (Live)**: en modo de desarrollo no llegan algunos webhooks. Para eso necesita una URL de política de privacidad.
3. **Número de teléfono.**
   - Debe ser un número que **no** esté en uso en la app de WhatsApp o WhatsApp Business del móvil. Si lo está, hay que darlo de baja allí antes.
   - WhatsApp Manager → Números de teléfono → Añadir. Verificarlo por SMS o llamada y registrar el **nombre visible**, que Meta revisa.
   - Añadir un **método de pago** en la WABA (WhatsApp Manager → Configuración de pago). Sin él no se pueden enviar plantillas de pago.
4. **Usuario del sistema y token permanente.**
   - Configuración del negocio → Usuarios → **Usuarios del sistema** → Añadir (rol Administrador).
   - «Asignar activos»: la **app** y la **cuenta de WhatsApp** (control total).
   - «Generar token»: elegir la app, caducidad **Nunca** y los permisos **`whatsapp_business_messaging`** y **`whatsapp_business_management`**.
   - Copiar el token y pegarlo directamente en el panel de Big Elephant. **No se envía por chat ni por correo.**
5. **App Secret:** App → Configuración de la app → Básica → Clave secreta de la app → Mostrar. Pegarla en el panel.
6. **Guardar los cinco datos** en Configuración › Integraciones › WhatsApp Business (`/admin/configuracion/integraciones`).
   - Después, en `/admin/atencion-comercial/whatsapp-business` → pestaña «Conexión con Meta», pulsar «Comprobar la conexión con Meta».
   - Debe mostrar el número, el nombre verificado y el nombre de la cuenta.
7. **Webhook en Meta.**
   - App → WhatsApp → Configuración → Webhook → Editar. En las apps creadas con el caso de uso de WhatsApp: Casos de uso → Personalizar → Configuración.
   - URL de devolución de llamada: la «Dirección para Meta» que muestra la pestaña «Conexión con Meta».
   - Token de verificación: la misma clave de verificación del paso 6.
   - «Verificar y guardar»: Meta llama con `GET` y la plataforma responde si la clave coincide.
   - En «Campos del webhook», **suscribirse a `messages`**.
   - Comprobar que la app está suscrita a la WABA: en WhatsApp Manager → la cuenta → la app debe aparecer como suscrita. Si no aparece, Meta no envía los mensajes. Se corrige con `POST /<wabaId>/subscribed_apps` desde el Explorador de la Graph API con el token del paso 4. La plataforma no lo hace por la empresa.
8. **Plantillas.**
   - WhatsApp Manager → Plantillas de mensajes → Crear (categoría Utilidad o Marketing, idioma y variables `{{1}}`…).
   - Meta las aprueba o las rechaza.
   - Solo las **aprobadas** aparecen en la bandeja para escribir fuera de la ventana de 24 h.
   - Las de marketing deben respetar el consentimiento del destinatario.
9. **Prueba real:** escribir al número desde un móvil y comprobar que el mensaje aparece en la bandeja y que la respuesta llega.
   - Se prueba con un móvil del equipo, nunca con clientes.
   - La IA sigue apagada hasta que la empresa la active.
10. **Licencia:** el equipo concede `whatsapp-ai` desde el CRM. No hay compra directa.

---

## 3. Resumen para Jorge

| Bloqueo | Quién | Acción |
|---|---|---|
| Netelip en Voice | Jorge | Decidir si se integra. Con Vapi, Voice ya funciona sin IP fija |
| Graph API v21.0 | Core (técnico) | Actualizar `GRAPH_VERSION` antes del 21/01/2027 |
| IP fija | Jorge (Railway) | Solo si se integra Netelip con filtro por IP: production → `core` → Settings → Networking → Enable Static IPs (plan Pro) → redesplegar → dar las IP a Netelip |
| API Cloud de Netelip | Jorge (comercial) | Solo si se quiere el listado de grabaciones de la vPBX: pedir a Netelip el alta de Big Elephant como integrador SaaS |
| WhatsApp: verificación del negocio, app, número, token, webhook y plantillas | Cada empresa cliente | Pasos 1 a 9 del apartado 2. El paso 10 (la licencia) lo hace el equipo |
