/**
 * API tRPC de Ski Rental (`skiRental.*`). Solo administración: todavía no hay reserva pública ni pago. La v1 por unidad
 * añade procedimientos (tiendas, modelos, unidades, entregas, contratos y taller) sin cambiar los de la v0.1.
 *
 * La licencia NO va en `capabilityRouteGuard` (que no conoce la sede): la aplica el servicio en cada
 * procedimiento con la licencia por capacidad de la sede. Los errores del SDK salen tipados
 * (`[module_not_licensed] …`, `[module_read_only] …`, `[module_not_active] …`).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { SdkError, getSdkRuntime, installSdkModule, toTrpcError } from "../sdk";
import { ITEM_CATEGORIES, RENTAL_STATUSES } from "./availability";
import { skiRentalModule } from "./manifest";
import { SkiRentalError, SkiRentalService } from "./service";
import { TenantDbSkiRentalStore } from "./store";
import { SkiRentalUnitsService } from "./unitService";
import { TenantDbSkiRentalUnitStore } from "./unitStore";
import { UNIT_STATUSES } from "./units";
import { SIGN_LINK_MAX_HOURS, issueSignLink, revokeSignLink, signLinkStatus } from "../netPublic/skiSign";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { companySites } from "../sitesDb";
import { storagePut } from "../storage";
import { objectStorageEnabled } from "../_core/files/service";
import { tpvRouter } from "../routers/tpv";
import { DEPOSIT_METHODS, MAX_DEPOSIT_CENTS, PAY_METHODS, REQUEST_KEY_RE, centsToEuros } from "../../shared/skiDeposits";
import { MAX_PHOTO_BYTES, SkiDepositService, type CreateDamageSale } from "./depositService";
import { TenantDbDepositStore } from "./depositStore";
import { withTenantLock } from "../tpvSaleIdempotency";

/** Espera máxima (s) por el bloqueo de un cargo o una fianza; las pruebas la acortan. */
export const depositLockWait = { seconds: 30 };

// Un módulo que no valida no impide arrancar al Core: queda sin registrar y sus rutas responden NOT_FOUND
try {
  installSdkModule(skiRentalModule);
} catch (e) {
  console.warn(JSON.stringify({ ctx: "SkiRental", event: "install_failed", error: e instanceof Error ? e.message.slice(0, 200) : "error" }));
}

const store = new TenantDbSkiRentalStore();
const service = new SkiRentalService({
  store,
  gate: () => getSdkRuntime().gate,
  events: () => getSdkRuntime().events,
});
const unitStore = new TenantDbSkiRentalUnitStore();
const units = new SkiRentalUnitsService({
  store: unitStore,
  activation: store,
  gate: () => getSdkRuntime().gate,
  events: () => getSdkRuntime().events,
});
/** Fianzas del alquiler (incluidas en la capacidad ski-rental): server/skiRental/depositService.ts. */
const deposits = new SkiDepositService({
  store: new TenantDbDepositStore(),
  units: unitStore,
  activation: store,
  gate: () => getSdkRuntime().gate,
  isPrimarySite: async (siteId) => (await companySites()).primarySiteId === siteId,
  photosEnabled: objectStorageEnabled,
  // Un cobro o una liquidación a la vez por cargo o por fianza, en todas las réplicas (bloqueo con nombre de MySQL)
  lock: (scope, key, fn) => withTenantLock(scope, key, depositLockWait.seconds, "Este cobro ya se está registrando. Espera unos segundos y revisa el cargo antes de repetirlo.", fn),
});

/**
 * Venta «Cargo por daños» en el TPV del Core (concepto libre, con su ticket, IVA y numeración) con la sesión de quien
 * cobra. Llamar al TPV desde aquí no pasa por el guardián HTTP de su namespace: se comprueba su licencia (caja).
 */
