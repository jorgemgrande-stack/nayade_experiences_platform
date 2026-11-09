/**
 * Versiones de la política de privacidad que acepta el plano de control (contratación con Stripe y alta de la prueba).
 *
 * Cambio de texto del 10/11/2026 (procedencia de las visitas y de las solicitudes de prueba): la web publica la versión
 * `2026-11-10` (`VERSIONS.privacy` de bigelephant-web) y production tiene `CP_PRIVACY_VERSION=2026-10-25`. Para que nadie
 * con la página abierta en una u otra versión reciba un error, y sin tener que cambiar la variable, se aceptan SOLO esas
 * dos versiones, sea cual sea el valor de la variable:
 *  - la variable decide únicamente SI se exige la privacidad en la contratación (presente = se exige), como hasta ahora;
 *  - las versiones válidas son siempre la lista cerrada de abajo. Un valor de la variable fuera de ella no amplía nada.
 * Al publicar otro texto se cambia esta lista (y `VERSIONS.privacy` de la web) a la vez.
 */
export const PRIVACY_VERSION_CURRENT = "2026-11-10";
export const PRIVACY_VERSION_PREVIOUS = "2026-10-25";
export const ACCEPTED_PRIVACY_VERSIONS: readonly string[] = [PRIVACY_VERSION_PREVIOUS, PRIVACY_VERSION_CURRENT];

/** ¿Es una versión de la privacidad que se puede aceptar hoy? */
export function isAcceptedPrivacyVersion(v: string | null | undefined): v is string {
  return typeof v === "string" && ACCEPTED_PRIVACY_VERSIONS.includes(v.trim());
}

/** La versión vigente que se muestra al contratar desde el panel. Sin variable (privacidad no exigida), null. */
export function currentPrivacyVersion(configured: string | null | undefined): string | null {
  return configured?.trim() ? PRIVACY_VERSION_CURRENT : null;
}
