/**
 * Condiciones comerciales personalizadas por cliente (acuerdo negociado de una suscripción).
 * Diseño: docs/elephant-source/CONDICIONES_PERSONALIZADAS.md.
 *
 * Un ACUERDO (`Terms`) es una versión inmutable, una vez activada, de lo pactado con una empresa: qué partidas
 * incluye (productos del catálogo y conceptos a medida), a qué precio (individual por partida o cuota global), con
 * qué ajustes (descuentos y recargos), durante cuánto tiempo y cómo se le presenta al cliente.
 *
 * Reglas que no se negocian:
 *  - los derechos (licencias) salen de los PRODUCTOS de catálogo incluidos, nunca del importe; una partida a medida
 *    (`custom`) no lleva producto, referencia de activación ni capacidad alguna;
 *  - el precio oficial se guarda como REFERENCIA (instantánea): ni el acuerdo modifica el catálogo ni el catálogo
 *    modifica el acuerdo;
 *  - todo importe es un entero de céntimos, NETO (sin impuestos); el impuesto se calcula por tipo.
 */
export type TermsStatus = "draft" | "pending_acceptance" | "scheduled" | "active" | "superseded" | "cancelled" | "expired";
export type PricingMode = "per_item" | "global";
export type Presentation = "global" | "breakdown";
export type TermsInterval = "month" | "year";
/** Cuota recurrente, pago inicial (implantación, formación, migración) o trabajo extraordinario (desarrollo, servicio puntual). */
export type ChargeClass = "recurring" | "initial" | "extraordinary";
export type LineKind = "catalog" | "custom";
export const CONCEPTS = ["core_plan", "net", "connect", "connector", "whatsapp", "implementation", "maintenance", "support", "development", "integration", "professional_service", "other"] as const;
export type Concept = (typeof CONCEPTS)[number];
/**
 * Qué ocurre al vencer una condición temporal:
 *  - `official_snapshot`: tarifa oficial fijada al pactar (la que figura en el contrato);
 *  - `official_current`: tarifa oficial vigente en la fecha del cambio (se lee el catálogo ese día y se registra el importe);
 *  - `next_terms`: otra condición ya programada (`nextTermsId`).
 */
export type AfterEnd = "official_snapshot" | "official_current" | "next_terms";

/** Instantánea del producto de catálogo de una partida (la rellena SIEMPRE el servidor a partir del catálogo). */
export interface CatalogSnapshot {
  family: "core_plan" | "extension" | "industry_module" | "usage" | "service";
  activationKind: string;
  activationRef: string | null;
  lineKind: "plan" | "module" | "quantity" | "service";
  metric: string | null;
}

export interface TermsLine {
  id: number;
  kind: LineKind;
  concept: Concept;
  /** Solo en partidas de catálogo. */
  productKey: string | null;
  /** Versión de precio oficial de referencia (web_prices.id); solo catálogo. */
  priceId: number | null;
  catalog: CatalogSnapshot | null;
  name: string;
  description: string | null;
  /** Condiciones particulares de la partida. */
  conditions: string | null;
  chargeClass: ChargeClass;
  quantity: number;
  /** Precio oficial unitario NETO al pactar (referencia). Null en partidas a medida. */
  officialUnitCents: number | null;
  /**
   * Precio unitario NETO negociado. Null = el oficial. En una partida a medida es obligatorio (es su precio y, con
   * cuota global, su valor de referencia para la asignación interna).
   */
  negotiatedUnitCents: number | null;
  taxRateBp: number;
  /** Inicio propio (ms UTC). Null = el del acuerdo. En un cargo único es la fecha del cargo. */
  startsAt: number | null;
  /** Fin propio (ms UTC) de una partida recurrente. Null = sin fin propio. */
  endsAt: number | null;
  sort: number;
}

