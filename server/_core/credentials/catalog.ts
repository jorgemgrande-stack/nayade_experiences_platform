/**
 * Catálogo de integraciones configurables por tenant y de sus campos.
 *
 * Cada campo declara si es secreto (cifrado, nunca devuelto en claro), su validación y, para
 * compatibilidad, el nombre de la variable de entorno histórica que sustituye en multiempresa
 * (`integrationEnv("GHL_API_KEY")` ⇒ campo `ghl.apiKey` del tenant).
 */
import type { IntegrationGroup } from "../../../shared/integrationsPanel";

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  required?: boolean;
  /** Nombre de la variable de entorno histórica equivalente. */
  env?: string;
  pattern?: RegExp;
  /** Longitud máxima del valor (por defecto, FIELD_MAX_LENGTH). */
  maxLength?: number;
  hint?: string;
  options?: string[];
  /** Presentación en el panel de la empresa (no cambia cómo se guarda ni se valida el valor). */
  panel?: FieldPanel;
}

/** Cómo ve el campo una persona no técnica en «Integraciones y pagos». */
export interface FieldPanel {
  label: string;
  /** Dónde encontrar el dato, en una frase. */
  help?: string;
  /** Aviso si el formato no es válido. */
  formatMessage?: string;
  /** Nombre de cada opción (p. ej. `test` → «Modo pruebas»). */
  optionLabels?: Record<string, string>;
  /** `yesno`: interruptor Sí/No sobre los valores `true`/`false`. */
  control?: "yesno";
  /** No se muestra en el formulario general: lo gestiona una pantalla propia (p. ej. un token que genera la plataforma). */
  hidden?: boolean;
}

export type { IntegrationGroup };

export interface ProviderPanel {
  group: IntegrationGroup;
  title: string;
  summary: string;
  /** Se muestra si la empresa tiene alguna de estas capacidades (o si ya la tiene configurada). */
  requires?: string[];
  /** Heredada o sectorial: solo se muestra si la empresa ya la tiene configurada. */
  legacy?: boolean;
}

export interface ProviderDef {
  id: string;
  name: string;
  description: string;
  fields: CredentialField[];
  /** Qué hace la plataforma con esta integración (permisos que usa), tal como está programado. */
  capabilities: string[];
  /** Cómo se comprueba la conexión sin modificar nada; null si el proveedor no lo permite. */
  check: string | null;
  /** Presentación en el panel de la empresa. */
  panel: ProviderPanel;
}

/** Longitud máxima por defecto de un valor de la bóveda. */
export const FIELD_MAX_LENGTH = 1024;
export const fieldMaxLength = (f: CredentialField) => f.maxLength ?? FIELD_MAX_LENGTH;

const URL_RE = /^https:\/\/[^\s]{4,500}$/;
const TOKEN_RE = /^[\x21-\x7e]{8,512}$/; // imprimibles ASCII sin espacios
/** Clave de verificación de webhooks: al menos 24 caracteres (MIN_WEBHOOK_SECRET_LENGTH de server/_core/webhookSecret.ts). */
const WEBHOOK_SECRET_RE = /^[\x21-\x7e]{24,512}$/;
/** Identificador de un recurso de Vapi (UUID). */
const VAPI_ID_RE = /^[A-Za-z0-9-]{8,80}$/;
/** Texto corto de una línea (nombre o número que se muestra en el panel). */
const LABEL_RE = /^[^\r\n\t]{1,120}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const HOST_RE = /^[A-Za-z0-9.-]{3,253}$/;
const PORT_RE = /^\d{2,5}$/;
const MAILBOX_USER_RE = /^[^\s]{3,254}$/;
const PASSWORD_RE = /^[^\r\n]{1,512}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

