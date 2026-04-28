/**
 * Lego Packs Router
 * Gestión de packs compuestos preconfigurados por el administrador.
 * El cliente solo puede activar/desactivar líneas opcionales.
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure, publicProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, asc, inArray, sql } from "drizzle-orm";
import {
  legoPacks,
  legoPackLines,
  legoPackSnapshots,
  experiences,
  packs,
  type LegoPack,
  type LegoPackLine,
} from "../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

// ─── Input schemas ─────────────────────────────────────────────────────────────

const legoPackInput = z.object({
  slug: z.string().min(1).max(256),
  title: z.string().min(1).max(256),
  subtitle: z.string().max(512).optional().nullable(),
  shortDescription: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  coverImageUrl: z.string().optional().nullable(),
  image1: z.string().optional().nullable(),
  image2: z.string().optional().nullable(),
  image3: z.string().optional().nullable(),
  image4: z.string().optional().nullable(),
  gallery: z.array(z.string()).optional().nullable(),
  badge: z.string().max(64).optional().nullable(),
  priceLabel: z.string().max(128).optional().nullable(),
  categoryId: z.number().optional().nullable(),
  category: z.enum(["dia", "escolar", "empresa", "estancia"]).default("dia"),
  targetAudience: z.string().max(256).optional().nullable(),
  availabilityMode: z.enum(["strict", "flexible"]).default("strict"),
  discountPercent: z.string().optional().nullable(),
  discountExpiresAt: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  isPublished: z.boolean().default(false),
  isFeatured: z.boolean().default(false),
  isPresentialSale: z.boolean().default(true),
  isOnlineSale: z.boolean().default(false),
  sortOrder: z.number().default(0),
  metaTitle: z.string().max(256).optional().nullable(),
  metaDescription: z.string().optional().nullable(),
});

const legoPackLineInput = z.object({
  legoPackId: z.number(),
  sourceType: z.enum(["experience", "pack"]),
  sourceId: z.number(),
  internalName: z.string().max(256).optional().nullable(),
  groupLabel: z.string().max(128).optional().nullable(),
  sortOrder: z.number().default(0),
  isActive: z.boolean().default(true),
  isRequired: z.boolean().default(true),
  isOptional: z.boolean().default(false),
  isClientEditable: z.boolean().default(false),
  isClientVisible: z.boolean().default(true),
  defaultQuantity: z.number().default(1),
  isQuantityEditable: z.boolean().default(false),
  discountType: z.enum(["percent", "fixed"]).default("percent"),
  discountValue: z.number().default(0),
  overridePrice: z.number().optional().nullable(),
  overridePriceLabel: z.string().max(64).optional().nullable(),
  frontendNote: z.string().optional().nullable(),
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Calculates the price of a Lego Pack given its lines and the active line IDs
 * chosen by the client. Returns per-line breakdown and totals.
 */
