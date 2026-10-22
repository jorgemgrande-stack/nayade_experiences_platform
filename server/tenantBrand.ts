/**
 * Marca, comunicaciones e identidad fiscal de la empresa en curso para correos, PDFs y plantillas.
 *
 *  - single/shadow: los ajustes de la propia instalación. Sin un dato, vacío: los respaldos escritos a mano de
 *    la instalación original (decisión del 23/10/2026) ya no se usan.
 *  - multi: los ajustes de la propia empresa (`system_settings`/`site_settings` de SU base) y su
 *    identidad del registro (nombre, URL pública, entidad fiscal por defecto). NUNCA los respaldos
 *    heredados: son de otra empresa y acabarían en documentos de un tercero. Sin dato, vacío.
 *
 * Las lecturas son síncronas sobre cachés por empresa que precarga el borde (ver
 * `installTenantBinding`): `warmConfigCache()` y `warmTenantIdentity()`.
 */
import { getSystemSettingSync } from "./config";
import { isMultiTenant } from "./_core/tenant";
import { publicBaseUrl } from "./_core/productIdentity";
import { peekTenantIdentity, warmTenantIdentity, type TenantFiscalIdentity } from "./_core/tenantIdentity";

const NAME_KEYS = new Set(["brand_name", "brand_short_name"]);

/**
 * Ajuste de marca. single: `getSystemSettingSync(key, legacyFallback)` sin cambios. multi: el ajuste
 * de la empresa; para el nombre, si falta, el nombre de la empresa en el registro.
 */
export function brandSetting(key: string, legacyFallback: string): string {
  if (!isMultiTenant()) return getSystemSettingSync(key, legacyFallback);
  const own = getSystemSettingSync(key, "");
  if (own) return own;
  if (key === "brand_short_name") return brandName();
  return NAME_KEYS.has(key) ? (peekTenantIdentity()?.displayName ?? "") : "";
}

export function brandName(): string {
  return brandSetting("brand_name", "");
}

/** Nombre de la empresa en curso (sus ajustes o, en multi, su nombre en el registro). */
export function companyName(): string {
  return brandName();
}

/** Obsoleto (usar `companyName()`): el nombre de la empresa en curso; el literal ya no se usa en ningún modo. */
export function legacyBrandText(_literal: string): string {
  return brandName();
}

/** Obsoleto (usar `publicBaseUrl()`): la URL pública de la instalación o de la empresa; el literal ya no se usa. */
export function legacyUrl(_literal: string): string {
  return publicBaseUrl();
}

/** Host público («www.ejemplo.es») de la empresa (multi) o de la instalación (APP_URL); el literal ya no se usa. */
export function legacySiteHost(_literal: string): string {
  if (isMultiTenant()) return peekTenantIdentity()?.publicHost ?? "";
  try {
    return publicBaseUrl() ? new URL(publicBaseUrl()).host : "";
  } catch {
    return "";
  }
}

/** Obsoleto (usar `brandSetting(key, "")`): el ajuste de la empresa en curso; el literal ya no se usa en ningún modo. */
export function legacyBrandSetting(key: string, _literal: string): string {
  return brandSetting(key, "");
}

// ── Comunicaciones ─────────────────────────────────────────────────────────

export interface TenantCommsConfig {
  /** Dirección del remitente (verificada en el proveedor de correo) o `null`. */
  fromEmail: string | null;
  fromName: string;
  replyTo: string | null;
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const cleanEmail = (v: string): string | null => (EMAIL.test(v.trim()) ? v.trim() : null);

/**
 * Remitente de la empresa en curso (preparado; no envía nada):
 *  - `email_from_address` (o el heredado `email_noreply_sender`)
 *  - `email_from_name` (o el nombre de marca)
 *  - `email_reply_to` (o `email_reservations`)
 */
export function tenantCommsConfig(): TenantCommsConfig {
  const fromName = (getSystemSettingSync("email_from_name", "") || brandName()).replace(/[<>"\r\n]/g, "").trim();
  return {
    fromEmail: cleanEmail(getSystemSettingSync("email_from_address", "") || getSystemSettingSync("email_noreply_sender", "")),
    fromName,
    replyTo: cleanEmail(getSystemSettingSync("email_reply_to", "") || getSystemSettingSync("email_reservations", "")),
  };
}

// ── Identidad fiscal ───────────────────────────────────────────────────────

export interface LegalCompany {
  name: string;
  cif: string;
  address: string;
  city: string;
  zip: string;
  province: string;
  email: string;
  phone: string;
  iban: string;
}

/**
 * Datos del emisor de documentos fiscales.
 *  - multi: la entidad fiscal por defecto de la empresa en el registro (razón social, NIF, domicilio).
 *  - Sin entidad (o en la instalación de una sola empresa): sus ajustes `legalCompany*`.
 *  Contacto e IBAN, siempre de sus ajustes. Nunca datos fiscales fijos de otra sociedad (decisión del 23/10/2026).
 */
export function resolveLegalCompany(
  s: Record<string, string>,
  opts: { multi: boolean; fiscal: TenantFiscalIdentity | null },
): LegalCompany {
  const contact = { email: s.legalCompanyEmail || "", phone: s.legalCompanyPhone || "", iban: s.legalCompanyIban || "" };
  const f = opts.multi ? opts.fiscal : null;
  if (f) return { name: f.legalName, cif: f.taxId, address: f.address ?? "", city: "", zip: "", province: "", ...contact };
  return {
    name: s.legalCompanyName || "",
    cif: s.legalCompanyCif || "",
    address: s.legalCompanyAddress || "",
    city: s.legalCompanyCity || "",
    zip: s.legalCompanyZip || "",
    province: s.legalCompanyProvince || "",
    ...contact,
  };
}

/**
 * Emisor de liquidaciones y lotes de facturación (multi): entidad fiscal del registro y contacto de
 * los ajustes de la empresa, con el domicilio en una línea.
 */
export async function tenantIssuerData(s: Record<string, string>): Promise<{ name: string; cif: string; address: string; email: string; phone: string }> {
  await warmTenantIdentity();
  const l = resolveLegalCompany(s, { multi: true, fiscal: tenantFiscalIdentity() });
  return { name: l.name, cif: l.cif, address: formatLegalAddress(l), email: l.email, phone: l.phone };
}

/** Razón social del emisor: la entidad fiscal del registro (multi), su razón social configurada o su nombre. */
export function issuerName(): string {
  return (isMultiTenant() ? tenantFiscalIdentity()?.legalName : "") || getSystemSettingSync("site_legal_name", "") || brandName();
}

/** Obsoleto (usar `issuerName()`). */
export function legacyIssuerName(_literal: string): string {
  return issuerName();
}

/** Entidad fiscal de la empresa en curso según el registro (multi), o `null`. */
export function tenantFiscalIdentity(): TenantFiscalIdentity | null {
  return peekTenantIdentity()?.fiscal ?? null;
}

/** «Dirección, CP Ciudad (Provincia)» omitiendo las partes vacías (en single nunca lo están). */
export function formatLegalAddress(l: Pick<LegalCompany, "address" | "zip" | "city" | "province">): string {
  const place = [l.zip, l.city].filter(Boolean).join(" ") + (l.province ? ` (${l.province})` : "");
  return [l.address, place.trim()].filter(Boolean).join(", ");
}
