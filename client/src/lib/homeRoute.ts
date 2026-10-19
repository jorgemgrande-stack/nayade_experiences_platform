/**
 * Portada («/») de una empresa en multiempresa. Lógica pura (probada en server/homeRoute.test.ts).
 *
 *  - Web neutra con página «inicio» publicada → esa página.
 *  - Web neutra SIN página «inicio» (toda empresa recién dada de alta) → su inicio de sesión. Antes se mostraba un
 *    404: la dirección de una empresa nueva no debe parecer rota.
 *  - Sin web neutra (un solo tenant) → la portada de siempre.
 */
export const HOME_PAGE_SLUG = "inicio";
export const HOME_WITHOUT_PAGE = "/login";

export type HomeView = { kind: "loading" } | { kind: "page" } | { kind: "redirect"; to: string } | { kind: "fallback" };

export function resolveHome(s: { themeLoading: boolean; neutralSite: boolean; pageLoading: boolean; hasPage: boolean }): HomeView {
  if (s.themeLoading) return { kind: "loading" };
  if (!s.neutralSite) return { kind: "fallback" };
  if (s.pageLoading) return { kind: "loading" };
  return s.hasPage ? { kind: "page" } : { kind: "redirect", to: HOME_WITHOUT_PAGE };
}
