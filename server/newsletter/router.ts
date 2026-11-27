/**
 * API tRPC de la newsletter (`newsletter.*`).
 *  - Pública: `subscribe` (el formulario del bloque «Newsletter» de la web). Mismo recorrido de seguridad que los
 *    formularios del Studio: origen de la propia web, límite por visitante, campo trampa, tiempo mínimo y límite global.
 *  - Administración (rol de administrador): estado, cifras, listado con filtros, ficha, baja administrativa, reenvíos,
 *    idioma y ajustes. La exportación a Excel/CSV va por una ruta REST de descarga (exportRoutes.ts).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { allowFormSubmit } from "../_core/studioForms";
import { sameSiteRequest } from "../_core/studioFormsSubmit";
import { peekTenantContext } from "../_core/tenant";
import { newsletterLang, newsletterMessage, NEWSLETTER_MESSAGES, type NewsletterMsgKey } from "../../shared/newsletterMessages";
import { cleanText, ipFingerprint, LOCALES, STATUSES } from "./core";
import { ipSecret, newsletterService } from "./runtime";
import { NewsletterError, type ListQuery } from "./service";
import { mysqlNewsletterStore, NewsletterNotInstalled } from "./store";

const hdr = (req: { headers: Record<string, string | string[] | undefined> }, n: string) => {
  const v = req.headers[n];
  return Array.isArray(v) ? v[0] : v;
};

const dateField = z.enum(["createdAt", "confirmedAt", "unsubscribedAt"]);
const filters = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["pending", "active", "unsubscribed"]).optional(),
  locale: z.string().trim().max(8).optional(),
  source: z.string().trim().max(64).optional(),
  dateField: dateField.optional(),
  from: z.number().int().nonnegative().optional(),
  to: z.number().int().nonnegative().optional(),
});
export const filtersSchema = filters;
const id = z.number().int().positive();

async function handle<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof NewsletterNotInstalled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
    if (e instanceof NewsletterError) {
      const code = ({ invalid_input: "BAD_REQUEST", no_consent: "BAD_REQUEST", rate_limited: "TOO_MANY_REQUESTS", unavailable: "PRECONDITION_FAILED", not_found: "NOT_FOUND", conflict: "CONFLICT" } as const)[e.code];
      throw new TRPCError({ code, message: e.message });
    }
    throw e;
  }
}
const actorOf = (ctx: { user: { id: number; name?: string | null; email?: string | null } }) => `user:${ctx.user.id}`;
const safeError = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof NewsletterNotInstalled) return fallback;
    throw e;
  }
};

export const newsletterRouter = router({
  /** ¿Está activo el módulo en esta empresa? (menú del panel). Cualquier usuario con sesión; sin tablas = apagado. */
  status: protectedProcedure.query(async () => safeError(async () => ({ enabled: (await mysqlNewsletterStore.settings()).enabled }), { enabled: false })),

  /** Alta pública desde el bloque de la web. Siempre responde igual exista o no el correo. */
  subscribe: publicProcedure
    .input(
      z.object({
        slug: z.string().trim().min(1).max(200),
        blockId: z.string().trim().min(1).max(64),
        email: z.string().max(320),
        consent: z.boolean(),
        website: z.string().max(200).optional(),
        elapsedMs: z.number().int().nonnegative().max(86_400_000).optional(),
        locale: z.string().max(8).optional(),
        page: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const req = ctx.req;
      if (!sameSiteRequest({ origin: hdr(req, "origin"), referer: hdr(req, "referer"), hosts: [hdr(req, "x-forwarded-host"), hdr(req, "host")] })) {
        throw new TRPCError({ code: "FORBIDDEN", message: NEWSLETTER_MESSAGES[newsletterLang(input.locale)].forbiddenMessage });
      }
      const ip = req.ip || req.socket.remoteAddress || "desconocida";
      const tenantId = peekTenantContext()?.tenantId ?? "single";
      // Límite por visitante (el mismo que los formularios del Studio) y campo trampa / tiempo mínimo: a un envío automático se le responde igual
      if (!allowFormSubmit(`newsletter:${tenantId}:${ip}`)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: NEWSLETTER_MESSAGES[newsletterLang(input.locale)].rateLimitedMessage });
      const found = await (await import("../pageBuilderDb")).getPublishedNewsletterBlock(input.slug, input.blockId);
      if (!found) throw new TRPCError({ code: "NOT_FOUND", message: NEWSLETTER_MESSAGES[newsletterLang(input.locale)].unavailableMessage });
      const msg = (k: NewsletterMsgKey) => newsletterMessage(input.locale, k, cleanText((found.localized as Record<string, unknown> | null)?.[k], 300) || cleanText((found.data as Record<string, unknown>)[k], 300));
      const okMessage = msg("successMessage");
      if ((input.website ?? "").trim() !== "" || (input.elapsedMs != null && input.elapsedMs < 1500)) return { ok: true as const, message: okMessage };
      const consentText = newsletterMessage(input.locale, "consentText", cleanText((found.localized as Record<string, unknown> | null)?.consentText, 600) || cleanText((found.data as Record<string, unknown>).consentText, 600));
      const path = /^\/[^\s<>"']{0,199}$/.test(input.page ?? "") ? input.page! : `/${found.slug}`;
      try {
        await newsletterService().subscribe({
          email: input.email,
          consent: input.consent,
          locale: input.locale,
          source: `web:${found.slug}`.slice(0, 64),
          page: path,
          consentText,
          ipHash: ipFingerprint(ip, tenantId, ipSecret()),
        });
        return { ok: true as const, message: okMessage };
      } catch (e) {
        if (e instanceof NewsletterError) {
          if (e.code === "invalid_input") throw new TRPCError({ code: "BAD_REQUEST", message: msg("invalidEmailMessage") });
          if (e.code === "no_consent") throw new TRPCError({ code: "BAD_REQUEST", message: msg("noConsentMessage") });
          if (e.code === "rate_limited") throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: msg("rateLimitedMessage") });
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: msg("errorMessage") });
        }
        if (e instanceof NewsletterNotInstalled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: msg("errorMessage") });
        console.error(JSON.stringify({ ctx: "Newsletter", event: "subscribe_error", error: e instanceof Error ? e.message.slice(0, 200) : "error" }));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg("errorMessage") });
      }
    }),

  // ── Administración ──
  stats: adminProcedure.query(() => handle(() => mysqlNewsletterStore.stats(Date.now()))),

  list: adminProcedure
    .input(
      filters.extend({
        sort: z.enum(["createdAt", "email", "confirmedAt", "status", "locale", "source"]).default("createdAt"),
        dir: z.enum(["asc", "desc"]).default("desc"),
        page: z.number().int().min(1).max(100_000).default(1),
        pageSize: z.number().int().min(5).max(100).default(25),
      }),
    )
    .query(({ input }) =>
      handle(async () => {
        const r = await mysqlNewsletterStore.list(input as ListQuery);
        return { ...r, page: input.page, pageSize: input.pageSize, facets: await mysqlNewsletterStore.facets() };
      }),
    ),

  get: adminProcedure.input(z.object({ id })).query(({ input }) => handle(() => newsletterService().detail(input.id))),

  updateLocale: adminProcedure
    .input(z.object({ id, locale: z.enum(LOCALES) }))
    .mutation(({ input, ctx }) => handle(async () => (await newsletterService().updateLocale(input.id, input.locale, actorOf(ctx)), { ok: true as const }))),

  unsubscribe: adminProcedure
    .input(z.object({ id, reason: z.string().trim().min(3).max(200) }))
    .mutation(({ input, ctx }) => handle(async () => (await newsletterService().adminUnsubscribe(input.id, input.reason, actorOf(ctx)), { ok: true as const }))),

  resendConfirmation: adminProcedure.input(z.object({ id })).mutation(({ input, ctx }) => handle(() => newsletterService().resendConfirmation(input.id, actorOf(ctx)))),
  resendWelcome: adminProcedure.input(z.object({ id })).mutation(({ input, ctx }) => handle(() => newsletterService().sendWelcome(input.id, "manual", actorOf(ctx)))),
  retryCrm: adminProcedure.input(z.object({ id })).mutation(({ input, ctx }) => handle(async () => (await newsletterService().retryCrm(input.id, actorOf(ctx)), { ok: true as const }))),

  getConfig: adminProcedure.query(() =>
    handle(async () => {
      const [{ resolveTemplate }, runtime] = await Promise.all([import("./core"), import("./runtime")]);
      const s = await mysqlNewsletterStore.settings();
      const ident = runtime.identity();
      return {
        enabled: s.enabled,
        publicEnabled: s.publicEnabled,
        locales: LOCALES,
        welcome: Object.fromEntries(LOCALES.map((l) => [l, resolveTemplate("welcome", l, s.templates)])),
        confirm: Object.fromEntries(LOCALES.map((l) => [l, resolveTemplate("confirm", l, s.templates)])),
        identity: ident,
        statuses: STATUSES,
      };
    }),
  ),

  saveConfig: adminProcedure
    .input(
      z.object({
        enabled: z.boolean().optional(),
        publicEnabled: z.boolean().optional(),
        welcome: z.record(z.enum(LOCALES), z.object({ subject: z.string().trim().min(3).max(200), body: z.string().trim().min(10).max(6000) })).optional(),
        confirm: z.record(z.enum(LOCALES), z.object({ subject: z.string().trim().min(3).max(200), body: z.string().trim().min(10).max(6000) })).optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      handle(async () => {
        const cur = await mysqlNewsletterStore.settings();
        const templates = { welcome: { ...cur.templates.welcome, ...input.welcome }, confirm: { ...cur.templates.confirm, ...input.confirm } };
        await mysqlNewsletterStore.saveSettings({ enabled: input.enabled, publicEnabled: input.publicEnabled, templates: input.welcome || input.confirm ? templates : undefined }, actorOf(ctx), Date.now());
        return { ok: true as const };
      }),
    ),
});
