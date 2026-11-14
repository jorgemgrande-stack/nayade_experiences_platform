/**
 * Formato de importación de contenidos y medios de Elephant Studio (versionado, `schemaVersion`).
 *
 * Un documento describe, para UN tenant cualquiera: los medios que hay que traer (por URL), las páginas (en BORRADOR
 * por defecto, con los tipos de bloque existentes de `shared/pageBlocks.ts`) y, opcionalmente, su sitio en el menú.
 * Las páginas referencian los medios por su id local con la cadena completa `media:<id>` en cualquier campo de texto
 * de un bloque (url, imageUrl, images[].url…). Aquí solo hay validación pura: sin red, sin base de datos.
 *
 * `locale` (BCP 47 simplificado: `es`, `de`, `pt-BR`) es OPCIONAL en la página y en cada bloque. Está preparado para
 * el multidioma nativo (E-1): hoy se valida y se conserva en el registro de importación, pero no cambia dónde ni cómo
 * se guarda la página. Ver docs/studio/importacion.md.
 */
import { z } from "zod";
import { BLOCK_TYPES, pageSlugProblem } from "./pageBlocks";

export const IMPORT_SCHEMA_VERSION = 1;
/** Prefijo de una referencia a un medio del propio documento. */
export const MEDIA_REF_PREFIX = "media:";

/** Código BCP 47 en minúsculas (formato de E-1, docs/architecture/studio-multidioma.md): es, de, pt-br. */
export const LOCALE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;
/** Idioma principal cuando el documento no declara `site.defaultLocale` (el implícito de una empresa sin idiomas, según E-1). */
export const FALLBACK_DEFAULT_LOCALE = "es";
const LOCAL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export const IMPORT_LIMITS = { media: 500, pages: 200, blocksPerPage: 60, menuItems: 30, text: 2000 } as const;

const text = (max: number = IMPORT_LIMITS.text) => z.string().max(max);
const locale = z.string().regex(LOCALE_RE, "Idioma no válido (minúsculas, por ejemplo: es, de, pt-br)");

const mediaSchema = z
  .object({
    id: z.string().regex(LOCAL_ID_RE, "Id local no válido (letras, números, guion y guion bajo; máx. 64)"),
    sourceUrl: z.string().max(2048).url(),
    originalFilename: text(256).optional(),
    alt: text(300).optional(),
    license: text(200).optional(),
    credit: text(300).optional(),
    sourceNote: text(500).optional(),
  })
  .strict();

const blockSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/i).optional(),
    type: z.enum(BLOCK_TYPES),
    data: z.record(z.string(), z.unknown()),
    style: z.record(z.string(), z.unknown()).optional(),
    locale: locale.optional(),
  })
  .strict();

const pageSchema = z
  .object({
    slug: z.string().min(1).max(60),
    title: z.string().min(1).max(200),
    locale: locale.optional(),
    /** Solo con `locale` distinto del principal: slug de la página del principal de la que esta es traducción (acuerdo con E-1, §11). */
    translationOf: z.string().min(1).max(60).optional(),
    /** Estado al que apunta el documento. `published` solo se aplica además con el flag explícito de publicar. */
    status: z.enum(["draft", "published"]).default("draft"),
    seo: z.object({ title: text(256).optional(), description: text(500).optional() }).strict().optional(),
    blocks: z.array(blockSchema).max(IMPORT_LIMITS.blocksPerPage),
  })
  .strict();

const menuItemSchema = z.object({ pageSlug: z.string().min(1).max(60) }).strict();

