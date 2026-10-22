/**
 * Comprobación de FORMA de los identificadores fiscales del comprador, antes de abrir el pago.
 *
 *  - España: NIF de persona física (DNI), NIE y NIF de persona jurídica (CIF), con su carácter de control.
 *    Se admite el prefijo «ES» del NIF-IVA.
 *  - Unión Europea: NIF-IVA con el prefijo del Estado (Grecia usa «EL») y un cuerpo de 2 a 12 caracteres.
 *  - Reino Unido: «GB» y 9 o 12 cifras (o los formatos de la Administración, GD y HA, con 3).
 *  - Resto de países: solo caracteres admitidos (ya lo exige el esquema del perfil).
 *
 * Un formato correcto NUNCA significa que el identificador exista o esté dado de alta (VIES, AEAT, HMRC): esa
 * verificación es un proceso fiscal aparte y el perfil lo sigue marcando «sin verificar».
 */
import { EU_COUNTRIES } from "./buyerProfile";
import { isValidSpanishCif } from "./issuer";

export type TaxIdScheme = "es_nif" | "es_nie" | "es_cif" | "eu_vat" | "gb_vat" | "other";
export type TaxIdCheck = { ok: true; scheme: TaxIdScheme; normalized: string } | { ok: false; reason: string };

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

/** DNI (8 cifras y letra) o NIE (X, Y o Z, 7 cifras y letra), con su letra de control. */
function spanishPersonalId(v: string): "es_nif" | "es_nie" | null {
  const nif = /^(\d{8})([A-Z])$/.exec(v);
  if (nif) return DNI_LETTERS[Number(nif[1]) % 23] === nif[2] ? "es_nif" : null;
  const nie = /^([XYZ])(\d{7})([A-Z])$/.exec(v);
  if (nie) return DNI_LETTERS[Number(`${"XYZ".indexOf(nie[1])}${nie[2]}`) % 23] === nie[3] ? "es_nie" : null;
  return null;
}

/** Prefijo de IVA de un Estado miembro (Grecia: EL). */
export const vatPrefix = (country: string) => (country === "GR" ? "EL" : country);
const OTHER_VAT_PREFIXES = [...Array.from(EU_COUNTRIES, vatPrefix), "XI"];

export function checkTaxId(country: string, raw: string): TaxIdCheck {
  const c = country.trim().toUpperCase();
  const v = raw.replace(/[\s.\-/]/g, "").toUpperCase();
  if (!v) return { ok: false, reason: "Falta el identificador fiscal" };
  if (c === "ES") {
    const body = v.startsWith("ES") && v.length > 9 ? v.slice(2) : v;
    const personal = spanishPersonalId(body);
    if (personal) return { ok: true, scheme: personal, normalized: body };
    if (isValidSpanishCif(body)) return { ok: true, scheme: "es_cif", normalized: body };
    return { ok: false, reason: "NIF, NIE o CIF español no válido (revisa la letra o la cifra de control)" };
  }
  if (EU_COUNTRIES.has(c)) {
    const prefix = vatPrefix(c);
    // Con el prefijo de OTRO Estado (o el de Irlanda del Norte, XI) es un NIF-IVA de otro país: no se acepta
    if (!v.startsWith(prefix) && OTHER_VAT_PREFIXES.some((p) => p !== prefix && v.startsWith(p))) return { ok: false, reason: `El NIF-IVA no es de ${c}: debe empezar por ${prefix}` };
    const body = v.startsWith(prefix) ? v.slice(2) : v;
    if (!/^[A-Z0-9]{2,12}$/.test(body)) return { ok: false, reason: `NIF-IVA de ${c} no válido: debe ser ${prefix} seguido de 2 a 12 letras o cifras` };
    return { ok: true, scheme: "eu_vat", normalized: `${prefix}${body}` };
  }
  if (c === "GB") {
    const body = v.startsWith("GB") ? v.slice(2) : v;
    if (!/^(\d{9}|\d{12}|(GD|HA)\d{3})$/.test(body)) return { ok: false, reason: "VAT del Reino Unido no válido: GB seguido de 9 o 12 cifras" };
    return { ok: true, scheme: "gb_vat", normalized: `GB${body}` };
  }
  if (!/^[A-Z0-9]{3,40}$/.test(v)) return { ok: false, reason: "Identificador fiscal con formato no admitido" };
  return { ok: true, scheme: "other", normalized: v };
}
