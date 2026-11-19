/**
 * Elephant Studio — envíos de los formularios a medida de la web de cada empresa.
 *
 * Reglas:
 *  - Se valida contra la configuración PUBLICADA del formulario (nunca contra lo que diga el navegador): los
 *    campos, sus tipos, las opciones permitidas y los obligatorios. Lo que no es un campo del formulario se ignora.
 *  - Cada envío válido entra en el CRM de la empresa como oportunidad (con su cliente), igual que el formulario de
 *    contacto de siempre: no hay una segunda base de contactos. El mensaje lleva todas las respuestas.
 *  - Antispam sin servicios externos: campo trampa invisible, tiempo mínimo de relleno y límite de envíos por
 *    visitante. A un envío automático se le responde como si hubiera ido bien (no se le da pista), sin guardarlo.
 *  - Sin adjuntos de archivos (aún no disponibles) ni nada ejecutable: solo texto, con límites de tamaño.
 */
import { safeLink } from "./pageBlocks";
import { createHash } from "node:crypto";
import { DEFAULT_FORM_CONSENT_TEXT, formFieldVisibility, type BlockDataMap, type FormFieldItem } from "../../shared/pageBlocks";

export class FormSubmitError extends Error {}

export const FORM_MIN_FILL_MS = 2500;
export const FORM_RATE = { max: 5, windowMs: 10 * 60 * 1000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+0-9 ().-]{6,25}$/;

export type FormValues = Record<string, string | string[] | boolean | undefined>;

export interface FormSubmission {
  values: FormValues;
  consent?: boolean;
  /** Campo trampa: las personas no lo ven; si llega relleno, es un envío automático */
  website?: string;
  /** Milisegundos desde que se mostró el formulario hasta el envío */
  elapsedMs?: number;
}

export type FormEvaluation =
  | { kind: "ok"; lead: { name: string; email: string; phone?: string; company?: string; message: string }; consent: FormConsent | null }
  | { kind: "spam" }
  | { kind: "invalid"; errors: Record<string, string> };

/** Consentimiento RGPD tal como lo vio la persona: el texto de la casilla de ese formulario y su versión (huella del texto). */
export interface FormConsent {
  text: string;
  version: string;
}

/** Texto de la casilla de privacidad de un formulario y su versión (cambia si la empresa cambia el texto). */
export function formConsentText(form: Pick<BlockDataMap["form"], "consentText">): FormConsent {
  const t = (form.consentText ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 300) || DEFAULT_FORM_CONSENT_TEXT;
  return { text: t, version: createHash("sha256").update(t).digest("hex").slice(0, 12) };
}

