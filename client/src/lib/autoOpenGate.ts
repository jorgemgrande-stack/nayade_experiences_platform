/**
 * Puerta de la apertura automática de las ventanas emergentes respecto al aviso de cookies (lógica pura, sin DOM).
 * Nunca se abre antes de saber si la web usa aviso ni, si lo usa, antes de que la persona decida: así no se
 * abre encima del aviso ni le roba el foco, vaya la red como vaya.
 */
import { cookieCategories, type CookieThemeInput } from "@shared/cookieCategories";

export type CookieGate = "wait-theme" | "wait-decision" | "clear";

/** Misma condición con la que el aviso decide si se muestra (CookieBanner.tsx): decisión previa, ruta sin aviso y categorías del tema. */
export function cookieGate(i: { themeLoaded: boolean; theme: CookieThemeInput | null | undefined; decided: boolean; bannerRoute: boolean }): CookieGate {
  if (i.decided || !i.bannerRoute) return "clear";
  if (!i.themeLoaded) return "wait-theme";
  // Sin tema (error): el aviso tampoco se pinta
  return cookieCategories(i.theme) ? "wait-decision" : "clear";
}

export interface AutoOpener {
  /** El retardo o la intención de salida se han cumplido: abrir en cuanto la puerta lo permita */
  trigger(): void;
  /** Ha cambiado algo (tema cargado, decisión de cookies): reevaluar */
  recheck(afterDecision?: boolean): void;
  dispose(): void;
}

export function createAutoOpener(o: {
  gate: () => CookieGate;
  open: () => void;
  /** Margen tras la decisión de cookies para que el aviso se cierre antes de abrir */
  graceMs: number;
  later: (fn: () => void, ms: number) => () => void;
}): AutoOpener {
  let pending = false;
  let done = false;
  let cancel: (() => void) | null = null;
  const evaluate = (afterDecision: boolean) => {
    if (!pending || done) return;
    if (o.gate() !== "clear") return;
    cancel?.();
    // Con decisión recién tomada se espera el margen; si ya estaba claro (sin aviso), se abre ya
    const fire = () => {
      cancel = null;
      // La puerta se vuelve a comprobar: no abre si entretanto algo la ha cerrado
      if (pending && !done && o.gate() === "clear") {
        done = true;
        pending = false;
        o.open();
      }
    };
    if (afterDecision && o.graceMs > 0) cancel = o.later(fire, o.graceMs);
    else fire();
  };
  return {
    trigger() {
      if (done) return;
      pending = true;
      evaluate(false);
    },
    recheck(afterDecision = true) {
      evaluate(afterDecision);
    },
    dispose() {
      done = true;
      cancel?.();
    },
  };
}
