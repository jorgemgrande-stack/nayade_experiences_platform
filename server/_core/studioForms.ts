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
import type { BlockDataMap, FormFieldItem } from "../../shared/pageBlocks";

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
  | { kind: "ok"; lead: { name: string; email: string; phone?: string; message: string } }
  | { kind: "spam" }
  | { kind: "invalid"; errors: Record<string, string> };

/** Clave de cada campo en el envío: su posición («f0», «f1»…). */
export const fieldKey = (i: number) => `f${i}`;

/** Opciones de un campo (una por línea, sin vacías ni repetidas). */
export function fieldOptions(f: Pick<FormFieldItem, "options">): string[] {
  return Array.from(new Set(f.options.split(/\r?\n/).map((o) => o.trim()).filter(Boolean))).slice(0, 50);
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "");

/**
 * Comprueba un envío contra el formulario publicado. Devuelve la oportunidad que se creará, los errores por campo
 * (texto para la persona) o «spam».
 */
export function evaluateFormSubmission(form: BlockDataMap["form"], input: FormSubmission, ctx: { slug: string }): FormEvaluation {
  if ((input.website ?? "").trim() !== "") return { kind: "spam" };
  if (typeof input.elapsedMs === "number" && input.elapsedMs < FORM_MIN_FILL_MS) return { kind: "spam" };
  const errors: Record<string, string> = {};
  const answers: Array<[string, string]> = [];
  let name = "";
  let email = "";
  let phone = "";
  form.fields.forEach((f, i) => {
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
    if (f.role === "name" && value) name = value;
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
  const message = [`Formulario: ${form.title || "Formulario de la web"}`, `Página: /${ctx.slug}`, "", ...answers.map(([l, v]) => `${l}: ${v}`)].join("\n").slice(0, 8000);
  return { kind: "ok", lead: { name: name || email.split("@")[0], email, ...(phone ? { phone } : {}), message } };
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