export async function calculateLegoPackPrice(
  legoPackId: number,
  activeLineIds?: number[] // undefined = all active lines
) {
  const lines = await db
    .select()
    .from(legoPackLines)
    .where(and(eq(legoPackLines.legoPackId, legoPackId), eq(legoPackLines.isActive, true)))
    .orderBy(asc(legoPackLines.sortOrder));

  const result: Array<{
    lineId: number;
    sourceType: string;
    sourceId: number;
    sourceName: string;
    internalName?: string | null;
    groupLabel?: string | null;
    isRequired: boolean;
    isOptional: boolean;
    isClientEditable: boolean;
    isClientVisible: boolean;
    isActiveInOperation: boolean;
    quantity: number;
    basePrice: number;
    discountType: string;
    discountValue: number;
    discountAmount: number;
    finalPrice: number;
    fiscalRegime: string;
    supplierId?: number | null;
    supplierName?: string | null;
    supplierCommissionPercent?: number;
    parentLegoPackId: number;
    parentLegoPackName: string;
    // Override price: used as basePrice fallback when product has no price (e.g. accommodation)
    overridePrice?: number | null;
    overridePriceLabel?: string | null;
    frontendNote?: string | null;
  }> = [];

  // Load the pack title
  const [pack] = await db.select({ title: legoPacks.title }).from(legoPacks).where(eq(legoPacks.id, legoPackId));
  const packTitle = pack?.title ?? "";

  for (const line of lines) {
    const isActiveInOp = activeLineIds ? activeLineIds.includes(line.id) : true;

    let basePrice = 0;
    let sourceName = "";
    let fiscalRegime = "general";
    let supplierId: number | null = null;
    let supplierName: string | null = null;
    let supplierCommissionPercent = 0;

    if (line.sourceType === "experience") {
      const [exp] = await db
        .select({
          title: experiences.title,
          basePrice: experiences.basePrice,
          fiscalRegime: experiences.fiscalRegime,
          supplierId: experiences.supplierId,
          supplierCommissionPercent: experiences.supplierCommissionPercent,
        })
        .from(experiences)
        .where(eq(experiences.id, line.sourceId));
      if (exp) {
        sourceName = exp.title;
        basePrice = parseFloat(exp.basePrice ?? "0");
        fiscalRegime = exp.fiscalRegime ?? "general";
        supplierId = exp.supplierId ?? null;
        supplierCommissionPercent = parseFloat(exp.supplierCommissionPercent ?? "0");
      }
    } else {
      const [pk] = await db
        .select({
          title: packs.title,
          basePrice: packs.basePrice,
          fiscalRegime: packs.fiscalRegime,
          supplierId: packs.supplierId,
          supplierCommissionPercent: packs.supplierCommissionPercent,
        })
        .from(packs)
        .where(eq(packs.id, line.sourceId));
      if (pk) {
        sourceName = pk.title;
        basePrice = parseFloat(pk.basePrice ?? "0");
        fiscalRegime = pk.fiscalRegime ?? "general";
        supplierId = pk.supplierId ?? null;
        supplierCommissionPercent = parseFloat(pk.supplierCommissionPercent ?? "0");
      }
    }

    // If no product was found (e.g. accommodation line with no linked experience)
    // or product has no price, fall back to overridePrice as the base price.
    // This ensures accommodation/external lines are correctly priced in the cart.
    if (basePrice === 0 && line.overridePrice) {
      basePrice = parseFloat(String(line.overridePrice));
      if (!sourceName) sourceName = line.internalName ?? "Alojamiento";
    }

    const quantity = line.defaultQuantity ?? 1;
    const lineTotalBase = basePrice * quantity;
    const discountValue = parseFloat(String(line.discountValue ?? "0"));
    let discountAmount = 0;
    if (line.discountType === "percent") {
      discountAmount = (lineTotalBase * discountValue) / 100;
    } else {
      discountAmount = discountValue * quantity;
    }
    const finalPrice = lineTotalBase - discountAmount;

    result.push({
      lineId: line.id,
      sourceType: line.sourceType,
      sourceId: line.sourceId,
      sourceName,
      internalName: line.internalName,
      groupLabel: line.groupLabel,
      isRequired: line.isRequired,
      isOptional: line.isOptional,
      isClientEditable: line.isClientEditable,
      isClientVisible: line.isClientVisible,
      isActiveInOperation: isActiveInOp,
      quantity,
      basePrice: lineTotalBase,
      discountType: line.discountType,
      discountValue,
      discountAmount,
      finalPrice,
      fiscalRegime,
      supplierId,
      supplierName,
      supplierCommissionPercent,
      parentLegoPackId: legoPackId,
      parentLegoPackName: packTitle,
      // Override price: used as basePrice fallback when product has no price (e.g. accommodation)
      overridePrice: line.overridePrice ? parseFloat(String(line.overridePrice)) : null,
      overridePriceLabel: line.overridePriceLabel ?? null,
      frontendNote: line.frontendNote ?? null,
    });
  }

  const totalOriginal = result.filter((l) => l.isActiveInOperation).reduce((s, l) => s + l.basePrice, 0);
  const totalDiscount = result.filter((l) => l.isActiveInOperation).reduce((s, l) => s + l.discountAmount, 0);
  const totalFinal = totalOriginal - totalDiscount;

  return { lines: result, totalOriginal, totalDiscount, totalFinal };
}

