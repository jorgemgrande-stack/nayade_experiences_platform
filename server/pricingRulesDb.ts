/**
 * Reglas de precios de la empresa (capacidad Business `pricing-rules`): gestión de las reglas y su aplicación en el
 * servidor a la tienda online, al TPV y a los presupuestos (motor puro en shared/pricingRules.ts).
 *
 * Todo vive en la BD de la empresa en curso (`getDb()` resuelve la del tenant): una empresa nunca lee ni aplica las
 * reglas de otra. Tabla de db/migrations/0023_pricing_rules (fuera de drizzle/schema.ts, como la 0021).
 *
 * Aplicación: solo con la capacidad activa. Sin ella (Essential), sin poder verificar la licencia o sin la migración
 * aplicada, no hay reglas y el precio es exactamente el de siempre: nunca se rompe un cobro por las reglas.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { date, decimal, int, mysqlTable, text, tinyint, varchar } from "drizzle-orm/mysql-core";
import { experiences } from "../drizzle/schema";
import { getDb } from "./db";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { opsLog } from "./_core/ops/log";
import {
  ADJUSTMENT_KINDS, PRICING_CHANNELS, RULES_MAX, appliedRuleNote, RULE_SCOPES, VALUE_TYPES, checkRule, madridToday, normalizeRuleForm, priceLine,
  sortRules, validateRuleForm,
  type AdjustmentKind, type PriceLineInput, type PricedLine, type PricingChannel, type PricingRule, type RuleCheck, type RuleForm, type RuleScope, type ValueType,
} from "../shared/pricingRules";

export const PRICING_RULES_CAPABILITY = "pricing-rules";

export const pricingRules = mysqlTable("pricing_rules", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  active: tinyint("active").notNull(),
  priority: int("priority").notNull(),
  kind: varchar("kind", { length: 16 }).notNull(),
  valueType: varchar("value_type", { length: 16 }).notNull(),
  value: decimal("value", { precision: 10, scale: 2 }).notNull(),
  scope: varchar("scope", { length: 16 }).notNull(),
  targetIds: text("target_ids"),
  minQuantity: int("min_quantity").notNull(),
  weekdays: varchar("weekdays", { length: 16 }),
  channels: varchar("channels", { length: 64 }).notNull(),
  validFrom: date("valid_from", { mode: "string" }),
  validTo: date("valid_to", { mode: "string" }),
  serviceFrom: date("service_from", { mode: "string" }),
  serviceTo: date("service_to", { mode: "string" }),
  combinable: tinyint("combinable").notNull(),
});

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function requireDb(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return db;
}

const errCode = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.cause?.code ?? err?.code;
};
const missingTable = (e: unknown) => errCode(e) === "ER_NO_SUCH_TABLE";

/** Sin la migración 0023 aplicada en esta empresa: aviso claro en lugar de un error interno. */
function notReady(e: unknown): never {
  if (missingTable(e))
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Las reglas de precios aún no están preparadas en tu empresa. Inténtalo de nuevo en unos minutos." });
  throw e;
}

const ids = (v: string | null): number[] => (v ? v.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0) : []);
const pick = <T extends string>(list: readonly T[], v: string, fallback: T): T => ((list as readonly string[]).includes(v) ? (v as T) : fallback);
const dateKey = (v: string | null): string | null => (v ? String(v).slice(0, 10) : null);

export function toRule(r: typeof pricingRules.$inferSelect): PricingRule {
  return {
    id: r.id,
    name: r.name,
    active: Number(r.active) === 1,
    priority: r.priority,
    kind: pick<AdjustmentKind>(ADJUSTMENT_KINDS, r.kind, "descuento"),
    valueType: pick<ValueType>(VALUE_TYPES, r.valueType, "porcentaje"),
    value: Number(r.value),
    scope: pick<RuleScope>(RULE_SCOPES, r.scope, "todo"),
    targetIds: ids(r.targetIds),
    minQuantity: r.minQuantity,
    weekdays: ids(r.weekdays).filter((d) => d <= 7),
    channels: r.channels.split(",").map((s) => s.trim()).filter((c): c is PricingChannel => (PRICING_CHANNELS as readonly string[]).includes(c)),
    validFrom: dateKey(r.validFrom),
    validTo: dateKey(r.validTo),
    serviceFrom: dateKey(r.serviceFrom),
    serviceTo: dateKey(r.serviceTo),
    combinable: Number(r.combinable) === 1,
  };
}

