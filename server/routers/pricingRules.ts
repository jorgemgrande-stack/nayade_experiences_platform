/**
 * Reglas de precios (capacidad Business `pricing-rules`). La licencia la aplica el guardián de rutas (`pricingRules` →
 * pricing-rules en TRPC_ROUTER_CAPABILITIES): Essential no llega aquí y sus precios y cupones siguen igual.
 *
 * Gestionar y simular es de administración. La aplicación en tienda, TPV y presupuestos está en server/pricingRulesDb.ts.
 */
import { z } from "zod";
import { asc } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { categories, experiences } from "../../drizzle/schema";
import { getDb } from "../db";
import { ADJUSTMENT_KINDS, PRICING_CHANNELS, RULE_NAME_MAX, RULE_SCOPES, TARGETS_MAX, VALUE_TYPES } from "../../shared/pricingRules";
import { createRule, listRules, removeRule, reorderRules, setRuleActive, simulatePrice, updateRule } from "../pricingRulesDb";

const id = z.number().int().positive();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const ruleForm = z.object({
  name: z.string().max(RULE_NAME_MAX * 2),
  active: z.boolean(),
  kind: z.enum(ADJUSTMENT_KINDS),
  valueType: z.enum(VALUE_TYPES),
  value: z.number().finite(),
  scope: z.enum(RULE_SCOPES),
  targetIds: z.array(id).max(TARGETS_MAX),
  minQuantity: z.number().int(),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7),
  channels: z.array(z.enum(PRICING_CHANNELS)).max(PRICING_CHANNELS.length),
  validFrom: day,
  validTo: day,
  serviceFrom: day,
  serviceTo: day,
  combinable: z.boolean(),
});

export const pricingRulesRouter = router({
  list: adminProcedure.query(() => listRules()),

  /** Productos y categorías de la empresa para elegir el ámbito de una regla y simular. */
  options: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { products: [], categories: [] };
    const [products, cats] = await Promise.all([
      db.select({ id: experiences.id, title: experiences.title, basePrice: experiences.basePrice, categoryId: experiences.categoryId }).from(experiences).orderBy(asc(experiences.title)),
      db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)),
    ]);
    return { products: products.map((p) => ({ ...p, basePrice: p.basePrice == null ? null : Number(p.basePrice) })), categories: cats };
  }),

  create: adminProcedure.input(ruleForm).mutation(({ input }) => createRule(input)),

  update: adminProcedure
    .input(ruleForm.extend({ id }))
    .mutation(async ({ input }) => {
      const { id: ruleId, ...form } = input;
      await updateRule(ruleId, form);
      return { success: true };
    }),

  setActive: adminProcedure
    .input(z.object({ id, active: z.boolean() }))
    .mutation(async ({ input }) => {
      await setRuleActive(input.id, input.active);
      return { success: true };
    }),

  reorder: adminProcedure
    .input(z.object({ ids: z.array(id).min(1).max(200) }))
    .mutation(async ({ input }) => {
      await reorderRules(input.ids);
      return { success: true };
    }),

  remove: adminProcedure
    .input(z.object({ id }))
    .mutation(async ({ input }) => {
      await removeRule(input.id);
      return { success: true };
    }),

  simulate: adminProcedure
    .input(z.object({
      productId: id,
      quantity: z.number().int().min(1).max(10000),
      channel: z.enum(PRICING_CHANNELS),
      serviceDate: day.optional(),
      today: day.optional(),
      unitPrice: z.number().min(0).max(1000000).nullable().optional(),
    }))
    .query(({ input }) => simulatePrice(input)),
});