export interface Adjustment {
  id: number;
  /** Partida a la que se aplica; null = a todo el acuerdo (recurrente). */
  lineId: number | null;
  type: "discount" | "surcharge";
  mode: "percent" | "amount";
  /** Puntos básicos (1 % = 100) o céntimos (por periodo si es recurrente). */
  value: number;
  /** Recurrente (en cada periodo mientras esté vigente) o de un solo uso. */
  recurrence: "recurring" | "once";
  /** Fin (ms UTC) de un ajuste recurrente; null = mientras dure el acuerdo. */
  endsAt: number | null;
  note: string | null;
}

export interface Terms {
  id: number;
  companyId: number;
  /** Null = borrador de paquete para una contratación nueva. */
  subscriptionId: number | null;
  versionNo: number;
  status: TermsStatus;
  pricingMode: PricingMode;
  /** Cuota global NETA por periodo de las partidas recurrentes (modo `global`). */
  globalAmountCents: number | null;
  interval: TermsInterval;
  currency: string;
  presentation: Presentation;
  packageName: string | null;
  /** Condiciones especiales del acuerdo (texto para el contrato). */
  conditions: string | null;
  effectiveFrom: number | null;
  /** Null = indefinido. */
  effectiveTo: number | null;
  afterEnd: AfterEnd | null;
  nextTermsId: number | null;
  requiresAcceptance: boolean;
  lines: TermsLine[];
  adjustments: Adjustment[];
}

const MAX_CENTS = 100_000_000;
const int = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export const isRecurring = (l: Pick<TermsLine, "chargeClass">) => l.chargeClass === "recurring";

/**
 * Coherencia interna de un acuerdo (sin catálogo ni BD). Devuelve los problemas en español; vacío = válido.
 * Lo que depende del catálogo (producto contratable, composición, cantidad según el ámbito) lo comprueba el servicio.
 */
