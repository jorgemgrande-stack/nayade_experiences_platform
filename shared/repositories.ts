/**
 * Repositorios de Elephant Source. Único punto con el nombre del repositorio del Core: al renombrarlo
 * (`nayade_experiences_platform` → `elephant-source-core`, ver docs/elephant-source/RENOMBRADO_ELEPHANT_CORE.md)
 * solo cambia `core` aquí. Sin dependencias: lo importan el servidor y los scripts de despliegue.
 */
export const REPOSITORIES = {
  core: "nayade_experiences_platform",
  crm: "big-elephant-crm",
  web: "bigelephant-web",
} as const;

/** Nombre decidido para el repositorio del Core (todavía no aplicado). */
export const CORE_REPOSITORY_TARGET = "elephant-source-core";
