/**
 * Vinculación de la sesión al tenant (claim `tid`).
 *
 * El tenant «actual» sale del contexto fijado por el middleware a partir del host resuelto en
 * el registro. El `tid` del token se compara contra él: nunca se confía en un tenant aportado
 * por el cliente (cabeceras, parámetros, cuerpo) ni se usa el `tid` para elegir la BD.
 *
 *  - multi: se exige contexto; el token debe llevar `tid` igual al contexto. Los tokens previos
 *    (sin `tid`) solo se aceptan para el tenant indicado en `legacyTenant` (transición de
 *    Náyade sin cierre masivo de sesiones); sin ese ajuste, se rechazan.
 *  - single / shadow: compatible con los tokens actuales; si hay `tid` y contexto, deben coincidir.
 */
import { isMultiTenant, peekTenantContext } from "../tenant";

export function sessionTenantClaim(): { tid?: string } {
  const ctx = peekTenantContext()?.tenantId;
  if (isMultiTenant() && !ctx) {
    throw new Error("No se puede emitir una sesión sin tenant resuelto");
  }
  return ctx ? { tid: ctx } : {};
}

export function sessionTenantAllowed(
  tokenTid: unknown,
  legacyTenant: string | undefined = process.env.TENANT_LEGACY_SESSION_TENANT,
): boolean {
  const ctx = peekTenantContext()?.tenantId;
  const tid = typeof tokenTid === "string" && tokenTid ? tokenTid : undefined;

  if (isMultiTenant()) {
    if (!ctx) return false;
    if (tid) return tid === ctx;
    return !!legacyTenant && legacyTenant === ctx;
  }
  if (tid && ctx) return tid === ctx;
  return true;
}
