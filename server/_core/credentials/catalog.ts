/**
 * Catálogo de integraciones configurables por tenant y de sus campos.
 *
 * Cada campo declara si es secreto (cifrado, nunca devuelto en claro), su validación y, para
 * compatibilidad, el nombre de la variable de entorno histórica que sustituye en multiempresa
 * (`integrationEnv("GHL_API_KEY")` ⇒ campo `ghl.apiKey` del tenant).
 */

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
}

export interface ProviderDef {
  id: string;
  name: string;
  description: string;
  fields: CredentialField[];
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
    { key: "host", label: "Servidor IMAP", secret: false, required: true, env: `${prefix}_HOST`, pattern: HOST_RE, hint: "imap.tuproveedor.com" },
    { key: "port", label: "Puerto", secret: false, env: `${prefix}_PORT`, pattern: PORT_RE, hint: "993" },
    { key: "secure", label: "Conexión segura (TLS)", secret: false, env: `${prefix}_SECURE`, options: ["true", "false"] },
    { key: "user", label: "Usuario", secret: false, required: true, env: `${prefix}_USER`, pattern: MAILBOX_USER_RE },
    { key: "pass", label: "Contraseña", secret: true, required: true, env: `${prefix}_PASS`, pattern: PASSWORD_RE },
    { key: "mailbox", label: "Carpeta", secret: false, env: `${prefix}_MAILBOX`, pattern: /^[^\r\n]{1,120}$/, hint: "INBOX" },
    ...extra,
  ];
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "ghl",
    name: "GoHighLevel",
    description: "CRM, bandeja de WhatsApp y automatizaciones.",
    fields: [
      { key: "apiKey", label: "API key", secret: true, env: "GHL_API_KEY", pattern: TOKEN_RE },
      { key: "locationId", label: "Location ID", secret: false, env: "GHL_LOCATION_ID", pattern: /^[A-Za-z0-9_-]{6,64}$/ },
      { key: "inboxToken", label: "Token de la bandeja", secret: true, env: "GHL_PRIVATE_INTEGRATION_TOKEN", pattern: TOKEN_RE },
      { key: "webhookSecret", label: "Secreto del webhook de la bandeja", secret: true, env: "GHL_WEBHOOK_SECRET", pattern: TOKEN_RE },
      { key: "leadWebhookSecret", label: "Secreto del webhook de leads", secret: true, env: "GHL_LEAD_WEBHOOK_SECRET", pattern: TOKEN_RE },
      { key: "leadWebhookUrl", label: "URL del webhook de leads", secret: false, env: "GHL_LEAD_WEBHOOK_URL", pattern: URL_RE },
      { key: "reservationWebhookUrl", label: "URL del webhook de reservas", secret: false, env: "GHL_RESERVATION_WEBHOOK_URL", pattern: URL_RE },
    ],
  },
  {
    id: "vapi",
    name: "VAPI",
    description: "Asistente de voz y registro de llamadas.",
    fields: [
      { key: "apiKey", label: "API key", secret: true, env: "VAPI_API_KEY", pattern: TOKEN_RE },
      { key: "webhookSecret", label: "Secreto del webhook", secret: true, env: "VAPI_WEBHOOK_SECRET", pattern: TOKEN_RE },
    ],
  },
  {
    id: "redsys",
    name: "Redsys (TPV virtual)",
    description: "Cobros con tarjeta. La cuenta es del propio tenant.",
    fields: [
      { key: "environment", label: "Entorno", secret: false, env: "REDSYS_ENVIRONMENT", options: ["test", "production"], required: true },
      { key: "merchantCode", label: "Código de comercio (FUC)", secret: false, env: "REDSYS_MERCHANT_CODE", pattern: /^\d{6,12}$/, required: true },
      { key: "merchantTerminal", label: "Terminal", secret: false, env: "REDSYS_MERCHANT_TERMINAL", pattern: /^\d{1,3}$/ },
      { key: "merchantKey", label: "Clave de firma (SHA-256)", secret: true, env: "REDSYS_MERCHANT_KEY", pattern: /^[A-Za-z0-9+/=]{16,80}$/, required: true },
    ],
  },
  {
    id: "meta",
    name: "Meta (Conversions API)",
    description: "Eventos de conversión del sitio.",
    fields: [
      { key: "capiAccessToken", label: "Token de acceso", secret: true, env: "META_CAPI_ACCESS_TOKEN", pattern: TOKEN_RE },
      { key: "capiTestEventCode", label: "Código de evento de prueba", secret: false, env: "META_CAPI_TEST_EVENT_CODE", pattern: /^[A-Za-z0-9_-]{3,40}$/ },
    ],
  },
  {
    id: "imap_tpv",
    name: "Buzón de tickets del datáfono",
    description: "Lee los tickets que el banco envía por correo y los concilia con las ventas del TPV.",
    fields: imapFields("IMAP_TPV", [
      { key: "allowedSender", label: "Remitente de los tickets", secret: false, env: "IMAP_TPV_ALLOWED_SENDER", pattern: EMAIL_RE, hint: "copia@ticket.tubanco.com" },
    ]),
  },
  {
    id: "imap_expenses",
    name: "Buzón de gastos",
    description: "Lee los justificantes de gasto (PDF o foto) que se reenvían a este buzón.",
    fields: imapFields("IMAP_EXPENSE"),
  },
  {
    id: "mail_smtp",
    name: "Correo saliente propio (SMTP)",
    description: "Opcional. Tus correos salen por tu servidor SMTP con tu dirección, que debe ser de un dominio propio verificado. Sin él, se usa el servicio de correo de Elephant Source.",
    fields: [
      { key: "host", label: "Servidor SMTP", secret: false, required: true, pattern: HOST_RE, hint: "smtp.tuproveedor.com" },
      { key: "port", label: "Puerto", secret: false, pattern: PORT_RE, hint: "587" },
      { key: "secure", label: "TLS directo (puerto 465)", secret: false, options: ["true", "false"] },
      { key: "user", label: "Usuario", secret: false, required: true, pattern: MAILBOX_USER_RE },
      { key: "pass", label: "Contraseña", secret: true, required: true, pattern: PASSWORD_RE },
      { key: "fromEmail", label: "Dirección del remitente", secret: false, required: true, pattern: EMAIL_RE, hint: "reservas@tuempresa.es" },
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
