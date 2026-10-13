/**
 * Credenciales de integraciones por tenant.
 *
 * En modo multi las credenciales de integraciones (GHL, VAPI, Meta, Redsys…) pertenecen a
 * cada tenant y salen de SUS ajustes; las variables de entorno del proceso son de una única
 * empresa (Náyade) y NO deben usarse para otra: un cobro o un mensaje de otro tenant saldría
 * por la cuenta equivocada.
 *
 *  - single/shadow: `integrationEnv(n)` ≡ `process.env[n]` (sin cambios).
 *  - multi: la credencial del tenant en la bóveda (server/_core/credentials); si no hay,
 *    `undefined` y el código cae a los ajustes del tenant (`|| map.xxx`).
 */
import { isMultiTenant } from "./tenant";
import { resolveEnvName } from "./credentials/catalog";
import { credentialFor } from "./credentials/cache";

export function integrationEnv(name: string): string | undefined {
  if (!isMultiTenant()) return process.env[name];
  // Multiempresa: la credencial del tenant (bóveda, precargada); nunca el entorno
  const r = resolveEnvName(name);
  return r ? credentialFor(r.provider, r.field) : undefined;
}
