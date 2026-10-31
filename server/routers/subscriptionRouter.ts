/**
 * subscription.* — plan, prueba, capacidades y límites de la empresa en curso, para su panel.
 *
 * Solo lectura y solo presentación (menú por licencias y página «Suscripción»). No está en
 * TRPC_ROUTER_CAPABILITIES a propósito: una empresa en solo lectura o con la prueba vencida
 * tiene que poder ver su estado y cómo contratar.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getTenantMode } from "../_core/tenant";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { buildSubscriptionOverview } from "../subscriptionOverview";
import { countPanelUsers, PANEL_ROLES } from "../subscriptionDb";
import { resolveSupportContact } from "../supportContact";
import { getTenantId } from "../_core/tenant";
import { CommerceError, commerceClientFromEnv, type CommerceClient } from "../commerceClient";
import { isCompanyOwnerUser } from "../_core/companyOwner";
import { getTrustedBaseUrl } from "../_core/publicUrl";
import { panelModules, type PanelCatalogItemView } from "../panelModules";
import { getLimitAccess } from "../_core/limits/access";
import { LIMIT_METRICS } from "../_core/limits/store";
import type { PanelUsage } from "../commerce/panelUsage";
import type { TenantPlanSummary } from "../commerce/tenantPlan";
import { isTrialTenant, TRIAL_PURCHASES_MESSAGE } from "../trialPayments";
import type { CancellationView as SelfServiceCancellation, PlanChangeView as SelfServicePlanChange } from "../stripe/subscriptionSelfService";

/** Qué se quiere comprar: solo claves y totales. Importes y derechos los calcula el plano de control. */
const purchaseInput = z
  .object({
    add: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/)).max(20).optional(),
    users: z.number().int().min(0).max(100_000).optional(),
    sites: z.number().int().min(0).max(10_000).optional(),
    storageGb: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();
const reductionInput = z
  .object({
    remove: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/)).max(20).optional(),
    users: z.number().int().min(0).max(100_000).optional(),
    sites: z.number().int().min(0).max(10_000).optional(),
    storageGb: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();
/** Contratación desde el panel durante la prueba: solo QUÉ se elige; precio, impuestos y elegibilidad, del plano de control. */
const conversionSelection = z
  .object({
    plan: z.enum(["essential", "business"]),
    interval: z.enum(["month", "year"]),
    add: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/)).max(20).optional(),
  })
  .strict();
const conversionStart = conversionSelection
  .extend({
    idempotencyKey: z.string().uuid(),
    // El perfil fiscal y los consentimientos los valida el plano de control (mismas reglas que el autoservicio)
    buyer: z.record(z.string(), z.unknown()),
    consents: z.record(z.string(), z.unknown()),
  })
  .strict();
/** Cambio de plan: solo el destino; importes y prorrateo, del plano de control (Stripe). */
const planTarget = z.object({ plan: z.enum(["essential", "business"]), interval: z.enum(["month", "year"]) }).strict();
const TRPC_CODE: Record<number, TRPCError["code"]> = { 400: "BAD_REQUEST", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 503: "PRECONDITION_FAILED" };

/**
 * Compra de módulos: solo el administrador de la empresa en curso, con el tenant de la SESIÓN (nunca del
 * navegador) y en modo multiempresa. Sin CP_COMMERCE_URL/TOKEN no está disponible.
 */
async function commerce<T>(role: string, fn: (c: CommerceClient, tenantId: string) => Promise<T>, denied = "Solo la administración de la empresa puede comprar"): Promise<T> {
  if (role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: denied });
  return reach(fn);
}

/** Canal con el plano de control para el tenant de la sesión (sin comprobar el rol: quien llama lo ha hecho). */
async function reach<T>(fn: (c: CommerceClient, tenantId: string) => Promise<T>): Promise<T> {
  if (getTenantMode() !== "multi") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La compra en línea no está disponible" });
  const client = commerceClientFromEnv();
  if (!client) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La compra en línea no está disponible" });
  try {
    return await fn(client, getTenantId());
  } catch (e) {
    if (e instanceof CommerceError) throw new TRPCError({ code: TRPC_CODE[e.status] ?? "INTERNAL_SERVER_ERROR", message: e.message });
    throw e;
  }
}

/** Compras y bajas de módulos: no durante la prueba (en el servidor, también por llamada directa). */
async function notInTrial() {
  if (await isTrialTenant()) throw new TRPCError({ code: "FORBIDDEN", message: TRIAL_PURCHASES_MESSAGE });
}

/**
 * Compra aplicada (licencias ya concedidas en el registro por el plano de control): se descarta la caché de licencias
 * de la empresa para que el panel (menú y catálogo) las vea en la siguiente consulta, sin esperar a que caduque.
 */
