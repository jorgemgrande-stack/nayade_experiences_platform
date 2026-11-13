/**
 * Multidioma (épica E-1): resolución de una página del constructor para un idioma, para la API pública
 * (`public.getTenantPage`). La web servida con SEO usa `resolveRequest` directamente (server/_core/vite.ts).
 */
import { HOME_SLUG } from "../shared/pageBlocks";
import { resolveRequest, type ResolvedPage } from "./i18nService";
import { sqlI18nRepo } from "./i18nSqlRepo";

export type TenantPageLocale =
  | { kind: "notFound" }
  | { kind: "redirect"; to: string }
  | { kind: "principal"; principalSlug: string }
  | { kind: "translated"; locale: string; htmlLang: string; principalSlug: string; page: ResolvedPage }
  /** Se muestra el principal en la URL de otro idioma (configuración `fallback = default`), declarado como tal. */
  | { kind: "fallback"; locale: string; htmlLang: string; principalSlug: string };

/** `slug` es el de la URL en ese idioma (`inicio` = portada). Los candados de validación los aplica `resolveRequest`. */
export async function resolveTenantPageLocale(slug: string, locale: string): Promise<TenantPageLocale> {
  const path = slug === HOME_SLUG ? `/${locale}` : `/${locale}/${slug}`;
  const r = await resolveRequest(sqlI18nRepo(), path, "");
  if (r.kind === "redirect") return { kind: "redirect", to: r.to };
  if (r.kind !== "page" || !r.prefixed) return { kind: "notFound" };
  if (r.decision.kind === "translated" && r.page) return { kind: "translated", locale: r.locale, htmlLang: r.seo.htmlLang, principalSlug: r.principalSlug, page: r.page };
  if (r.decision.kind === "fallback") return { kind: "fallback", locale: r.decision.requested, htmlLang: r.seo.htmlLang, principalSlug: r.principalSlug };
  if (r.decision.kind === "principal") return { kind: "principal", principalSlug: r.principalSlug };
  return { kind: "notFound" };
}

/**
 * Contrato estable para la importación (E-3, `TranslationGateway`): guarda el BORRADOR de la traducción de una página
 * en la base de datos de la empresa en curso. Nunca valida ni publica. El idioma debe estar dado de alta (si no,
 * `I18nError`); `locale` en minúsculas y `pageId` = `static_pages.id` del principal.
 */
export async function savePageTranslationDraftForTenant(pageId: number, locale: string, input: import("./i18nService").PageTranslationInput) {
  const { savePageTranslationDraft } = await import("./i18nService");
  return savePageTranslationDraft(sqlI18nRepo(), pageId, locale, input);
}
