/**
 * Identidad legal de la empresa en curso para el pie de correos y páginas públicas: razón social, NIF/CIF, domicilio
 * y correo de contacto, y la línea «nombre · NIF/CIF X · dirección · correo» que ya usaba la newsletter (misma
 * composición; se reutiliza, no se inventa ningún dato). Lectura síncrona sobre las cachés por empresa.
 */
import { getSystemSettingSync } from "../config";
import { brandName, issuerName } from "../tenantBrand";

export interface TenantLegalIdentity {
  /** Una línea: nombre · NIF/CIF · dirección · correo (solo las partes que existen). */
  line: string;
  name: string;
  cif?: string;
  address?: string;
  email?: string;
  phone?: string;
}

export function tenantLegalIdentity(): TenantLegalIdentity {
  let brand = "";
  try {
    brand = brandName();
  } catch {
    brand = "";
  }
  const get = (k: string) => getSystemSettingSync(k, "").trim();
  let name = "";
  try {
    name = issuerName();
  } catch {
    name = brand;
  }
  const cif = get("brand_nif") || get("site_legal_cif");
  const address = get("brand_address") || get("site_legal_address");
  const email = get("site_legal_email") || get("email_reservations");
  const phone = get("site_legal_phone") || get("brand_phone");
  const line = [name, cif && `NIF/CIF ${cif}`, address, email].filter(Boolean).join(" · ");
  return { line, name, cif: cif || undefined, address: address || undefined, email: email || undefined, phone: phone || undefined };
}
