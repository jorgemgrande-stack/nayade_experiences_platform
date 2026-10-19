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

/** Qué se quiere comprar: solo claves y totales. Importes y derechos los calcula el plano de control. */
const purchaseInput = z
  .object({
    add: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/)).max(20).optional(),
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
async function commerce<T>(role: string, fn: (c: CommerceClient, tenantId: string) => Promise<T>): Promise<T> {
  if (role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Solo la administración de la empresa puede comprar" });
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
  /** Canal de ayuda (correo configurable): disponible también en solo lectura o con la prueba vencida. */
  supportContact: protectedProcedure.query(async ({ ctx }) => {
    if (!(PANEL_ROLES as readonly string[]).includes(String(ctx.user.role))) throw new TRPCError({ code: "FORBIDDEN" });
    return resolveSupportContact();
  }),
});
