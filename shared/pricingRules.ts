/**
 * Reglas de precios de la empresa (capacidad Business `pricing-rules`): descuentos y recargos que la empresa aplica a SUS
 * productos del catálogo, por porcentaje o por importe fijo, con prioridad, vigencia y condiciones.
 *
 * Motor puro: lo usan el servidor (tienda online, TPV y presupuestos, siempre recalculado allí) y el panel (formulario y
 * simulación). Nunca decide con datos del navegador.
 *
 * Orden del cálculo (documentado también en el panel):
 *   1. Precio de catálogo del producto o de la opción elegida (IVA incluido, como siempre).
 *   2. Regla de precio: cambia el precio por unidad/persona y se redondea a céntimos.
 *   3. Descuentos de siempre: descuento de línea del TPV, descuento manual y cupón (el cupón se calcula sobre el
 *      importe ya ajustado por la regla).
 *
 * Combinación: gana la regla de mayor prioridad que se cumple. Si está marcada como acumulable, se le suman en orden las
 * demás reglas acumulables que también se cumplen; una regla no acumulable nunca se combina con otra.
 *
 * Los importes fijos son por unidad (o por persona) y con IVA incluido. Lo ya cobrado o facturado no cambia: la regla se
 * aplica al crear el pedido, la venta o el presupuesto y el precio resultante queda guardado en ese documento.
 */

export const PRICING_CHANNELS = ["web", "tpv", "presupuesto"] as const;
export type PricingChannel = (typeof PRICING_CHANNELS)[number];
export const CHANNEL_LABELS: Record<PricingChannel, string> = { web: "Tienda online", tpv: "TPV", presupuesto: "Presupuestos" };

export const ADJUSTMENT_KINDS = ["descuento", "recargo"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];
export const ADJUSTMENT_LABELS: Record<AdjustmentKind, string> = { descuento: "Descuento", recargo: "Recargo" };

export const VALUE_TYPES = ["porcentaje", "importe"] as const;
export type ValueType = (typeof VALUE_TYPES)[number];
export const VALUE_TYPE_LABELS: Record<ValueType, string> = { porcentaje: "Porcentaje", importe: "Importe fijo por unidad" };

export const RULE_SCOPES = ["todo", "producto", "categoria"] as const;
export type RuleScope = (typeof RULE_SCOPES)[number];
export const SCOPE_LABELS: Record<RuleScope, string> = { todo: "Todo el catálogo", producto: "Productos concretos", categoria: "Categorías" };

/** 1 = lunes … 7 = domingo (ISO). */
export const WEEKDAY_LABELS: Record<number, string> = { 1: "Lunes", 2: "Martes", 3: "Miércoles", 4: "Jueves", 5: "Viernes", 6: "Sábado", 7: "Domingo" };

export const RULE_NAME_MAX = 80;
export const RULES_MAX = 200;
export const TARGETS_MAX = 100;
export const MAX_PERCENT_DISCOUNT = 100;
export const MAX_PERCENT_SURCHARGE = 500;
export const MAX_AMOUNT = 100000;
export const MAX_MIN_QUANTITY = 10000;

export const PRICING_ORDER_NOTE =
  "Primero el precio de catálogo o de la opción, después la regla de precio y por último los descuentos de siempre (descuento de línea, descuento manual y cupón, que se calcula sobre el importe ya ajustado). Importes con IVA incluido.";

export interface RuleForm {
  name: string;
  active: boolean;
  kind: AdjustmentKind;
  valueType: ValueType;
  value: number;
  scope: RuleScope;
  targetIds: number[];
  minQuantity: number;
  weekdays: number[];
  channels: PricingChannel[];
  /** Vigencia de la regla (fecha de la operación, AAAA-MM-DD, ambas incluidas). */
  validFrom: string | null;
  validTo: string | null;
  /** Franja de fechas del servicio (fecha de la actividad; sin fecha, la de la operación). */
  serviceFrom: string | null;
  serviceTo: string | null;
  combinable: boolean;
}

export interface PricingRule extends RuleForm {
  id: number;
  /** 1 = la primera en aplicarse. */
  priority: number;
}

export interface PriceLineInput {
  productId: number;
  categoryId: number | null;
  /** Precio por unidad o persona antes de la regla (catálogo u opción). */
  unitPrice: number;
  /** Unidades o personas de la línea (condición de cantidad mínima). */
  quantity: number;
  /** Fecha del servicio (AAAA-MM-DD), si la línea la tiene. */
  serviceDate?: string | null;
}

export interface PriceContext {
  channel: PricingChannel;
  /** Fecha de la operación en Europe/Madrid (AAAA-MM-DD). */
  today: string;
}

export interface AppliedRule {
  id: number;
  name: string;
}

export interface PricedLine {
  baseUnitPrice: number;
  unitPrice: number;
  applied: AppliedRule[];
}

