/**
 * Esquemas del catálogo comercial y de los contenidos de la web. Cada tipo de entrada valida su
 * borrador con zod (campos desconocidos = error) y tiene una proyección PÚBLICA que es lo único que
 * sale hacia la web: nunca notas internas, costes, márgenes ni datos de autoría.
 */
import { z } from "zod";

export const ENTRY_KINDS = ["product", "promotion", "faq", "menu", "seo", "page", "forms"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** Familia comercial (categoría de producto). */
export const FAMILIES = ["core_plan", "extension", "industry_module", "usage", "service"] as const;
export type Family = (typeof FAMILIES)[number];
/** Mecanismo técnico de activación (independiente de la familia y de la facturación). */
export const ACTIVATIONS = ["plan", "module", "feature", "usage", "service", "none"] as const;
/** Modalidad de facturación. */
export const BILLING_MODELS = ["subscription", "recurring_addon", "usage", "credits", "one_time"] as const;
export const TECHNICAL_STATUS = ["available", "partial", "planned"] as const;
export const PRICE_KINDS = ["monthly", "yearly", "one_time", "usage"] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];

/** Clave estable: minúsculas, números y guiones (también las usan las URL y los formularios). */
export const KEY_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const entryKey = z.string().regex(KEY_RE);
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => z.string().trim().max(max).nullable().default(null);
/** Enlace interno (/ruta) o https. Nada de javascript:, data: ni http en claro. */
const href = z.string().trim().max(300).regex(/^(\/[^\s]*|https:\/\/[^\s]+|mailto:[^\s@]+@[^\s]+)$/);

export const productDraft = z
  .object({
    name: text(120).min(1),
    tagline: text(200).default(""),
    description: text(2000).default(""),
    technicalStatus: z.enum(TECHNICAL_STATUS),
    activation: z.object({ kind: z.enum(ACTIVATIONS), ref: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).nullable().default(null) }).strict(),
    billingModel: z.enum(BILLING_MODELS),
    /** Periodicidad de referencia de la cuota (la de los precios manda). */
    billingNote: optText(300),
    limits: z.array(z.object({ label: text(80).min(1), value: text(80).min(1), metric: z.string().regex(/^[a-z][a-z0-9_.]{1,63}$/).nullable().default(null) }).strict()).max(20).default([]),
    /** Otros productos que deben estar contratados (claves). */
    dependencies: z.array(entryKey).max(20).default([]),
    /** Planes base con los que es compatible (claves de core_plan); vacío = todos. */
    compatibleWith: z.array(entryKey).max(20).default([]),
    /** Requisitos de configuración (cuentas de terceros, datos, dominio…). */
    requirements: z.array(text(200).min(1)).max(20).default([]),
    thirdPartyCosts: optText(500),
    includes: z.array(text(160).min(1)).max(30).default([]),
    presentation: z
      .object({
        icon: z.string().regex(/^[a-z-]{1,30}$/).default("puzzle"),
        color: z.string().regex(/^(#[0-9a-fA-F]{3,8}|var\(--[a-z0-9-]+\))$/).default("var(--ink)"),
        highlight: z.boolean().default(false),
        /** Texto «Hoy:» con el estado real. */
        today: optText(500),
        forWho: optText(300),
        note: optText(300),
        sectorSlug: entryKey.nullable().default(null),
        moduleSlug: entryKey.nullable().default(null),
      })
      .strict()
      .prefault({}),
    /** Solo para el equipo: nunca se publica. */
    internal: z.object({ notes: optText(2000), costCents: z.number().int().min(0).nullable().default(null), marginNote: optText(300) }).strict().prefault({}),
  })
  .strict();
export type ProductDraft = z.infer<typeof productDraft>;

export const promotionDraft = z
  .object({
    name: text(120).min(1),
    description: text(500).default(""),
    discount: z.object({ kind: z.enum(["percent", "amount"]), value: z.number().int().min(1).max(10_000_000) }).strict(),
    products: z.array(entryKey).min(1).max(30),
    startsAt: z.number().int().min(0).nullable().default(null),
    endsAt: z.number().int().min(0).nullable().default(null),
    conditions: optText(500),
    internal: z.object({ notes: optText(1000) }).strict().prefault({}),
  })
  .strict()
  .refine((p) => p.discount.kind !== "percent" || p.discount.value <= 100, { path: ["discount", "value"], message: "percent ≤ 100" })
  .refine((p) => !p.startsAt || !p.endsAt || p.startsAt < p.endsAt, { path: ["endsAt"], message: "endsAt > startsAt" });

export const faqDraft = z
  .object({ items: z.array(z.object({ q: text(300).min(3), a: text(2000).min(1), topic: z.enum(["producto", "prueba", "precios", "seguridad"]) }).strict()).max(80) })
  .strict();
const link = z.object({ label: text(60).min(1), href }).strict();
export const menuDraft = z
  .object({ items: z.array(link).max(12).default([]), groups: z.array(z.object({ title: text(60).min(1), links: z.array(link).max(12) }).strict()).max(6).default([]) })
  .strict();
export const seoDraft = z
  .object({
    routes: z
      .array(z.object({ path: z.string().regex(/^\/[a-z0-9/-]*$/), title: text(70).min(1), description: text(170).min(1), noindex: z.boolean().default(false) }).strict())
      .max(100),
  })
  .strict();
/** Páginas de texto: cuerpo en texto con «## » para títulos y «- » para listas (sin HTML). */
export const pageDraft = z.object({ title: text(120).min(1), lead: text(400).default(""), body: text(30000).default(""), draftNotice: z.boolean().default(false) }).strict();
const formType = z.object({ enabled: z.boolean(), intro: optText(400) }).strict();
export const formsDraft = z
  .object({
    types: z.object({ trial: formType, onboarding: formType, contact: formType }).strict(),
    privacyVersion: z.string().regex(/^[a-z0-9.-]{1,32}$/),
  })
  .strict();

export const DRAFT_SCHEMAS: Record<EntryKind, z.ZodTypeAny> = {
  product: productDraft,
  promotion: promotionDraft,
  faq: faqDraft,
  menu: menuDraft,
  seo: seoDraft,
  page: pageDraft,
  forms: formsDraft,
};

/** Proyección pública: quita todo lo interno. */
export function publicView(kind: EntryKind, draft: Record<string, unknown>): Record<string, unknown> {
  if (kind === "product" || kind === "promotion") {
    const { internal: _i, ...rest } = draft;
    return rest;
  }
  return draft;
}
