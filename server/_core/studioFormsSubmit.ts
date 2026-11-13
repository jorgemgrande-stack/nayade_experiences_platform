/**
 * Elephant Studio — recorrido completo de un envío de formulario a medida (E-7).
 *
 * Orden: comprobación de origen → límite por visitante → formulario publicado → validación (campo trampa, tiempo
 * mínimo, campos) → verificación antirrobots (si la empresa la activó en ese formulario) → duplicado → oportunidad en
 * el CRM → constancia del envío (consentimiento, página de origen, UTM, huella de IP) → aviso al propietario.
 *
 * Todo lo que toca datos o servicios llega por `deps`: en producción son los de la empresa en curso (BD, bóveda de
 * credenciales y correo del tenant); en las pruebas, dobles en memoria por empresa. Ningún estado se comparte entre
 * empresas: las claves del límite incluyen la empresa y las credenciales se leen de la bóveda de la empresa.
 */
import { createHmac } from "node:crypto";
import { type BlockDataMap } from "../../shared/pageBlocks";
import type { CaptchaConfig } from "./studioFormsCaptcha";
import { evaluateFormSubmission, FormSubmitError, formRedirect, type FormConsent, type FormSubmission } from "./studioForms";

/** Dos envíos del mismo correo al mismo formulario en esta ventana no crean otra oportunidad: se anotan en la primera. */
export const FORM_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
export const FORM_MAX_BODY_CHARS = 20_000;

export interface FormMeta {
  /** Página desde la que se envió (ruta, sin dominio) */
  page?: string;
  utm?: Partial<Record<"source" | "medium" | "campaign" | "term" | "content", string>>;
}

export interface StudioSubmitInput extends FormSubmission {
  slug: string;
  blockId: string;
  meta?: FormMeta;
  captchaToken?: string;
}

export interface SubmissionRecord {
  leadId: number;
  slug: string;
  blockId: string;
  formTitle: string;
  email: string;
  consent: (FormConsent & { given: boolean; at: number }) | null;
  ipHash: string | null;
  page: string;
  utm: Record<string, string>;
  duplicate: boolean;
  at: number;
}

export interface SubmitDeps {
  tenantId: string;
  now: () => number;
  /** Límite por visitante (true = puede enviar) */
  allow: (key: string) => boolean;
  getForm: (slug: string, blockId: string) => Promise<{ slug: string; data: BlockDataMap["form"] } | null>;
  /** Claves de Turnstile de LA EMPRESA (null = sin configurar) */
  captchaConfig: () => Promise<CaptchaConfig | null>;
  verifyCaptcha: (token: string, secretKey: string, ip: string) => Promise<boolean>;
  findRecent: (email: string, slug: string, blockId: string, since: number) => Promise<{ leadId: number } | null>;
  createLead: (lead: { name: string; email: string; phone?: string; company?: string; message: string }) => Promise<number>;
  addLeadNote: (leadId: number, text: string) => Promise<void>;
  recordSubmission: (r: SubmissionRecord) => Promise<void>;
  /** Aviso al propietario: nunca lanza ni retrasa la respuesta */
  notifyOwner: (n: OwnerNotice) => Promise<void>;
  /** Serializa los envíos del mismo correo y formulario (dos a la vez no crean dos oportunidades) */
  lock: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
  ipSecret: string;
}

export interface OwnerNotice {
  leadId: number;
  duplicate: boolean;
  formTitle: string;
  page: string;
  name: string;
  email: string;
  phone?: string;
  message: string;
}

export type StudioSubmitResult =
  | { ok: true; id: number; message: string; redirectUrl: string }
  | { ok: false; errors: Record<string, string> };

export class StudioSubmitError extends Error {
  constructor(readonly code: "NOT_FOUND" | "TOO_MANY_REQUESTS" | "BAD_REQUEST" | "FORBIDDEN", message: string) {
    super(message);
  }
}

/** La petición viene de la propia web: el origen (si el navegador lo manda) debe ser el mismo sitio que la atiende. */
export function sameSiteOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || origin === "null") return !origin; // sin cabecera: llamada que no es de un navegador (sigue el límite por visitante)
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/** Huella de la IP (nunca se guarda la dirección): HMAC con el secreto de la instalación y la empresa. Sin secreto, nada. */
export function ipFingerprint(ip: string, tenantId: string, secret: string): string | null {
  if (!ip || !secret) return null;
  return createHmac("sha256", secret).update(`studio-form:${tenantId}:${ip}`).digest("hex");
}

