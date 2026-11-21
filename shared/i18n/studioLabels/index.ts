/**
 * Textos de interfaz de Elephant Studio y del CMS por idioma. El español es el texto de origen (clave) y aquí solo está lo que
 * se traduce, como en `navLabels.ts`. Sin traducción se muestra el español. La prueba `server/studioLabels.test.ts` exige que
 * cada texto usado con `tx("…")` y cada etiqueta del catálogo de bloques tenga su traducción y conserve los mismos parámetros.
 * Idioma de interfaz ≠ idioma de contenido: aquí nunca hay contenido de la empresa.
 */
import type { Locale } from "../core";
import { STUDIO_DE_CATALOG } from "./catalog";
import { STUDIO_DE_STUDIO } from "./studio";
import { STUDIO_DE_CMS } from "./cms";

export const STUDIO_DE: Record<string, string> = { ...STUDIO_DE_CATALOG, ...STUDIO_DE_STUDIO, ...STUDIO_DE_CMS };

/** Texto de interfaz en el idioma pedido; si no hay traducción, el español. */
export const studioText = (es: string, locale: Locale): string => (locale === "de" ? STUDIO_DE[es] ?? es : es);
