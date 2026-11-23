/**
 * cobros.ts — Ajustes › Cobros: la cuenta Stripe PROPIA de cada empresa (Stripe Connect).
 *
 * Solo multiempresa. Todas las operaciones exigen administrador (`settings.manage`). Prueba: se crea una cuenta de
 * Sandbox. Real: SOLO para las empresas autorizadas expresamente (CONNECT_STRIPE_LIVE_TENANTS) y SIN crear cuentas: la
 * empresa autoriza en Stripe (OAuth) la cuenta que ya tiene. Nada aquí toca el Stripe corporativo de Big Elephant
 * (`server/stripe/*`). El pago público de un presupuesto va por `crm.quotes.payWithToken` (ver publicApi.ts).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { getTenantIdOrDefault, isMultiTenant } from "../_core/tenant";
import { getTrustedBaseUrl } from "../_core/publicUrl";
import { MODE_LABEL, STATUS_LABEL, type PaymentMode } from "../../shared/paymentAccounts";
import { connectConfigState, liveAllowedFor } from "../paymentsConnect/config";
import { oauthAuthorizeUrl, signOAuthState, verifyOAuthState } from "../paymentsConnect/oauthState";
import { translatePaymentsError as translate } from "../paymentsConnect/publicApi";
import { realPaymentsDeps } from "../paymentsConnect/runtime";
import { connectAccount, linkExistingAccount, refreshAccount, setOnlineEnabled } from "../paymentsConnect/service";
import { mysqlPaymentStore, type PaymentAccountRow } from "../paymentsConnect/store";

function requireMulti() {
  if (!isMultiTenant()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Los cobros por empresa solo están disponibles en el modo multiempresa" });
}

function depsOrThrow() {
  requireMulti();
  const { config, problem } = connectConfigState();
  if (!config) throw new TRPCError({ code: "PRECONDITION_FAILED", message: problem ?? "Los cobros con Stripe no están configurados en esta plataforma" });
  return realPaymentsDeps(getTenantIdOrDefault(), config);
}

const LIVE_OFF = "Los cobros reales no están activados para esta empresa";

/** Dependencias del modo Real: solo si la plataforma lo tiene configurado Y esta empresa está autorizada expresamente. */
function liveDepsOrThrow() {
  requireMulti();
  const live = liveAllowedFor(getTenantIdOrDefault());
  if (!live) throw new TRPCError({ code: "PRECONDITION_FAILED", message: LIVE_OFF });
  return { deps: realPaymentsDeps(getTenantIdOrDefault(), live), live };
}

const stateSecret = () => process.env.JWT_SECRET ?? "";

const view = (a: PaymentAccountRow | null, mode: PaymentMode, connectable: boolean) => ({
  mode,
  label: MODE_LABEL[mode],
  connectable,
  status: a?.status ?? "no_conectada",
  statusLabel: STATUS_LABEL[a?.status ?? "no_conectada"],
  // Identificador de cuenta recortado: la empresa reconoce cuál ha vinculado sin exponerlo entero
  accountHint: a ? `${a.accountId.slice(0, 8)}…${a.accountId.slice(-4)}` : null,
  chargesEnabled: a?.chargesEnabled ?? false,
  payoutsEnabled: a?.payoutsEnabled ?? false,
  requirementsDue: a?.requirementsDue ?? [],
  disabledReason: a?.disabledReason ?? null,
  onlineEnabled: a?.onlineEnabled ?? false,
  connectedAt: a?.connectedAt ?? null,
  verifiedAt: a?.verifiedAt ?? null,
  lastEventAt: a?.lastEventAt ?? null,
  lastEventType: a?.lastEventType ?? null,
  // Última comprobación del estado (no es un aviso de Stripe: sirve para distinguir «ninguno aún» de «sin comprobar»)
  checkedAt: a?.updatedAt ?? null,
});

