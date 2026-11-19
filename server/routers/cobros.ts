/**
 * cobros.ts — Ajustes › Cobros: la cuenta Stripe PROPIA de cada empresa (Stripe Connect).
 *
 * Solo multiempresa. Todas las operaciones exigen administrador (`settings.manage`). Los cobros reales (modo Real) no
 * están activados en esta entrega: solo existe la conexión de Prueba. Nada aquí toca el Stripe corporativo de Big
 * Elephant (`server/stripe/*`). El pago público de un presupuesto va por `crm.quotes.payWithToken` (ver publicApi.ts).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { getTenantIdOrDefault, isMultiTenant } from "../_core/tenant";
import { getTrustedBaseUrl } from "../_core/publicUrl";
import { MODE_LABEL, STATUS_LABEL, type PaymentMode } from "../../shared/paymentAccounts";
import { connectConfigState } from "../paymentsConnect/config";
import { translatePaymentsError as translate } from "../paymentsConnect/publicApi";
import { realPaymentsDeps } from "../paymentsConnect/runtime";
import { connectAccount, refreshAccount, setOnlineEnabled } from "../paymentsConnect/service";
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
});

export const cobrosRouter = router({
  /** Estado de Prueba y Real. Real siempre figura como no disponible en esta entrega. */
  status: adminProcedure.query(async () => {
    requireMulti();
    const { config, problem } = connectConfigState();
    let test: PaymentAccountRow | null = null;
    try {
      test = await mysqlPaymentStore().getAccount("test");
    } catch (e) {
      translate(e);
    }
    return {
      platformReady: !!config,
      platformProblem: config ? null : problem,
      // Alta y verificación de eventos las gestiona Big Elephant de forma central: no hay URL ni secreto que configurar
      webhookManagedCentrally: true,
      modes: [view(test, "test", !!config), view(null, "live", false)],
      liveDisabledReason: "Los cobros reales todavía no están activados. Se activarán de forma explícita tras validar la conexión de Prueba.",
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
  refresh: adminProcedure.mutation(async ({ ctx }) => {
    const d = depsOrThrow();
    try {
      const a = await refreshAccount(d, ctx.user.name ?? String(ctx.user.id));
      return view(a, d.config.mode, true);
    } catch (e) {
      return translate(e);
    }
  }),

  /** Interruptor de cobros en línea: apagado por defecto; solo se enciende con la cuenta verificada de ese modo. */
  setOnline: adminProcedure.input(z.object({ mode: z.enum(["test", "live"]), enabled: z.boolean() })).mutation(async ({ input, ctx }) => {
    requireMulti();
    if (input.mode === "live" && input.enabled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Los cobros reales todavía no están activados" });
    try {
      const a = await setOnlineEnabled({ store: mysqlPaymentStore() }, input.mode, input.enabled, ctx.user.name ?? String(ctx.user.id));
      return view(a, input.mode, input.mode === "test");
    } catch (e) {
      return translate(e);
    }
  }),
});
