/**
 * Editor de traducciones de contenido (E-1, `content_translations`): campos traducibles por tipo de contenido, estado
 * de cada idioma y el borrador del formulario. Lógica pura, la usa el panel («Idiomas» de un producto).
 *
 * Pensado para crecer por tipo: para traducir otro contenido (p. ej. los nombres de las modalidades) basta con añadir su
 * lista de campos a `TRANSLATION_FIELD_SETS` y que el servidor lo admita en `CONTENT_FIELDS` (server/i18nService.ts).
 * Las longitudes máximas deben coincidir con las del servidor (lo comprueba server/productTranslations.test.ts).
 */
import { normalizeLocalizedSlug, type TranslationStatus } from "./i18n";

export interface TranslationFieldDef {
  key: string;
  label: string;
  max: number;
  /** Texto largo (área de texto) */
  long?: boolean;
  /** Campo para buscadores (se agrupa aparte) */
  seo?: boolean;
}

export const TRANSLATION_FIELD_SETS = {
  product: [
    { key: "title", label: "Nombre", max: 256 },
    { key: "shortDescription", label: "Descripción corta", max: 2000, long: true },
    { key: "description", label: "Descripción", max: 20000, long: true },
    { key: "metaTitle", label: "Título para buscadores", max: 256, seo: true },
    { key: "metaDescription", label: "Descripción para buscadores", max: 1000, long: true, seo: true },
    { key: "duration", label: "Duración", max: 128 },
    { key: "requirements", label: "Requisitos", max: 4000, long: true },
    { key: "includes", label: "Incluye (una línea por elemento)", max: 4000, long: true },
    { key: "excludes", label: "No incluye (una línea por elemento)", max: 4000, long: true },
    { key: "requestCtaLabel", label: "Texto del botón de solicitud", max: 80 },
  ],
  variant: [
    { key: "name", label: "Nombre de la opción", max: 128 },
    { key: "description", label: "Descripción de la opción", max: 2000, long: true },
  ],
  edition: [
    { key: "label", label: "Nombre de la convocatoria", max: 160 },
    { key: "scheduleNote", label: "Horario", max: 600, long: true },
    { key: "locationNote", label: "Lugar", max: 300 },
  ],
} as const satisfies Record<string, readonly TranslationFieldDef[]>;

export type TranslatableEntity = keyof typeof TRANSLATION_FIELD_SETS;

/** Tipos con dirección propia por idioma (el servidor solo la admite en productos). */
export const ENTITY_HAS_SLUG: Record<TranslatableEntity, boolean> = { product: true, variant: false, edition: false };

export type TranslationState = "untranslated" | "draft" | "validated";
export const TRANSLATION_STATE_LABELS: Record<TranslationState, string> = {
  untranslated: "Sin traducir",
  draft: "Borrador",
  validated: "Validada",
};

/** Lo que guarda el servidor de una traducción (forma de `ContentTranslationRow`). */
export interface StoredTranslation {
  fields: Record<string, string>;
  slug: string | null;
  status: TranslationStatus;
  validatedAt?: Date | string | null;
  validatedBy?: string | null;
}

export interface TranslationDraft {
  fields: Record<string, string>;
  slug: string;
}

export function translationState(row: StoredTranslation | null | undefined): TranslationState {
  if (!row || !Object.values(row.fields ?? {}).some((v) => (v ?? "").trim() !== "")) return "untranslated";
  return row.status === "validated" ? "validated" : "draft";
}

export function draftFromRow(defs: readonly TranslationFieldDef[], row: StoredTranslation | null | undefined): TranslationDraft {
  const fields: Record<string, string> = {};
  for (const d of defs) fields[d.key] = row?.fields?.[d.key] ?? "";
  return { fields, slug: row?.slug ?? "" };
}

/** Cuerpo de `cms.saveContentTranslation`: textos recortados y sin los vacíos; dirección vacía → null. */
export function draftPayload(defs: readonly TranslationFieldDef[], draft: TranslationDraft, withSlug: boolean): { fields: Record<string, string>; slug: string | null } {
  const fields: Record<string, string> = {};
  for (const d of defs) {
    const v = (draft.fields[d.key] ?? "").trim();
    if (v) fields[d.key] = v;
  }
  const slug = withSlug ? draft.slug.trim().toLowerCase() : "";
  return { fields, slug: slug || null };
}

/** ¿El formulario difiere de lo guardado? (se compara lo que se enviaría, no los espacios) */
export function isDraftDirty(defs: readonly TranslationFieldDef[], draft: TranslationDraft, row: StoredTranslation | null | undefined, withSlug: boolean): boolean {
  const now = draftPayload(defs, draft, withSlug);
  const saved = draftPayload(defs, draftFromRow(defs, row), withSlug);
  return JSON.stringify(now) !== JSON.stringify(saved);
}

/** Campos con texto en el idioma principal que en la traducción siguen vacíos o iguales al original. */
export function pendingFieldKeys(defs: readonly TranslationFieldDef[], principal: Record<string, string | null | undefined>, draft: TranslationDraft): string[] {
  return defs
    .filter((d) => {
      const orig = (principal[d.key] ?? "").trim();
      if (!orig) return false;
      const t = (draft.fields[d.key] ?? "").trim();
      return !t || t === orig;
    })
    .map((d) => d.key);
}

/** Errores del formulario antes de enviarlo (el servidor vuelve a validarlo todo). */
export function draftErrors(defs: readonly TranslationFieldDef[], draft: TranslationDraft, withSlug: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const d of defs) {
    const v = (draft.fields[d.key] ?? "").trim();
    if (v.length > d.max) errors[d.key] = `Admite hasta ${d.max} caracteres.`;
  }
  const first = defs[0];
  if (first && !(draft.fields[first.key] ?? "").trim()) errors[first.key] = `Escribe el ${first.label.toLowerCase()} traducido.`;
  const slug = draft.slug.trim();
  if (withSlug && slug && !normalizeLocalizedSlug(slug)) errors.slug = "Solo minúsculas sin acentos, números y guiones (máximo 64).";
  return errors;
}

/** Se puede validar (publicar) lo guardado si hay textos y no quedan cambios sin guardar. */
export function canValidate(row: StoredTranslation | null | undefined, dirty: boolean): boolean {
  return translationState(row) === "draft" && !dirty;
}