function toRow(form: RuleForm) {
  return {
    name: form.name,
    active: form.active ? 1 : 0,
    kind: form.kind,
    valueType: form.valueType,
    value: form.value.toFixed(2),
    scope: form.scope,
    targetIds: form.targetIds.length ? form.targetIds.join(",") : null,
    minQuantity: form.minQuantity,
    weekdays: form.weekdays.length ? form.weekdays.join(",") : null,
    channels: form.channels.join(","),
    validFrom: form.validFrom,
    validTo: form.validTo,
    serviceFrom: form.serviceFrom,
    serviceTo: form.serviceTo,
    combinable: form.combinable ? 1 : 0,
  };
}

function checkedForm(form: RuleForm): RuleForm {
  const clean = normalizeRuleForm(form);
  const errs = validateRuleForm(clean);
  const first = Object.values(errs)[0];
  if (first) throw new TRPCError({ code: "BAD_REQUEST", message: first });
  return clean;
}

// ─── Gestión (administración) ────────────────────────────────────────────────

export async function listRules(): Promise<PricingRule[]> {
  const db = await requireDb();
  try {
    const rows = await db.select().from(pricingRules).orderBy(asc(pricingRules.priority), asc(pricingRules.id));
    return sortRules(rows.map(toRule));
  } catch (e) {
    notReady(e);
  }
}

export async function createRule(form: RuleForm): Promise<{ id: number }> {
  const db = await requireDb();
  const clean = checkedForm(form);
  const rules = await listRules();
  if (rules.length >= RULES_MAX) throw new TRPCError({ code: "BAD_REQUEST", message: `Como máximo ${RULES_MAX} reglas de precios.` });
  const priority = rules.reduce((m, r) => Math.max(m, r.priority), 0) + 1;
  const [res] = (await db.insert(pricingRules).values({ ...toRow(clean), priority })) as unknown as [{ insertId: number }];
  return { id: Number(res.insertId) };
}

async function requireRule(id: number): Promise<PricingRule> {
  const rule = (await listRules()).find((r) => r.id === id);
  if (!rule) throw new TRPCError({ code: "NOT_FOUND", message: "Regla no encontrada" });
  return rule;
}

export async function updateRule(id: number, form: RuleForm): Promise<void> {
  const db = await requireDb();
  const clean = checkedForm(form);
  await requireRule(id);
  await db.update(pricingRules).set(toRow(clean)).where(eq(pricingRules.id, id));
}

export async function setRuleActive(id: number, active: boolean): Promise<void> {
  const db = await requireDb();
  await requireRule(id);
  await db.update(pricingRules).set({ active: active ? 1 : 0 }).where(eq(pricingRules.id, id));
}

/** Nuevo orden de aplicación: todas las reglas, una sola vez; la primera pasa a prioridad 1. */
export async function reorderRules(order: number[]): Promise<void> {
  const db = await requireDb();
  const rules = await listRules();
  const known = new Set(rules.map((r) => r.id));
  if (order.length !== rules.length || new Set(order).size !== order.length || order.some((i) => !known.has(i)))
    throw new TRPCError({ code: "BAD_REQUEST", message: "El orden debe incluir todas las reglas una sola vez." });
  for (let i = 0; i < order.length; i++) await db.update(pricingRules).set({ priority: i + 1 }).where(eq(pricingRules.id, order[i]));
}

/** Quita una regla. Lo ya vendido o presupuestado conserva su precio guardado. */
export async function removeRule(id: number): Promise<void> {
  const db = await requireDb();
  await requireRule(id);
  await db.delete(pricingRules).where(eq(pricingRules.id, id));
}

// ─── Aplicación en el cálculo de precios ─────────────────────────────────────

