/**
 * Contratos y firma electrónica (capacidad `contracts-esign`) · lógica pura compartida por el servidor y el panel:
 * variables de las plantillas, estados del contrato y sus transiciones, límites y textos.
 *
 * La firma es SIMPLE (aceptación expresa, nombre escrito, DNI/NIF opcional, fecha, IP, navegador y huella SHA-256 del
 * texto firmado), como la del contrato de alquiler de Ski Net. No es firma avanzada ni cualificada.
 */

export const ESIGN_CAPABILITY = "contracts-esign";

export const ESIGN_PATHS = { contracts: "/admin/contratos", templates: "/admin/contratos/plantillas" } as const;

/** Aviso que acompaña a la firma en el panel, en la página pública y en el PDF. */
export const SIMPLE_SIGNATURE_NOTICE =
  "Firma electrónica simple: aceptación expresa con nombre escrito, fecha, IP, navegador y huella SHA-256 del texto firmado. No es una firma electrónica avanzada ni cualificada.";

export const ESIGN_LIMITS = {
  titleMax: 200,
  bodyMin: 20,
  bodyMax: 60_000,
  nameMax: 120,
  taxIdMax: 20,
  reasonMax: 500,
  linkDefaultHours: 72,
  linkMaxHours: 14 * 24,
} as const;

// ─── Variables de plantilla ──────────────────────────────────────────────────

export const TEMPLATE_VARIABLES = [
  { key: "cliente.nombre", label: "Nombre del cliente" },
  { key: "cliente.email", label: "Correo del cliente" },
  { key: "cliente.nif", label: "DNI/NIF del cliente" },
  { key: "cliente.telefono", label: "Teléfono del cliente" },
  { key: "cliente.direccion", label: "Dirección del cliente" },
  { key: "cliente.empresa", label: "Empresa del cliente" },
  { key: "empresa.nombre", label: "Nombre de tu empresa" },
  { key: "fecha", label: "Fecha del contrato" },
  { key: "importe", label: "Importe" },
  { key: "contrato.titulo", label: "Título del contrato" },
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]["key"];
const KNOWN = new Set<string>(TEMPLATE_VARIABLES.map((v) => v.key));

/** `{{ nombre.de.variable }}` (espacios opcionales). */
const VAR_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;

/** Variables que usa un texto (sin repetir, en orden de aparición). */
export function variablesOf(text: string): string[] {
  const out: string[] = [];
  text.replace(VAR_RE, (_whole, key: string) => {
    if (!out.includes(key)) out.push(key);
    return "";
  });
  return out;
}

/** Variables desconocidas de una plantilla (una plantilla con alguna no se guarda). */
export function unknownVariables(text: string): string[] {
  return variablesOf(text).filter((v) => !KNOWN.has(v));
}

/** Valor que se escribe cuando falta un dato (para que se vea en el borrador y se complete). */
export const MISSING_VALUE = "________";

export type TemplateValues = Partial<Record<TemplateVariable, string | null | undefined>>;

/**
 * Sustituye las variables por sus valores. Un valor que falta se escribe como `MISSING_VALUE` y se devuelve en
 * `missing`; una variable desconocida se deja tal cual y se devuelve en `unknown`. Puro y determinista.
 */
export function renderTemplate(text: string, values: TemplateValues): { text: string; missing: string[]; unknown: string[] } {
  const missing: string[] = [];
  const unknown: string[] = [];
  const out = text.replace(VAR_RE, (whole, key: string) => {
    if (!KNOWN.has(key)) {
      if (!unknown.includes(key)) unknown.push(key);
      return whole;
    }
    const v = values[key as TemplateVariable];
    const s = v == null ? "" : String(v).trim();
    if (!s) {
      if (!missing.includes(key)) missing.push(key);
      return MISSING_VALUE;
    }
    return s;
  });
  return { text: out, missing, unknown };
}

/** Importe en euros con formato español («1.234,50 €»); null o no finito → null. */
export function formatAmount(amount: number | null | undefined): string | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(amount);
}