export const cobrosRouter = router({
  /** Estado de Prueba y Real. Real siempre figura como no disponible en esta entrega. */
  status: adminProcedure.query(async () => {
    requireMulti();
    const { config, problem } = connectConfigState();
    let test: PaymentAccountRow | null = null;
    let real: PaymentAccountRow | null = null;
    const liveReady = !!liveAllowedFor(getTenantIdOrDefault());
    try {
      test = await mysqlPaymentStore().getAccount("test");
      if (liveReady) real = await mysqlPaymentStore().getAccount("live");
    } catch (e) {
      translate(e);
    }
    return {
      platformReady: !!config,
      platformProblem: config ? null : problem,
      // Alta y verificación de eventos las gestiona Big Elephant de forma central: no hay URL ni secreto que configurar
      webhookManagedCentrally: true,
      modes: [view(test, "test", !!config), view(real, "live", liveReady)],
      liveDisabledReason: liveReady ? null : "Los cobros reales no están activados para esta empresa. Se activan de forma explícita.",
    };
  }),

  /** Devuelve la dirección de Stripe donde la empresa autoriza (o continúa) la conexión de su cuenta. */
  connect: adminProcedure.mutation(async ({ ctx }) => {
    const d = depsOrThrow();
    const base = getTrustedBaseUrl();
    try {
      const r = await connectAccount(d, {
        email: ctx.user.email ?? null,
        returnUrl: `${base}/admin/configuracion/cobros?stripe=volver`,
        refreshUrl: `${base}/admin/configuracion/cobros?stripe=reanudar`,
        by: ctx.user.name ?? String(ctx.user.id),
      });
      return { url: r.url };
    } catch (e) {
      return translate(e);
    }
  }),

  /** Relee el estado de la cuenta en Stripe (lo que diga el navegador no cuenta). */
  refresh: adminProcedure.input(z.object({ mode: z.enum(["test", "live"]).default("test") }).optional()).mutation(async ({ input, ctx }) => {
    const d = input?.mode === "live" ? liveDepsOrThrow().deps : depsOrThrow();
    try {
      const a = await refreshAccount(d, ctx.user.name ?? String(ctx.user.id));
      return view(a, d.config.mode, true);
    } catch (e) {
      return translate(e);
    }
  }),

  /**
   * Modo Real: dirección de Stripe donde la empresa elige y autoriza la cuenta que YA tiene (no se crea ninguna cuenta).
   * Solo empresas autorizadas expresamente en la plataforma.
   */
  connectLive: adminProcedure.mutation(async ({ ctx }) => {
    const { live } = liveDepsOrThrow();
    const secret = stateSecret();
    if (!secret) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Falta la clave de firma del servidor" });
    const state = signOAuthState({ tenantId: getTenantIdOrDefault(), userId: String(ctx.user.id) }, secret);
    return { url: oauthAuthorizeUrl({ clientId: live.clientId, redirectUri: `${getTrustedBaseUrl()}/admin/configuracion/cobros`, state }) };
  }),

  /** Modo Real: cierra el vínculo con el código que Stripe entrega tras la autorización (de un solo uso, con `state` firmado). */
  completeLive: adminProcedure.input(z.object({ code: z.string().min(8).max(512), state: z.string().min(8).max(1024) })).mutation(async ({ input, ctx }) => {
    const { deps } = liveDepsOrThrow();
    if (!verifyOAuthState(input.state, stateSecret(), { tenantId: getTenantIdOrDefault(), userId: String(ctx.user.id) })) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "El enlace de autorización ha caducado o no es de esta sesión. Vuelve a pulsar «Vincular mi cuenta de Stripe»." });
    }
    try {
      const a = await linkExistingAccount(deps, { code: input.code, by: ctx.user.name ?? String(ctx.user.id) });
      return view(a, "live", true);
    } catch (e) {
      return translate(e);
    }
  }),

  /** Interruptor de cobros en línea: apagado por defecto; solo se enciende con la cuenta verificada de ese modo. */
  setOnline: adminProcedure.input(z.object({ mode: z.enum(["test", "live"]), enabled: z.boolean() })).mutation(async ({ input, ctx }) => {
    requireMulti();
    if (input.mode === "live" && input.enabled && !liveAllowedFor(getTenantIdOrDefault())) throw new TRPCError({ code: "PRECONDITION_FAILED", message: LIVE_OFF });
    try {
      const a = await setOnlineEnabled({ store: mysqlPaymentStore() }, input.mode, input.enabled, ctx.user.name ?? String(ctx.user.id));
      return view(a, input.mode, input.mode === "test" || !!liveAllowedFor(getTenantIdOrDefault()));
    } catch (e) {
      return translate(e);
    }
  }),
});
