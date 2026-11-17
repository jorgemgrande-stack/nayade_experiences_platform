/**
 * Intercambio de papeles entre el contenido base de una página y su traducción al nuevo idioma principal (reglas puras,
 * sin BD ni red). Diseño: docs/elephant-source/DISENO_IDIOMA_PRINCIPAL.md.
 *
 * Antes: base = idioma anterior; traducción(destino) = contenido en el idioma nuevo.
 * Después: base = contenido del idioma nuevo; traducción(anterior) = lo que era el base. La traducción del destino
 * desaparece (ya es el base). Las demás traducciones no se tocan (su `base_hash` queda desfasado y el panel las marca
 * como pendientes de revisar: se tradujeron desde otro idioma).
 */
import { contentHash } from "./i18n";
import type { PageBlock } from "./pageBlocks";

export interface SwapBase {
  slug: string;
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  isPublished: boolean;
  isHome: boolean;
  /** Bloques publicados (o los de su HTML antiguo); null si no tiene */
  publishedBlocks: PageBlock[] | null;
  draftBlocks: PageBlock[] | null;
}

export interface SwapTranslation {
  slug: string;
  publishedSlug: string | null;
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  draftBlocks: PageBlock[] | null;
  publishedBlocks: PageBlock[] | null;
  publishedMeta: { title: string; metaTitle: string | null; metaDescription: string | null; ogImageUrl: string | null } | null;
  status: "draft" | "validated";
}

export interface SwapResult {
  /** Nuevo contenido base */
  base: { slug: string; title: string; metaTitle: string | null; metaDescription: string | null; publishedBlocks: PageBlock[] | null; draftBlocks: PageBlock[] | null };
  /** Nueva traducción al idioma que deja de ser principal */
  oldLocaleTranslation: {
    slug: string; publishedSlug: string | null; title: string; metaTitle: string | null; metaDescription: string | null;
    publishedMeta: SwapTranslation["publishedMeta"]; draftBlocks: PageBlock[] | null; publishedBlocks: PageBlock[] | null;
    status: "draft" | "validated"; baseHash: string | null;
  };
  slugChanged: boolean;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const nonEmpty = (b: PageBlock[] | null | undefined): b is PageBlock[] => Array.isArray(b) && b.length > 0;

export function swapPageRoles(base: SwapBase, tr: SwapTranslation): SwapResult {
  const trValidated = tr.status === "validated";
  const meta = trValidated && tr.publishedMeta ? tr.publishedMeta : { title: tr.title, metaTitle: tr.metaTitle, metaDescription: tr.metaDescription, ogImageUrl: null };
  // La portada conserva su dirección interna (es la que identifica la portada de la web)
  const newSlug = base.isHome ? base.slug : (trValidated ? tr.publishedSlug : null) ?? tr.slug;
  const newPublished = trValidated && nonEmpty(tr.publishedBlocks) ? tr.publishedBlocks : null;
  // Borrador pendiente solo si difiere de lo publicado
  const trDraft = nonEmpty(tr.draftBlocks) ? tr.draftBlocks : null;
  const newDraft = trDraft && !sameJson(trDraft, newPublished) ? trDraft : null;
  const newBase: SwapResult["base"] = { slug: newSlug, title: meta.title || tr.title, metaTitle: meta.metaTitle, metaDescription: meta.metaDescription, publishedBlocks: newPublished, draftBlocks: newDraft };

  const wasPublished = base.isPublished && nonEmpty(base.publishedBlocks);
  const effective = newBase.draftBlocks ?? newBase.publishedBlocks;
  return {
    base: newBase,
    oldLocaleTranslation: {
      slug: base.slug,
      publishedSlug: wasPublished ? base.slug : null,
      title: base.title,
      metaTitle: base.metaTitle,
      metaDescription: base.metaDescription,
      publishedMeta: wasPublished ? { title: base.title, metaTitle: base.metaTitle, metaDescription: base.metaDescription, ogImageUrl: null } : null,
      draftBlocks: base.draftBlocks ?? base.publishedBlocks,
      publishedBlocks: wasPublished ? base.publishedBlocks : null,
      status: wasPublished ? "validated" : "draft",
      baseHash: effective ? contentHash(effective) : null,
    },
    slugChanged: !base.isHome && newSlug !== base.slug,
  };
}

/** Dirección de un menú tras el intercambio: la de su traducción, o la de la página si apuntaba a una que cambió de dirección. */
export function swapMenuUrl(currentUrl: string | null, translatedUrl: string | null | undefined, slugMap: ReadonlyMap<string, string>): string | null {
  if (translatedUrl && translatedUrl.trim()) return translatedUrl.trim();
  const m = /^\/([^/?#]+)([?#].*)?$/.exec(currentUrl ?? "");
  if (m && slugMap.has(m[1])) return `/${slugMap.get(m[1])}${m[2] ?? ""}`;
  return currentUrl;
}
