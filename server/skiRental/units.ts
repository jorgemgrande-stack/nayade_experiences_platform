/**
 * Ski Net · Alquiler v1 por unidad (lógica pura, sin BD): tipos de material configurables, máquina de estados de la
 * unidad (portada del origen `rentalAssetStateMachine`), compatibilidad unidad ↔ lo pedido, horarios de tienda,
 * códigos de unidad y contrato (plantilla neutra, texto configurable por empresa y huella SHA-256 del contenido).
 */
import { createHash } from "node:crypto";

export interface CodeLabel {
  code: string;
  label: string;
}

export class UnitRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnitRuleError";
  }
}

/** Plantilla por defecto de tipos de material (cada sede la cambia). */
export const DEFAULT_ASSET_TYPES: CodeLabel[] = [
  { code: "ski", label: "Esquís" },
  { code: "snowboard", label: "Snowboard" },
  { code: "boots", label: "Botas de esquí" },
  { code: "snowboard_boots", label: "Botas de snowboard" },
  { code: "poles", label: "Bastones" },
  { code: "helmet", label: "Casco" },
];

const TYPE_CODE_RE = /^[a-z][a-z0-9_]{0,23}$/;

export function normalizeAssetTypes(list: CodeLabel[] | null | undefined): CodeLabel[] {
  const src = list ?? DEFAULT_ASSET_TYPES;
  if (!Array.isArray(src) || src.length === 0) throw new UnitRuleError("Tipos de material: indica al menos uno");
  if (src.length > 30) throw new UnitRuleError("Tipos de material: como mucho 30");
  const seen = new Set<string>();
  return src.map((t) => {
    const code = String(t?.code ?? "").trim().toLowerCase();
    const label = String(t?.label ?? "").trim();
    if (!TYPE_CODE_RE.test(code)) throw new UnitRuleError(`Tipo de material: código no válido (${code || "vacío"}); minúsculas, cifras y «_»`);
    if (seen.has(code)) throw new UnitRuleError(`Tipo de material: código repetido (${code})`);
    seen.add(code);
    if (label.length < 1 || label.length > 60) throw new UnitRuleError(`Tipo de material: nombre no válido para ${code}`);
    return { code, label };
  });
}

// ── Máquina de estados de la unidad ─────────────────────────────────────────────

export const UNIT_STATUSES = ["available", "rented", "workshop", "incident", "retired"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];
export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = { available: "Disponible", rented: "Alquilada", workshop: "En taller", incident: "Incidencia", retired: "Retirada" };

export const UNIT_TRANSITIONS: Record<UnitStatus, UnitStatus[]> = {
  // Alta inicial, o vuelta desde cualquier estado que ya haya resuelto su ciclo
  available: ["rented", "workshop", "incident", "retired"],
  // En la calle: solo vuelve (devolución normal) o queda con incidencia (daño o pérdida); nunca va directa al taller
  rented: ["available", "incident"],
  workshop: ["available", "incident", "retired"],
  incident: ["available", "workshop", "retired"],
  // Terminal
  retired: [],
};

/** El mismo estado no es una transición (evita eventos vacíos). */
export function isValidUnitTransition(from: UnitStatus, to: UnitStatus): boolean {
  if (from === to) return false;
  return UNIT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertUnitTransition(from: UnitStatus, to: UnitStatus): void {
  if (!isValidUnitTransition(from, to)) throw new UnitRuleError(`La unidad no puede pasar de «${UNIT_STATUS_LABEL[from]}» a «${UNIT_STATUS_LABEL[to]}»`);
}

/** Cambios manuales permitidos desde el inventario (los demás los hacen la entrega, la devolución y el taller). */
export const MANUAL_TARGETS: readonly UnitStatus[] = ["available", "incident", "retired"];

// ── Compatibilidad en la entrega ────────────────────────────────────────────────

export interface Compatibility {
  /** Bloqueante: nunca se entregan unas botas cuando se piden esquís. */
  typeMatches: boolean;
  /** No bloquea, pero exige confirmación con motivo. */
  sizeMatches: boolean;
}

const normSize = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, "");

export function checkCompatibility(unit: { assetType: string; size: string | null }, wanted: { assetType: string; size: string | null }): Compatibility {
  return {
    typeMatches: unit.assetType === wanted.assetType,
    sizeMatches: !normSize(wanted.size) || normSize(unit.size) === normSize(wanted.size),
  };
}

/** Lanza si la unidad no es del tipo pedido, o si la talla difiere sin confirmación y motivo. */
export function assertCompatible(unit: { code: string; assetType: string; size: string | null }, wanted: { assetType: string; size: string | null; confirmSize?: boolean; reason?: string | null }): Compatibility {
  const c = checkCompatibility(unit, wanted);
  if (!c.typeMatches) throw new UnitRuleError(`La unidad ${unit.code} es de otro tipo de material (${unit.assetType}, se pidió ${wanted.assetType})`);
  if (!c.sizeMatches && !(wanted.confirmSize && (wanted.reason ?? "").trim().length >= 3)) {
    throw new UnitRuleError(`La talla de ${unit.code} (${unit.size ?? "sin talla"}) no coincide con la pedida (${wanted.size}): confírmalo e indica el motivo`);
  }
  return c;
}