function appliedRefresh<T>(tenantId: string, r: T): T {
  if ((r as { status?: unknown } | null)?.status === "applied") getCapabilityAccess().invalidate(tenantId);
  return r;
}

export const subscriptionRouter = router({
  /**
   * «Mi plan»: contrato vigente (plan, periodicidad, importe), periodo y renovación, estado del cobro y facturas.
   * Solo la administración. `null` sin canal con el plano de control o fuera de multiempresa (la página muestra
   * entonces solo la licencia). Sin contrato (prueba), `contract` es null.
   */
  plan: protectedProcedure.query(async ({ ctx }) => {
    if (String(ctx.user.role) !== "admin" || getTenantMode() !== "multi" || !commerceClientFromEnv()) return null;
    return (await reach((c, t) => c.plan(t))) as TenantPlanSummary;
  }),
  invoiceDocument: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(({ ctx, input }) =>
    commerce(String(ctx.user.role), (c, t) => c.invoiceDocument(t, input.id), "Solo la administración de la empresa puede ver las facturas"),
  ),
  overview: protectedProcedure.query(async ({ ctx }) => {
    if (!(PANEL_ROLES as readonly string[]).includes(String(ctx.user.role))) throw new TRPCError({ code: "FORBIDDEN" });
    const mode = getTenantMode();
    const upgradeUrl = process.env.ELEPHANT_PRICING_URL ?? process.env.CP_TRIAL_PRICING_URL ?? null;
    if (mode !== "multi") return buildSubscriptionOverview({ mode, enforcing: false, grants: [], now: Date.now(), upgradeUrl });
    const access = getCapabilityAccess();
    let grants;
    try {
      grants = await access.list();
    } catch {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo consultar la suscripción. Inténtalo de nuevo en unos minutos." });
    }
    const usedUsers = await countPanelUsers();
    return buildSubscriptionOverview({ mode, enforcing: access.enforcing(), grants, now: access.currentTime(), usedUsers, upgradeUrl });
  }),
  /**
   * Módulos y ampliaciones de la plataforma con su estado para ESTA empresa (incluido, solo lectura, a la venta, bajo
   * petición, próximamente). Solo lectura. `null` si no hay canal con el plano de control o fuera de multiempresa:
   * la pantalla muestra entonces solo el enlace de contratación.
   */
  catalog: protectedProcedure.query(async ({ ctx }) => {
    if (!(PANEL_ROLES as readonly string[]).includes(String(ctx.user.role))) throw new TRPCError({ code: "FORBIDDEN" });
    const client = commerceClientFromEnv();
    if (getTenantMode() !== "multi" || !client) return null;
    const access = getCapabilityAccess();
    try {
      const [catalog, grants] = await Promise.all([client.catalog(getTenantId()) as Promise<{ purchasesEnabled: boolean; items: PanelCatalogItemView[] }>, access.list()]);
      // Solo la administración compra: al resto se le muestra el catálogo sin el botón
      const out = panelModules(catalog, grants, access.currentTime());
      // Totales contratados hoy (plan + ampliaciones): la compra de unidades pide el NUEVO total. null = sin tope.
      const limitAccess = getLimitAccess();
      const totals: Record<string, number | null> = {};
      for (const m of LIMIT_METRICS) {
        const v = limitAccess ? await limitAccess.limit(m).catch(() => undefined) : undefined;
        if (v !== undefined) totals[m] = v;
      }
      return { ...out, totals, usedUsers: await countPanelUsers().catch(() => null), canPurchase: String(ctx.user.role) === "admin" && out.purchasesEnabled && !(await isTrialTenant()) };
    } catch {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo consultar el catálogo de módulos. Inténtalo de nuevo en unos minutos." });
    }
  }),
  /**
   * Consumo de la empresa frente a los límites de su plan (correo, IA, ficheros, exportaciones), medido por Elephant
   * Resource Manager. Solo lectura. `null` fuera de multiempresa o sin canal con el plano de control.
   */
  usage: protectedProcedure.query(async ({ ctx }) => {
    if (!(PANEL_ROLES as readonly string[]).includes(String(ctx.user.role))) throw new TRPCError({ code: "FORBIDDEN" });
    const client = commerceClientFromEnv();
    if (getTenantMode() !== "multi" || !client) return null;
    try {
      return (await client.usage(getTenantId())) as PanelUsage;
    } catch {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo consultar el consumo. Inténtalo de nuevo en unos minutos." });
    }
  }),
  /** Vista previa de una compra: partidas y prorrateo calculados por el plano de control (no cambia nada). */
  purchasePreview: protectedProcedure.input(purchaseInput).mutation(async ({ ctx, input }) => {
    await notInTrial();
    return commerce(String(ctx.user.role), (c, t) => c.preview(t, input));
  }),
  /** Compra (idempotente por la clave que genera el navegador para cada intento). */
  purchase: protectedProcedure
    .input(purchaseInput.extend({ idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }))
    .mutation(async ({ ctx, input }) => {
      await notInTrial();
      const { idempotencyKey, ...what } = input;
      return commerce(String(ctx.user.role), async (c, t) => appliedRefresh(t, await c.purchase(t, what, { idempotencyKey, buyer: `user:${ctx.user.id}` })));
    }),
  purchaseStatus: protectedProcedure.input(z.object({ orderId: z.number().int().positive() })).query(({ ctx, input }) => commerce(String(ctx.user.role), async (c, t) => appliedRefresh(t, await c.status(t, input.orderId)))),
  /** Bajas y reducciones a fin de periodo: qué cambiaría (sin abonos; nunca por debajo del uso real). */
  reductionPreview: protectedProcedure.input(reductionInput).mutation(async ({ ctx, input }) => {
    await notInTrial();
    return commerce(String(ctx.user.role), (c, t) => c.previewReduction(t, input));
  }),
  reduce: protectedProcedure
    .input(reductionInput.extend({ idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }))
    .mutation(async ({ ctx, input }) => {
      await notInTrial();
      const { idempotencyKey, ...what } = input;
      return commerce(String(ctx.user.role), (c, t) => c.reduce(t, what, { idempotencyKey, buyer: `user:${ctx.user.id}` }));
    }),
  /**
   * Desistimiento del contrato (particulares, 14 días): estado para la cuenta. Sin canal con el plano de control,
   * fuera de multiempresa o sin permiso, null (la sección no se muestra). La cancelación ordinaria es otra cosa.
   */
  withdrawalStatus: protectedProcedure.query(async ({ ctx }) => {
    if (String(ctx.user.role) !== "admin" || getTenantMode() !== "multi" || !commerceClientFromEnv()) return null;
    return commerce(String(ctx.user.role), (c, t) => c.withdrawalStatus(t)).catch(() => null);
  }),
  /** Solicitud de desistimiento (idempotente por la clave del navegador): devuelve el justificante. */
  withdraw: protectedProcedure
    .input(z.object({ idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/), contactEmail: z.string().trim().email().max(200).optional(), statement: z.string().trim().max(1000).optional() }).strict())
    .mutation(({ ctx, input }) =>
      commerce(
        String(ctx.user.role),
        (c, t) => c.withdraw(t, { idempotencyKey: input.idempotencyKey, requestedBy: `user:${ctx.user.id}`, contactEmail: input.contactEmail ?? String(ctx.user.email ?? ""), ...(input.statement ? { statement: input.statement } : {}) }),
        "Solo la administración de la cuenta puede desistir del contrato",
      ),
    ),
  /** Canal de ayuda (correo configurable): disponible también en solo lectura o con la prueba vencida. */
  /**
   * Portal de facturación de Stripe (facturas y método de pago), solo para la persona propietaria. `null` si no está
   * disponible (apagado en el plano de control, sin canal o fuera de multiempresa): el botón no se muestra.
   */
  billingPortalStatus: protectedProcedure.query(async ({ ctx }) => {
    if (getTenantMode() !== "multi" || !commerceClientFromEnv() || !(await isCompanyOwnerUser(ctx.user).catch(() => false))) return null;
    return commerce(String(ctx.user.role), (c) => c.billingPortalStatus()).catch(() => null);
  }),
  billingPortal: protectedProcedure.mutation(async ({ ctx }) => {
    if (!(await isCompanyOwnerUser(ctx.user))) throw new TRPCError({ code: "FORBIDDEN", message: "Solo la persona propietaria de la empresa puede ver las facturas de la suscripción" });
    return commerce(String(ctx.user.role), (c, t) => c.billingPortal(t, `${getTrustedBaseUrl()}/admin/suscripcion`));
  }),
  /**
   * Contratación desde el panel durante la prueba (conversión a pago con Stripe Checkout). Solo la administración y
   * solo en prueba. `null` si no aplica (sin canal, fuera de multiempresa, sin prueba o sin permiso): el bloque no se
   * muestra. `enabled:false` con motivos si el plano de control aún no la ofrece (decisión comercial pendiente).
   */
  conversionStatus: protectedProcedure.query(async ({ ctx }) => {
    if (String(ctx.user.role) !== "admin" || getTenantMode() !== "multi" || !commerceClientFromEnv() || !(await isTrialTenant())) return null;
    return reach((c) => c.conversionStatus()).catch(() => null);
  }),
  conversionPreview: protectedProcedure.input(conversionSelection).mutation(async ({ ctx, input }) => {
    if (!(await isTrialTenant())) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Tu empresa no está en periodo de prueba" });
    return commerce(String(ctx.user.role), (c, t) => c.conversionPreview(t, input), "Solo la administración de la empresa puede contratar");
  }),
  /** Abre el pago en Stripe. La activación llega SOLO con el pago verificado (webhook), nunca con la vuelta del navegador. */
  conversionStart: protectedProcedure.input(conversionStart).mutation(async ({ ctx, input }) => {
    if (!(await isTrialTenant())) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Tu empresa no está en periodo de prueba" });
    const r = await commerce(String(ctx.user.role), (c, t) => c.conversionStart(t, { ...input, user: `user:${ctx.user.id}` }), "Solo la administración de la empresa puede contratar");
    // Solo se redirige a Stripe Checkout (nunca a otra dirección que devolviera el canal)
    if (!/^https:\/\/checkout\.stripe\.com\//.test(r.url)) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se ha podido iniciar el pago" });
    return { url: r.url, expiresAt: r.expiresAt };
  }),
  /**
   * Baja de la suscripción cobrada en Stripe (al final del periodo pagado) y su reactivación: solo la persona
   * propietaria, fuera de la prueba. `null` si no aplica (sin canal, fuera de multiempresa, en prueba o sin permiso):
   * la sección no se muestra. El cambio en Elephant llega por el webhook de Stripe; nunca se borran datos.
   */
  cancellationStatus: protectedProcedure.query(async ({ ctx }) => {
    if (getTenantMode() !== "multi" || !commerceClientFromEnv() || (await isTrialTenant().catch(() => true)) || !(await isCompanyOwnerUser(ctx.user).catch(() => false))) return null;
    return reach((c, t) => c.cancellationStatus(t)).catch(() => null) as Promise<SelfServiceCancellation | null>;
  }),
  cancel: protectedProcedure
    .input(z.object({ idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/), reason: z.string().trim().max(500).optional() }).strict())
    .mutation(async ({ ctx, input }) => {
      await notInTrial();
      if (!(await isCompanyOwnerUser(ctx.user))) throw new TRPCError({ code: "FORBIDDEN", message: "Solo la persona propietaria de la empresa puede dar de baja la suscripción" });
      return reach((c, t) => c.cancel(t, { idempotencyKey: input.idempotencyKey, user: `user:${ctx.user.id}`, ...(input.reason ? { reason: input.reason } : {}) }));
    }),
  undoCancel: protectedProcedure.input(z.object({ idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }).strict()).mutation(async ({ ctx, input }) => {
    await notInTrial();
    if (!(await isCompanyOwnerUser(ctx.user))) throw new TRPCError({ code: "FORBIDDEN", message: "Solo la persona propietaria de la empresa puede mantener la suscripción" });
    return reach((c, t) => c.undoCancel(t, { idempotencyKey: input.idempotencyKey, user: `user:${ctx.user.id}` }));
  }),
  /**
   * Cambio de plan o periodicidad (subida inmediata con prorrateo; bajada como solicitud para el fin del periodo):
   * solo la administración, fuera de la prueba. `null` si no aplica: la sección no se muestra.
   */
  planChangeStatus: protectedProcedure.query(async ({ ctx }) => {
    if (String(ctx.user.role) !== "admin" || getTenantMode() !== "multi" || !commerceClientFromEnv() || (await isTrialTenant().catch(() => true))) return null;
    return reach((c, t) => c.planChangeStatus(t)).catch(() => null) as Promise<SelfServicePlanChange | null>;
  }),
  planChangePreview: protectedProcedure.input(planTarget).mutation(async ({ ctx, input }) => {
    await notInTrial();
    return commerce(String(ctx.user.role), (c, t) => c.planChangePreview(t, input), "Solo la administración de la empresa puede cambiar de plan");
  }),
  changePlan: protectedProcedure
    .input(planTarget.extend({ idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }).strict())
    .mutation(async ({ ctx, input }) => {
      await notInTrial();
      const r = (await commerce(String(ctx.user.role), (c, t) => c.changePlan(t, { ...input, user: `user:${ctx.user.id}` }), "Solo la administración de la empresa puede cambiar de plan")) as { paymentUrl?: string | null };
      // Solo se devuelve una página de pago de Stripe (nunca otra dirección que devolviera el canal)
      if (r.paymentUrl && !/^https:\/\/(invoice\.stripe\.com|pay\.stripe\.com)\//.test(r.paymentUrl)) return { ...r, paymentUrl: null };
      return r;
    }),
  supportContact: protectedProcedure.query(async ({ ctx }) => {
    if (!(PANEL_ROLES as readonly string[]).includes(String(ctx.user.role))) throw new TRPCError({ code: "FORBIDDEN" });
    return resolveSupportContact();
  }),
});
