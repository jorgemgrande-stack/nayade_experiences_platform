/**
 * Venta multicanal (namespace `multichannel`, licenciado con la capacidad `multichannel` en
 * server/_core/capabilities/routeGuard.ts y comprobado también aquí, como GEO Control: sin licencia, 403; en solo
 * lectura, solo consultas). Solo administración. La lógica vive en server/multichannelDb.ts y shared/multichannel.ts.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { getCapabilityAccess } from "../_core/capabilities/access";
import * as mc from "../multichannelDb";
import { MC_CAPABILITY, MC_CHANNEL_KINDS, MC_CSV_FIELDS, MC_LIMITS, MC_PROVIDERS, MC_SALE_STATUSES, MC_TARGET_KINDS, isDay, parseInboundSale } from "../../shared/multichannel";

const id = z.number().int().positive();
const day = z.string().refine(isDay, "La fecha no es válida.");
const cents = z.number().int().min(0).max(MC_LIMITS.maxCents);
const actorOf = (ctx: { user: { id: number; role: unknown } }): mc.McActor => ({ userId: ctx.user.id, role: String(ctx.user.role) });

/** Además del guardián de rutas: licencia `multichannel` (consultas en solo lectura; operar exige la licencia activa). */
const licensed = adminProcedure.use(async ({ type, next }) => {
  const d = await getCapabilityAccess().check(MC_CAPABILITY, { write: type === "mutation" });
  if (!d.allowed) throw new TRPCError({ code: "FORBIDDEN", message: d.reason || "La Venta multicanal no está incluida en tu plan" });
  return next();
});

const mapping = z.object(Object.fromEntries(MC_CSV_FIELDS.map((f) => [f, z.string().max(120).optional()])) as Record<(typeof MC_CSV_FIELDS)[number], z.ZodOptional<z.ZodString>>).partial();
const saleFilter = z.object({
  channelId: id.optional(),
  status: z.enum([...MC_SALE_STATUSES, "pendientes", "todas"] as const).optional(),
  from: day.optional(),
  to: day.optional(),
  search: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

export const multichannelRouter = router({
  // ── Canales ─────────────────────────────────────────────────────────────
  channels: licensed.query(() => mc.listChannels()),
  upsertChannel: licensed
    .input(z.object({
      id: id.optional(),
      name: z.string().max(120),
      kind: z.enum(MC_CHANNEL_KINDS),
      provider: z.enum(MC_PROVIDERS),
      commissionPct: z.number().min(0).max(100),
      commissionFixedCents: z.number().int().min(0).max(1_000_000),
      settlementDays: z.number().int().min(0).max(365).nullish(),
      csvMapping: mapping.optional(),
      notes: z.string().max(1000).nullish(),
    }))
    .mutation(({ ctx, input }) => mc.upsertChannel(input, actorOf(ctx))),
  setChannelActive: licensed.input(z.object({ id, active: z.boolean() })).mutation(({ ctx, input }) => mc.setChannelActive(input.id, input.active, actorOf(ctx))),
  rotateInboundToken: licensed.input(z.object({ id })).mutation(({ ctx, input }) => mc.rotateInboundToken(input.id, actorOf(ctx))),
  revokeInboundToken: licensed.input(z.object({ id })).mutation(({ ctx, input }) => mc.revokeInboundToken(input.id, actorOf(ctx))),

  // ── Publicaciones y cupo ────────────────────────────────────────────────
  targets: licensed.query(() => mc.listTargets()),
  listings: licensed.input(z.object({ channelId: id.optional() }).optional()).query(({ input }) => mc.listListings(input?.channelId)),
  upsertListing: licensed
    .input(z.object({
      id: id.optional(),
      channelId: id,
      externalCode: z.string().max(80),
      label: z.string().max(200).nullish(),
      targetKind: z.enum(MC_TARGET_KINDS),
      targetId: id,
      timeSlotId: id.nullish(),
      unitPriceCents: cents.nullish(),
    }))
    .mutation(({ ctx, input }) => mc.upsertListing(input, actorOf(ctx))),
  setListingActive: licensed.input(z.object({ id, active: z.boolean() })).mutation(({ ctx, input }) => mc.setListingActive(input.id, input.active, actorOf(ctx))),
  allocations: licensed
    .input(z.object({ channelId: id.optional(), listingId: id.optional(), from: day.optional(), to: day.optional() }).optional())
    .query(({ input }) => mc.listAllocations(input ?? {})),
  setAllocations: licensed
    .input(z.object({ listingId: id, from: day, to: day, quota: z.number().int().min(0).max(100_000), weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional() }))
    .mutation(({ ctx, input }) => mc.setAllocations(input, actorOf(ctx))),

  // ── Ventas ──────────────────────────────────────────────────────────────
  sales: licensed.input(saleFilter.optional()).query(({ input }) => mc.listSales(input ?? {})),
  exportSales: licensed.input(saleFilter.optional()).query(async ({ input }) => ({ csv: await mc.exportSalesCsv(input ?? {}) })),
  recordSale: licensed
    .input(z.object({
      channelId: id,
      ref: z.string().max(128),
      code: z.string().max(80).nullish(),
      date: day,
      endDate: day.nullish(),
      time: z.string().max(5).nullish(),
      units: z.number().int().min(1).max(MC_LIMITS.maxUnits),
      amount: z.number().min(0).max(MC_LIMITS.maxCents / 100).nullish(),
      commission: z.number().min(0).max(MC_LIMITS.maxCents / 100).nullish(),
      customerName: z.string().max(200).nullish(),
      customerEmail: z.string().max(255).nullish(),
      customerPhone: z.string().max(50).nullish(),
    }))
    .mutation(({ ctx, input }) => {
      const p = parseInboundSale({ ...input, customer: { name: input.customerName, email: input.customerEmail, phone: input.customerPhone } });
      if (!p.ok) throw new TRPCError({ code: "BAD_REQUEST", message: p.problem });
      return mc.recordSale(input.channelId, p.sale, actorOf(ctx));
    }),
  cancelSale: licensed.input(z.object({ id })).mutation(({ ctx, input }) => mc.cancelSale(input.id, actorOf(ctx))),
  retrySale: licensed.input(z.object({ id })).mutation(({ ctx, input }) => mc.retrySale(input.id, actorOf(ctx))),
  retryOperation: licensed.input(z.object({ id })).mutation(({ ctx, input }) => mc.retryOperation(input.id, actorOf(ctx))),
  importCsv: licensed
    .input(z.object({ channelId: id, fileName: z.string().max(200).nullish(), text: z.string().min(1).max(MC_LIMITS.csvBytes) }))
    .mutation(({ ctx, input }) => mc.importCsv(input.channelId, input.text, input.fileName ?? null, actorOf(ctx))),
  imports: licensed.input(z.object({ channelId: id.optional() }).optional()).query(({ input }) => mc.listImports(input?.channelId)),

  // ── Conciliación ────────────────────────────────────────────────────────
  reconciliation: licensed
    .input(z.object({ channelId: id.optional(), from: day.optional(), to: day.optional() }).optional())
    .query(({ input }) => mc.reconciliation(input ?? {})),
  createSettlement: licensed
    .input(z.object({ channelId: id, from: day, to: day, reference: z.string().max(120).nullish(), receivedCents: z.number().int().min(-MC_LIMITS.maxCents).max(MC_LIMITS.maxCents).nullish(), note: z.string().max(500).nullish() }))
    .mutation(({ ctx, input }) => mc.createSettlement(input, actorOf(ctx))),
});