/** Texto de un nombre o empresa: sin etiquetas (se guarda y se enseña como texto, nunca como HTML). */
const plain = (v: string) => v.replace(/<[^>]*>/g, "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

/** Clave de cada campo en el envío: su posición («f0», «f1»…). */
export const fieldKey = (i: number) => `f${i}`;

/** Opciones de un campo (una por línea, sin vacías ni repetidas). */
export function fieldOptions(f: Pick<FormFieldItem, "options">): string[] {
  return Array.from(new Set(f.options.split(/\r?\n/).map((o) => o.trim()).filter(Boolean))).slice(0, 50);
}

/**
 * Formulario en otro idioma: el servidor valida SIEMPRE contra el formulario del idioma principal, pero la persona elige entre
 * las opciones traducidas que ve. Cada opción elegida se lleva a la del principal que ocupa su misma posición (así la
 * oportunidad del CRM queda en un solo idioma y las condiciones «solo si…» siguen funcionando). Una opción que ya es del
 * principal se deja como está; una que no está en ninguna lista sigue siendo un error de validación.
 */
export function valuesInPrincipalLanguage(
  form: Pick<BlockDataMap["form"], "fields">,
  localized: Pick<BlockDataMap["form"], "fields"> | null | undefined,
  values: Record<string, unknown>,
): Record<string, unknown> {
  if (!localized) return values;
  const out: Record<string, unknown> = { ...values };
  form.fields.forEach((f, i) => {
    if (f.kind !== "select" && f.kind !== "radio" && f.kind !== "multi") return;
    const l = localized.fields[i];
    if (!l || l.kind !== f.kind) return;
    const own = fieldOptions(f);
    const theirs = fieldOptions(l);
    const map = (v: unknown): unknown => {
      if (typeof v !== "string" || own.includes(v)) return v;
      const at = theirs.indexOf(v);
      return at >= 0 && own[at] !== undefined ? own[at] : v;
    };
    const key = fieldKey(i);
    const raw = out[key];
    if (Array.isArray(raw)) out[key] = raw.map(map);
    else if (raw !== undefined) out[key] = map(raw);
  });
  return out;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "");

/**
 * Comprueba un envío contra el formulario publicado. Devuelve la oportunidad que se creará, los errores por campo
 * (texto para la persona) o «spam».
 */
export function evaluateFormSubmission(form: BlockDataMap["form"], rawInput: FormSubmission, ctx: { slug: string; localized?: BlockDataMap["form"] | null }): FormEvaluation {
  const input: FormSubmission = ctx.localized ? { ...rawInput, values: valuesInPrincipalLanguage(form, ctx.localized, rawInput.values) as FormSubmission["values"] } : rawInput;
  if ((input.website ?? "").trim() !== "") return { kind: "spam" };
  if (typeof input.elapsedMs === "number" && input.elapsedMs < FORM_MIN_FILL_MS) return { kind: "spam" };
  const errors: Record<string, string> = {};
  const answers: Array<[string, string]> = [];
  let name = "";
  let firstName = "";
  let lastName = "";
  let company = "";
  let email = "";
  let phone = "";
  // Un campo que no se muestra por su condición no se valida ni se guarda (aunque el navegador lo mande)
  const visible = formFieldVisibility(form.fields, input.values);
  form.fields.forEach((f, i) => {
    if (!visible[i]) return;
    const key = fieldKey(i);
    const raw = input.values[key];
    const label = f.label.trim() || `Campo ${i + 1}`;
    let value = "";
    switch (f.kind) {
      case "hidden":
        value = text(f.value, 200);
        break;
      case "checkbox":
        value = raw === true || raw === "on" || raw === "true" ? "Sí" : "";
        if (f.required === "on" && !value) errors[key] = "Marca esta casilla para continuar.";
        if (!value) value = "No";
        break;
      case "multi": {
        const opts = fieldOptions(f);
        const picked = (Array.isArray(raw) ? raw : []).map((v) => text(v, 200)).filter((v) => opts.includes(v));
        value = Array.from(new Set(picked)).join(", ");
        if (Array.isArray(raw) && raw.length !== picked.length) errors[key] = "Elige solo entre las opciones de la lista.";
        break;
      }
      case "select":
      case "radio": {
        value = text(raw, 200);
        if (value && !fieldOptions(f).includes(value)) errors[key] = "Elige una de las opciones de la lista.";
        break;
      }
      case "email":
        value = text(raw, 200).toLowerCase();
        if (value && !EMAIL_RE.test(value)) errors[key] = "Escribe un correo electrónico válido.";
        break;
      case "phone":
        value = text(raw, 40);
        if (value && !PHONE_RE.test(value)) errors[key] = "Escribe un teléfono válido.";
        break;
      case "number":
        value = text(raw, 30);
        if (value && !/^-?\d+([.,]\d+)?$/.test(value)) errors[key] = "Escribe un número.";
        break;
      case "date":
        value = text(raw, 10);
        if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))) errors[key] = "Escribe una fecha válida.";
        break;
      case "time":
        value = text(raw, 5);
        if (value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) errors[key] = "Escribe una hora válida.";
        break;
      case "textarea":
        value = text(raw, 4000);
        break;
      default:
        value = text(raw, 300);
    }
    if (f.required === "on" && f.kind !== "checkbox" && f.kind !== "hidden" && !value && !errors[key]) errors[key] = "Este campo es obligatorio.";
    if (errors[key]) return;
    if (f.role === "name" && value) name = plain(value);
    if (f.role === "first_name" && value) firstName = plain(value);
    if (f.role === "last_name" && value) lastName = plain(value);
    if (f.role === "company" && value) company = plain(value);
    if (f.role === "email" && value) email = value;
    if (f.role === "phone" && value) phone = value;
    if (value) answers.push([label, value]);
  });
  if (form.consent === "on" && !input.consent) errors.consent = "Para enviarlo, acepta la política de privacidad.";
  if (Object.keys(errors).length) return { kind: "invalid", errors };
  if (!email) {
    // Sin correo no se puede responder a la persona: el formulario está mal configurado o el correo es opcional y vino vacío
    const hasEmailField = form.fields.some((f) => f.role === "email");
    if (!hasEmailField) throw new FormSubmitError("Este formulario no tiene un campo de correo electrónico. Avisa a la empresa.");
    const i = form.fields.findIndex((f) => f.role === "email");
    return { kind: "invalid", errors: { [fieldKey(i)]: "Escribe tu correo electrónico para que podamos responderte." } };
  }
  // Nombre y apellidos por separado (opcional): se unen para el CRM; si hay un campo de nombre completo, manda ese
  if (!name) name = [firstName, lastName].filter(Boolean).join(" ");
  // Consentimiento: el texto que la persona vio y aceptó (el del formulario traducido, si lo hay), no el del idioma principal
  const consent = form.consent === "on" ? formConsentText(ctx.localized?.consentText?.trim() ? ctx.localized : form) : null;
  const message = [`Formulario: ${form.title || "Formulario de la web"}`, `Página: /${ctx.slug}`, "", ...answers.map(([l, v]) => `${l}: ${v}`)].join("\n").slice(0, 8000);
  return { kind: "ok", lead: { name: name || email.split("@")[0], email, ...(phone ? { phone } : {}), ...(company ? { company } : {}), message }, consent };
}

/** Destino tras enviar: solo una página de la propia web (nunca otra web). */
export function formRedirect(url: string): string {
  const s = safeLink(url);
  return /^\/(?!\/)/.test(s) ? s : "";
}

// ─── Límite de envíos por visitante (memoria del proceso, por empresa y página) ───

const hits = new Map<string, number[]>();

export function allowFormSubmit(key: string, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < FORM_RATE.windowMs);
  if (recent.length >= FORM_RATE.max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value as string);
  return true;
}