export const importDocumentSchema = z
  .object({
    schemaVersion: z.literal(IMPORT_SCHEMA_VERSION),
    site: z.object({ defaultLocale: locale.optional() }).strict().optional(),
    media: z.array(mediaSchema).max(IMPORT_LIMITS.media).default([]),
    pages: z.array(pageSchema).max(IMPORT_LIMITS.pages).default([]),
    menu: z
      .object({
        header: z.array(menuItemSchema).max(IMPORT_LIMITS.menuItems).optional(),
        footer: z.array(menuItemSchema).max(IMPORT_LIMITS.menuItems).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ImportDocument = z.infer<typeof importDocumentSchema>;
export type ImportMedia = ImportDocument["media"][number];
export type ImportPage = ImportDocument["pages"][number];
export type ImportBlock = ImportPage["blocks"][number];

export interface ImportValidation {
  ok: boolean;
  doc?: ImportDocument;
  /** Problemas con su ruta (`pages[2].blocks[0].data.url: …`), en español. */
  errors: string[];
}

/** Idioma principal del documento. */
export function principalLocale(doc: Pick<ImportDocument, "site">): string {
  return doc.site?.defaultLocale ?? FALLBACK_DEFAULT_LOCALE;
}

/** ¿La página está en un idioma distinto del principal (y por tanto es una traducción)? */
export function isTranslation(doc: Pick<ImportDocument, "site">, p: Pick<ImportPage, "locale">): boolean {
  return !!p.locale && p.locale !== principalLocale(doc);
}

/** Referencias `media:<id>` que contiene un valor (recorre objetos y listas). */
export function collectMediaRefs(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    if (value.startsWith(MEDIA_REF_PREFIX)) out.add(value.slice(MEDIA_REF_PREFIX.length));
  } else if (Array.isArray(value)) value.forEach((v) => collectMediaRefs(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectMediaRefs(v, out));
  return out;
}

/** Valida un documento: forma (zod) y coherencia entre sus partes (ids únicos, referencias, direcciones, menú). */
export function validateImportDocument(raw: unknown): ImportValidation {
  const parsed = importDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`) };
  }
  const doc = parsed.data;
  const errors: string[] = [];
  const mediaIds = new Set<string>();
  doc.media.forEach((m, i) => {
    if (mediaIds.has(m.id)) errors.push(`media[${i}].id: el id «${m.id}» está repetido`);
    mediaIds.add(m.id);
    let u: URL | null = null;
    try {
      u = new URL(m.sourceUrl);
    } catch {
      /* ya lo ha dicho zod */
    }
    if (u && u.protocol !== "https:") errors.push(`media[${i}].sourceUrl: solo se admite https`);
    if (u && (u.username || u.password)) errors.push(`media[${i}].sourceUrl: no puede llevar credenciales`);
  });
  const slugs = new Set<string>();
  doc.pages.forEach((p, i) => {
    const problem = pageSlugProblem(p.slug);
    if (problem) errors.push(`pages[${i}].slug: ${problem}`);
    if (slugs.has(p.slug)) errors.push(`pages[${i}].slug: la dirección «${p.slug}» está repetida`);
    slugs.add(p.slug);
    if (p.translationOf && !p.locale) errors.push(`pages[${i}].translationOf: requiere indicar locale`);
    if (isTranslation(doc, p) && !p.translationOf) errors.push(`pages[${i}].translationOf: una página en otro idioma debe indicar la página del idioma principal de la que es traducción`);
    if (!isTranslation(doc, p) && p.translationOf) errors.push(`pages[${i}].translationOf: solo se usa en páginas con un idioma distinto del principal`);
    p.blocks.forEach((b, j) => {
      for (const ref of Array.from(collectMediaRefs(b.data))) {
        if (!mediaIds.has(ref)) errors.push(`pages[${i}].blocks[${j}]: referencia a un medio que no existe («media:${ref}»)`);
      }
      for (const ref of Array.from(collectMediaRefs(b.style ?? {}))) {
        if (!mediaIds.has(ref)) errors.push(`pages[${i}].blocks[${j}].style: referencia a un medio que no existe («media:${ref}»)`);
      }
    });
  });
  doc.pages.forEach((p, i) => {
    if (p.translationOf && slugs.has(p.translationOf)) {
      const target = doc.pages.find((x) => x.slug === p.translationOf)!;
      if (isTranslation(doc, target)) errors.push(`pages[${i}].translationOf: «${p.translationOf}» es a su vez una traducción`);
    }
  });
  for (const zone of ["header", "footer"] as const) {
    doc.menu?.[zone]?.forEach((it, i) => {
      const target = doc.pages.find((x) => x.slug === it.pageSlug);
      if (!target) errors.push(`menu.${zone}[${i}].pageSlug: «${it.pageSlug}» no es una página de este documento`);
      else if (isTranslation(doc, target)) errors.push(`menu.${zone}[${i}].pageSlug: «${it.pageSlug}» es una traducción; el menú del principal solo enlaza páginas del idioma principal`);
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true, doc, errors: [] };
}

/** JSON Schema (draft 2020-12) del formato, para editores y validadores externos. */
export function importJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(importDocumentSchema, { io: "input" }) as Record<string, unknown>;
}
