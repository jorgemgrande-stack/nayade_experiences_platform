/**
 * Newsletter · páginas públicas del enlace del correo (sin sesión, HTML del servidor, sin JavaScript):
 *  - GET  /newsletter/confirmar/:token  muestra el botón «Confirmar mi inscripción» (no consume el enlace).
 *  - POST /newsletter/confirmar/:token  confirma (activa, enlaza con el CRM y envía la bienvenida una sola vez).
 *  - GET  /newsletter/baja/:token       pide confirmar la baja.
 *  - POST /newsletter/baja/:token       registra la baja; también la baja en un clic de los clientes de correo (RFC 8058).
 * Un enlace que no vale (inexistente, de otra empresa, ya usado o caducado) responde siempre con el mismo mensaje.
 * Todas las páginas llevan la marca de la empresa (kit visual) en el idioma de la persona; sin kit, un kit mínimo.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { brandedPage, type BrandedPageKind } from "../netPublic/brandedPage";
import { minimalKit, tenantVisualKit, type TenantVisualKit } from "../brand/tenantVisualKit";
import { brandUiText } from "../../shared/brandUiText";
import { BUTTON, LOCALES, normalizeLocale, templateLocale, TOKEN_RE, verifyUnsubscribeToken, type Locale } from "./core";
import { newsletterService, unsubscribeSecrets } from "./runtime";
import { newsletterLang, NEWSLETTER_MESSAGES } from "../../shared/newsletterMessages";
import { SubscribeFailure, subscribeFromWeb, subscribeInput } from "./subscribe";
import { NewsletterNotInstalled } from "./store";
import { PUBLIC_PAGE_TEXT as T } from "./publicPageText";

const tokenOf = (req: Request) => String(req.params.token ?? "").slice(0, 120);
const log = (event: string, e: unknown) => console.error(JSON.stringify({ ctx: "Newsletter", event, error: e instanceof Error ? e.message.slice(0, 200) : "error" }));

/** Idioma de la persona por `Accept-Language` (solo los soportados); sin uno, alemán, como el resto del módulo. */
export function acceptLanguageLocale(header: string | undefined, fallback: Locale = "de"): Locale {
  for (const part of String(header ?? "").split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase().slice(0, 2);
    if ((LOCALES as readonly string[]).includes(tag)) return tag as Locale;
  }
  return fallback;
}

/** Kit de la empresa; si no se puede cargar, uno mínimo con su nombre y línea legal (la página sale igual). */
async function kitSafe(): Promise<TenantVisualKit> {
  try {
    return await tenantVisualKit();
  } catch (e) {
    log("visual_kit", e);
    try {
      const [{ brandName }, { tenantLegalIdentity }, { publicBaseUrl }] = await Promise.all([import("../tenantBrand"), import("../brand/tenantLegal"), import("../_core/productIdentity")]);
      const legal = tenantLegalIdentity();
      return minimalKit({ brand: brandName() || legal.name, legalLine: legal.line, legal, siteUrl: publicBaseUrl() });
    } catch {
      return minimalKit({ brand: "", legalLine: "" });
    }
  }
}

type Page = { kind: BrandedPageKind; title: string; text: string; cta?: "confirm" | "unsub" | "resubscribe" | "back" };

async function show(res: Response, status: number, l: Locale, p: Page): Promise<void> {
  const kit = await kitSafe();
  const site = kit.links.site(l);
  const back = brandUiText(l).backTo.replace("{brand}", kit.brandName || kit.legal.name || "");
  let cta: { label: string; url?: string; method?: "GET" | "POST" } | undefined;
  if (p.cta === "confirm") cta = { label: T[l].confirmBtn, method: "POST" };
  else if (p.cta === "unsub") cta = { label: T[l].unsubBtn, method: "POST" };
  else if (p.cta === "resubscribe" && site) cta = { label: BUTTON[l].resubscribe, url: site };
  else if (p.cta === "back" && site) cta = { label: back, url: site };
  brandedPage(res, status, kit, { locale: l, kind: p.kind, title: p.title, text: p.text, cta });
}

const fail = (res: Response, l: Locale) => show(res, 503, l, { kind: "warning", title: T[l].busy, text: T[l].busyText, cta: "back" });
/** Enlace que no vale: inexistente, de otra empresa, ya usado (confirmado o no: a propósito no se distingue) o caducado. */
const bad = (res: Response, l: Locale, expired = false) =>
  show(res, 404, l, { kind: expired ? "warning" : "error", title: T[l][expired ? "expiredTitle" : "invalidTitle"], text: T[l][expired ? "expiredText" : "invalidText"], cta: "resubscribe" });

