/**
 * Cambio de idioma principal de una empresa: PLAN de solo lectura (sin BD ni red).
 *
 * Cambiar el principal no es cambiar una etiqueta: el contenido base (páginas, bloques, menús) está escrito en el idioma
 * principal actual y la traducción del idioma nuevo debe pasar a ser el contenido base, y el principal anterior pasar a ser
 * una traducción. Este plan dice si se puede hacer ahora, qué se intercambiaría y qué lo impide. No cambia nada.
 *
 * Diseño: docs/elephant-source/DISENO_IDIOMA_PRINCIPAL.md.
 */
import { isReservedSlug, normalizeLocale } from "./i18n";

export type PlanSeverity = "blocker" | "warning";
export interface PlanIssue { severity: PlanSeverity; code: string; message: string; ref?: string }

export interface PlanLocale { locale: string; isDefault: boolean; status: "draft" | "validated" }
export interface PlanPage { id: number; slug: string; title: string; isPublished: boolean; isHome: boolean }
export interface PlanPageTranslation { pageId: number; locale: string; slug: string; publishedSlug: string | null; status: "draft" | "validated"; hasPublishedBlocks: boolean; hasDraftBlocks: boolean }
export interface PlanMenuItem { id: number; label: string; url: string; isVisible: boolean }
export interface PlanContentTranslation { entityType: string; entityKey: string; locale: string; status: "draft" | "validated" }

export interface DefaultLocalePlanInput {
  target: unknown;
  locales: readonly PlanLocale[];
  pages: readonly PlanPage[];
  /** Traducciones de páginas (todos los idiomas): solo se usan las del idioma destino y las del principal actual */
  pageTranslations: readonly PlanPageTranslation[];
  menuItems: readonly PlanMenuItem[];
  contentTranslations: readonly PlanContentTranslation[];
  /** Cuántas entidades de cada tipo existen (para avisar de contenido sin traducción en el destino) */
  contentCounts?: Readonly<Record<string, number>>;
}

export interface DefaultLocalePlan {
  current: string | null;
  target: string | null;
  canApply: boolean;
  issues: PlanIssue[];
  pages: { id: number; slug: string; targetSlug: string | null; swappable: boolean }[];
  slugChanges: { from: string; to: string }[];
  counts: { pages: number; swappable: number; blocked: number; menuItems: number; menuTranslated: number };
}

const PLANNED_CONTENT_TYPES = ["menu_item", "product", "form", "setting"] as const;

