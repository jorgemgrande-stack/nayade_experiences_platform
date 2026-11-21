import { useCallback, useMemo } from "react";
import { format, type Params } from "@shared/i18n/core";
import { studioText } from "@shared/i18n/studioLabels";
import { useI18n } from "@/i18n/I18nProvider";

export interface StudioText {
  (es: string, params?: Params): string;
  /** Minúsculas solo en español: en alemán los sustantivos llevan mayúscula inicial. */
  lower: (text: string) => string;
}

/**
 * Textos de interfaz de Elephant Studio y del CMS: el español es la clave (texto de origen) y el alemán está en
 * `shared/i18n/studioLabels`. Sin traducción se muestra el español. Admite parámetros `{nombre}` como el resto del panel.
 * Solo traduce interfaz: nunca contenido de la empresa (páginas, textos de bloques, medios).
 */
export function useStudioText(): StudioText {
  const { locale } = useI18n();
  const base = useCallback(
    (es: string, params?: Params): string => {
      const text = studioText(es, locale);
      if (!params) return text;
      const clean: Params = {};
      for (const [k, v] of Object.entries(params)) clean[k] = v == null ? "" : v;
      return format(text, clean, locale);
    },
    [locale],
  );
  return useMemo(() => Object.assign(base, { lower: (text: string) => (locale === "es" ? text.toLowerCase() : text) }), [base, locale]);
}