/** ¿Aplica la empresa en curso reglas de precios? Solo con la capacidad activa; ante la duda, no (precio de siempre). */
export async function pricingRulesEnabled(): Promise<boolean> {
  try {
    return (await getCapabilityAccess().check(PRICING_RULES_CAPABILITY, { write: true })).allowed;
  } catch {
    return false;
  }
}

/**
 * Reglas activas de la empresa en curso para el cálculo. Vacío sin licencia, sin la migración aplicada o si no pueden
 * leerse (queda registrado): un fallo de las reglas nunca bloquea un cobro, se cobra el precio de catálogo.
 */
export async function activeRules(): Promise<PricingRule[]> {
  if (!(await pricingRulesEnabled())) return [];
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await db.select().from(pricingRules).where(eq(pricingRules.active, 1));
    return Array.isArray(rows) ? sortRules(rows.map(toRule)) : [];
  } catch (e) {
    if (!missingTable(e)) opsLog("warn", "PricingRules", "rules_unreadable", { code: errCode(e) ?? null });
    return [];
  }
}

/**
 * Promociones vigentes de la tienda online para un producto (canal web, vigencia de hoy y ámbito que lo incluye). Las
 * condiciones de cantidad y fecha del servicio las evalúa el motor con el carrito; el cobro lo recalcula el servidor.
 */
export async function webRulesForProduct(product: { id: number; categoryId: number | null }, today = madridToday()): Promise<PricingRule[]> {
  const rules = await activeRules();
  return rules.filter((r) => {
    if (!r.channels.includes("web")) return false;
    if ((r.validFrom && today < r.validFrom) || (r.validTo && today > r.validTo)) return false;
    if (r.scope === "producto") return r.targetIds.includes(product.id);
    if (r.scope === "categoria") return product.categoryId != null && r.targetIds.includes(product.categoryId);
    return true;
  });
}

/** Categoría de cada producto del catálogo (las reglas por categoría la necesitan). */
async function categoriesOf(productIds: number[]): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>();
  const unique = Array.from(new Set(productIds.filter((n) => n > 0)));
  if (unique.length === 0) return out;
  const db = await getDb();
  if (!db) return out;
  const rows = await db.select({ id: experiences.id, categoryId: experiences.categoryId }).from(experiences).where(inArray(experiences.id, unique));
  for (const r of rows) out.set(r.id, r.categoryId ?? null);
  return out;
}

export type ServerPriceLine = Omit<PriceLineInput, "categoryId"> & { categoryId?: number | null };

/**
 * Precio por unidad de cada línea con las reglas de la empresa en curso. `null` en una línea = no es un producto del
 * catálogo (se deja como está). Sin reglas, devuelve los mismos precios sin tocar nada.
 */
export async function priceLinesForChannel(channel: PricingChannel, lines: Array<ServerPriceLine | null>, today = madridToday()): Promise<Array<PricedLine | null>> {
  const rules = await activeRules();
  if (rules.length === 0) return lines.map((l) => (l ? { baseUnitPrice: l.unitPrice, unitPrice: l.unitPrice, applied: [] } : null));
  const missing = lines.filter((l): l is ServerPriceLine => !!l && l.categoryId === undefined).map((l) => l.productId);
  const cats = await categoriesOf(missing);
  return lines.map((l) => (l ? priceLine(rules, { ...l, categoryId: l.categoryId !== undefined ? l.categoryId : cats.get(l.productId) ?? null }, { channel, today }) : null));
}

export interface Simulation {
  productTitle: string;
  baseUnitPrice: number;
  unitPrice: number;
  quantity: number;
  baseTotal: number;
  total: number;
  savings: number;
  applied: { id: number; name: string }[];
  checks: RuleCheck[];
}

