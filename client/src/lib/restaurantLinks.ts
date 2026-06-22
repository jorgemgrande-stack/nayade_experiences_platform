// Enlaces de restaurantes hacia la web del Hotel Náyade (www.hotelnayade.es).
// Los restaurantes gestionados desde el sitio del hotel se enlazan allí
// directamente; cualquier otro (p. ej. Limoncello Summer Club) permanece
// como ruta interna del SPA de Náyade Experiences.

export const RESTAURANTS_INDEX_EXTERNAL_URL = "https://www.hotelnayade.es/restaurantes";

const RESTAURANT_EXTERNAL_URLS: Record<string, string> = {
  "el-galeon": "https://www.hotelnayade.es/restaurantes/el-galeon",
  "nassau-bar": "https://www.hotelnayade.es/restaurantes/nassau-bar",
  "la-cabana-del-lago": "https://www.hotelnayade.es/restaurantes/la-cabana-del-lago",
};

/** URL externa del Hotel Náyade para un restaurante por su slug, o null si es interno. */
export function restaurantExternalUrl(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return RESTAURANT_EXTERNAL_URLS[slug] ?? null;
}