export interface RuleCheck {
  id: number;
  name: string;
  applies: boolean;
  reason: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Día de la semana ISO (1 = lunes … 7 = domingo) de una fecha AAAA-MM-DD. */
export function isoWeekday(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Fecha de calendario (AAAA-MM-DD) en Europe/Madrid. */
export function madridToday(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(at);
}

/** Redondeo a céntimos, simétrico (medio céntimo se aleja de cero), como el resto de importes del Core. */
export function roundCents(n: number): number {
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(n) * 100 + 1e-9)) / 100;
}

/** Orden de aplicación: prioridad (1 primero) y, a igualdad, la más antigua. */
export function sortRules<T extends Pick<PricingRule, "priority" | "id">>(rules: T[]): T[] {
  return [...rules].sort((a, b) => a.priority - b.priority || a.id - b.id);
}

/** ¿Se cumple la regla para esta línea? Con el motivo, para la simulación del panel. */
export function checkRule(rule: PricingRule, line: PriceLineInput, ctx: PriceContext): RuleCheck {
  const out = (applies: boolean, reason: string): RuleCheck => ({ id: rule.id, name: rule.name, applies, reason });
  if (!rule.active) return out(false, "Está desactivada");
  if (!rule.channels.includes(ctx.channel)) return out(false, `No se aplica en ${CHANNEL_LABELS[ctx.channel].toLowerCase()}`);
  if (rule.validFrom && ctx.today < rule.validFrom) return out(false, "Aún no está vigente");
  if (rule.validTo && ctx.today > rule.validTo) return out(false, "Su vigencia ha terminado");
  if (rule.scope === "producto" && !rule.targetIds.includes(line.productId)) return out(false, "No incluye este producto");
  if (rule.scope === "categoria" && (line.categoryId == null || !rule.targetIds.includes(line.categoryId))) return out(false, "No incluye la categoría de este producto");
  if (line.quantity < rule.minQuantity) return out(false, `Pide al menos ${rule.minQuantity} unidades`);
  const serviceDate = line.serviceDate && isDateKey(line.serviceDate) ? line.serviceDate : ctx.today;
  if (rule.serviceFrom && serviceDate < rule.serviceFrom) return out(false, "La fecha del servicio es anterior a la franja");
  if (rule.serviceTo && serviceDate > rule.serviceTo) return out(false, "La fecha del servicio es posterior a la franja");
  if (rule.weekdays.length > 0 && !rule.weekdays.includes(isoWeekday(serviceDate))) return out(false, `No se aplica en ${WEEKDAY_LABELS[isoWeekday(serviceDate)].toLowerCase()}`);
  return out(true, "Se cumple");
}

/** Precio por unidad tras una regla, redondeado a céntimos y nunca negativo. */
export function adjustUnitPrice(price: number, rule: Pick<PricingRule, "kind" | "valueType" | "value">): number {
  const delta = rule.valueType === "porcentaje" ? (price * rule.value) / 100 : rule.value;
  const next = rule.kind === "descuento" ? price - delta : price + delta;
  return Math.max(0, roundCents(next));
}

/** Reglas que se aplican a la línea, en orden, según la política de combinación. */
export function rulesToApply(rules: PricingRule[], line: PriceLineInput, ctx: PriceContext): PricingRule[] {
  const candidates = sortRules(rules).filter((r) => checkRule(r, line, ctx).applies);
  const [top] = candidates;
  if (!top) return [];
  return top.combinable ? candidates.filter((r) => r.combinable) : [top];
}

/** Precio de una línea con las reglas de la empresa. Sin reglas que se cumplan, el precio queda exactamente igual. */
export function priceLine(rules: PricingRule[], line: PriceLineInput, ctx: PriceContext): PricedLine {
  const chosen = rulesToApply(rules, line, ctx);
  if (chosen.length === 0 || !(line.unitPrice > 0)) return { baseUnitPrice: line.unitPrice, unitPrice: line.unitPrice, applied: [] };
  let unit = line.unitPrice;
  for (const r of chosen) unit = adjustUnitPrice(unit, r);
  return { baseUnitPrice: line.unitPrice, unitPrice: unit, applied: chosen.map((r) => ({ id: r.id, name: r.name })) };
}

/** Diferencia de una línea (positiva = ahorro, negativa = recargo) dados los totales antes y después. */
export function lineSavings(baseTotal: number, finalTotal: number): number {
  return roundCents(baseTotal - finalTotal);
}

/** Nota que acompaña a la línea guardada (venta o presupuesto) para saber de dónde sale su precio. */
export function appliedRuleNote(priced: PricedLine): string | null {
  if (priced.applied.length === 0) return null;
  const names = priced.applied.map((r) => r.name).join(" + ");
  return `Regla de precio: ${names} (precio de catálogo ${priced.baseUnitPrice.toFixed(2).replace(".", ",")} €)`;
}

// ─── Formulario ──────────────────────────────────────────────────────────────

export function emptyRuleForm(): RuleForm {
  return {
    name: "", active: true, kind: "descuento", valueType: "porcentaje", value: 10, scope: "todo", targetIds: [], minQuantity: 1,
    weekdays: [], channels: [...PRICING_CHANNELS], validFrom: null, validTo: null, serviceFrom: null, serviceTo: null, combinable: false,
  };
}

export function normalizeRuleName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export type RuleFormErrors = Partial<Record<keyof RuleForm, string>>;

