/**
 * Elephant Connect · Brevo marketing — reglas puras de la sincronización (sin BD ni red).
 *
 *  - Sin consentimiento no hay contacto: solo se exporta quien tiene el consentimiento de marketing CONCEDIDO (nunca se
 *    presume) y un correo válido.
 *  - Las bajas mandan: un correo dado de baja en Brevo (de la lista o de toda la cuenta) retira el consentimiento en el
 *    CRM y no se vuelve a exportar; quien retira el consentimiento en el CRM sale de la lista.
 *  - Un cambio de correo saca el antiguo de la lista y exporta el nuevo.
 *  - Tope de contactos por ejecución: lo que no cabe queda para la siguiente (ejecución parcial).
 */

export const MAX_CONTACTS_PER_RUN = 5000;
/** Llamadas a Brevo por ejecución (lectura de bajas + importaciones + bajas de la lista). */
export const MAX_CALLS_PER_RUN = 60;
/** Una ejecución «en curso» más antigua que esto se da por caída (el proceso se reinició a mitad). */
export const STALE_RUN_MS = 30 * 60_000;

export type ConsentStatus = "granted" | "withdrawn";
export const CONSENT_SOURCES = ["form", "in_person", "import", "phone", "other"] as const;
export const CONSENT_SOURCE_LABEL: Record<(typeof CONSENT_SOURCES)[number], string> = {
  form: "Formulario",
  in_person: "En persona (firmado)",
  import: "Importación con prueba de consentimiento",
  phone: "Teléfono (grabado)",
  other: "Otro",
};

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export function normalizeEmail(e: string | null | undefined): string | null {
  const v = (e ?? "").trim().toLowerCase();
  return EMAIL_RE.test(v) ? v : null;
}

export interface Candidate {
  clientId: number;
  email: string | null;
  name: string | null;
  consent: ConsentStatus | null;
}
export interface PreviousSync {
  email: string;
  status: "synced" | "removed" | "error";
}

export interface SyncPlan {
  toImport: Array<{ clientId: number; email: string; firstName: string | null }>;
  toRemove: Array<{ clientId: number; email: string }>;
  /** Con consentimiento en el CRM pero dados de baja en Brevo: se retira el consentimiento. */
  unsubscribed: Array<{ clientId: number; email: string }>;
  skipped: number;
  /** Quedan contactos para otra ejecución por el tope. */
  truncated: boolean;
}

const firstName = (name: string | null) => {
  const n = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return n ? n.slice(0, 60) : null;
};

export function planSync(candidates: Candidate[], previous: Map<number, PreviousSync>, brevoUnsubscribed: Set<string>, maxContacts = MAX_CONTACTS_PER_RUN): SyncPlan {
  const plan: SyncPlan = { toImport: [], toRemove: [], unsubscribed: [], skipped: 0, truncated: false };
  const seen = new Set<string>();
  let work = 0;
  const room = () => {
    if (work >= maxContacts) {
      plan.truncated = true;
      return false;
    }
    work++;
    return true;
  };
  for (const c of [...candidates].sort((a, b) => a.clientId - b.clientId)) {
    const email = normalizeEmail(c.email);
    const prev = previous.get(c.clientId);
    const wasInList = prev && prev.status !== "removed";
    // Correo cambiado o ya no válido: el antiguo sale de la lista
    if (wasInList && prev.email !== email && room()) plan.toRemove.push({ clientId: c.clientId, email: prev.email });
    if (c.consent !== "granted") {
      if (wasInList && prev.email === email && email && room()) plan.toRemove.push({ clientId: c.clientId, email });
      continue;
    }
    if (!email || seen.has(email)) {
      plan.skipped++;
      continue;
    }
    seen.add(email);
    if (brevoUnsubscribed.has(email)) {
      plan.unsubscribed.push({ clientId: c.clientId, email });
      continue;
    }
    if (room()) plan.toImport.push({ clientId: c.clientId, email, firstName: firstName(c.name) });
  }
  return plan;
}

export const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/** Conceder exige origen y una prueba legible (texto aceptado, formulario, referencia del documento…). */
export function checkGrant(source: string, evidence: string): { source: string; evidence: string } {
  if (!(CONSENT_SOURCES as readonly string[]).includes(source)) throw new Error("Origen del consentimiento no válido");
  const e = evidence.trim();
  if (e.length < 5 || e.length > 500) throw new Error("Describe la prueba del consentimiento (entre 5 y 500 caracteres)");
  return { source, evidence: e };
}