async function damageSale(ctx: Parameters<typeof tpvRouter.createCaller>[0]): Promise<CreateDamageSale> {
  const cash = await getCapabilityAccess().check("bill-cash", { write: true }).catch(() => ({ allowed: false }));
  if (!cash.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "La caja (TPV) no está incluida en tu plan o está en solo lectura: no se puede cobrar el cargo por daños." });
  // El TPV solo admite conceptos libres a administradores (tpv.createSale): se comprueba antes de reservar nada
  if ((ctx as { user?: { role?: string } }).user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Solo un administrador puede registrar cargos por daños en el TPV." });
  const tpv = tpvRouter.createCaller(ctx);
  return async (s) => {
    const euros = centsToEuros(s.amountCents);
    const r = await tpv.createSale({
      sessionId: s.sessionId,
      idempotencyKey: s.idempotencyKey,
      customerName: s.customerName || undefined,
      notes: s.notes,
      discountAmount: 0,
      // IVA general siempre (nunca REAV). PENDIENTE DEL ASESOR FISCAL: una indemnización por daños puede no estar
      // sujeta a IVA (art. 78.Tres.1º LIVA); hoy se documenta con ticket e IVA general.
      items: [{ productType: "extra", productId: 0, productName: "Cargo por daños (alquiler de material)", quantity: 1, unitPrice: euros, discountPercent: 0, participants: 1, isManual: true, forceGeneralVat: true, conceptText: s.concept }],
      payments: [{ method: s.method, amount: euros }],
    });
    return { saleId: Number(r.sale?.id), ticketNumber: r.sale?.ticketNumber ? String(r.sale.ticketNumber) : null };
  };
}
const cents = z.number().int().min(0).max(MAX_DEPOSIT_CENTS);
const cashierOf = (ctx: { user: { name?: string | null; email?: string | null } }) => ctx.user.name ?? ctx.user.email ?? "Mostrador";
/** El mismo servicio para la firma remota (server/netPublic/skiSign.ts): una sola forma de firmar. */
export const skiRentalUnitsService = units;

const CODES: Record<SkiRentalError["code"], TRPCError["code"]> = { invalid_input: "BAD_REQUEST", not_found: "NOT_FOUND", conflict: "CONFLICT" };

async function handle<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SdkError) throw toTrpcError(e);
    if (e instanceof SkiRentalError) throw new TRPCError({ code: CODES[e.code], message: e.message });
    throw e;
  }
}

const site = z.object({ siteId: z.string().min(1).max(63) });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const actor = (ctx: { user: { id: number } }) => `user:${ctx.user.id}`;
const id = z.number().int().positive();
const time = z.string().regex(/^\d{2}:\d{2}$/);
const hours = { openingTime: time, closingTime: time, overdueReturnTime: time };
const codeLabels = z.array(z.object({ code: z.string().max(24), label: z.string().max(60) })).max(30);
/** Evidencia del equipo donde se firma: IP (según el `trust proxy` del Core) y navegador. */
const evidence = (ctx: { req: { ip?: string; headers: Record<string, string | string[] | undefined> } }) => {
  const ua = ctx.req.headers["user-agent"];
  return { ip: ctx.req.ip ?? null, userAgent: typeof ua === "string" ? ua.slice(0, 300) : null };
};

