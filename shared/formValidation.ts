/**
 * Validaciones de los formularios del panel (lógica pura, compartida por el cliente y las pruebas).
 * Devuelven el mensaje de error en español o `null` si el valor es válido. Un valor vacío solo es
 * error cuando el campo es obligatorio.
 */

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

/** Normaliza un NIF/CIF/NIE: mayúsculas, sin espacios, guiones ni puntos. */
export function normalizeTaxId(v: string): string {
  return v.toUpperCase().replace(/[\s.-]/g, "");
}

/** NIF (DNI), NIE o CIF español con su dígito o letra de control. */
export function isValidSpanishTaxId(raw: string): boolean {
  const v = normalizeTaxId(raw);
  // DNI: 8 dígitos + letra
  if (/^\d{8}[A-Z]$/.test(v)) return DNI_LETTERS[Number(v.slice(0, 8)) % 23] === v[8];
  // NIE: X/Y/Z + 7 dígitos + letra
  if (/^[XYZ]\d{7}[A-Z]$/.test(v)) {
    const n = Number(String("XYZ".indexOf(v[0])) + v.slice(1, 8));
    return DNI_LETTERS[n % 23] === v[8];
  }
  // NIF especiales (K, L, M) + 7 dígitos + letra
  if (/^[KLM]\d{7}[A-Z]$/.test(v)) return true;
  // CIF: letra + 7 dígitos + control (dígito o letra)
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(v)) {
    const digits = v.slice(1, 8);
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const d = Number(digits[i]);
      if (i % 2 === 0) {
        const x = d * 2;
        sum += Math.floor(x / 10) + (x % 10);
      } else sum += d;
    }
    const control = (10 - (sum % 10)) % 10;
    const letter = "JABCDEFGHI"[control];
    const c = v[8];
    if ("PQRSNW".includes(v[0])) return c === letter;
    if ("ABEH".includes(v[0])) return c === String(control);
    return c === String(control) || c === letter;
  }
  return false;
}

export function validateTaxId(v: string, required = false): string | null {
  if (!v.trim()) return required ? "Indica el NIF o CIF." : null;
  return isValidSpanishTaxId(v) ? null : "El NIF o CIF no es válido. Revisa los números y la letra (por ejemplo, B12345674 o 12345678Z).";
}

export function validateEmail(v: string, required = false): string | null {
  if (!v.trim()) return required ? "Indica un correo electrónico." : null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? null : "El correo electrónico no es válido (por ejemplo, nombre@empresa.com).";
}

export function validatePostalCodeES(v: string, required = false): string | null {
  if (!v.trim()) return required ? "Indica el código postal." : null;
  return /^(0[1-9]|[1-4]\d|5[0-2])\d{3}$/.test(v.trim()) ? null : "El código postal debe tener 5 cifras (por ejemplo, 28001).";
}

export function validatePhone(v: string, required = false): string | null {
  if (!v.trim()) return required ? "Indica un teléfono." : null;
  const digits = v.replace(/[\s().-]/g, "");
  return /^\+?\d{9,15}$/.test(digits) ? null : "El teléfono debe tener entre 9 y 15 cifras (puede empezar por +34).";
}

/** IBAN con su dígito de control (ISO 13616, módulo 97). */
export function isValidIban(raw: string): boolean {
  const v = raw.toUpperCase().replace(/\s/g, "");
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return false;
  if (v.startsWith("ES") && v.length !== 24) return false;
  const moved = v.slice(4) + v.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const code = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of code) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

export function validateIban(v: string, required = false): string | null {
  if (!v.trim()) return required ? "Indica el IBAN." : null;
  return isValidIban(v) ? null : "El IBAN no es válido. Revisa que esté completo (en España, ES seguido de 22 cifras).";
}

export function validateUrl(v: string, required = false): string | null {
  if (!v.trim()) return required ? "Indica una dirección web." : null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? null : "La dirección web debe empezar por https://";
  } catch {
    return "La dirección web no es válida (por ejemplo, https://www.tuempresa.com).";
  }
}