/** Fecha AAAA-MM-DD en formato largo español, sin zona horaria («8 de noviembre de 2026»). */
export function formatLongDay(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

/** Problema de una plantilla (título y cuerpo) o null si es válida. */
export function templateProblem(t: { title: string; body: string }): string | null {
  const title = t.title.trim();
  if (title.length < 2) return "Escribe el título de la plantilla.";
  if (title.length > ESIGN_LIMITS.titleMax) return `El título admite como máximo ${ESIGN_LIMITS.titleMax} caracteres.`;
  const body = t.body.trim();
  if (body.length < ESIGN_LIMITS.bodyMin) return "El texto del contrato es demasiado corto.";
  if (body.length > ESIGN_LIMITS.bodyMax) return `El texto del contrato admite como máximo ${ESIGN_LIMITS.bodyMax} caracteres.`;
  const unknown = unknownVariables(body + "\n" + title);
  if (unknown.length) return `Variables desconocidas: ${unknown.map((v) => `{{${v}}}`).join(", ")}.`;
  return null;
}

// ─── Estados del contrato ────────────────────────────────────────────────────

export const CONTRACT_STATUSES = ["draft", "sent", "signed", "rejected", "void"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  draft: "Borrador",
  sent: "Enviado",
  signed: "Firmado",
  rejected: "Rechazado",
  void: "Anulado",
};

export type ContractAction = "edit" | "send" | "sign" | "reject" | "void";

/** Transiciones permitidas: borrador → enviado → firmado / rechazado; borrador o enviado → anulado. */
const TRANSITIONS: Record<ContractAction, { from: readonly ContractStatus[]; to: ContractStatus }> = {
  edit: { from: ["draft"], to: "draft" },
  send: { from: ["draft", "sent"], to: "sent" },
  sign: { from: ["draft", "sent"], to: "signed" },
  reject: { from: ["sent"], to: "rejected" },
  void: { from: ["draft", "sent"], to: "void" },
};

export function canTransition(from: ContractStatus, action: ContractAction): boolean {
  return TRANSITIONS[action].from.includes(from);
}

/** Estado al que lleva una acción, o un error en español si no se puede. */
export function nextStatus(from: ContractStatus, action: ContractAction): { ok: true; status: ContractStatus } | { ok: false; error: string } {
  if (canTransition(from, action)) return { ok: true, status: TRANSITIONS[action].to };
  const what: Record<ContractAction, string> = {
    edit: "editar",
    send: "enviar",
    sign: "firmar",
    reject: "rechazar",
    void: "anular",
  };
  return { ok: false, error: `Un contrato ${CONTRACT_STATUS_LABEL[from].toLowerCase()} no se puede ${what[action]}.` };
}

/** Estado final: ya no cambia. */
export const isFinalStatus = (s: ContractStatus) => s === "signed" || s === "rejected" || s === "void";

// ─── Firma ───────────────────────────────────────────────────────────────────

/** DNI, NIE o NIF/CIF en forma normalizada (mayúsculas sin espacios ni guiones). */
const TAX_ID_RE = /^[A-Z0-9]{5,20}$/;

/**
 * Valida la firma: aceptación expresa, nombre escrito (2 a 120) y DNI/NIF opcional. Devuelve los datos normalizados o
 * un error en español.
 */
export function checkSigner(input: { signerName: string; signerTaxId?: string | null; accepted: boolean }): { ok: true; signerName: string; signerTaxId: string | null } | { ok: false; error: string } {
  if (!input.accepted) return { ok: false, error: "Hay que aceptar el contrato para firmarlo." };
  const signerName = input.signerName.trim().replace(/\s+/g, " ");
  if (signerName.length < 2 || signerName.length > ESIGN_LIMITS.nameMax) return { ok: false, error: "Escribe el nombre y apellidos de quien firma." };
  const raw = (input.signerTaxId ?? "").toUpperCase().replace(/[\s.-]/g, "");
  if (!raw) return { ok: true, signerName, signerTaxId: null };
  if (!TAX_ID_RE.test(raw)) return { ok: false, error: "El DNI/NIF no es válido." };
  return { ok: true, signerName, signerTaxId: raw };
}

/** Horas de validez del enlace de firma (por defecto 72; entre 1 y 14 días). */
export function linkHours(hours: number | null | undefined): number {
  if (hours == null || !Number.isFinite(hours)) return ESIGN_LIMITS.linkDefaultHours;
  return Math.min(ESIGN_LIMITS.linkMaxHours, Math.max(1, Math.round(hours)));
}

/** ¿El enlace ha caducado en `now`? Sin fecha de caducidad no caduca (los de firma siempre la llevan). */
export const isLinkExpired = (expiresAt: number | null, now: number) => expiresAt != null && expiresAt <= now;

export const EVIDENCE_EVENT_LABEL: Record<string, string> = {
  created: "Contrato creado",
  edited: "Borrador editado",
  sent: "Contenido fijado y enviado a firma",
  link_issued: "Enlace de firma emitido",
  link_revoked: "Enlace de firma desactivado",
  mail_sent: "Enlace enviado por correo",
  mail_failed: "No se pudo enviar el correo",
  viewed: "Contrato abierto con el enlace",
  signed: "Contrato firmado",
  rejected: "Contrato rechazado",
  void: "Contrato anulado",
  pdf: "PDF firmado generado",
};
