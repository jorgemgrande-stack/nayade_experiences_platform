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
const TRPC_CODE: Record<number, TRPCError["code"]> = { 400: "BAD_REQUEST", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 503: "PRECONDITION_FAILED" };

/**
 * Compra de módulos: solo el administrador de la empresa en curso, con el tenant de la SESIÓN (nunca del
 * navegador) y en modo multiempresa. Sin CP_COMMERCE_URL/TOKEN no está disponible.
 */
async function commerce<T>(role: string, fn: (c: CommerceClient, tenantId: string) => Promise<T>, denied = "Solo la administración de la empresa puede comprar"): Promise<T> {
  if (role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: denied });
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

export const subscriptionRouter = router({
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
      return { ...out, canPurchase: String(ctx.user.role) === "admin" && out.purchasesEnabled };
    } catch {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo consultar el catálogo de módulos. Inténtalo de nuevo en unos minutos." });
    }
  }),
  /** Vista previa de una compra: partidas y prorrateo calculados por el plano de control (no cambia nada). */
  purchasePreview: protectedProcedure.input(purchaseInput).mutation(({ ctx, input }) => commerce(String(ctx.user.role), (c, t) => c.preview(t, input))),
  /** Compra (idempotente por la clave que genera el navegador para cada intento). */
  purchase: protectedProcedure
    .input(purchaseInput.extend({ idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }))
    .mutation(({ ctx, input }) => {
      const { idempotencyKey, ...what } = input;
      return commerce(String(ctx.user.role), (c, t) => c.purchase(t, what, { idempotencyKey, buyer: `user:${ctx.user.id}` }));
    }),
  purchaseStatus: protectedProcedure.input(z.object({ orderId: z.number().int().positive() })).query(({ ctx, input }) => commerce(String(ctx.user.role), (c, t) => c.status(t, input.orderId))),
  /** Bajas y reducciones a fin de periodo: qué cambiaría (sin abonos; nunca por debajo del uso real). */
  reductionPreview: protectedProcedure.input(reductionInput).mutation(({ ctx, input }) => commerce(String(ctx.user.role), (c, t) => c.previewReduction(t, input))),
  reduce: protectedProcedure
    .input(reductionInput.extend({ idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }))
    .mutation(({ ctx, input }) => {
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
  supportContact: protectedProcedure.query(async ({ ctx }) => {
    if (!(PANEL_ROLES as readonly string[]).includes(String(ctx.user.role))) throw new TRPCError({ code: "FORBIDDEN" });
    return resolveSupportContact();
  }),
});