export interface FiscalData {
  legalCompanyName: string;
  legalCompanyCif: string;
  legalCompanyAddress: string;
  legalCompanyCity: string;
  legalCompanyZip: string;
  legalCompanyProvince: string;
  legalCompanyEmail: string;
  legalCompanyPhone: string;
  legalCompanyIban: string;
}

/**
 * Datos fiscales del emisor de facturas. Los campos vacíos se permiten mientras se rellena (se
 * guarda por partes), pero lo que se escribe tiene que ser válido.
 */
export function validateFiscalData(d: FiscalData): Partial<Record<keyof FiscalData, string>> {
  const out: Partial<Record<keyof FiscalData, string>> = {};
  const set = (k: keyof FiscalData, m: string | null) => {
    if (m) out[k] = m;
  };
  if (d.legalCompanyName.trim() && d.legalCompanyName.trim().length < 2) out.legalCompanyName = "La razón social es demasiado corta.";
  set("legalCompanyCif", validateTaxId(d.legalCompanyCif));
  set("legalCompanyZip", validatePostalCodeES(d.legalCompanyZip));
  set("legalCompanyEmail", validateEmail(d.legalCompanyEmail));
  set("legalCompanyPhone", validatePhone(d.legalCompanyPhone));
  set("legalCompanyIban", validateIban(d.legalCompanyIban));
  return out;
}

/** Faltan datos imprescindibles para emitir facturas (razón social, NIF/CIF, domicilio, CP y municipio). */
export function missingFiscalFields(d: Partial<FiscalData>): string[] {
  const req: Array<[keyof FiscalData, string]> = [
    ["legalCompanyName", "razón social"],
    ["legalCompanyCif", "NIF o CIF"],
    ["legalCompanyAddress", "domicilio fiscal"],
    ["legalCompanyZip", "código postal"],
    ["legalCompanyCity", "municipio"],
  ];
  return req.filter(([k]) => !(d[k] ?? "").trim()).map(([, l]) => l);
}

export interface ProductFormInput {
  title: string;
  basePrice: string;
  categoryId: string;
  locationId: string;
  pricingType: string;
  unitCapacity: string;
  minPersons: string;
  maxPersons: string;
  discountPercent: string;
}

/** Alta y edición de producto o servicio. Mensajes en español, por campo. */
export function validateProductForm(f: ProductFormInput, labels: { location: string } = { location: "la ubicación" }): Partial<Record<keyof ProductFormInput, string>> {
  const out: Partial<Record<keyof ProductFormInput, string>> = {};
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  if (!f.title.trim()) out.title = "Indica el nombre.";
  else if (f.title.trim().length < 3) out.title = "El nombre debe tener al menos 3 caracteres.";
  const price = num(f.basePrice);
  if (price === null) out.basePrice = "Indica el precio.";
  else if (!Number.isFinite(price) || price < 0) out.basePrice = "El precio debe ser un número igual o mayor que 0.";
  if (!f.categoryId) out.categoryId = "Elige una categoría.";
  if (!f.locationId) out.locationId = `Elige ${labels.location}.`;
  const min = num(f.minPersons);
  const max = num(f.maxPersons);
  if (min !== null && (!Number.isInteger(min) || min < 1)) out.minPersons = "Debe ser un número entero mayor que 0.";
  if (max !== null && (!Number.isInteger(max) || max < 1)) out.maxPersons = "Debe ser un número entero mayor que 0.";
  else if (min !== null && max !== null && max < min) out.maxPersons = "El máximo no puede ser menor que el mínimo.";
  if (f.pricingType === "per_unit") {
    const cap = num(f.unitCapacity);
    if (cap === null) out.unitCapacity = "Indica cuántas personas caben por unidad.";
    else if (!Number.isInteger(cap) || cap < 1) out.unitCapacity = "Debe ser un número entero mayor que 0.";
  }
  const disc = num(f.discountPercent);
  if (disc !== null && (!Number.isFinite(disc) || disc < 0 || disc > 100)) out.discountPercent = "El descuento debe estar entre 0 y 100.";
  return out;
}
