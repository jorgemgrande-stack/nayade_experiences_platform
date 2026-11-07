/**
 * Hotel Net · ficha de huésped y planes de tarifa — lógica pura (sin base de datos).
 *
 * Registro de viajeros (RD 933/2021): de cada persona alojada se recogen nombre y apellidos, sexo, fecha de nacimiento,
 * nacionalidad y dirección; de los mayores de 14 años, además, el documento de identidad (tipo, número y, para DNI/NIE,
 * número de soporte). Los menores van con el parentesco con el adulto que los acompaña. Este módulo valida la ficha en
 * recepción; la comunicación a las autoridades no se hace aquí.
 *
 * Planes de tarifa: ajuste sobre el precio de cada noche — `percent` en puntos básicos (−1000 = −10 %) o `fixed` en
 * céntimos por noche (+1200 = desayuno de 12 €). Sin plan, el precio de siempre.
 */

export const DOC_TYPES = ["DNI", "NIE", "PASAPORTE", "OTRO"] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const SEXES = ["H", "M", "X"] as const;

/** Edad desde la que el documento de identidad es obligatorio en el registro de viajeros. */
export const DOCUMENT_REQUIRED_AGE = 14;

export interface GuestInput {
  firstName: string | null;
  lastName: string | null;
  secondLastName?: string | null;
  sex?: string | null;
  birthDate: string | null;
  nationality: string | null;
  docType?: string | null;
  docNumber?: string | null;
  docSupportNumber?: string | null;
  docIssueDate?: string | null;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  kinship?: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Edad en años cumplidos a una fecha (YYYY-MM-DD). null si la fecha de nacimiento no es válida. */
export function ageAt(birthDate: string | null | undefined, on: string): number | null {
  if (!birthDate || !ISO.test(birthDate) || !ISO.test(on) || birthDate > on) return null;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = on.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** Normaliza un número de documento (mayúsculas, sin espacios ni guiones). */
export function normalizeDocNumber(v: string | null | undefined): string | null {
  const s = (v ?? "").toUpperCase().replace(/[\s.-]/g, "");
  return s || null;
}

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

/** ¿Es válido el DNI o NIE (letra de control)? Otros documentos no se comprueban. */
export function validSpanishId(type: string, number: string): boolean {
  const n = normalizeDocNumber(number) ?? "";
  if (type === "DNI") {
    const m = /^(\d{8})([A-Z])$/.exec(n);
    return !!m && DNI_LETTERS[Number(m[1]) % 23] === m[2];
  }
  if (type === "NIE") {
    const m = /^([XYZ])(\d{7})([A-Z])$/.exec(n);
    if (!m) return false;
    const num = Number(`${"XYZ".indexOf(m[1])}${m[2]}`);
    return DNI_LETTERS[num % 23] === m[3];
  }
  return true;
}

/**
 * Errores de la ficha para el registro de viajeros a la fecha de entrada (lista vacía = completa). La ficha se puede
 * guardar incompleta (recepción la completa después); `complete` lo indica en la interfaz.
 */
export function guestRegistryErrors(g: GuestInput, checkIn: string): string[] {
  const e: string[] = [];
  if (!g.firstName?.trim()) e.push("Falta el nombre.");
  if (!g.lastName?.trim()) e.push("Falta el primer apellido.");
  if (!g.sex) e.push("Falta el sexo.");
  if (!g.birthDate) e.push("Falta la fecha de nacimiento.");
  else if (ageAt(g.birthDate, checkIn) === null) e.push("La fecha de nacimiento no es válida.");
  if (!g.nationality?.trim()) e.push("Falta la nacionalidad.");
  const age = ageAt(g.birthDate ?? null, checkIn);
  if (age !== null && age >= DOCUMENT_REQUIRED_AGE) {
    if (!g.docType || !normalizeDocNumber(g.docNumber)) e.push("Falta el documento de identidad (obligatorio desde los 14 años).");
    else if (!validSpanishId(g.docType, g.docNumber!)) e.push(`El número de ${g.docType} no es válido.`);
    else if ((g.docType === "DNI" || g.docType === "NIE") && !g.docSupportNumber?.trim()) e.push("Falta el número de soporte del documento.");
    if (!g.address?.trim() || !g.country?.trim()) e.push("Falta la dirección (calle y país).");
  }
  if (age !== null && age < 18 && !g.kinship?.trim()) e.push("Falta el parentesco del menor con el adulto que lo acompaña.");
  return e;
}

/** Nombre para mostrar. */
export function guestDisplayName(g: { firstName: string | null; lastName: string | null; secondLastName?: string | null }): string {
  return [g.firstName, g.lastName, g.secondLastName].filter((x) => x && x.trim()).join(" ") || "Huésped sin nombre";
}

// ─── Conservación ─────────────────────────────────────────────────────────────

export const MIN_RETENTION_MONTHS = 12;
export const MAX_RETENTION_MONTHS = 240;

/** Valida el plazo de conservación: null (desactivado) o entre 12 y 240 meses. */
export function retentionError(months: number | null): string | null {
  if (months === null) return null;
  if (!Number.isInteger(months) || months < MIN_RETENTION_MONTHS || months > MAX_RETENTION_MONTHS) {
    return `El plazo de conservación debe estar entre ${MIN_RETENTION_MONTHS} y ${MAX_RETENTION_MONTHS} meses (o desactivado).`;
  }
  return null;
}

/** Fecha (YYYY-MM-DD) antes de la cual se anonimizan las fichas cuya última estancia terminó; null = no se anonimiza. */
export function retentionCutoff(months: number | null, today: string): string | null {
  if (months === null || retentionError(months) || !ISO.test(today)) return null;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

// ─── Planes de tarifa ─────────────────────────────────────────────────────────

export const ADJUST_TYPES = ["none", "percent", "fixed"] as const;
export type AdjustType = (typeof ADJUST_TYPES)[number];

export interface RatePlanAdjust {
  adjustType: string;
  adjustValue: number;
}

/** Precio de una noche (céntimos) con el ajuste del plan; nunca negativo. Sin plan, el mismo. */
export function applyPlanToNight(nightCents: number, plan: RatePlanAdjust | null | undefined): number {
  if (!plan || plan.adjustType === "none") return Math.round(nightCents);
  if (plan.adjustType === "percent") return Math.max(0, Math.round(nightCents * (1 + plan.adjustValue / 10000)));
  if (plan.adjustType === "fixed") return Math.max(0, Math.round(nightCents + plan.adjustValue));
  return Math.round(nightCents);
}

/** Total de una estancia con el plan aplicado noche a noche. */
export function applyPlanToStay(nightsCents: readonly number[], plan: RatePlanAdjust | null | undefined): number {
  return nightsCents.reduce((s, n) => s + applyPlanToNight(n, plan), 0);
}

export function ratePlanError(p: { name: string; adjustType: string; adjustValue: number }): string | null {
  if (p.name.trim().length < 2) return "Indica el nombre del plan.";
  if (!(ADJUST_TYPES as readonly string[]).includes(p.adjustType)) return "Tipo de ajuste no válido.";
  if (!Number.isInteger(p.adjustValue)) return "El ajuste debe ser un número entero.";
  if (p.adjustType === "percent" && (p.adjustValue < -9000 || p.adjustValue > 20000)) return "El ajuste porcentual debe estar entre −90 % y +200 %.";
  if (p.adjustType === "fixed" && Math.abs(p.adjustValue) > 1_000_000) return "El ajuste por noche es demasiado grande.";
  return null;
}
