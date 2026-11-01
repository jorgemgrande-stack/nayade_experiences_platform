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

const URL_RE = /^https:\/\/[^\s]{4,500}$/;
const TOKEN_RE = /^[\x21-\x7e]{8,512}$/; // imprimibles ASCII sin espacios

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
    capabilities: ["Recibir el registro de llamadas por webhook", "Consultar asistentes"],
    check: "Listado de asistentes (1 elemento): solo lectura",
    panel: { group: "customer", title: "Asistente de voz (VAPI)", summary: "Atiende llamadas con un asistente de voz y guarda el registro de cada llamada.", requires: ["voice-ai"] },
    fields: [
      { key: "apiKey", label: "API key", secret: true, env: "VAPI_API_KEY", pattern: TOKEN_RE, panel: { label: "Clave de acceso", help: "Está en tu cuenta de VAPI, en el apartado de claves (usa la privada).", formatMessage: "Cópiala completa, sin espacios." } },
      { key: "webhookSecret", label: "Secreto del webhook", secret: true, env: "VAPI_WEBHOOK_SECRET", pattern: TOKEN_RE, panel: { label: "Clave de verificación de llamadas", help: "La eliges tú y la escribes igual en la configuración de tu asistente en VAPI.", formatMessage: "Al menos 8 caracteres, sin espacios." } },
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
    name: "Meta (Conversions API)",
    description: "Eventos de conversión del sitio.",
    capabilities: ["Enviar eventos de conversión del sitio"],
    check: "Consulta de la identidad del token: solo lectura",
    panel: { group: "marketing", title: "Medición de anuncios de Meta", summary: "Envía a Meta las compras de tu web para medir tus anuncios de Facebook e Instagram.", legacy: true },
    fields: [
      { key: "capiAccessToken", label: "Token de acceso", secret: true, env: "META_CAPI_ACCESS_TOKEN", pattern: TOKEN_RE, panel: { label: "Clave de acceso", help: "Se genera en el Administrador de eventos de Meta, en la configuración de tu píxel.", formatMessage: "Cópiala completa, sin espacios." } },
      { key: "capiTestEventCode", label: "Código de evento de prueba", secret: false, env: "META_CAPI_TEST_EVENT_CODE", pattern: /^[A-Za-z0-9_-]{3,40}$/, panel: { label: "Código de prueba (opcional)", help: "Solo para comprobar que llegan los datos; normalmente, déjalo vacío.", formatMessage: "Solo letras, números, guiones y guiones bajos." } },
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
    else if (v.length > 1024) problems.push(`${k}: demasiado largo`);
  }
  return problems;
}