export function validateRuleForm(form: RuleForm): RuleFormErrors {
  const e: RuleFormErrors = {};
  const name = normalizeRuleName(form.name);
  if (!name) e.name = "Ponle un nombre a la regla.";
  else if (name.length > RULE_NAME_MAX) e.name = `El nombre admite como máximo ${RULE_NAME_MAX} caracteres.`;
  if (!Number.isFinite(form.value) || form.value <= 0) e.value = "Indica un valor mayor que cero.";
  else if (form.valueType === "porcentaje" && form.kind === "descuento" && form.value > MAX_PERCENT_DISCOUNT) e.value = "Un descuento no puede superar el 100 %.";
  else if (form.valueType === "porcentaje" && form.kind === "recargo" && form.value > MAX_PERCENT_SURCHARGE) e.value = `Un recargo no puede superar el ${MAX_PERCENT_SURCHARGE} %.`;
  else if (form.valueType === "importe" && form.value > MAX_AMOUNT) e.value = "El importe es demasiado alto.";
  else if (roundCents(form.value) !== form.value) e.value = "Usa como máximo dos decimales.";
  if (form.scope !== "todo") {
    if (form.targetIds.length === 0) e.targetIds = form.scope === "producto" ? "Elige al menos un producto." : "Elige al menos una categoría.";
    else if (form.targetIds.length > TARGETS_MAX) e.targetIds = `Como máximo ${TARGETS_MAX} elementos por regla.`;
  }
  if (!Number.isInteger(form.minQuantity) || form.minQuantity < 1 || form.minQuantity > MAX_MIN_QUANTITY) e.minQuantity = "La cantidad mínima es un número entero desde 1.";
  if (form.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) e.weekdays = "Día de la semana no válido.";
  if (form.channels.length === 0) e.channels = "Elige al menos un canal.";
  for (const k of ["validFrom", "validTo", "serviceFrom", "serviceTo"] as const) {
    if (form[k] != null && !isDateKey(form[k])) e[k] = "Fecha no válida.";
  }
  if (!e.validTo && form.validFrom && form.validTo && form.validFrom > form.validTo) e.validTo = "La vigencia termina antes de empezar.";
  if (!e.serviceTo && form.serviceFrom && form.serviceTo && form.serviceFrom > form.serviceTo) e.serviceTo = "La franja termina antes de empezar.";
  return e;
}

/** Forma canónica que se guarda: nombre limpio, listas sin duplicados y ordenadas. */
export function normalizeRuleForm(form: RuleForm): RuleForm {
  const uniq = (xs: number[]) => Array.from(new Set(xs)).sort((a, b) => a - b);
  return {
    ...form,
    name: normalizeRuleName(form.name),
    targetIds: form.scope === "todo" ? [] : uniq(form.targetIds),
    weekdays: uniq(form.weekdays),
    channels: PRICING_CHANNELS.filter((c) => form.channels.includes(c)),
    validFrom: form.validFrom || null,
    validTo: form.validTo || null,
    serviceFrom: form.serviceFrom || null,
    serviceTo: form.serviceTo || null,
  };
}

/** Resumen corto de lo que hace una regla («−10 %», «+5,00 € por unidad»). */
export function describeAdjustment(rule: Pick<PricingRule, "kind" | "valueType" | "value">): string {
  const sign = rule.kind === "descuento" ? "−" : "+";
  const v = rule.value.toLocaleString("es-ES", { minimumFractionDigits: rule.valueType === "importe" ? 2 : 0, maximumFractionDigits: 2 });
  return rule.valueType === "porcentaje" ? `${sign}${v} %` : `${sign}${v} € por unidad`;
}

export interface CartLineEstimate {
  baseUnitPrice: number;
  unitPrice: number;
  baseTotal: number;
  total: number;
  /** Positivo = ahorro; negativo = suplemento. */
  savings: number;
  rules: string[];
}

/**
 * Estimación para el carrito de la tienda (solo presentación; el servidor recalcula al pagar): la línea sin extras se
 * escala por la proporción entre el precio con reglas y el de catálogo, lo que respeta la tarificación por persona o
 * por unidad. `null` si no se aplica ninguna regla.
 */
export function estimateCartLine(
  rules: PricingRule[],
  input: { productId: number; categoryId: number | null; unitPrice: number; quantity: number; serviceDate?: string | null; lineTotal: number },
  today: string,
): CartLineEstimate | null {
  if (!(input.unitPrice > 0) || !(input.lineTotal > 0)) return null;
  const priced = priceLine(rules, { productId: input.productId, categoryId: input.categoryId, unitPrice: input.unitPrice, quantity: input.quantity, serviceDate: input.serviceDate ?? null }, { channel: "web", today });
  if (priced.applied.length === 0) return null;
  const baseTotal = roundCents(input.lineTotal);
  const total = roundCents((input.lineTotal * priced.unitPrice) / input.unitPrice);
  return { baseUnitPrice: input.unitPrice, unitPrice: priced.unitPrice, baseTotal, total, savings: roundCents(baseTotal - total), rules: priced.applied.map((r) => r.name) };
}
