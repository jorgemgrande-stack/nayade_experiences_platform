import { createTranslator, DEFAULT_LOCALE, type Locale, type Translate } from "@shared/i18n/core";
import { FLAT } from "./catalog";

/**
 * Traductor para código que NO es React (utilidades de errores, avisos emergentes…). Usa el idioma que el proveedor
 * (`I18nProvider`) ha publicado; mientras no haya proveedor, español.
 */
let current: Locale = DEFAULT_LOCALE;

export function setCurrentLocale(locale: Locale): void {
  current = locale;
}
export function getCurrentLocale(): Locale {
  return current;
}

const cache = new Map<Locale, Translate>();
/** Traductor del idioma activo de la interfaz. */
export function getT(): Translate {
  let t = cache.get(current);
  if (!t) {
    t = createTranslator(current, FLAT).t;
    cache.set(current, t);
  }
  return t;
}
