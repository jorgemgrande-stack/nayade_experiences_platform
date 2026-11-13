/**
 * Elephant Studio: ventanas emergentes (modales). Reglas puras, compartidas por el servidor (saneado), el editor y la web.
 *
 * - Una ventana es un bloque de primer nivel (`modal`) con una sola columna de módulos dentro (misma forma que una
 *   sección, así el editor reutiliza el árbol de la página). Nunca va dentro de una columna ni dentro de otra ventana.
 * - Se identifica por su `slug` (único en la página); el enlace que la abre es `#modal-<slug>`. No hay código ni HTML libre.
 * - Cualquier enlace, botón o tarjeta con esa dirección la abre: no hace falta un campo nuevo en cada módulo.
 */
import { ANCHOR_RE, type BlockDataMap, type PageBlock } from "../pageBlocks";

export const MODAL_HASH_PREFIX = "#modal-";
export const MODAL_SLUG_MAX = 40;
export const MODAL_DEFAULT_SLUG = "ventana";

export const MODAL_SIZES = ["s", "m", "l"] as const;
export const MODAL_AUTO_OPEN = ["off", "load", "exit"] as const;
export const MODAL_AUTO_DELAYS = ["3", "5", "10", "20", "30"] as const;
export const MODAL_REMEMBER_DAYS = ["7", "30", "90", "365"] as const;

/** Dirección que abre la ventana. */
export const modalHref = (slug: string): string => `${MODAL_HASH_PREFIX}${slug}`;

/** Identificador de la ventana que abre una dirección (`#modal-x`, `/pagina#modal-x`), o null si no abre ninguna. */
export function modalSlugFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const i = href.indexOf(MODAL_HASH_PREFIX);
  if (i < 0 || (i > 0 && href[i - 1] === "#")) return null;
  const slug = href.slice(i + MODAL_HASH_PREFIX.length);
  return ANCHOR_RE.test(slug) ? slug : null;
}

/** Identificador válido a partir de un texto (título): minúsculas sin tildes y con guiones. */
export function modalSlugFrom(text: string): string {
  const s = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MODAL_SLUG_MAX)
    .replace(/-+$/g, "");
  return ANCHOR_RE.test(s) ? s : MODAL_DEFAULT_SLUG;
}

/** Un identificador libre: el pedido o, si ya está en uso, con -2, -3… */
export function uniqueModalSlug(wanted: string, taken: ReadonlySet<string>): string {
  const base = ANCHOR_RE.test(wanted) ? wanted : modalSlugFrom(wanted);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const cand = base.slice(0, MODAL_SLUG_MAX - suffix.length).replace(/-+$/, "") + suffix;
    if (!taken.has(cand)) return cand;
  }
}

/** Las ventanas de la página (las de primer nivel), para elegirlas por su nombre en el editor. */
export function pageModals(blocks: readonly PageBlock[]): Array<{ id: string; slug: string; title: string }> {
  const out: Array<{ id: string; slug: string; title: string }> = [];
  for (const b of blocks) if (b.type === "modal") out.push({ id: b.id, slug: b.data.slug, title: b.data.title });
  return out;
}

/** Nombre con el que se ofrece una ventana como destino de un enlace. */
export const modalTargetLabel = (title: string, slug: string): string => `Abrir la ventana «${title.trim() || slug}»`;

/** Si la apertura automática puede mostrarse otra vez (no la ha descartado ni se ha mostrado en esta sesión). */
export function modalDismissalActive(stored: string | null, now: number): boolean {
  if (!stored) return false;
  const until = Number(stored);
  return Number.isFinite(until) && until > now;
}

export const MODAL_DAY_MS = 86_400_000;

/** Claves del almacenamiento del navegador (una por ventana; cada empresa tiene su propio dominio, así que no se mezclan). */
export const modalStorageKey = (slug: string) => `es-modal-dismissed:${slug}`;
export const modalSessionKey = (slug: string) => `es-modal-shown:${slug}`;

export type ModalData = BlockDataMap["modal"];

/**
 * Cierres posibles. Una ventana nunca puede quedar sin salida en un móvil (sin tecla ESC): si no se puede cerrar
 * pulsando fuera, el botón de cerrar se mantiene aunque se haya desactivado.
 */
export function modalClosing(d: Pick<ModalData, "showClose" | "closeOnOverlay" | "closeOnEsc">): { button: boolean; overlay: boolean; esc: boolean } {
  const overlay = d.closeOnOverlay !== "off";
  const esc = d.closeOnEsc !== "off";
  const button = d.showClose !== "off" || !overlay;
  return { button, overlay, esc };
}

/** Las ventanas de `added` con un identificador que no choque con las que ya tiene la página (al insertar, duplicar o pegar). */
export function withUniqueModalSlugs(added: PageBlock[], existing: readonly PageBlock[]): PageBlock[] {
  const taken = new Set(pageModals(existing).map((m) => m.slug));
  return added.map((b) => {
    if (b.type !== "modal") return b;
    const slug = uniqueModalSlug(b.data.slug, taken);
    taken.add(slug);
    return slug === b.data.slug ? b : ({ ...b, data: { ...b.data, slug } } as PageBlock);
  });
}
