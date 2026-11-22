import { useCallback } from "react";
import { LOCALE_META } from "@shared/i18n/core";
import { panelText } from "@shared/i18n/panelText";
import { useI18n } from "./I18nProvider";
import { getCurrentLocale } from "./standalone";

/**
 * Traduce al idioma de la interfaz los textos en español que componen los modelos puros de «Suscripción», recuperación,
 * planes y ampliaciones (`shared/i18n/panelText.ts`). Sin traducción se muestra el español. Solo interfaz: no usar con
 * contenido del catálogo ni de la empresa.
 */
export function usePanelText(): (es: string) => string {
  const { locale } = useI18n();
  return useCallback((es: string) => panelText(es, locale), [locale]);
}

/** Etiqueta BCP-47 del idioma de la interfaz (para `Intl` en importes). */
export function usePanelTag(): string {
  return LOCALE_META[useI18n().locale].tag;
}

/** Para código que no es React (avisos emergentes, utilidades): usa el idioma publicado por el proveedor. */
export const panelTextNow = (es: string): string => panelText(es, getCurrentLocale());

/** Etiqueta BCP-47 del idioma publicado (código que no es un hook). */
export const panelTagNow = (): string => LOCALE_META[getCurrentLocale()].tag;
