/**
 * «Nuevo» en el menú del panel para las extensiones recién activadas (módulos Net, extras Connect…). Lógica pura, sin
 * React: la usan el menú y las pruebas.
 *
 * Una sección o entrada aportada por una extensión se marca «Nuevo» si su licencia se activó hace menos de
 * NEW_EXTENSION_DAYS y la persona todavía no ha entrado en ninguna de sus pantallas. Al entrar, se recuerda como
 * descubierta (en el navegador, por persona) y la marca desaparece. Es solo presentación.
 */
import type { NavExtension, NavItem, NavLeaf, NavSection } from "./adminNav";

export const NEW_EXTENSION_DAYS = 14;
const DAY_MS = 86_400_000;

export function isNewExtension(ext: NavExtension | undefined, discovered: ReadonlySet<string>, now: number): boolean {
  return !!ext && ext.since != null && now - ext.since < NEW_EXTENSION_DAYS * DAY_MS && !discovered.has(ext.moduleId);
}

const pathOf = (href: string) => href.split(/[?#]/)[0].replace(/\/+$/, "");

/** Extensiones del menú con sus rutas (secciones propias y entradas sueltas). */
export function extensionBlocks(sections: ReadonlyArray<Pick<NavSection, "extension"> & { items: ReadonlyArray<Pick<NavItem, "href" | "extension"> & { children?: ReadonlyArray<Pick<NavLeaf, "href">> }> }>): Array<{ moduleId: string; paths: string[] }> {
  const by = new Map<string, Set<string>>();
  const add = (moduleId: string, items: ReadonlyArray<{ href: string; children?: ReadonlyArray<{ href: string }> }>) => {
    const set = by.get(moduleId) ?? new Set<string>();
    for (const i of items) {
      set.add(pathOf(i.href));
      for (const c of i.children ?? []) set.add(pathOf(c.href));
    }
    by.set(moduleId, set);
  };
  for (const s of sections) {
    if (s.extension) add(s.extension.moduleId, s.items);
    for (const i of s.items) if (i.extension) add(i.extension.moduleId, [i]);
  }
  return Array.from(by, ([moduleId, paths]) => ({ moduleId, paths: Array.from(paths) }));
}

/** Extensiones cuyas pantallas incluyen esta ruta (la persona las ha descubierto al entrar). */
export function discoveredAt(pathname: string, blocks: ReadonlyArray<{ moduleId: string; paths: string[] }>): string[] {
  const p = pathOf(pathname);
  return blocks.filter((b) => b.paths.some((x) => p === x || p.startsWith(`${x}/`))).map((b) => b.moduleId);
}