export const skiRentalRouter = router({
  status: adminProcedure.input(site).query(({ input }) => handle(() => service.status(input.siteId))),
  activateSite: adminProcedure.input(site).mutation(({ input, ctx }) => handle(() => service.activateSite(input.siteId, actor(ctx)))),
  deactivateSite: adminProcedure.input(site).mutation(({ input, ctx }) => handle(() => service.deactivateSite(input.siteId, actor(ctx)))),

  listItems: adminProcedure.input(site).query(({ input }) => handle(() => service.listItems(input.siteId))),
  createItem: adminProcedure
    .input(site.extend({ category: z.enum(ITEM_CATEGORIES), name: z.string(), size: z.string().optional(), quantity: z.number().int() }))
    .mutation(({ input }) => handle(() => service.createItem(input.siteId, input))),
  updateItem: adminProcedure
    .input(site.extend({ itemId: z.number().int().positive(), name: z.string().optional(), quantity: z.number().int().optional(), active: z.boolean().optional() }))
    .mutation(({ input }) => handle(() => service.updateItem(input.siteId, input.itemId, input))),

  availability: adminProcedure
    .input(site.extend({ from: day, to: day, category: z.enum(ITEM_CATEGORIES).optional() }))
    .query(({ input }) => handle(() => service.availability(input.siteId, input.from, input.to, input.category))),

  listRentals: adminProcedure.input(site.extend({ status: z.enum(RENTAL_STATUSES).optional() })).query(({ input }) => handle(() => service.listRentals(input.siteId, input.status))),
  createRental: adminProcedure
    .input(site.extend({ itemId: z.number().int().positive(), quantity: z.number().int(), customerName: z.string(), startDate: day, endDate: day }))
    .mutation(({ input, ctx }) => handle(() => service.createRental(input.siteId, input, actor(ctx)))),
  pickUp: adminProcedure.input(site.extend({ rentalId: z.number().int().positive() })).mutation(({ input }) => handle(() => service.pickUp(input.siteId, input.rentalId))),
  returnRental: adminProcedure.input(site.extend({ rentalId: z.number().int().positive() })).mutation(({ input }) => handle(() => service.returnRental(input.siteId, input.rentalId))),
  cancelRental: adminProcedure.input(site.extend({ rentalId: z.number().int().positive() })).mutation(({ input }) => handle(() => service.cancelRental(input.siteId, input.rentalId))),

  // ── v1 por unidad ──
  settings: adminProcedure.input(site).query(({ input }) => handle(() => units.settings(input.siteId))),
  updateSettings: adminProcedure
    .input(site.extend({ assetTypes: codeLabels.optional(), contractTerms: z.string().max(20_000).nullable().optional() }))
    .mutation(({ input, ctx }) => {
      const { siteId, ...rest } = input;
      return handle(() => units.updateSettings(siteId, rest, actor(ctx)));
    }),
  listStores: adminProcedure.input(site).query(({ input }) => handle(() => units.listStores(input.siteId))),
  createStore: adminProcedure.input(site.extend({ name: z.string().max(120), ...hours })).mutation(({ input }) => {
    const { siteId, ...rest } = input;
    return handle(() => units.createStore(siteId, rest));
  }),
  updateStore: adminProcedure
    .input(site.extend({ storeId: id, name: z.string().max(120).optional(), openingTime: time.optional(), closingTime: time.optional(), overdueReturnTime: time.optional(), active: z.boolean().optional() }))
    .mutation(({ input }) => {
      const { siteId, storeId, ...rest } = input;
      return handle(() => units.updateStore(siteId, storeId, rest));
    }),
  listModels: adminProcedure.input(site).query(({ input }) => handle(() => units.listModels(input.siteId))),
  createModel: adminProcedure
    .input(site.extend({ assetType: z.string().max(24), name: z.string().max(120), brand: z.string().max(80).nullable().optional(), size: z.string().max(16).nullable().optional(), replacementValueCents: z.number().int().nullable().optional() }))
    .mutation(({ input }) => {
      const { siteId, ...rest } = input;
      return handle(() => units.createModel(siteId, rest));
    }),
  updateModel: adminProcedure
    .input(site.extend({ modelId: id, name: z.string().max(120).optional(), brand: z.string().max(80).nullable().optional(), replacementValueCents: z.number().int().nullable().optional(), active: z.boolean().optional() }))
    .mutation(({ input }) => {
      const { siteId, modelId, ...rest } = input;
      return handle(() => units.updateModel(siteId, modelId, rest));
    }),
  listUnits: adminProcedure
    .input(site.extend({ modelId: id.optional(), status: z.enum(UNIT_STATUSES).optional() }))
    .query(({ input }) => handle(() => units.listUnits(input.siteId, { modelId: input.modelId, status: input.status }))),
  createUnits: adminProcedure
    .input(site.extend({ modelId: id, storeId: id.nullable().optional(), codes: z.array(z.string().max(40)).max(200).optional(), count: z.number().int().optional() }))
    .mutation(({ input, ctx }) => {
      const { siteId, ...rest } = input;
      return handle(() => units.createUnits(siteId, rest, actor(ctx)));
    }),
  scanUnit: adminProcedure.input(site.extend({ code: z.string().max(60) })).query(({ input }) => handle(() => units.scan(input.siteId, input.code))),
  unitHistory: adminProcedure.input(site.extend({ unitId: id })).query(({ input }) => handle(() => units.unitHistory(input.siteId, input.unitId))),
  setUnitStatus: adminProcedure
    .input(site.extend({ unitId: id, status: z.enum(UNIT_STATUSES), note: z.string().max(300).nullable().optional() }))
    .mutation(({ input, ctx }) => handle(() => units.setUnitStatus(input.siteId, input.unitId, input.status, input.note, actor(ctx)))),
  listDeliveries: adminProcedure
    .input(site.extend({ status: z.enum(["open", "returned"]).optional() }))
    .query(({ input }) => handle(() => units.listDeliveries(input.siteId, input.status))),
  getDelivery: adminProcedure.input(site.extend({ deliveryId: id })).query(({ input }) => handle(() => units.getDelivery(input.siteId, input.deliveryId))),
  createDelivery: adminProcedure
    .input(
      site.extend({
        storeId: id,
        customerName: z.string().max(120),
        reservationId: id.nullable().optional(),
        startDate: day,
        expectedReturnDate: day,
        lines: z
          .array(
            z.object({
              code: z.string().max(60),
              requestedType: z.string().max(24),
              requestedSize: z.string().max(16).nullable().optional(),
              confirmSize: z.boolean().optional(),
              reason: z.string().max(200).nullable().optional(),
            }),
          )
          .max(30),
      }),
    )
    .mutation(({ input, ctx }) => {
      const { siteId, ...rest } = input;
      return handle(() => units.createDelivery(siteId, rest, actor(ctx)));
    }),
  returnLine: adminProcedure
    .input(site.extend({ lineId: id, condition: z.enum(["ok", "damaged", "lost"]), note: z.string().max(300).nullable().optional() }))
    .mutation(({ input, ctx }) => handle(() => units.returnLine(input.siteId, input.lineId, input.condition, input.note, actor(ctx)))),
  signContract: adminProcedure
    .input(site.extend({ deliveryId: id, signerName: z.string().max(120), accepted: z.boolean() }))
    .mutation(({ input, ctx }) => handle(() => units.signContract(input.siteId, input.deliveryId, input, evidence(ctx), actor(ctx)))),
  listContracts: adminProcedure
    .input(site.extend({ status: z.enum(["pending", "signed"]).optional() }))
    .query(({ input }) => handle(() => units.listContracts(input.siteId, input.status))),
  // Firma remota (enlace de un solo uso con caducidad; la página pública es /firma/<token>)
  signLinkStatus: adminProcedure.input(site.extend({ deliveryId: id })).query(({ input }) => signLinkStatus(input.siteId, input.deliveryId)),
  issueSignLink: adminProcedure
    .input(site.extend({ deliveryId: id, hours: z.number().int().min(1).max(SIGN_LINK_MAX_HOURS).optional() }))
    .mutation(({ input, ctx }) => issueSignLink(input.siteId, input.deliveryId, input.hours, actor(ctx))),
  revokeSignLink: adminProcedure.input(site.extend({ deliveryId: id })).mutation(({ input, ctx }) => revokeSignLink(input.siteId, input.deliveryId, actor(ctx))),
  listTickets: adminProcedure
    .input(site.extend({ status: z.enum(["open", "done"]).optional() }))
    .query(({ input }) => handle(() => units.listTickets(input.siteId, input.status))),
  openTicket: adminProcedure
    .input(site.extend({ unitId: id, reason: z.string().max(300) }))
    .mutation(({ input, ctx }) => handle(() => units.openTicket(input.siteId, input.unitId, input.reason, actor(ctx)))),
  closeTicket: adminProcedure
    .input(site.extend({ ticketId: id, resolution: z.enum(["available", "incident", "retired"]), notes: z.string().max(500).nullable().optional() }))
    .mutation(({ input, ctx }) => handle(() => units.closeTicket(input.siteId, input.ticketId, input.resolution, input.notes, actor(ctx)))),

  // ── Fianzas (incluidas en ski-rental) ──
  depositRules: adminProcedure.input(site).query(({ input }) => handle(() => deposits.listRules(input.siteId))),
  setDepositRule: adminProcedure
    .input(site.extend({ modelId: id.nullable().optional(), assetType: z.string().max(24).nullable().optional(), amountCents: cents.nullable() }))
    .mutation(({ input, ctx }) => handle(() => deposits.setRule(input.siteId, input, actor(ctx)))),
  depositCashSessions: adminProcedure.input(site).query(({ input }) => handle(() => deposits.cashSessions(input.siteId))),
  depositForDelivery: adminProcedure.input(site.extend({ deliveryId: id })).query(({ input }) => handle(() => deposits.forDelivery(input.siteId, input.deliveryId))),
  registerDeposit: adminProcedure
    .input(site.extend({ deliveryId: id, amountCents: cents, method: z.enum(DEPOSIT_METHODS), sessionId: id.nullable().optional(), externalRef: z.string().max(120).nullable().optional() }))
    .mutation(({ input, ctx }) => {
      const { siteId, ...rest } = input;
      return handle(() => deposits.register(siteId, rest, actor(ctx), cashierOf(ctx)));
    }),
  settleDeposit: adminProcedure
    .input(site.extend({ depositId: id, damageCents: cents, reason: z.string().max(300).nullable().optional(), note: z.string().max(1000).nullable().optional(), sessionId: id.nullable().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { siteId, depositId, ...rest } = input;
      return handle(() => deposits.settle(siteId, depositId, rest, actor(ctx), cashierOf(ctx), () => damageSale(ctx)));
    }),
  addDepositPhoto: adminProcedure
    .input(site.extend({ depositId: id, fileName: z.string().max(200), mimeType: z.string().max(80), base64: z.string().max(Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 8) }))
    .mutation(({ input, ctx }) =>
      handle(() =>
        deposits.addPhoto(input.siteId, input.depositId, { fileName: input.fileName, mimeType: input.mimeType, data: Buffer.from(input.base64, "base64") }, actor(ctx), async (key, data, mime, name) => {
          const r = await storagePut(key, data, mime, { category: "internal", originalName: name, uploadedBy: ctx.user.id });
          return r.url;
        }),
      ),
    ),
  createDamageCharge: adminProcedure
    .input(site.extend({ deliveryId: id, amountCents: cents, reason: z.string().max(300), requestKey: z.string().regex(REQUEST_KEY_RE) }))
    .mutation(({ input, ctx }) => {
      const { siteId, ...rest } = input;
      return handle(() => deposits.createCharge(siteId, rest, actor(ctx)));
    }),
  payDamageCharge: adminProcedure
    .input(site.extend({ chargeId: id, sessionId: id, method: z.enum(PAY_METHODS) }))
    .mutation(async ({ input, ctx }) => {
      const sale = await damageSale(ctx);
      return handle(() => deposits.payCharge(input.siteId, input.chargeId, { sessionId: input.sessionId, method: input.method }, actor(ctx), sale));
    }),
  cancelDamageCharge: adminProcedure
    .input(site.extend({ chargeId: id, reason: z.string().max(300) }))
    .mutation(({ input, ctx }) => handle(() => deposits.cancelCharge(input.siteId, input.chargeId, input.reason, actor(ctx)))),
  listDeposits: adminProcedure.input(site.extend({ status: z.enum(["open", "closed"]) })).query(({ input }) => handle(() => deposits.list(input.siteId, input.status))),
  depositTotals: adminProcedure.input(site.extend({ day: day.optional() })).query(({ input }) => handle(() => deposits.totals(input.siteId, input.day ?? SkiDepositService.today()))),
});