/** Buzón IMAP de una ingesta de correo. */
function imapFields(prefix: string, extra: CredentialField[] = []): CredentialField[] {
  return [
    { key: "host", label: "Servidor IMAP", secret: false, required: true, env: `${prefix}_HOST`, pattern: HOST_RE, hint: "imap.tuproveedor.com", panel: { label: "Servidor de correo entrante", help: "Lo indica tu proveedor de correo en sus instrucciones para configurar el correo.", formatMessage: "Escribe solo el nombre del servidor, sin espacios ni «https://» (por ejemplo, imap.tuproveedor.com)." } },
    { key: "port", label: "Puerto", secret: false, env: `${prefix}_PORT`, pattern: PORT_RE, hint: "993", panel: { label: "Puerto", help: "Casi siempre 993. Si lo dejas vacío, se usa 993.", formatMessage: "El puerto es un número (por ejemplo, 993)." } },
    { key: "secure", label: "Conexión segura (TLS)", secret: false, env: `${prefix}_SECURE`, options: ["true", "false"], panel: { label: "Conexión cifrada", help: "Déjalo en «Sí» salvo que tu proveedor indique lo contrario.", control: "yesno" } },
    { key: "user", label: "Usuario", secret: false, required: true, env: `${prefix}_USER`, pattern: MAILBOX_USER_RE, panel: { label: "Usuario del buzón", help: "Normalmente, la dirección de correo completa del buzón.", formatMessage: "El usuario no puede tener espacios." } },
    { key: "pass", label: "Contraseña", secret: true, required: true, env: `${prefix}_PASS`, pattern: PASSWORD_RE, panel: { label: "Contraseña del buzón", help: "La de ese buzón, o una «contraseña de aplicación» si tu proveedor la exige (Gmail y Outlook, por ejemplo).", formatMessage: "La contraseña no puede tener saltos de línea." } },
    { key: "mailbox", label: "Carpeta", secret: false, env: `${prefix}_MAILBOX`, pattern: /^[^\r\n]{1,120}$/, hint: "INBOX", panel: { label: "Carpeta", help: "Déjala vacía para leer la bandeja de entrada.", formatMessage: "El nombre de la carpeta no puede tener saltos de línea." } },
    ...extra,
  ];
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "ghl",
    name: "GoHighLevel",
    description: "CRM, bandeja de WhatsApp y automatizaciones.",
    capabilities: ["Recibir leads por webhook", "Bandeja de conversaciones (WhatsApp)", "Enviar reservas y leads a sus automatizaciones"],
    check: "Consulta de la ubicación (location) con la API key: solo lectura",
    panel: { group: "customer", title: "GoHighLevel", summary: "CRM externo con bandeja de WhatsApp y automatizaciones. Solo si ya trabajas con él.", legacy: true },
    fields: [
      { key: "apiKey", label: "API key", secret: true, env: "GHL_API_KEY", pattern: TOKEN_RE, panel: { label: "Clave de acceso", help: "Está en tu cuenta de GoHighLevel, en el apartado de integraciones privadas.", formatMessage: "Cópiala completa, sin espacios." } },
      { key: "locationId", label: "Location ID", secret: false, env: "GHL_LOCATION_ID", pattern: /^[A-Za-z0-9_-]{6,64}$/, panel: { label: "Identificador de la cuenta", help: "Está en tu cuenta de GoHighLevel, en el perfil del negocio.", formatMessage: "Solo letras, números, guiones y guiones bajos." } },
      { key: "inboxToken", label: "Token de la bandeja", secret: true, env: "GHL_PRIVATE_INTEGRATION_TOKEN", pattern: TOKEN_RE, panel: { label: "Clave de la bandeja de mensajes", formatMessage: "Cópiala completa, sin espacios." } },
      { key: "webhookSecret", label: "Secreto del webhook de la bandeja", secret: true, env: "GHL_WEBHOOK_SECRET", pattern: TOKEN_RE, panel: { label: "Clave de verificación de la bandeja", formatMessage: "Cópiala completa, sin espacios." } },
      { key: "leadWebhookSecret", label: "Secreto del webhook de leads", secret: true, env: "GHL_LEAD_WEBHOOK_SECRET", pattern: TOKEN_RE, panel: { label: "Clave de verificación de oportunidades", formatMessage: "Cópiala completa, sin espacios." } },
      { key: "leadWebhookUrl", label: "URL del webhook de leads", secret: false, env: "GHL_LEAD_WEBHOOK_URL", pattern: URL_RE, panel: { label: "Dirección para enviar oportunidades", formatMessage: "Debe empezar por https:// y no tener espacios." } },
      { key: "reservationWebhookUrl", label: "URL del webhook de reservas", secret: false, env: "GHL_RESERVATION_WEBHOOK_URL", pattern: URL_RE, panel: { label: "Dirección para enviar pedidos", formatMessage: "Debe empezar por https:// y no tener espacios." } },
    ],
  },
  {
    id: "vapi",
    name: "VAPI",
    description: "Asistente de voz y registro de llamadas.",
    capabilities: ["Recibir el registro de llamadas por webhook", "Consultar asistentes y números", "Configurar el webhook del asistente elegido y asignarle el número elegido (Puesta en marcha de Llamadas IA)"],
    check: "Listado de asistentes (1 elemento): solo lectura",
    panel: { group: "customer", title: "Asistente de voz (VAPI)", summary: "Atiende llamadas con un asistente de voz y guarda el registro de cada llamada.", requires: ["voice-ai", "reception-ai"] },
    fields: [
      { key: "apiKey", label: "API key", secret: true, env: "VAPI_API_KEY", pattern: TOKEN_RE, panel: { label: "Clave de acceso", help: "Está en tu cuenta de VAPI, en el apartado de claves (usa la privada).", formatMessage: "Cópiala completa, sin espacios." } },
      // Mínimo de 24 caracteres, el mismo que exige el webhook (server/_core/webhookSecret.ts): con menos, rechaza las llamadas
      { key: "webhookSecret", label: "Secreto del webhook", secret: true, env: "VAPI_WEBHOOK_SECRET", pattern: WEBHOOK_SECRET_RE, panel: { label: "Clave de verificación de llamadas", help: "La genera y la configura en tu asistente de VAPI la «Puesta en marcha» de Llamadas IA; si la escribes tú, ponla igual en VAPI.", formatMessage: "Al menos 24 caracteres, sin espacios." } },
      // Elección de la «Puesta en marcha» de Llamadas IA (server/voiceSetup.ts): no son secretos y no se editan desde aquí
      { key: "setupAssistantId", label: "Asistente conectado", secret: false, pattern: VAPI_ID_RE, panel: { label: "Asistente conectado", hidden: true } },
      { key: "setupAssistantName", label: "Nombre del asistente", secret: false, pattern: LABEL_RE, maxLength: 120, panel: { label: "Nombre del asistente", hidden: true } },
      { key: "setupPhoneNumberId", label: "Número conectado", secret: false, pattern: VAPI_ID_RE, panel: { label: "Número conectado", hidden: true } },
      { key: "setupPhoneNumber", label: "Número de teléfono", secret: false, pattern: LABEL_RE, maxLength: 120, panel: { label: "Número de teléfono", hidden: true } },
      { key: "setupConnectedAt", label: "Conectado el", secret: false, pattern: ISO_RE, panel: { label: "Conectado el", hidden: true } },
    ],
  },
  {
    // Elephant WhatsApp AI: WhatsApp Cloud API de Meta con el número y la app PROPIOS de la empresa. La clave de acceso va
    // siempre en la cabecera Authorization (nunca en la URL); el App Secret verifica la firma de los mensajes entrantes
    id: "whatsapp_cloud",
    name: "WhatsApp Business (Cloud API de Meta)",
    description: "Bandeja de WhatsApp Business con el número de la empresa: mensajes entrantes por webhook firmado, respuestas, plantillas aprobadas y respuestas con IA.",
    capabilities: [
      "Recibir los mensajes y los estados de entrega de tu número por webhook (firma comprobada con la clave secreta de tu app)",
      "Enviar respuestas de texto dentro de la ventana de 24 h y plantillas aprobadas de tu cuenta",
      "Consultar los datos de tu número y la lista de plantillas aprobadas (solo lectura)",
    ],
    check: "Consulta de los datos del número de WhatsApp Business y de su cuenta: solo lectura",
    panel: { group: "customer", title: "WhatsApp Business", summary: "Atiende el WhatsApp de tu empresa desde el panel, con plantillas y respuestas con IA.", requires: ["whatsapp-ai"] },
    fields: [
      { key: "phoneNumberId", label: "Phone number ID", secret: false, required: true, pattern: /^\d{5,30}$/, panel: { label: "Identificador del número", help: "En tu app de Meta, en WhatsApp › Configuración de la API, junto a tu número.", formatMessage: "Solo cifras." } },
      { key: "wabaId", label: "WhatsApp Business Account ID", secret: false, required: true, pattern: /^\d{5,30}$/, panel: { label: "Identificador de la cuenta de WhatsApp Business", help: "En la misma pantalla de tu app de Meta, o en la configuración del negocio › Cuentas de WhatsApp.", formatMessage: "Solo cifras." } },
      { key: "accessToken", label: "Token de acceso del usuario del sistema", secret: true, required: true, pattern: TOKEN_RE, panel: { label: "Clave de acceso", help: "Créala en la configuración del negocio de Meta con un usuario del sistema que tenga tu cuenta de WhatsApp asignada y los permisos de gestión y mensajes de WhatsApp.", formatMessage: "Cópiala completa, sin espacios." } },
      { key: "appSecret", label: "App Secret", secret: true, required: true, pattern: /^[A-Za-z0-9]{16,128}$/, panel: { label: "Clave secreta de tu app", help: "En tu app de Meta, en Configuración de la app › Básica. Sirve para comprobar que cada mensaje que llega lo envía Meta.", formatMessage: "Solo letras y números, sin espacios." } },
      { key: "verifyToken", label: "Token de verificación del webhook", secret: true, required: true, pattern: /^[\x21-\x7e]{24,256}$/, panel: { label: "Clave de verificación de mensajes", help: "La eliges tú (al menos 24 caracteres) y la escribes igual en tu app de Meta, junto a la dirección que te indica la pantalla de WhatsApp.", formatMessage: "Al menos 24 caracteres, sin espacios." } },
    ],
  },
  {
    id: "redsys",
    name: "Redsys (TPV virtual)",
    description: "Cobros con tarjeta en la cuenta de la propia empresa.",
    capabilities: ["Cobros con tarjeta en la web de la empresa", "Confirmación de pagos por notificación firmada"],
    check: "Validación local de la configuración (Redsys no ofrece una consulta sin cobro)",
    panel: {
      group: "payments",
      title: "Pago con tarjeta en tu web (TPV virtual)",
      summary: "Tus clientes pagan con tarjeta en tu tienda y en los enlaces de pago de tus presupuestos. El dinero llega a tu cuenta del banco, sin intermediarios.",
      requires: ["shop-checkout", "crm-quotes", "bill-payments"],
    },
    fields: [
      { key: "environment", label: "Entorno", secret: false, env: "REDSYS_ENVIRONMENT", options: ["test", "production"], required: true, panel: { label: "Modo", help: "Empieza en «Modo pruebas» para hacer pagos de prueba con las tarjetas que te indique el banco; pasa a «Modo real» cuando el banco te lo confirme.", optionLabels: { test: "Modo pruebas (no se cobra)", production: "Modo real (cobros de verdad)" } } },
      { key: "merchantCode", label: "Código de comercio (FUC)", secret: false, env: "REDSYS_MERCHANT_CODE", pattern: /^\d{6,12}$/, required: true, panel: { label: "Número de comercio (FUC)", help: "Te lo da tu banco al contratar el TPV virtual; también aparece en el portal del TPV virtual de tu banco.", formatMessage: "Escribe solo cifras, entre 6 y 12, sin espacios ni letras." } },
      { key: "merchantTerminal", label: "Terminal", secret: false, env: "REDSYS_MERCHANT_TERMINAL", pattern: /^\d{1,3}$/, panel: { label: "Número de terminal", help: "Viene en los datos de alta del TPV virtual. Casi siempre es 1; si lo dejas vacío, se usa 1.", formatMessage: "Escribe un número de 1 a 3 cifras (por ejemplo, 1)." } },
      { key: "merchantKey", label: "Clave de firma (SHA-256)", secret: true, env: "REDSYS_MERCHANT_KEY", pattern: /^[A-Za-z0-9+/=]{16,80}$/, required: true, panel: { label: "Clave secreta del comercio", help: "Te la entrega tu banco junto al número de comercio (a veces la llama «clave de firma» o «clave SHA-256»). Es distinta en modo pruebas y en modo real.", formatMessage: "La clave tiene entre 16 y 80 letras, números o los signos + / =, sin espacios. Cópiala tal cual te la dio el banco." } },
    ],
  },
  {
    id: "meta",
    name: "Meta (Conversions API y Marketing API)",
    description: "Eventos de conversión del sitio y, con Elephant Ads Manager, lectura diaria del gasto y los resultados de las campañas de la cuenta publicitaria de la empresa.",
    capabilities: [
      "Enviar eventos de conversión del sitio",
      "Leer cada día el gasto, las impresiones, los clics y las compras de las campañas de la cuenta publicitaria (solo lectura: nunca crea ni modifica campañas)",
    ],
    check: "Consulta de la identidad del token o, si hay cuenta publicitaria, de su nombre: solo lectura",
    // Heredada (solo se ve si ya está configurada), salvo para las empresas con Elephant Ads Manager, que la necesitan
    panel: { group: "marketing", title: "Medición de anuncios de Meta", summary: "Envía a Meta las compras de tu web para medir tus anuncios de Facebook e Instagram y, con Ads Manager, trae cada día lo que gastan y consiguen tus campañas.", legacy: true, requires: ["ads-manager"] },
    fields: [
      { key: "capiAccessToken", label: "Token de acceso", secret: true, env: "META_CAPI_ACCESS_TOKEN", pattern: TOKEN_RE, panel: { label: "Clave de acceso", help: "Se genera en el Administrador de eventos de Meta, en la configuración de tu píxel.", formatMessage: "Cópiala completa, sin espacios." } },
      { key: "capiTestEventCode", label: "Código de evento de prueba", secret: false, env: "META_CAPI_TEST_EVENT_CODE", pattern: /^[A-Za-z0-9_-]{3,40}$/, panel: { label: "Código de prueba (opcional)", help: "Solo para comprobar que llegan los datos; normalmente, déjalo vacío.", formatMessage: "Solo letras, números, guiones y guiones bajos." } },
      // Elephant Ads Manager: lectura de la cuenta publicitaria PROPIA de la empresa (sin ellos, el panel funciona con CSV)
      { key: "adAccountId", label: "Cuenta publicitaria (act_…)", secret: false, pattern: /^(act_)?\d{5,20}$/, hint: "act_1234567890", panel: { label: "Número de tu cuenta publicitaria", help: "Está en el Administrador de anuncios de Meta, junto al nombre de la cuenta (puede empezar por «act_»).", formatMessage: "Solo cifras, con o sin «act_» delante." } },
      { key: "adsAccessToken", label: "Token de lectura de anuncios (ads_read)", secret: true, pattern: TOKEN_RE, panel: { label: "Clave de lectura de tus anuncios", help: "Créala en la configuración del negocio de Meta con un usuario del sistema que tenga acceso a la cuenta publicitaria y permiso para leer anuncios. Si la clave de acceso de arriba ya tiene ese permiso, puedes dejarla vacía.", formatMessage: "Cópiala completa, sin espacios." } },
    ],
  },
  {
    // Elephant Ads Manager: cuenta de Google Ads PROPIA de cada empresa, solo lectura (GAQL sobre campaign). Google exige
    // un token de desarrollador aprobado y un cliente OAuth: sin todos los datos, la conexión está desactivada y el panel
    // funciona con el CSV del informe de Google Ads. Nunca una cuenta ni un token de otra empresa o de la plataforma
    id: "google_ads",
    name: "Google Ads (solo lectura)",
    description: "Lectura diaria del coste, las impresiones, los clics y las conversiones de las campañas de la cuenta de Google Ads de la empresa para Elephant Ads Manager.",
    capabilities: ["Leer cada día el coste, las impresiones, los clics y las conversiones de las campañas (solo lectura: nunca crea ni modifica campañas)"],
    check: "Renovación del acceso y consulta de la cuenta y de un día de sus campañas: solo lectura",
    panel: { group: "marketing", title: "Google Ads", summary: "Trae cada día lo que gastan y consiguen tus campañas de Google para verlas junto a tus ventas. Si no lo configuras, puedes subir el informe de Google Ads a mano.", requires: ["ads-manager"] },
    fields: [
      { key: "customerId", label: "ID de cliente de Google Ads", secret: false, required: true, pattern: /^\d{3}-?\d{3}-?\d{4}$/, hint: "123-456-7890", panel: { label: "Número de tu cuenta de Google Ads", help: "Aparece arriba a la derecha en Google Ads, con el formato 123-456-7890.", formatMessage: "Son 10 cifras, con o sin guiones (123-456-7890)." } },
      { key: "loginCustomerId", label: "ID de la cuenta de administrador (MCC)", secret: false, pattern: /^\d{3}-?\d{3}-?\d{4}$/, panel: { label: "Número de tu cuenta de administrador (opcional)", help: "Solo si entras en la cuenta a través de una cuenta de administrador (la de tu agencia o la tuya).", formatMessage: "Son 10 cifras, con o sin guiones (123-456-7890)." } },
      { key: "developerToken", label: "Token de desarrollador", secret: true, required: true, pattern: /^[A-Za-z0-9_-]{16,64}$/, panel: { label: "Clave de desarrollador de Google Ads", help: "Se solicita a Google en el Centro de la API de tu cuenta de administrador (Herramientas → Centro de la API) y debe estar aprobada.", formatMessage: "Letras, números, guiones y guiones bajos, sin espacios." } },
      { key: "clientId", label: "ID de cliente OAuth", secret: false, required: true, pattern: /^[A-Za-z0-9._-]{10,200}\.apps\.googleusercontent\.com$/, panel: { label: "Identificador de la aplicación de Google", help: "Se crea en Google Cloud (Credenciales → ID de cliente de OAuth) con la API de Google Ads activada. Termina en «.apps.googleusercontent.com».", formatMessage: "Debe terminar en «.apps.googleusercontent.com»." } },
      { key: "clientSecret", label: "Secreto de cliente OAuth", secret: true, required: true, pattern: TOKEN_RE, panel: { label: "Clave secreta de la aplicación de Google", help: "Se muestra junto al identificador de la aplicación en Google Cloud.", formatMessage: "Cópiala completa, sin espacios." } },
      { key: "refreshToken", label: "Refresh token (ámbito adwords)", secret: true, required: true, pattern: TOKEN_RE, panel: { label: "Permiso de lectura de tu cuenta", help: "Se obtiene al autorizar esa aplicación con el usuario de Google que entra en tu cuenta de Google Ads (permiso de Google Ads).", formatMessage: "Cópialo completo, sin espacios." } },
    ],
  },
  {
    id: "imap_tpv",
    name: "Buzón de tickets del datáfono",
    description: "Lee los tickets que el banco envía por correo y los concilia con las ventas del TPV.",
    capabilities: ["Leer los tickets del datáfono del buzón (cada 5 minutos)", "Conciliar con las ventas del TPV"],
    check: "Inicio de sesión IMAP y apertura de la carpeta en solo lectura (no lee ni marca mensajes)",
    panel: { group: "mailboxes", title: "Tickets del datáfono por correo", summary: "Lee los tickets que tu banco envía por correo y los cuadra con las ventas de la caja.", requires: ["bank-import-pos"] },
    fields: imapFields("IMAP_TPV", [
      { key: "allowedSender", label: "Remitente de los tickets", secret: false, env: "IMAP_TPV_ALLOWED_SENDER", pattern: EMAIL_RE, hint: "copia@ticket.tubanco.com", panel: { label: "Dirección que envía los tickets", help: "La dirección desde la que tu banco te manda las copias de los tickets. Solo se leen los correos de esa dirección.", formatMessage: "Escribe una dirección de correo válida (por ejemplo, copia@ticket.tubanco.com)." } },
    ]),
  },
  {
    id: "imap_expenses",
    name: "Buzón de gastos",
    description: "Lee los justificantes de gasto (PDF o foto) que se reenvían a este buzón.",
    capabilities: ["Leer los justificantes de gasto del buzón", "Crear gastos a partir de su asunto"],
    check: "Inicio de sesión IMAP y apertura de la carpeta en solo lectura (no lee ni marca mensajes)",
    panel: { group: "mailboxes", title: "Justificantes de gasto por correo", summary: "Reenvía las facturas de tus proveedores (PDF o foto) a un buzón y se registran como gastos.", requires: ["purchasing-basic"] },
    fields: imapFields("IMAP_EXPENSE"),
  },
  {
    id: "mail_smtp",
    name: "Correo saliente propio (SMTP)",
    description: "Opcional. Tus correos salen por tu servidor SMTP con tu dirección, que debe ser de un dominio propio verificado. Sin él, se usa el servicio de correo de Elephant Source.",
    capabilities: ["Enviar los correos de la empresa desde su propio servidor"],
    check: "Conexión y autenticación SMTP sin enviar ningún mensaje",
    panel: {
      group: "email",
      title: "Enviar correos desde tu propia dirección",
      summary: "Opcional. Los correos a tus clientes salen desde tu buzón (por ejemplo, hola@tuempresa.es). Si no lo configuras, se envían igualmente desde el servicio de correo de Elephant Source.",
      requires: ["comms-email"],
    },
    fields: [
      { key: "host", label: "Servidor SMTP", secret: false, required: true, pattern: HOST_RE, hint: "smtp.tuproveedor.com", panel: { label: "Servidor de correo saliente", help: "Lo indica tu proveedor de correo en sus instrucciones para configurar el correo.", formatMessage: "Escribe solo el nombre del servidor, sin espacios ni «https://» (por ejemplo, smtp.tuproveedor.com)." } },
      { key: "port", label: "Puerto", secret: false, pattern: PORT_RE, hint: "587", panel: { label: "Puerto", help: "Normalmente 587 (o 465 si tu proveedor lo indica). Si lo dejas vacío, se usa 587.", formatMessage: "El puerto es un número (por ejemplo, 587)." } },
      { key: "secure", label: "TLS directo (puerto 465)", secret: false, options: ["true", "false"], panel: { label: "Conexión cifrada directa (puerto 465)", help: "Marca «Sí» solo si usas el puerto 465.", control: "yesno" } },
      { key: "user", label: "Usuario", secret: false, required: true, pattern: MAILBOX_USER_RE, panel: { label: "Usuario", help: "Normalmente, tu dirección de correo completa.", formatMessage: "El usuario no puede tener espacios." } },
      { key: "pass", label: "Contraseña", secret: true, required: true, pattern: PASSWORD_RE, panel: { label: "Contraseña", help: "La de tu buzón, o una «contraseña de aplicación» si tu proveedor la exige (Gmail y Outlook, por ejemplo).", formatMessage: "La contraseña no puede tener saltos de línea." } },
      { key: "fromEmail", label: "Dirección del remitente", secret: false, required: true, pattern: EMAIL_RE, hint: "hola@tuempresa.es", panel: { label: "Dirección desde la que se envía", help: "Debe ser de tu propio dominio (por ejemplo, hola@tuempresa.es).", formatMessage: "Escribe una dirección de correo válida (por ejemplo, hola@tuempresa.es)." } },
    ],
  },
  {
    // Correo TRANSACCIONAL de la empresa con SU servidor de Postmark (decisión del 08/11/2026). Distinto del Postmark de la
    // plataforma (variables POSTMARK_*): sin configurar, los correos salen por el servicio de Elephant Source como hoy. Solo
    // el flujo transaccional: las campañas siguen en Brevo marketing. Activación guiada en /admin/configuracion/postmark
    id: "postmark",
    name: "Postmark (correo transaccional)",
    description: "Opcional. Los correos transaccionales de la empresa (confirmaciones, facturas, accesos) salen por su propio servidor de Postmark, con su dominio verificado, y se registra si se entregan o rebotan. Sin configurar, se usa el servicio de correo de Elephant Source.",
    capabilities: [
      "Enviar los correos transaccionales de la empresa por su flujo transaccional de Postmark, sin seguimiento de aperturas ni de clics",
      "Recibir por webhook los avisos de entrega, rebote, queja y baja de esos correos",
    ],
    check: "Consulta del servidor y del flujo de mensajes (GET /server y GET /message-streams/{id}): solo lectura",
    panel: {
      group: "email",
      title: "Correo transaccional con Postmark",
      summary: "Opcional. Tus confirmaciones, facturas y avisos salen por tu cuenta de Postmark con tu dominio, y en la ficha de cada cliente ves si le han llegado. La activación guiada está en Ajustes → Correo transaccional (Postmark).",
      requires: ["comms-email"],
    },
    fields: [
      { key: "serverToken", label: "Server API token", secret: true, required: true, pattern: /^[A-Za-z0-9-]{20,100}$/, panel: { label: "Token del servidor de Postmark", help: "En Postmark: tu servidor → API Tokens → «Server API token» (no el de la cuenta).", formatMessage: "El token tiene letras, números y guiones, sin espacios. Cópialo completo." } },
      { key: "messageStream", label: "Flujo de mensajes", secret: false, pattern: /^[a-z0-9][a-z0-9-]{0,49}$/, hint: "outbound", panel: { label: "Flujo transaccional", help: "Déjalo vacío para usar «outbound», el flujo transaccional por defecto. Nunca uno de difusión (broadcast).", formatMessage: "Solo minúsculas, números y guiones (por ejemplo, outbound)." } },
      { key: "fromEmail", label: "Dirección del remitente", secret: false, required: true, pattern: EMAIL_RE, hint: "reservas@tuempresa.es", panel: { label: "Dirección desde la que se envía", help: "De un dominio propio verificado en Elephant Source y firmado (DKIM) en Postmark.", formatMessage: "Escribe una dirección de correo válida (por ejemplo, reservas@tuempresa.es)." } },
      // Lo genera la plataforma (pantalla de Postmark) y se pega como cabecera del webhook en Postmark
      { key: "webhookToken", label: "Token del webhook", secret: true, pattern: /^[A-Za-z0-9_-]{32,128}$/, panel: { label: "Token del webhook", hidden: true } },
      // Marca de la última comprobación correcta (servidor Live y flujo transaccional) de este token y flujo: sin ella no se usa
      { key: "verifiedFor", label: "Comprobación", secret: true, pattern: /^[a-f0-9]{64}$/, panel: { label: "Comprobación", hidden: true } },
    ],
  },
  {
    // Distinto del Brevo del CORREO de la plataforma (server/mail, variables BREVO_*): esta es la cuenta de marketing
    // PROPIA de cada empresa, para sincronizar sus contactos con consentimiento con una lista suya
    id: "brevo_marketing",
    name: "Brevo (email marketing)",
    description: "Sincroniza con una lista de tu cuenta de Brevo los contactos del CRM que han dado su consentimiento para recibir comunicaciones comerciales.",
    capabilities: ["Consultar la cuenta y sus listas", "Añadir o actualizar en la lista elegida los contactos con consentimiento", "Quitar de la lista a quien retira el consentimiento", "Leer las bajas de la lista para respetarlas en el CRM"],
    check: "Consulta de la cuenta (GET /v3/account): solo lectura",
    panel: { group: "marketing", title: "Email marketing con Brevo", summary: "Envía tus campañas desde tu cuenta de Brevo a los clientes que han aceptado recibirlas.", requires: ["email-campaigns"] },
    fields: [
      { key: "apiKey", label: "Clave API", secret: true, required: true, pattern: /^xkeysib-[A-Za-z0-9-]{20,200}$/, panel: { label: "Clave API de Brevo", help: "Créala en tu cuenta de Brevo, en «SMTP y API» → «Claves API». Empieza por «xkeysib-».", formatMessage: "La clave empieza por «xkeysib-» y no tiene espacios. Cópiala completa." } },
    ],
  },
  {
    // Cuenta de agencia PROPIA de cada empresa en Veturis (nunca la de otra empresa ni variables de entorno)
    id: "veturis",
    name: "Veturis (alojamiento)",
    description: "Banco de camas para los expedientes de Travel Net: buscar disponibilidad y precio de hoteles y, si lo activas, reservarlos.",
    capabilities: ["Buscar disponibilidad y precio de hoteles (solo lectura)", "Revalidar el precio de una oferta antes de confirmar", "Reservar el alojamiento, solo si activas la reserva en Travel Net"],
    check: "Búsqueda de disponibilidad de prueba (SearchAvailability): no reserva nada",
    panel: { group: "suppliers", title: "Veturis: hoteles para tus viajes", summary: "Busca hoteles de Veturis desde tus expedientes de viaje con tu propia cuenta de agencia.", requires: ["travel-net"] },
    fields: [
      { key: "environment", label: "Entorno", secret: false, required: true, options: ["test", "live"], panel: { label: "Modo", help: "Empieza en «Pruebas» con el usuario de pruebas que te da Veturis; pasa a «Real» cuando Veturis te certifique.", optionLabels: { test: "Pruebas (sin reservas reales)", live: "Real" } } },
      { key: "user", label: "Usuario XML", secret: true, required: true, pattern: TOKEN_RE, panel: { label: "Usuario de la API", help: "Te lo da Veturis al darte de alta en su API XML.", formatMessage: "Cópialo completo, sin espacios." } },
      { key: "password", label: "Clave XML", secret: true, required: true, pattern: PASSWORD_RE, panel: { label: "Clave de la API", formatMessage: "La clave no puede tener saltos de línea." } },
      { key: "agencyUser", label: "Usuario de la agencia", secret: true, required: true, pattern: TOKEN_RE, panel: { label: "Usuario de tu agencia en Veturis", formatMessage: "Cópialo completo, sin espacios." } },
      { key: "agencyPassword", label: "Clave de la agencia", secret: true, required: true, pattern: PASSWORD_RE, panel: { label: "Clave de tu agencia en Veturis", formatMessage: "La clave no puede tener saltos de línea." } },
    ],
  },
  {
    // Search Console PROPIO de cada empresa: su cuenta de servicio de Google Cloud con acceso a su propiedad (como
    // Skicenter, sin OAuth de Big Elephant). Elephant SEO Control (server/seoControl/connectors.ts)
    id: "google_search_console",
    name: "Google Search Console",
    description: "Importa de tu propiedad de Search Console los clics, las impresiones y la posición media de tus palabras clave y páginas.",
    capabilities: ["Listar las propiedades a las que tiene acceso la cuenta de servicio (solo lectura)", "Leer el rendimiento de búsqueda de tu propiedad por consulta, página y día (solo lectura)"],
    check: "Inicio de sesión de la cuenta de servicio y listado de propiedades (sites.list): solo lectura",
    panel: { group: "marketing", title: "Google Search Console", summary: "Posiciones, clics e impresiones de tu web en Google para el seguimiento SEO.", requires: ["seo-control"] },
    fields: [
      { key: "serviceAccountJson", label: "JSON de la cuenta de servicio", secret: true, required: true, maxLength: 6000, pattern: /^\s*\{[\s\S]*"private_key"[\s\S]*\}\s*$/, panel: { label: "Cuenta de servicio de Google (JSON)", help: "En Google Cloud: crea una cuenta de servicio, genera una clave JSON y pega aquí el contenido completo del fichero. Después añade el correo de la cuenta como usuario de tu propiedad en Search Console.", formatMessage: "Pega el contenido completo del fichero JSON (empieza por «{» e incluye «private_key»)." } },
      { key: "siteUrl", label: "Propiedad", secret: false, required: true, pattern: /^(sc-domain:[A-Za-z0-9.-]{3,253}|https?:\/\/[^\s/]{3,253}\/[^\s]{0,200})$/, hint: "sc-domain:miempresa.es", panel: { label: "Propiedad de Search Console", help: "Tal como aparece en Search Console: «sc-domain:miempresa.es» para una propiedad de dominio o «https://www.miempresa.es/» para una de prefijo de URL.", formatMessage: "Escribe «sc-domain:tudominio.es» o la URL completa terminada en «/»." } },
    ],
  },
  {
    // Ficha PROPIA de la empresa en Google Business Profile: su cliente OAuth y su token de actualización (Skicenter usa
    // el mismo flujo con su app; aquí cada empresa trae la suya). Solo lectura de reseñas
    id: "google_business_profile",
    name: "Google Business Profile",
    description: "Lee las reseñas de la ficha de tu negocio en Google para verlas en SEO Control junto al resto.",
    capabilities: ["Renovar el acceso con tu token de actualización", "Listar tus cuentas y leer las reseñas de tu ficha (solo lectura: no responde ni edita nada)"],
    check: "Renovación del token y listado de cuentas: solo lectura",
    panel: { group: "marketing", title: "Reseñas de Google (Business Profile)", summary: "Reseñas de tu ficha de Google en el panel de SEO Control.", requires: ["seo-control"] },
    fields: [
      { key: "clientId", label: "ID de cliente OAuth", secret: false, required: true, pattern: /^[A-Za-z0-9._-]{10,200}$/, panel: { label: "ID de cliente OAuth", help: "En tu proyecto de Google Cloud con acceso aprobado a la API de Business Profile: «APIs y servicios» → «Credenciales».", formatMessage: "Cópialo completo, sin espacios." } },
      { key: "clientSecret", label: "Secreto del cliente OAuth", secret: true, required: true, pattern: TOKEN_RE, panel: { label: "Secreto del cliente OAuth", formatMessage: "Cópialo completo, sin espacios." } },
      { key: "refreshToken", label: "Token de actualización", secret: true, required: true, pattern: TOKEN_RE, panel: { label: "Token de actualización", help: "Se obtiene autorizando tu cliente OAuth con la cuenta que gestiona la ficha (permiso business.manage).", formatMessage: "Cópialo completo, sin espacios." } },
      { key: "locationPath", label: "Ficha", secret: false, required: true, pattern: /^accounts\/[A-Za-z0-9_-]{1,64}\/locations\/[A-Za-z0-9_-]{1,64}$/, hint: "accounts/123/locations/456", panel: { label: "Identificador de la ficha", help: "Con la forma accounts/{cuenta}/locations/{ficha}.", formatMessage: "Debe tener la forma accounts/123/locations/456." } },
    ],
  },
  {
    // Clave PROPIA de la empresa en la API de contenidos de TripAdvisor (Terra). Solo lectura de reseñas
    id: "tripadvisor",
    name: "TripAdvisor",
    description: "Lee las reseñas más recientes de tu establecimiento en TripAdvisor para verlas en SEO Control.",
    capabilities: ["Leer las reseñas más recientes de tu establecimiento (solo lectura; cada reseña consume cuota de tu cuenta)"],
    check: "Lectura de 1 reseña del establecimiento: solo lectura (consume 1 unidad de cuota)",
    panel: { group: "marketing", title: "Reseñas de TripAdvisor", summary: "Reseñas de tu establecimiento en TripAdvisor en el panel de SEO Control.", requires: ["seo-control"] },
    fields: [
      { key: "apiKey", label: "Clave de la API", secret: true, required: true, pattern: TOKEN_RE, panel: { label: "Clave de la API de TripAdvisor", help: "La de tu cuenta de la API de contenidos de TripAdvisor.", formatMessage: "Cópiala completa, sin espacios." } },
      { key: "locationId", label: "ID del establecimiento", secret: false, required: true, pattern: /^\d{1,12}$/, panel: { label: "Identificador del establecimiento", help: "El número que aparece en la dirección de tu ficha de TripAdvisor (…-d123456-…).", formatMessage: "Solo números." } },
    ],
  },
  {
    // Venta multicanal: credenciales PREPARADAS para el conector de Fourvenues (su API de integraciones exige una clave
    // que emite Fourvenues a cada organizador). Hoy las ventas entran por el informe CSV o el enlace de entrada del canal.
    id: "fourvenues",
    name: "Fourvenues",
    description: "Cuenta de Fourvenues para el conector de entradas de la Venta multicanal (en preparación).",
    capabilities: ["Guardar la clave de tu cuenta para el conector de entradas (aún no se usa: las ventas entran por CSV o por el enlace del canal)"],
    check: "Sin prueba de conexión: el conector se activa en la implantación acompañada, con la clave que te emite Fourvenues",
    panel: { group: "channels", title: "Fourvenues", summary: "Guarda aquí la clave de la API de Fourvenues para cuando se active el conector. Mientras, importa su informe de ventas en Venta multicanal.", requires: ["multichannel"] },
    fields: [
      { key: "apiKey", label: "Clave de la API", secret: true, required: true, pattern: TOKEN_RE, panel: { label: "Clave de la API de Fourvenues", help: "La emite el equipo de integraciones de Fourvenues para tu organización.", formatMessage: "Cópiala completa, sin espacios." } },
      { key: "organizationId", label: "Organización", secret: false, pattern: /^[A-Za-z0-9_-]{1,64}$/, panel: { label: "Identificador de tu organización", help: "El que figura en tu panel de Fourvenues.", formatMessage: "Solo letras, números, guiones y guiones bajos." } },
    ],
  },
  {
    // Venta multicanal: credenciales PREPARADAS para el conector de Weezevent (API con clave y usuario de la cuenta).
    id: "weezevent",
    name: "Weezevent",
    description: "Cuenta de Weezevent para el conector de entradas de la Venta multicanal (en preparación).",
    capabilities: ["Guardar la clave y el usuario de tu cuenta para el conector de entradas (aún no se usa: las ventas entran por CSV o por el enlace del canal)"],
    check: "Sin prueba de conexión: el conector se activa en la implantación acompañada, con la clave de API que te da Weezevent",
    panel: { group: "channels", title: "Weezevent", summary: "Guarda aquí la clave de la API de Weezevent para cuando se active el conector. Mientras, importa su informe de participantes en Venta multicanal.", requires: ["multichannel"] },
    fields: [
      { key: "apiKey", label: "Clave de la API", secret: true, required: true, pattern: TOKEN_RE, panel: { label: "Clave de la API de Weezevent", help: "Se solicita a Weezevent desde tu cuenta de organizador.", formatMessage: "Cópiala completa, sin espacios." } },
      { key: "user", label: "Usuario", secret: false, pattern: MAILBOX_USER_RE, panel: { label: "Usuario de tu cuenta de Weezevent", formatMessage: "El usuario no puede tener espacios." } },
      { key: "password", label: "Contraseña", secret: true, pattern: PASSWORD_RE, panel: { label: "Contraseña de tu cuenta de Weezevent", formatMessage: "La contraseña no puede tener saltos de línea." } },
    ],
  },
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Variable de entorno histórica → (proveedor, campo). */
export function resolveEnvName(envName: string): { provider: string; field: string } | null {
  for (const p of PROVIDERS) {
    for (const f of p.fields) if (f.env === envName) return { provider: p.id, field: f.key };
  }
  return null;
}

export function validateFields(provider: ProviderDef, values: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    const f = provider.fields.find((x) => x.key === k);
    if (!f) {
      problems.push(`${k}: campo desconocido`);
      continue;
    }
    if (v === "") continue; // vacío = borrar
    if (f.options && !f.options.includes(v)) problems.push(`${k}: valor no permitido`);
    else if (f.pattern && !f.pattern.test(v)) problems.push(`${k}: formato no válido`);
    else if (v.length > fieldMaxLength(f)) problems.push(`${k}: demasiado largo`);
  }
  return problems;
}
