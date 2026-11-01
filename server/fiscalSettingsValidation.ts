/**
 * Comprobación en el servidor de los datos fiscales que la empresa guarda uno a uno (Configuración, «Datos de la
 * empresa»): NIF/CIF con su dígito de control y código postal de una empresa española, correo, teléfono e IBAN de las
 * facturas. Las mismas reglas que el formulario y que el asistente (`spanishFiscalErrors`). Vacío = borrar: siempre
 * válido. El NIF de la entidad fiscal registrada en el alta ya lo validó quien la dio de alta: se acepta tal cual.
 */
import { TRPCError } from "@trpc/server";
import { spanishFiscalErrors } from "../shared/setupWizard";
import { validateEmail, validateIban, validatePhone } from "../shared/formValidation";
import { getSystemSetting } from "./config";
import { isMultiTenant } from "./_core/tenant";
import { warmTenantIdentity } from "./_core/tenantIdentity";
import { tenantFiscalIdentity } from "./tenantBrand";

/** Ajustes fiscales que se comprueban (clave de `system_settings`). */
export const CHECKED_FISCAL_SETTING_KEYS: ReadonlySet<string> = new Set(["brand_nif", "site_legal_zip", "site_legal_email", "site_legal_phone", "site_legal_iban"]);

const norm = (x: string | null | undefined) => (x ?? "").toUpperCase().replace(/[\s.-]/g, "");

/** Motivo por el que el valor no es válido, o null. `country`: el de la empresa (por defecto, el guardado o España). */
export async function fiscalSettingError(key: string, value: string, country?: string | null): Promise<string | null> {
  if (!CHECKED_FISCAL_SETTING_KEYS.has(key) || !value.trim()) return null;
  if (key === "site_legal_email") return validateEmail(value);
  if (key === "site_legal_phone") return validatePhone(value);
  if (key === "site_legal_iban") return validateIban(value);
  const c = country ?? (await getSystemSetting("site_legal_country", "").catch(() => ""));
  if (key === "site_legal_zip") return spanishFiscalErrors(c, { postalCode: value }).postalCode ?? null;
  const err = spanishFiscalErrors(c, { taxId: value }).taxId ?? null;
  if (err && isMultiTenant()) {
    await warmTenantIdentity().catch(() => undefined);
    const registry = tenantFiscalIdentity();
    if (registry && norm(registry.taxId) === norm(value)) return null;
  }
  return err;
}

/**
 * Igual que `fiscalSettingError`, pero rechaza la petición (400) con el motivo. Un valor que no cambia respecto al
 * guardado no se comprueba: un dato antiguo no impide guardar el resto de la configuración.
 */
export async function assertFiscalSettingValue(key: string, value: string, opts: { country?: string | null; stored?: string | null } = {}): Promise<void> {
  if (!CHECKED_FISCAL_SETTING_KEYS.has(key)) return;
  const stored = opts.stored !== undefined ? opts.stored : await getSystemSetting(key, "").catch(() => null);
  if (stored !== null && (stored ?? "").trim() === value.trim()) return;
  const err = await fiscalSettingError(key, value, opts.country);
  if (err) throw new TRPCError({ code: "BAD_REQUEST", message: err });
}
