/**
 * Credenciales de integraciones por tenant.
 *
 * En modo multi las credenciales de integraciones (GHL, VAPI, Meta, Redsys…) pertenecen a
 * cada tenant y salen de SUS ajustes; las variables de entorno del proceso son de una única
 * empresa (Náyade) y NO deben usarse para otra: un cobro o un mensaje de otro tenant saldría
 * por la cuenta equivocada.
 *
 *  - single/shadow: `integrationEnv(n)` ≡ `process.env[n]` (sin cambios).
 *  - multi: siempre `undefined`; el código ya cae a los ajustes del tenant (`|| map.xxx`).
 */
import { isMultiTenant } from "./tenant";

export function integrationEnv(name: string): string | undefined {
  return isMultiTenant() ? undefined : process.env[name];
}
