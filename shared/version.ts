/**
 * Versión de Elephant Core: fuente ÚNICA para el servidor (validación de `coreRange` de los módulos,
 * `system.version`) y para el panel («Acerca de Elephant Core»). `package.json` no es la fuente.
 *
 * Al publicar una versión se cambian estas dos constantes a la vez y se añade su sección en
 * `CHANGELOG.md`; `scripts/release/etiquetar-core.mjs` comprueba que coinciden antes de etiquetar.
 */

/** Versión semántica publicada (MAJOR.MINOR.PATCH). */
export const CORE_VERSION = "1.0.0";

/** Fecha de publicación de `CORE_VERSION` (AAAA-MM-DD), la misma que su sección del CHANGELOG. */
export const CORE_RELEASED_AT = "2026-10-31";