/** Simulación del panel: cómo quedaría el precio de un producto con las reglas guardadas (activas o no). */
export async function simulatePrice(input: { productId: number; quantity: number; channel: PricingChannel; serviceDate?: string | null; today?: string | null; unitPrice?: number | null }): Promise<Simulation> {
  const db = await requireDb();
  const [product] = await db.select({ id: experiences.id, title: experiences.title, basePrice: experiences.basePrice, categoryId: experiences.categoryId })
    .from(experiences).where(and(eq(experiences.id, input.productId))).limit(1);
  if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Producto no encontrado" });
  const unit = input.unitPrice ?? Number(product.basePrice ?? 0);
  const rules = await listRules();
  const ctx = { channel: input.channel, today: input.today || madridToday() };
  const line: PriceLineInput = { productId: product.id, categoryId: product.categoryId ?? null, unitPrice: unit, quantity: input.quantity, serviceDate: input.serviceDate ?? null };
  const priced = priceLine(rules, line, ctx);
  const baseTotal = Math.round(unit * input.quantity * 100) / 100;
  const total = Math.round(priced.unitPrice * input.quantity * 100) / 100;
  return {
    productTitle: product.title,
    baseUnitPrice: unit,
    unitPrice: priced.unitPrice,
    quantity: input.quantity,
    baseTotal,
    total,
    savings: Math.round((baseTotal - total) * 100) / 100,
    applied: priced.applied,
    checks: rules.map((r) => checkRule(r, line, ctx)),
  };
}

// ─── TPV ─────────────────────────────────────────────────────────────────────

export interface TpvPricedItem {
  productType: string;
  productId: number;
  unitPrice: number;
  quantity: number;
  participants?: number;
  eventDate?: string;
  isManual?: boolean;
  notes?: string;
}

/**
 * Precio por unidad de las líneas del TPV con las reglas (canal tpv). Solo los productos del catálogo; los conceptos
 * libres y lo sectorial (packs, spa, hotel…) se quedan como están. Cantidad = unidades × participantes.
 */
export async function tpvLinePrices(items: TpvPricedItem[], serviceDate?: string | null): Promise<Array<PricedLine | null>> {
  return priceLinesForChannel(
    "tpv",
    items.map((i) => (!i.isManual && i.productType === "experience" && i.productId > 0
      ? { productId: i.productId, unitPrice: i.unitPrice, quantity: i.quantity * (i.participants ?? 1), serviceDate: i.eventDate ?? serviceDate ?? null }
      : null)),
  );
}

/** Líneas del TPV con el precio de las reglas aplicado y la nota de la regla (lo que queda guardado en la venta). */
export async function applyTpvPricingRules<T extends TpvPricedItem>(items: T[], serviceDate?: string | null): Promise<T[]> {
  const priced = await tpvLinePrices(items, serviceDate);
  return items.map((it, i) => {
    const p = priced[i];
    const note = p ? appliedRuleNote(p) : null;
    if (!p || !note) return it;
    return { ...it, unitPrice: p.unitPrice, notes: [it.notes, note].filter(Boolean).join(" · ").slice(0, 500) };
  });
}

// ─── Presupuestos ────────────────────────────────────────────────────────────

/**
 * Líneas de presupuesto calculadas por el servidor desde el catálogo (generar o precargar desde un lead) con las reglas
 * (canal presupuesto). Solo las líneas con `productId` de un producto del catálogo; el resto queda igual. El
 * presupuesto guarda el precio resultante: editarlo después no vuelve a aplicar reglas.
 */
export async function applyQuotePricingRules<T extends { unitPrice: number; quantity: number; total: number; productId?: number; description: string }>(
  items: T[],
  opts: { catalogIds: Set<number>; serviceDate?: string | null },
): Promise<T[]> {
  const priced = await priceLinesForChannel(
    "presupuesto",
    items.map((i) => (i.productId && opts.catalogIds.has(i.productId) ? { productId: i.productId, unitPrice: i.unitPrice, quantity: i.quantity, serviceDate: opts.serviceDate ?? null } : null)),
  );
  return items.map((it, i) => {
    const p = priced[i];
    if (!p || p.applied.length === 0) return it;
    return { ...it, unitPrice: p.unitPrice, total: Math.round(p.unitPrice * it.quantity * 100) / 100, description: `${it.description} (${p.applied.map((r) => r.name).join(" + ")})` };
  });
}