export function createNewsletterPublicRouter(): Router {
  const r = express.Router();
  const form = express.urlencoded({ extended: false, limit: "8kb" });
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `nl:${ipKeyGenerator(req.ip ?? "")}`,
    handler: (req, res) => {
      const l = acceptLanguageLocale(req.headers["accept-language"]);
      void show(res, 429, l, { kind: "warning", title: T[l].many, text: T[l].manyText, cta: "back" });
    },
  });
  r.use("/newsletter", limiter);

  // Alta desde el formulario de la web: pública y sin sesión (los formularios del Studio entran igual por una ruta fuera de /api/trpc)
  const subLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `nls:${ipKeyGenerator(req.ip ?? "")}`,
    handler: (req, res) => {
      const l = newsletterLang((req.body as { locale?: unknown } | undefined)?.locale);
      res.status(429).json({ error: NEWSLETTER_MESSAGES[l].rateLimitedMessage });
    },
  });
  r.post("/api/newsletter/subscribe", express.json({ limit: "8kb" }), subLimiter, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = subscribeInput.safeParse(req.body);
    const l = newsletterLang((req.body as { locale?: unknown } | undefined)?.locale);
    if (!parsed.success) return void res.status(400).json({ error: NEWSLETTER_MESSAGES[l].invalidEmailMessage });
    try {
      res.json(await subscribeFromWeb(parsed.data, req));
    } catch (e) {
      if (e instanceof SubscribeFailure) return void res.status(e.status).json({ error: e.message });
      log("subscribe_route", e);
      res.status(500).json({ error: NEWSLETTER_MESSAGES[l].errorMessage });
    }
  });

  r.get("/newsletter/confirmar/:token", async (req, res) => {
    try {
      if (!TOKEN_RE.test(tokenOf(req))) return await bad(res, "de");
      const p = await newsletterService().peekConfirm(tokenOf(req));
      const l = templateLocale(p.locale);
      if (p.state !== "valid") return await bad(res, l, p.state === "expired");
      await show(res, 200, l, { kind: "info", title: T[l].confirmTitle, text: T[l].confirmText, cta: "confirm" });
    } catch (e) {
      if (!(e instanceof NewsletterNotInstalled)) log("confirm_get", e);
      await fail(res, "de");
    }
  });
  r.post("/newsletter/confirmar/:token", form, async (req, res) => {
    try {
      if (!TOKEN_RE.test(tokenOf(req))) return await bad(res, "de");
      const c = await newsletterService().confirm(tokenOf(req));
      const l = templateLocale(c.locale);
      if (c.state !== "confirmed") return await bad(res, l, c.state === "expired");
      await show(res, 200, l, { kind: "success", title: T[l].doneTitle, text: T[l].doneText, cta: "back" });
    } catch (e) {
      if (!(e instanceof NewsletterNotInstalled)) log("confirm_post", e);
      await fail(res, "de");
    }
  });

  r.get("/newsletter/baja/:token", async (req, res) => {
    try {
      const sl = await newsletterService().unsubscribeLocale(tokenOf(req), unsubscribeSecrets(), verifyUnsubscribeToken);
      if (!sl) return await bad(res, "de");
      const l = templateLocale(sl);
      await show(res, 200, l, { kind: "info", title: T[l].unsubTitle, text: T[l].unsubText, cta: "unsub" });
    } catch (e) {
      if (!(e instanceof NewsletterNotInstalled)) log("unsub_get", e);
      await fail(res, "de");
    }
  });
  r.post("/newsletter/baja/:token", form, async (req, res) => {
    try {
      const svc = newsletterService();
      const l = normalizeLocale(await svc.unsubscribeLocale(tokenOf(req), unsubscribeSecrets(), verifyUnsubscribeToken), "de");
      const ok = await svc.unsubscribeByToken(tokenOf(req), unsubscribeSecrets(), verifyUnsubscribeToken);
      if (!ok) return await bad(res, "de");
      await show(res, 200, l, { kind: "success", title: T[l].unsubDone, text: T[l].unsubDoneText, cta: "back" });
    } catch (e) {
      if (!(e instanceof NewsletterNotInstalled)) log("unsub_post", e);
      await fail(res, "de");
    }
  });
  r.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    void fail(res, "de");
  });
  return r;
}