// ─── Router ────────────────────────────────────────────────────────────────────

export const legoPacksRouter = router({
  // ── List all Lego Packs ────────────────────────────────────────────────────
  list: adminProcedure
    .input(z.object({
      isPublished: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      const conditions = [];
      if (input?.isPublished !== undefined) conditions.push(eq(legoPacks.isPublished, input.isPublished));
      if (input?.isActive !== undefined) conditions.push(eq(legoPacks.isActive, input.isActive));

      const rows = await db
        .select()
        .from(legoPacks)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(asc(legoPacks.sortOrder), asc(legoPacks.title));

      // Attach line count
      const ids = rows.map((r: LegoPack) => r.id);
      const lineCounts: Record<number, number> = {};
      if (ids.length > 0) {
        const counts = await db
          .select({ legoPackId: legoPackLines.legoPackId, count: sql<number>`count(*)` })
          .from(legoPackLines)
          .where(inArray(legoPackLines.legoPackId, ids))
          .groupBy(legoPackLines.legoPackId);
        for (const c of counts) lineCounts[c.legoPackId] = Number(c.count);
      }

      return rows.map((r: LegoPack) => ({ ...r, lineCount: lineCounts[r.id] ?? 0 }));
    }),

  // ── Public list (for frontend/TPV) ────────────────────────────────────────
  listPublic: publicProcedure
    .query(async () => {
      return db
        .select()
        .from(legoPacks)
        .where(and(eq(legoPacks.isPublished, true), eq(legoPacks.isActive, true)))
        .orderBy(asc(legoPacks.sortOrder));
    }),

  // ── Public list by category ───────────────────────────────────────────────
  listPublicByCategory: publicProcedure
    .input(z.object({ category: z.enum(["dia", "escolar", "empresa", "estancia"]) }))
    .query(async ({ input }) => {
      const packsList = await db
        .select()
        .from(legoPacks)
        .where(and(
          eq(legoPacks.isPublished, true),
          eq(legoPacks.isActive, true),
          eq(legoPacks.category, input.category),
        ))
        .orderBy(asc(legoPacks.sortOrder));

      // Calcular precio mínimo para cada pack (solo líneas requeridas activas)
      const withPricing = await Promise.all(
        packsList.map(async (pack) => {
          try {
            const pricing = await calculateLegoPackPrice(pack.id);
            // Precio mínimo = total de líneas requeridas con descuento
            const minPrice = pricing.totalFinal > 0 ? pricing.totalFinal : null;
            return { ...pack, minPrice };
          } catch {
            return { ...pack, minPrice: null };
          }
        })
      );

      return withPricing;
    }),

  // ── Get single Lego Pack with lines ───────────────────────────────────────
  get: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [pack] = await db.select().from(legoPacks).where(eq(legoPacks.id, input.id));
      if (!pack) throw new TRPCError({ code: "NOT_FOUND" });
      const lines = await db
        .select()
        .from(legoPackLines)
        .where(eq(legoPackLines.legoPackId, input.id))
        .orderBy(asc(legoPackLines.sortOrder));
      return { ...pack, lines };
    }),

  // ── Get by slug (public) ───────────────────────────────────────────────────
  getBySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const [pack] = await db
        .select()
        .from(legoPacks)
        .where(and(eq(legoPacks.slug, input.slug), eq(legoPacks.isPublished, true)));
      if (!pack) throw new TRPCError({ code: "NOT_FOUND" });
      const lines = await db
        .select()
        .from(legoPackLines)
        .where(and(eq(legoPackLines.legoPackId, pack.id), eq(legoPackLines.isActive, true), eq(legoPackLines.isClientVisible, true)))
        .orderBy(asc(legoPackLines.sortOrder));
      const pricing = await calculateLegoPackPrice(pack.id);
      return { ...pack, lines, pricing };
    }),

  // ── Create Lego Pack ───────────────────────────────────────────────────────
  create: adminProcedure
    .input(legoPackInput)
    .mutation(async ({ input }) => {
      const { discountExpiresAt, ...rest } = input;
      const [result] = await db.insert(legoPacks).values({
        ...rest,
        gallery: rest.gallery ?? [],
        discountExpiresAt: discountExpiresAt ? new Date(discountExpiresAt) : null,
      });
      return { id: (result as any).insertId };
    }),

  // ── Update Lego Pack ───────────────────────────────────────────────────────
  update: adminProcedure
    .input(legoPackInput.extend({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { id, discountExpiresAt, ...data } = input;
      await db.update(legoPacks).set({
        ...data,
        gallery: data.gallery ?? [],
        discountExpiresAt: discountExpiresAt ? new Date(discountExpiresAt) : null,
      }).where(eq(legoPacks.id, id));
      return { ok: true };
    }),

  // ── Delete Lego Pack ───────────────────────────────────────────────────────
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(legoPackLines).where(eq(legoPackLines.legoPackId, input.id));
      await db.delete(legoPacks).where(eq(legoPacks.id, input.id));
      return { ok: true };
    }),

  // ── Toggle published ───────────────────────────────────────────────────────
  togglePublished: adminProcedure
    .input(z.object({ id: z.number(), isPublished: z.boolean() }))
    .mutation(async ({ input }) => {
      await db.update(legoPacks).set({ isPublished: input.isPublished }).where(eq(legoPacks.id, input.id));
      return { ok: true };
    }),

  // ── Reorder packs ─────────────────────────────────────────────────────────
  reorder: adminProcedure
    .input(z.array(z.object({ id: z.number(), sortOrder: z.number() })))
    .mutation(async ({ input }) => {
      for (const item of input) {
        await db.update(legoPacks).set({ sortOrder: item.sortOrder }).where(eq(legoPacks.id, item.id));
      }
      return { ok: true };
    }),

  // ── Lines: Add ────────────────────────────────────────────────────────────
  addLine: adminProcedure
    .input(legoPackLineInput)
    .mutation(async ({ input }) => {
      const [result] = await db.insert(legoPackLines).values({
        ...input,
        discountValue: String(input.discountValue),
        overridePrice: input.overridePrice != null ? String(input.overridePrice) : null,
      });
      return { id: (result as any).insertId };
    }),

  // ── Lines: Update ─────────────────────────────────────────────────────────
  updateLine: adminProcedure
    .input(legoPackLineInput.extend({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(legoPackLines).set({
        ...data,
        discountValue: String(data.discountValue),
        overridePrice: data.overridePrice != null ? String(data.overridePrice) : null,
      }).where(eq(legoPackLines.id, id));
      return { ok: true };
    }),

  // ── Lines: Delete ─────────────────────────────────────────────────────────
  deleteLine: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(legoPackLines).where(eq(legoPackLines.id, input.id));
      return { ok: true };
    }),

  // ── Lines: Reorder ────────────────────────────────────────────────────────
  reorderLines: adminProcedure
    .input(z.array(z.object({ id: z.number(), sortOrder: z.number() })))
    .mutation(async ({ input }) => {
      for (const item of input) {
        await db.update(legoPackLines).set({ sortOrder: item.sortOrder }).where(eq(legoPackLines.id, item.id));
      }
      return { ok: true };
    }),

  // ── Calculate price ───────────────────────────────────────────────────────
  // Used by TPV, presupuestos, and frontend to get the price breakdown
  calculatePrice: publicProcedure
    .input(z.object({
      legoPackId: z.number(),
      activeLineIds: z.array(z.number()).optional(), // undefined = all active lines
    }))
    .query(async ({ input }) => {
      return calculateLegoPackPrice(input.legoPackId, input.activeLineIds);
    }),

  // ── Save snapshot ─────────────────────────────────────────────────────────
  // Called when an operation (reservation, quote, tpv_sale, invoice) is created
  saveSnapshot: protectedProcedure
    .input(z.object({
      legoPackId: z.number(),
      operationType: z.enum(["reservation", "quote", "tpv_sale", "invoice"]),
      operationId: z.number(),
      activeLineIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ input }) => {
      const pricing = await calculateLegoPackPrice(input.legoPackId, input.activeLineIds);
      const [pack] = await db.select({ title: legoPacks.title }).from(legoPacks).where(eq(legoPacks.id, input.legoPackId));

      const [result] = await db.insert(legoPackSnapshots).values({
        legoPackId: input.legoPackId,
        legoPackTitle: pack?.title ?? "",
        operationType: input.operationType,
        operationId: input.operationId,
        linesSnapshot: pricing.lines as any,
        totalOriginal: String(pricing.totalOriginal.toFixed(2)),
        totalDiscount: String(pricing.totalDiscount.toFixed(2)),
        totalFinal: String(pricing.totalFinal.toFixed(2)),
      });
      return { id: (result as any).insertId, ...pricing };
    }),

  // ── Get snapshot for operation ─────────────────────────────────────────────
  getSnapshot: protectedProcedure
    .input(z.object({
      operationType: z.enum(["reservation", "quote", "tpv_sale", "invoice"]),
      operationId: z.number(),
    }))
    .query(async ({ input }) => {
      const rows = await db
        .select()
        .from(legoPackSnapshots)
        .where(and(
          eq(legoPackSnapshots.operationType, input.operationType),
          eq(legoPackSnapshots.operationId, input.operationId)
        ))
        .orderBy(asc(legoPackSnapshots.id));
      return rows;
    }),

  // ── Auditoría completa de configuración ──────────────────────────────────
  audit: adminProcedure
    .query(async () => {
      const allPacks = await db.select().from(legoPacks).orderBy(asc(legoPacks.sortOrder));
      const allLines = await db.select().from(legoPackLines);

      // Cargar todos los productos origen de una vez (evitar N+1)
      const expIds = [...new Set(allLines.filter(l => l.sourceType === "experience").map(l => l.sourceId))];
      const packIds = [...new Set(allLines.filter(l => l.sourceType === "pack").map(l => l.sourceId))];

      const expMap: Record<number, { title: string; basePrice: string; isActive: boolean; fiscalRegime: string }> = {};
      const packMap: Record<number, { title: string; basePrice: string; isActive: boolean; fiscalRegime: string }> = {};

      if (expIds.length > 0) {
        const exps = await db.select({
          id: experiences.id, title: experiences.title, basePrice: experiences.basePrice,
          isActive: experiences.isActive, fiscalRegime: experiences.fiscalRegime,
        }).from(experiences).where(inArray(experiences.id, expIds));
        for (const e of exps) expMap[e.id] = { title: e.title, basePrice: e.basePrice ?? "0", isActive: e.isActive, fiscalRegime: e.fiscalRegime };
      }

      if (packIds.length > 0) {
        const pks = await db.select({
          id: packs.id, title: packs.title, basePrice: packs.basePrice,
          isActive: packs.isActive, fiscalRegime: packs.fiscalRegime,
        }).from(packs).where(inArray(packs.id, packIds));
        for (const p of pks) packMap[p.id] = { title: p.title, basePrice: p.basePrice ?? "0", isActive: p.isActive, fiscalRegime: p.fiscalRegime };
      }

      const now = new Date();
      const report: Array<{
        id: number; slug: string; title: string;
        status: { isActive: boolean; isPublished: boolean; isOnlineSale: boolean; isPresentialSale: boolean; availabilityMode: string; category: string };
        isSellable: boolean;
        errors: string[]; warnings: string[];
        lineCount: number; activeLineCount: number;
        pricingTotal: number | null;
        lines: Array<{ id: number; internalName: string | null; sourceType: string; sourceId: number; sourceName: string; isActive: boolean; isRequired: boolean; isOptional: boolean; basePrice: number; overridePrice: number | null; finalPrice: number; errors: string[]; warnings: string[] }>;
      }> = [];

      for (const pack of allPacks) {
        const packLines = allLines.filter(l => l.legoPackId === pack.id).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        const activePackLines = packLines.filter(l => l.isActive);
        const errors: string[] = [];
        const warnings: string[] = [];

        // ── Pack-level checks ────────────────────────────────────────────────
        if (!pack.isActive) errors.push("Pack desactivado (isActive=false)");
        if (!pack.isPublished) warnings.push("No publicado — invisible en la web pública");
        if (!pack.isOnlineSale && !pack.isPresentialSale) errors.push("Sin canal de venta: ni isOnlineSale ni isPresentialSale están activos");
        else if (!pack.isOnlineSale && pack.isPresentialSale) warnings.push("Solo venta presencial (isOnlineSale=false) — no aparece en web");
        if (!pack.coverImageUrl) warnings.push("Sin imagen de portada (coverImageUrl vacío)");
        if (!pack.shortDescription && !pack.description) warnings.push("Sin descripción (ni shortDescription ni description)");
        if (!pack.priceLabel) warnings.push("Sin etiqueta de precio (priceLabel vacío) — el listado público no mostrará precio orientativo");
        if (packLines.length === 0) errors.push("Sin líneas configuradas — no se puede vender");
        else if (activePackLines.length === 0) errors.push("Todas las líneas están desactivadas — precio total = 0€");

        if (pack.discountPercent && pack.discountExpiresAt && new Date(pack.discountExpiresAt) < now) {
          warnings.push(`Descuento del ${pack.discountPercent}% configurado pero caducó el ${new Date(pack.discountExpiresAt).toLocaleDateString("es-ES")}`);
        }

        // ── Line-level checks ────────────────────────────────────────────────
        const lineReports = [];
        let pricingTotal = 0;
        let anyActiveLineHasPrice = false;

        for (const line of packLines) {
          const lineErrors: string[] = [];
          const lineWarnings: string[] = [];

          const src = line.sourceType === "experience" ? expMap[line.sourceId] : packMap[line.sourceId];
          const sourceName = src?.title ?? "(producto no encontrado)";

          if (!src) {
            lineErrors.push(`Producto origen no existe (${line.sourceType} id=${line.sourceId}) — HUÉRFANO`);
          } else {
            if (!src.isActive) lineErrors.push(`Producto origen "${src.title}" está desactivado`);
          }

          const rawBase = parseFloat(src?.basePrice ?? "0");
          const rawOverride = line.overridePrice ? parseFloat(String(line.overridePrice)) : null;
          const basePrice = rawBase > 0 ? rawBase : (rawOverride ?? 0);
          const qty = line.defaultQuantity ?? 1;
          const discVal = parseFloat(String(line.discountValue ?? "0"));
          const discAmt = line.discountType === "percent" ? (basePrice * qty * discVal / 100) : (discVal * qty);
          const finalPrice = basePrice * qty - discAmt;

          if (basePrice === 0 && line.isActive) {
            lineErrors.push("Sin precio: ni el producto origen tiene basePrice > 0 ni hay overridePrice → se venderá a 0€");
          }

          if (line.isRequired && line.isOptional) {
            lineErrors.push("Flags contradictorios: isRequired=true AND isOptional=true simultáneamente");
          }
          if (!line.isRequired && !line.isOptional) {
            lineWarnings.push("Ni required ni optional: la línea existe pero no tiene rol definido para el cliente");
          }
          if (line.isRequired && !line.isClientVisible) {
            lineWarnings.push("Línea obligatoria oculta al cliente (isRequired=true + isClientVisible=false)");
          }
          if (line.isActive && pack.availabilityMode === "strict" && src && !src.isActive) {
            errors.push(`Modo strict + producto de línea "${src.title}" desactivado → pack NUNCA disponible`);
          }

          if (line.isActive) {
            pricingTotal += finalPrice;
            if (basePrice > 0) anyActiveLineHasPrice = true;
          }

          lineReports.push({
            id: line.id, internalName: line.internalName ?? null,
            sourceType: line.sourceType, sourceId: line.sourceId, sourceName,
            isActive: line.isActive, isRequired: line.isRequired, isOptional: line.isOptional,
            basePrice: rawBase, overridePrice: rawOverride, finalPrice,
            errors: lineErrors, warnings: lineWarnings,
          });
        }

        if (activePackLines.length > 0 && !anyActiveLineHasPrice) {
          errors.push("Ninguna línea activa tiene precio configurado → el pack se vendería a 0€");
        }

        // ── Sellability final verdict ────────────────────────────────────────
        const isSellable =
          pack.isActive &&
          pack.isPublished &&
          (pack.isOnlineSale || pack.isPresentialSale) &&
          activePackLines.length > 0 &&
          errors.length === 0;

        report.push({
          id: pack.id, slug: pack.slug, title: pack.title,
          status: {
            isActive: pack.isActive, isPublished: pack.isPublished,
            isOnlineSale: pack.isOnlineSale, isPresentialSale: pack.isPresentialSale,
            availabilityMode: pack.availabilityMode, category: pack.category,
          },
          isSellable,
          errors, warnings,
          lineCount: packLines.length, activeLineCount: activePackLines.length,
          pricingTotal: packLines.length > 0 ? pricingTotal : null,
          lines: lineReports,
        });
      }

      const totalErrors = report.reduce((s, p) => s + p.errors.length + p.lines.reduce((ls, l) => ls + l.errors.length, 0), 0);
      const totalWarnings = report.reduce((s, p) => s + p.warnings.length + p.lines.reduce((ls, l) => ls + l.warnings.length, 0), 0);
      const sellableCount = report.filter(p => p.isSellable).length;

      return {
        summary: { totalPacks: allPacks.length, sellable: sellableCount, totalErrors, totalWarnings },
        packs: report,
      };
    }),

  // ── Stats for reports ─────────────────────────────────────────────────────
  stats: adminProcedure
    .query(async () => {
      const snapshots = await db.select().from(legoPackSnapshots);
      const packMap: Record<number, { packId: number; packName: string; totalSales: number; totalRevenue: number; lineStats: Record<string, { name: string; kept: number; removed: number }> }> = {};

      for (const snap of snapshots) {
        if (!packMap[snap.legoPackId]) {
          packMap[snap.legoPackId] = {
            packId: snap.legoPackId,
            packName: snap.legoPackTitle,
            totalSales: 0,
            totalRevenue: 0,
            lineStats: {},
          };
        }
        packMap[snap.legoPackId].totalSales++;
        packMap[snap.legoPackId].totalRevenue += parseFloat(String(snap.totalFinal ?? "0"));

        const lines = (snap.linesSnapshot as any[]) ?? [];
        for (const line of lines) {
          const key = `${line.sourceType}_${line.sourceId}`;
          if (!packMap[snap.legoPackId].lineStats[key]) {
            packMap[snap.legoPackId].lineStats[key] = { name: line.sourceName ?? "", kept: 0, removed: 0 };
          }
          if (line.isActiveInOperation) {
            packMap[snap.legoPackId].lineStats[key].kept++;
          } else {
            packMap[snap.legoPackId].lineStats[key].removed++;
          }
        }
      }

      return Object.values(packMap);
    }),
});