const cleanPath = (v: unknown) => (typeof v === "string" && /^\/[^\s<>"']{0,199}$/.test(v) ? v : "");
function cleanUtm(u: FormMeta["utm"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["source", "medium", "campaign", "term", "content"] as const) {
    const v = u?.[k];
    if (typeof v === "string") {
      const t = v.replace(/[^A-Za-z0-9À-ɏ _.:|/+-]/g, "").trim().slice(0, 100);
      if (t) out[k] = t;
    }
  }
  return out;
}

export async function processStudioSubmission(input: StudioSubmitInput, ip: string, deps: SubmitDeps): Promise<StudioSubmitResult> {
  if (JSON.stringify(input.values).length > FORM_MAX_BODY_CHARS) throw new StudioSubmitError("BAD_REQUEST", "El formulario es demasiado largo.");
  const found = await deps.getForm(input.slug, input.blockId);
  if (!found) throw new StudioSubmitError("NOT_FOUND", "Este formulario ya no está disponible.");
  const form = found.data;
  if (!deps.allow(`${deps.tenantId}:${found.slug}:${ip || "desconocida"}`)) {
    throw new StudioSubmitError("TOO_MANY_REQUESTS", "Has enviado varios formularios seguidos. Espera unos minutos e inténtalo de nuevo.");
  }
  let result;
  try {
    result = evaluateFormSubmission(form, input, { slug: found.slug });
  } catch (e) {
    if (e instanceof FormSubmitError) throw new StudioSubmitError("BAD_REQUEST", e.message);
    throw e;
  }
  const success = (id: number): StudioSubmitResult => ({ ok: true, id, message: form.successMessage, redirectUrl: formRedirect(form.redirectUrl) });
  if (result.kind === "invalid") return { ok: false, errors: result.errors };
  // A un envío automático se le responde igual que a uno bueno, sin guardarlo
  if (result.kind === "spam") return success(0);

  // Antirrobots de la empresa: solo si activó Turnstile en este formulario Y tiene sus claves (las de otra empresa nunca valen)
  if (form.captcha === "on") {
    const cfg = await deps.captchaConfig();
    if (cfg) {
      const ok = input.captchaToken ? await deps.verifyCaptcha(input.captchaToken, cfg.secretKey, ip) : false;
      if (!ok) return { ok: false, errors: { captcha: "No hemos podido comprobar que no eres un robot. Acepta las cookies, recarga la página e inténtalo de nuevo." } };
    }
  }

  const now = deps.now();
  const page = cleanPath(input.meta?.page) || `/${found.slug}`;
  const utm = cleanUtm(input.meta?.utm);
  const title = form.title || "Formulario de la web";
  const extra = [`Origen: ${page}`, ...Object.entries(utm).map(([k, v]) => `UTM ${k}: ${v}`)];
  if (result.consent) extra.push(`Consentimiento RGPD: aceptado el ${new Date(now).toISOString()} · texto v${result.consent.version}: «${result.consent.text}»`);
  const message = [result.lead.message, "", ...extra].join("\n").slice(0, 8000);
  const lead = { ...result.lead, message };
  const record = (leadId: number, duplicate: boolean): SubmissionRecord => ({
    leadId,
    slug: found.slug,
    blockId: input.blockId,
    formTitle: title.slice(0, 200),
    email: lead.email,
    consent: result.consent ? { ...result.consent, given: true, at: now } : null,
    ipHash: ipFingerprint(ip, deps.tenantId, deps.ipSecret),
    page,
    utm,
    duplicate,
    at: now,
  });

  const notify = (leadId: number, duplicate: boolean) => {
    if (form.notifyOwner === "on") void deps.notifyOwner({ leadId, duplicate, formTitle: title, page, name: lead.name, email: lead.email, phone: lead.phone, message }).catch(() => {});
  };

  const id = await deps.lock(`${found.slug}:${input.blockId}:${lead.email}`, async () => {
    const prev = await deps.findRecent(lead.email, found.slug, input.blockId, now - FORM_DEDUPE_WINDOW_MS);
    if (prev) {
      // Mismo correo y formulario hace un momento: no se crea otra oportunidad, se anota en la que ya existe
      await deps.addLeadNote(prev.leadId, `Nuevo envío del mismo formulario (${new Date(now).toISOString()}):\n${message}`);
      await deps.recordSubmission(record(prev.leadId, true));
      notify(prev.leadId, true);
      return prev.leadId;
    }
    const leadId = await deps.createLead(lead);
    await deps.recordSubmission(record(leadId, false));
    notify(leadId, false);
    return leadId;
  });
  return success(id);
}