export function planDefaultLocaleChange(input: DefaultLocalePlanInput): DefaultLocalePlan {
  const issues: PlanIssue[] = [];
  const target = normalizeLocale(input.target);
  const current = input.locales.find((l) => l.isDefault)?.locale ?? null;
  const empty = (): DefaultLocalePlan => ({ current, target, canApply: false, issues, pages: [], slugChanges: [], counts: { pages: 0, swappable: 0, blocked: 0, menuItems: 0, menuTranslated: 0 } });
  const blocker = (code: string, message: string, ref?: string) => issues.push({ severity: "blocker", code, message, ref });
  const warning = (code: string, message: string, ref?: string) => issues.push({ severity: "warning", code, message, ref });

  if (!target) { blocker("target_invalid", "El idioma indicado no es válido."); return empty(); }
  if (!current) { blocker("no_multilingual", "La empresa aún no tiene idiomas adicionales: elige el idioma principal al darlos de alta."); return empty(); }
  if (target === current) { blocker("already_default", `«${target}» ya es el idioma principal.`); return empty(); }
  const targetLocale = input.locales.find((l) => l.locale === target);
  if (!targetLocale) { blocker("target_missing", `El idioma «${target}» no está dado de alta.`); return empty(); }
  if (targetLocale.status !== "validated") blocker("target_not_validated", `El idioma «${target}» está en borrador: una persona debe validarlo antes de convertirlo en principal.`);

  const byPageTarget = new Map(input.pageTranslations.filter((t) => t.locale === target).map((t) => [t.pageId, t]));
  const baseSlugs = new Set(input.pages.map((p) => p.slug));
  const pagesPlan: DefaultLocalePlan["pages"] = [];
  const slugChanges: DefaultLocalePlan["slugChanges"] = [];
  const claimed = new Map<string, number>();

  for (const p of input.pages) {
    const t = byPageTarget.get(p.id);
    const ref = p.slug;
    // Las páginas sin publicar no bloquean: se intercambian si tienen traducción, y si no, se avisa
    const needs = p.isPublished;
    let swappable = true;
    if (!t) {
      swappable = false;
      if (needs) blocker("page_no_translation", `La página «${p.title}» (${p.slug}) está publicada y no tiene traducción al «${target}».`, ref);
      else warning("page_draft_no_translation", `La página sin publicar «${p.title}» (${p.slug}) no tiene traducción al «${target}»: pasaría a ser contenido en «${target}» sin estarlo.`, ref);
    } else {
      if (needs && t.status !== "validated") { swappable = false; blocker("page_translation_not_validated", `La traducción al «${target}» de «${p.title}» (${p.slug}) está en borrador: debe validarla una persona.`, ref); }
      if (needs && t.status === "validated" && !t.hasPublishedBlocks) { swappable = false; blocker("page_translation_empty", `La traducción validada de «${p.title}» (${p.slug}) no tiene contenido publicado.`, ref); }
      const newSlug = (t.status === "validated" ? t.publishedSlug : null) ?? t.slug;
      if (isReservedSlug(newSlug) && !p.isHome) { swappable = false; blocker("slug_reserved", `La dirección «${newSlug}» de «${p.title}» está reservada.`, ref); }
      const owner = claimed.get(newSlug);
      if (owner !== undefined && owner !== p.id) { swappable = false; blocker("slug_duplicate", `Dos páginas tomarían la dirección «${newSlug}».`, ref); }
      claimed.set(newSlug, p.id);
      // Una dirección nueva que coincide con la actual de OTRA página que no se mueve
      if (newSlug !== p.slug && baseSlugs.has(newSlug)) {
        const other = input.pages.find((x) => x.slug === newSlug);
        const otherMoves = other ? byPageTarget.has(other.id) && (byPageTarget.get(other.id)!.publishedSlug ?? byPageTarget.get(other.id)!.slug) !== other.slug : false;
        if (!otherMoves) { swappable = false; blocker("slug_collision", `La dirección «${newSlug}» de «${p.title}» ya es la de otra página.`, ref); }
      }
      if (newSlug !== p.slug && !p.isHome) slugChanges.push({ from: `/${p.slug}`, to: `/${newSlug}` });
    }
    pagesPlan.push({ id: p.id, slug: p.slug, targetSlug: t ? ((t.status === "validated" ? t.publishedSlug : null) ?? t.slug) : null, swappable });
  }

  // Menús: sin traducción validada, la etiqueta seguiría en el idioma anterior pero se serviría como «target»
  const menuTr = new Set(input.contentTranslations.filter((c) => c.entityType === "menu_item" && c.locale === target && c.status === "validated").map((c) => c.entityKey));
  const visible = input.menuItems.filter((m) => m.isVisible);
  const untranslated = visible.filter((m) => !menuTr.has(String(m.id)));
  if (untranslated.length) blocker("menu_untranslated", `${untranslated.length} elemento(s) visible(s) del menú no tienen traducción validada al «${target}»: ${untranslated.slice(0, 5).map((m) => `«${m.label}»`).join(", ")}${untranslated.length > 5 ? "…" : ""}.`);

  // Productos, formularios y ajustes: se avisa (su contenido base puede estar ya en el idioma destino, como en Quantum)
  for (const type of PLANNED_CONTENT_TYPES) {
    if (type === "menu_item") continue;
    const total = input.contentCounts?.[type] ?? 0;
    if (!total) continue;
    const done = input.contentTranslations.filter((c) => c.entityType === type && c.locale === target && c.status === "validated").length;
    if (done < total) warning("content_untranslated", `${total - done} de ${total} elemento(s) de tipo «${type}» no tienen traducción validada al «${target}»: su contenido base se conserva tal cual; confirma que ya está escrito en «${target}».`, type);
  }

  const swappable = pagesPlan.filter((p) => p.swappable).length;
  const blocked = pagesPlan.length - swappable;
  const canApply = !issues.some((i) => i.severity === "blocker");
  return { current, target, canApply, issues, pages: pagesPlan, slugChanges, counts: { pages: pagesPlan.length, swappable, blocked, menuItems: visible.length, menuTranslated: visible.length - untranslated.length } };
}
