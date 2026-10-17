/**
 * Marca, comunicaciones e identidad fiscal de la empresa en curso para correos, PDFs y plantillas.
 *
 *  - single/shadow: EXACTAMENTE lo de antes: el ajuste de la instalación o, si falta, el respaldo
 *    heredado que cada sitio tenía escrito (Skicenter, Náyade, Iron Elephant…).
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
  return brandSetting("brand_name", "Skicenter");
}

/** Texto de marca escrito a mano en el código: en single el de siempre; en multi el nombre de la empresa. */
export function legacyBrandText(literal: string): string {
  return isMultiTenant() ? brandName() : literal;
}

/** URL escrita a mano en el código: en single la de siempre; en multi la URL pública de la empresa. */
export function legacyUrl(literal: string): string {
  return isMultiTenant() ? publicBaseUrl() : literal;
}

/** Host escrito a mano («www.ejemplo.es»): en single el de siempre; en multi el host público de la empresa. */
export function legacySiteHost(literal: string): string {
  return isMultiTenant() ? (peekTenantIdentity()?.publicHost ?? "") : literal;
}

/** Valor fijo (p. ej. un logotipo) que en single no lee ajustes: en multi, el ajuste de la empresa. */
export function legacyBrandSetting(key: string, literal: string): string {
  return isMultiTenant() ? brandSetting(key, "") : literal;
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

/** Respaldos heredados de la instalación histórica (solo single). */
export const LEGACY_LEGAL_FALLBACK = {
  name: "Iron Elephant Consulting S.L.",
  cif: "B26987875",
  address: "C/ Corazón de María 57, 1º D",
  city: "Madrid",
  zip: "28002",
  province: "Madrid",
} as const;

/**
 * Datos del emisor de documentos fiscales.
 *  - single: ajustes `legalCompany*` con los respaldos heredados (idéntico a antes).
 *  - multi: la entidad fiscal por defecto de la empresa en el registro (razón social, NIF,
 *    domicilio); contacto e IBAN de sus ajustes. Sin entidad, sus ajustes; nunca constantes.
 */
export function resolveLegalCompany(
  s: Record<string, string>,
  opts: { multi: boolean; fiscal: TenantFiscalIdentity | null },
): LegalCompany {
  const contact = { email: s.legalCompanyEmail || "", phone: s.legalCompanyPhone || "", iban: s.legalCompanyIban || "" };
  if (!opts.multi) {
    const L = LEGACY_LEGAL_FALLBACK;
    return {
      name: s.legalCompanyName || L.name,
      cif: s.legalCompanyCif || L.cif,
      address: s.legalCompanyAddress || L.address,
      city: s.legalCompanyCity || L.city,
      zip: s.legalCompanyZip || L.zip,
      province: s.legalCompanyProvince || L.province,
      ...contact,
    };
  }
  const f = opts.fiscal;
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

/** Razón social del emisor escrita a mano: en single la de siempre; en multi la de su entidad fiscal. */
export function legacyIssuerName(literal: string): string {
  return isMultiTenant() ? tenantFiscalIdentity()?.legalName || brandName() : literal;
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