export function validateTerms(t: Pick<Terms, "pricingMode" | "globalAmountCents" | "effectiveFrom" | "effectiveTo" | "afterEnd" | "nextTermsId" | "lines" | "adjustments" | "currency">): string[] {
  const out: string[] = [];
  if (!/^[A-Z]{3}$/.test(t.currency)) out.push("Moneda no válida");
  if (!t.lines.length) out.push("El acuerdo no tiene partidas");
  if (new Set(t.lines.map((l) => l.id)).size !== t.lines.length) out.push("Partidas repetidas");
  const recurring = t.lines.filter(isRecurring);
  for (const l of t.lines) {
    const n = `«${l.name || "partida"}»`;
    if (!l.name?.trim()) out.push("Toda partida necesita un nombre comercial");
    if (!CONCEPTS.includes(l.concept)) out.push(`${n}: tipo de concepto no válido`);
    if (!int(l.quantity, 1, 10_000)) out.push(`${n}: cantidad entre 1 y 10.000`);
    if (!int(l.taxRateBp, 0, 10_000)) out.push(`${n}: tipo de impuesto no válido`);
    if (l.officialUnitCents !== null && !int(l.officialUnitCents, 0, MAX_CENTS)) out.push(`${n}: precio oficial no válido`);
    if (l.negotiatedUnitCents !== null && !int(l.negotiatedUnitCents, 0, MAX_CENTS)) out.push(`${n}: precio negociado no válido (céntimos enteros, sin negativos)`);
    if (l.kind === "custom") {
      // Una partida a medida es solo económica: nunca concede licencias
      if (l.productKey !== null || l.priceId !== null || l.catalog !== null) out.push(`${n}: una partida a medida no puede llevar producto, precio de catálogo ni activación`);
      if (l.officialUnitCents !== null) out.push(`${n}: una partida a medida no tiene precio oficial`);
      if (l.negotiatedUnitCents === null) out.push(`${n}: indica el precio de la partida a medida`);
      if (l.concept === "core_plan") out.push(`${n}: un plan Core solo puede ser un producto del catálogo`);
    } else {
      if (!l.productKey || !l.catalog) out.push(`${n}: una partida de catálogo necesita su producto`);
      if (l.officialUnitCents === null) out.push(`${n}: falta el precio oficial de referencia`);
    }
    if (isRecurring(l)) {
      if (l.endsAt !== null && l.endsAt <= (l.startsAt ?? t.effectiveFrom ?? 0)) out.push(`${n}: la fecha de fin debe ser posterior al inicio`);
      if (t.pricingMode === "global" && (l.startsAt !== null || l.endsAt !== null)) out.push(`${n}: con cuota global las partidas recurrentes comparten la vigencia del acuerdo`);
    } else {
      if (l.endsAt !== null) out.push(`${n}: un cargo único no tiene fecha de fin`);
      if (l.kind === "catalog" && l.catalog?.family === "core_plan") out.push(`${n}: un plan Core es siempre una cuota recurrente`);
    }
    if (l.startsAt !== null && t.effectiveFrom !== null && l.startsAt < t.effectiveFrom) out.push(`${n}: no puede empezar antes que el acuerdo`);
    if (l.startsAt !== null && t.effectiveTo !== null && l.startsAt >= t.effectiveTo) out.push(`${n}: empieza después del fin del acuerdo`);
  }
  if (recurring.filter((l) => l.catalog?.family === "core_plan").length > 1) out.push("Solo puede haber un plan Core");
  if (t.pricingMode === "global") {
    if (t.globalAmountCents === null || !int(t.globalAmountCents, 0, MAX_CENTS)) out.push("Indica la cuota global (céntimos enteros, sin negativos)");
    if (!recurring.length) out.push("Una cuota global necesita al menos una partida recurrente");
  } else if (t.globalAmountCents !== null) out.push("La cuota global solo se indica en el modo de precio global");
  if (t.effectiveTo !== null) {
    if (t.effectiveFrom !== null && t.effectiveTo <= t.effectiveFrom) out.push("El fin de la vigencia debe ser posterior al inicio");
    if (!t.afterEnd) out.push("Una condición temporal debe indicar qué ocurre al vencer");
    if (t.afterEnd === "next_terms" && t.nextTermsId === null) out.push("Falta la condición programada que sustituye a esta al vencer");
  } else if (t.afterEnd) out.push("Una condición indefinida no tiene «qué ocurre al vencer»");
  if (t.afterEnd !== "next_terms" && t.nextTermsId !== null) out.push("La condición siguiente solo se indica cuando al vencer se aplica otra condición programada");
  if (new Set(t.adjustments.map((a) => a.id)).size !== t.adjustments.length) out.push("Ajustes repetidos");
  for (const a of t.adjustments) {
    const line = a.lineId === null ? null : t.lines.find((l) => l.id === a.lineId);
    if (a.lineId !== null && !line) {
      out.push("Un ajuste apunta a una partida que no existe");
      continue;
    }
    if (a.mode === "percent") {
      if (!int(a.value, 1, a.type === "discount" ? 10_000 : 100_000)) out.push(a.type === "discount" ? "Descuento porcentual entre 0,01 % y 100 %" : "Recargo porcentual entre 0,01 % y 1.000 %");
    } else if (!int(a.value, 1, MAX_CENTS)) out.push("Importe del ajuste no válido (céntimos enteros, mayor que cero)");
    if (a.recurrence === "once" && a.endsAt !== null) out.push("Un ajuste de un solo uso no tiene fecha de fin");
    if (a.recurrence === "recurring" && line && !isRecurring(line)) out.push(`«${line.name}»: un cargo único solo admite ajustes de un solo uso`);
    if (a.recurrence === "recurring" && a.lineId === null && !recurring.length) out.push("Un ajuste recurrente global necesita partidas recurrentes");
    if (a.endsAt !== null && t.effectiveFrom !== null && a.endsAt <= t.effectiveFrom) out.push("Un ajuste no puede terminar antes de empezar el acuerdo");
  }
  return Array.from(new Set(out));
}
