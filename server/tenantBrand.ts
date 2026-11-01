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
import { getSystemSetting, getSystemSettingSync } from "./config";
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
 * Ajustes que guardan «Datos de la empresa» y el asistente de alta (`system_settings`), equivalentes a las claves
 * heredadas `legalCompany*` de `site_settings`.
 */
export const OWN_LEGAL_SETTING_KEYS: Readonly<Record<string, string>> = {
  legalCompanyName: "site_legal_name",
  legalCompanyCif: "brand_nif",
  legalCompanyAddress: "brand_address",
  legalCompanyCity: "site_legal_city",
  legalCompanyZip: "site_legal_zip",
  legalCompanyProvince: "site_legal_province",
  legalCompanyEmail: "site_legal_email",
  legalCompanyPhone: "site_legal_phone",
  legalCompanyIban: "site_legal_iban",
};

/**
 * Fuente única de una pyme (multi): lo que guardó en «Datos de la empresa» o en el asistente manda; las claves
 * heredadas `legalCompany*` solo rellenan lo que esté vacío. Antes era al revés y un valor antiguo ganaba siempre.
 */
export function preferOwnLegalSettings(legacy: Record<string, string>, own: Record<string, string>): Record<string, string> {
  const out = { ...legacy };
  for (const k of Object.keys(OWN_LEGAL_SETTING_KEYS)) {
    const v = (own[k] ?? "").trim();
    if (v) out[k] = v;
  }
  return out;
}

/** Ajustes propios (`system_settings`) con las claves `legalCompany*`. */
export async function readOwnLegalSettings(): Promise<Record<string, string>> {
  const own: Record<string, string> = {};
  for (const [k, sys] of Object.entries(OWN_LEGAL_SETTING_KEYS)) own[k] = await getSystemSetting(sys, "");
  return own;
}

/**
 * Emisor de los documentos que se emiten A PARTIR DE AHORA (facturas, abonos, tickets, textos legales, liquidaciones).
 *  - multi: lo que la empresa guardó en «Datos de la empresa» o en el asistente (`own`) manda, campo a campo. Lo que
 *    no haya guardado sale de su entidad fiscal en el registro (su alta como cliente de Elephant Source) y, si tampoco
 *    está, de los ajustes antiguos `legalCompany*`. Antes la entidad del registro ganaba siempre y la empresa no podía
 *    corregir su razón social ni su NIF.
 *  - single: sus ajustes `legalCompany*`, sin cambios.
 * Los documentos ya emitidos NO usan esto: llevan su copia del emisor (o, los anteriores a la copia, la fuente de antes).
 */
export function resolveCurrentLegalCompany(
  legacy: Record<string, string>,
  own: Record<string, string>,
  opts: { multi: boolean; fiscal: TenantFiscalIdentity | null },
): LegalCompany {
  if (!opts.multi) return resolveLegalCompany(legacy, { multi: false, fiscal: null });
  const o = (k: string) => (own[k] ?? "").trim();
  const l = (k: string) => (legacy[k] ?? "").trim();
  const f = opts.fiscal;
  const merged = preferOwnLegalSettings(legacy, own);
  // El domicilio va entero de una sola fuente (calle, CP, ciudad y provincia), para no mezclar dos direcciones
  const place = o("legalCompanyAddress")
    ? { address: o("legalCompanyAddress"), city: o("legalCompanyCity"), zip: o("legalCompanyZip"), province: o("legalCompanyProvince") }
    : (f?.address ?? "").trim()
      ? { address: (f!.address ?? "").trim(), city: "", zip: "", province: "" }
      : { address: l("legalCompanyAddress"), city: l("legalCompanyCity"), zip: l("legalCompanyZip"), province: l("legalCompanyProvince") };
  return {
    name: o("legalCompanyName") || (f?.legalName ?? "").trim() || l("legalCompanyName"),
    cif: o("legalCompanyCif") || (f?.taxId ?? "").trim() || l("legalCompanyCif"),
    ...place,
    email: merged.legalCompanyEmail || "",
    phone: merged.legalCompanyPhone || "",
    iban: merged.legalCompanyIban || "",
  };
}

/**
 * Emisor de liquidaciones y lotes de facturación (multi): el mismo que el de las facturas nuevas, con el domicilio en
 * una línea. Se generan y guardan al pedirlos.
 */
export async function tenantIssuerData(s: Record<string, string>): Promise<{ name: string; cif: string; address: string; email: string; phone: string }> {
  await warmTenantIdentity();
  const l = resolveCurrentLegalCompany(s, await readOwnLegalSettings(), { multi: true, fiscal: tenantFiscalIdentity() });
  return { name: l.name, cif: l.cif, address: formatLegalAddress(l), email: l.email, phone: l.phone };
}

/** Razón social del emisor: la que guardó la empresa, la de su entidad fiscal en el registro (multi) o su nombre. */
export function issuerName(): string {
  return getSystemSettingSync("site_legal_name", "").trim() || (isMultiTenant() ? tenantFiscalIdentity()?.legalName : "") || brandName();
}

// ── Colores de los documentos ─────────────────────────────────────────────

const DOC_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
/** Tinta neutra cuando la empresa no tiene color o no se lee con texto blanco encima (contraste < 4,5:1). */
export const DOCUMENT_NEUTRAL_INK = "#171d28";

function docLuminance(hex: string): number {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** ¿Se lee texto blanco sobre este color (WCAG AA, 4,5:1)? */
export function readableOnWhiteText(hex: string): boolean {
  if (!DOC_HEX.test(hex)) return false;
  return 1.05 / (docLuminance(hex) + 0.05) >= 4.5;
}

/**
 * Colores de las facturas, abonos y tickets nuevos: los de la marca de la empresa (color principal y de acento, de
 * «Marca» o de los ajustes antiguos). Sin ellos, o si el texto blanco no se leería encima, una tinta neutra; el acento
 * cae en el principal. Solo presentación: nunca cambia el contenido fiscal.
 */
export async function documentBrandColors(): Promise<{ primary: string; accent: string }> {
  const pick = async (...keys: string[]) => {
    for (const k of keys) {
      const v = (await getSystemSetting(k, "").catch(() => "")).trim();
      if (DOC_HEX.test(v)) return v;
    }
    return "";
  };
  const p = await pick("theme_primary_color", "brand_primary_color");
  const primary = p && readableOnWhiteText(p) ? p : DOCUMENT_NEUTRAL_INK;
  const a = await pick("theme_accent_color", "brand_accent_color");
  return { primary, accent: a && readableOnWhiteText(a) ? a : primary };
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
