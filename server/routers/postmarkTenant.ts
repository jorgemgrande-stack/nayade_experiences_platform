/**
 * Panel de Postmark de la empresa (`postmarkTenant.*`, solo administración, multiempresa): activación guiada del correo
 * transaccional con SU cuenta de Postmark. La licencia (`comms-email`) la exige el guardián de rutas
 * (TRPC_ROUTER_CAPABILITIES). Los secretos se guardan cifrados en la bóveda y nunca se devuelven; el token del webhook se
 * muestra UNA vez al generarlo, para pegarlo en Postmark.
 */
import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { isMultiTenant } from "../_core/tenant";
import { getVault } from "../_core/credentials/runtime";
import { getProvider } from "../_core/credentials/catalog";
import { fieldProblems } from "../_core/credentials/presentation";
import { integrationHealth, recordCheck } from "../_core/credentials/health";
import { peekTenantIdentity } from "../_core/tenantIdentity";
import { setPostmarkVerification } from "../mail/tenantPostmarkHealth";
import { tenantPublicUrl } from "../_core/tenantIdentity";
import { WEBHOOK_TOKEN_HEADER } from "../mail/webhook";
import { POSTMARK_DEFAULT_STREAM, POSTMARK_PROBLEM_TEXT, POSTMARK_PROVIDER_ID, TENANT_POSTMARK_LABEL, TENANT_POSTMARK_WEBHOOK_PATH, postmarkConfigFrom, postmarkFingerprint, postmarkServerInfo } from "../mail/tenantPostmark";
import { providerDeliveryStats } from "../mail/deliveryDb";

function requireMulti() {
  if (!isMultiTenant()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Disponible solo en multiempresa" });
}

/** URL del webhook en el dominio público de la EMPRESA; sin él, ninguna (nunca la de la plataforma). */
export const tenantWebhookUrl = (base: string | null = tenantPublicUrl()) => (base ? `${base.replace(/\/+$/, "")}${TENANT_POSTMARK_WEBHOOK_PATH}` : null);
const webhookUrl = () => tenantWebhookUrl();

const DAY = 86_400_000;

export const postmarkTenantRouter = router({
  /** Estado para la pantalla: datos guardados (sin secretos), remitente y dominio, webhook, última comprobación y envíos. */
  status: adminProcedure.query(async () => {
    requireMulti();
    const vault = getVault();
    const [[st], values, health, stats] = await Promise.all([
      vault.status([POSTMARK_PROVIDER_ID]),
      vault.resolve(POSTMARK_PROVIDER_ID),
      integrationHealth().catch(() => ({ available: false, providers: [] })),
      providerDeliveryStats(TENANT_POSTMARK_LABEL, Date.now() - 30 * DAY).catch(() => null),
    ]);
    const identity = peekTenantIdentity();
    const cfg = postmarkConfigFrom(values, identity);
    const field = (k: string) => st?.fields.find((f) => f.key === k);
    const verifiedDomains = (identity?.customDomains ?? []).filter((d) => d.state === "verified").map((d) => d.domain);
    const h = health.providers.find((p) => p.provider === POSTMARK_PROVIDER_ID) ?? null;
    return {
      configured: !!st?.configured,
      active: cfg.problem === null,
      problem: cfg.problem,
      problemText: cfg.problem ? POSTMARK_PROBLEM_TEXT[cfg.problem] : null,
      serverToken: { set: !!field("serverToken")?.set, display: field("serverToken")?.display ?? null },
      messageStream: (values.messageStream ?? "").trim() || POSTMARK_DEFAULT_STREAM,
      fromEmail: (values.fromEmail ?? "").trim() || null,
      sender: { domain: cfg.domain, verified: cfg.problem === null, verifiedDomains },
      webhook: { url: webhookUrl(), header: WEBHOOK_TOKEN_HEADER, configured: (values.webhookToken ?? "").length >= 32, events: ["Delivery", "Bounce", "Spam Complaint", "Subscription Change"] },
      lastCheck: h?.lastCheck ?? null,
      connection: h?.connection ?? "not_checked",
      stats30d: stats,
    };
  }),

  /** Guarda token, flujo y remitente (vacío = conservar; para borrar, «Desconectar»). */
  save: adminProcedure
    .input(z.object({ serverToken: z.string().max(200).optional(), messageStream: z.string().max(60).optional(), fromEmail: z.string().max(254).optional() }))
    .mutation(async ({ ctx, input }) => {
      requireMulti();
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(input)) if (typeof v === "string" && v.trim()) values[k] = v.trim();
      if (values.fromEmail) values.fromEmail = values.fromEmail.toLowerCase();
      if (!Object.keys(values).length) throw new TRPCError({ code: "BAD_REQUEST", message: "No hay nada que guardar." });
      const problems = fieldProblems(getProvider(POSTMARK_PROVIDER_ID)!, values);
      if (problems.length) throw new TRPCError({ code: "BAD_REQUEST", message: problems.join(" ") });
      try {
        const r = await getVault().save(POSTMARK_PROVIDER_ID, values, `user:${ctx.user.id}`);
        console.warn(JSON.stringify({ ctx: "Integrations", event: "saved", provider: POSTMARK_PROVIDER_ID, fields: r.saved, user: ctx.user.id }));
        return r;
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Error" });
      }
    }),

  /** Comprobación de solo lectura en Postmark (servidor y flujo) y del dominio del remitente en el registro. */
  verify: adminProcedure.mutation(async ({ ctx }) => {
    requireMulti();
    const values = await getVault().resolve(POSTMARK_PROVIDER_ID);
    if (!values.serverToken) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Pega primero el token del servidor de Postmark." });
    const info = await postmarkServerInfo({ serverToken: values.serverToken, messageStream: values.messageStream });
    const cfg = postmarkConfigFrom({ ...values, verifiedFor: info.ok ? postmarkFingerprint(values.serverToken, values.messageStream) : "" }, peekTenantIdentity());
    const message = [info.message, ...info.warnings].join(" ");
    await recordCheck(POSTMARK_PROVIDER_ID, info.outcome, message, `user:${ctx.user.id}`).catch(() => undefined);
    // Solo una comprobación correcta (Live y flujo transaccional) de este token y flujo activa el envío por Postmark
    await setPostmarkVerification(values, info.ok, `user:${ctx.user.id}`);
    return { ...info, message, sender: { domain: cfg.domain, problem: cfg.problem, problemText: cfg.problem ? POSTMARK_PROBLEM_TEXT[cfg.problem] : null } };
  }),

  /** Genera (o renueva) el token del webhook de la empresa. Se devuelve solo ahora: hay que pegarlo en Postmark. */
  generateWebhookToken: adminProcedure.mutation(async ({ ctx }) => {
    requireMulti();
    const token = crypto.randomBytes(32).toString("base64url");
    await getVault().save(POSTMARK_PROVIDER_ID, { webhookToken: token }, `user:${ctx.user.id}`);
    console.warn(JSON.stringify({ ctx: "Integrations", event: "webhook_token_generated", provider: POSTMARK_PROVIDER_ID, user: ctx.user.id }));
    return { token, header: WEBHOOK_TOKEN_HEADER, url: webhookUrl() };
  }),

  /** Borra la configuración: los correos vuelven a salir por el servicio de Elephant Source. */
  disconnect: adminProcedure.mutation(async ({ ctx }) => {
    requireMulti();
    await getVault().clear(POSTMARK_PROVIDER_ID);
    console.warn(JSON.stringify({ ctx: "Integrations", event: "cleared", provider: POSTMARK_PROVIDER_ID, user: ctx.user.id }));
    return { ok: true };
  }),
});