// ── Tiendas y horarios ──────────────────────────────────────────────────────────

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const toMinutes = (t: string) => {
  if (!TIME_RE.test(t)) throw new UnitRuleError(`Hora no válida: ${t}`);
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
};

export interface StoreHours {
  openingTime: string;
  closingTime: string;
  /** A partir de esta hora del día de devolución, la devolución es tardía. */
  overdueReturnTime: string;
}

export function checkStoreHours(h: StoreHours): void {
  const o = toMinutes(h.openingTime);
  const c = toMinutes(h.closingTime);
  const d = toMinutes(h.overdueReturnTime);
  if (c <= o) throw new UnitRuleError("La hora de cierre debe ser posterior a la de apertura");
  if (d < o || d > c) throw new UnitRuleError("La hora límite de devolución debe estar dentro del horario de la tienda");
}

export function isWithinOperatingHours(nowMinutes: number, h: StoreHours): boolean {
  return nowMinutes >= toMinutes(h.openingTime) && nowMinutes < toMinutes(h.closingTime);
}

/** Devolución tardía: después del día previsto, o ese día a partir de la hora límite de la tienda. */
export function isReturnLate(expectedDate: string, now: { date: string; minutes: number }, h: StoreHours): boolean {
  if (now.date > expectedDate) return true;
  return now.date === expectedDate && now.minutes >= toMinutes(h.overdueReturnTime);
}

// ── Códigos de unidad ───────────────────────────────────────────────────────────

export const UNIT_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,39}$/;

/** Código legible y escaneable (es el contenido del QR o código de barras de la etiqueta). */
export function normalizeUnitCode(raw: string): string {
  const c = raw.trim().toUpperCase().replace(/\s+/g, "-");
  if (!UNIT_CODE_RE.test(c)) throw new UnitRuleError("Código de unidad no válido: letras, cifras y guiones (2 a 40)");
  return c;
}

/** Código automático: prefijo del tipo + correlativo de la sede (ESQ-00012). */
export function autoUnitCode(assetType: string, seq: number): string {
  const prefix = assetType.replace(/[^a-z0-9]/g, "").slice(0, 4).toUpperCase() || "MAT";
  return `${prefix}-${String(seq).padStart(5, "0")}`;
}

// ── Contrato ────────────────────────────────────────────────────────────────────

/** Plantilla neutra (sin empresa ni jurisdicción). Cada empresa la sustituye por la suya en los ajustes de la sede. */
export const NEUTRAL_CONTRACT_TERMS = [
  "El cliente recibe el material indicado en este contrato en buen estado de uso y se compromete a utilizarlo de forma adecuada.",
  "El cliente se compromete a devolverlo en la tienda en la fecha y hora acordadas y a abonar el importe que corresponda en caso de pérdida, robo o daño distinto del desgaste normal por su uso correcto.",
  "El material de seguridad (fijaciones, cascos) se ajusta según los datos facilitados por el cliente, que declara que son ciertos. El cliente conoce y acepta los riesgos propios de la práctica deportiva.",
  "Los datos personales se tratan solo para gestionar este alquiler, conforme a la política de privacidad de la empresa.",
].join("\n\n");

export const MAX_TERMS_LENGTH = 20_000;

export function normalizeTerms(text: string | null | undefined): string {
  const t = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!t) return NEUTRAL_CONTRACT_TERMS;
  if (t.length < 40) throw new UnitRuleError("El texto del contrato es demasiado corto");
  if (t.length > MAX_TERMS_LENGTH) throw new UnitRuleError(`El texto del contrato no puede superar ${MAX_TERMS_LENGTH} caracteres`);
  return t;
}

export interface ContractContent {
  deliveryId: number;
  siteId: string;
  storeName: string;
  customerName: string;
  startDate: string;
  expectedReturnDate: string;
  lines: Array<{ code: string; assetType: string; model: string; size: string | null }>;
  termsVersion: number;
  terms: string;
}

/** Serialización canónica (claves ordenadas): la misma entrada da siempre el mismo texto y la misma huella. */
export function canonicalContract(c: ContractContent): string {
  const sortKeys = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(sortKeys(c));
}

export function contractHash(c: ContractContent): string {
  return createHash("sha256").update(canonicalContract(c)).digest("hex");
}

/** Evidencia de la firma por clic: nombre escrito, aceptación expresa, IP y navegador, ligados a la huella del contenido. */
export function checkSignature(input: { signerName: string; accepted: boolean }): string {
  const name = input.signerName.trim().replace(/\s+/g, " ");
  if (!input.accepted) throw new UnitRuleError("El cliente debe aceptar las condiciones para firmar");
  if (name.length < 2 || name.length > 120) throw new UnitRuleError("Escribe el nombre de quien firma");
  return name;
}
