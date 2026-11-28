/**
 * Newsletter · páginas públicas del enlace del correo (sin sesión, HTML del servidor, sin JavaScript):
 *  - GET  /newsletter/confirmar/:token  muestra el botón «Confirmar mi inscripción» (no consume el enlace).
 *  - POST /newsletter/confirmar/:token  confirma (activa, enlaza con el CRM y envía la bienvenida una sola vez).
 *  - GET  /newsletter/baja/:token       pide confirmar la baja.
 *  - POST /newsletter/baja/:token       registra la baja; también la baja en un clic de los clientes de correo (RFC 8058).
 * Un enlace que no vale (inexistente, de otra empresa, ya usado o caducado) responde siempre con el mismo mensaje.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { esc, notice, page } from "../netPublic/html";
import { normalizeLocale, templateLocale, TOKEN_RE, verifyUnsubscribeToken, type Locale } from "./core";
import { newsletterService, unsubscribeSecrets } from "./runtime";
import { newsletterLang, NEWSLETTER_MESSAGES } from "../../shared/newsletterMessages";
import { SubscribeFailure, subscribeFromWeb, subscribeInput } from "./subscribe";
import { NewsletterNotInstalled } from "./store";

const T: Record<Locale, Record<string, string>> = {
  es: {
    confirmTitle: "Confirma tu inscripción", confirmText: "Pulsa el botón para confirmar que quieres recibir la newsletter semanal.", confirmBtn: "Confirmar mi inscripción",
    doneTitle: "¡Inscripción confirmada!", doneText: "Gracias. En unos instantes recibirás un correo de bienvenida.", invalidTitle: "Enlace no válido", invalidText: "Este enlace no es válido, ya se usó o ha caducado. Si quieres recibir la newsletter, vuelve a inscribirte desde la web.",
    expiredTitle: "Enlace caducado", expiredText: "Este enlace ha caducado. Vuelve a inscribirte desde la web para recibir uno nuevo.",
    unsubTitle: "Baja de la newsletter", unsubText: "Confirma que no quieres recibir más correos de la newsletter.", unsubBtn: "Confirmar la baja", unsubDone: "Baja registrada", unsubDoneText: "No volverás a recibir la newsletter. Los avisos de tus compras o reservas, si los hay, se siguen enviando.",
    busy: "No disponible", busyText: "No hemos podido completar la operación. Inténtalo de nuevo en unos minutos.", many: "Demasiadas solicitudes", manyText: "Espera unos minutos y vuelve a intentarlo.",
  },
  de: {
    confirmTitle: "Bestätige deine Anmeldung", confirmText: "Klicke auf den Button, um zu bestätigen, dass du den wöchentlichen Newsletter erhalten möchtest.", confirmBtn: "Anmeldung bestätigen",
    doneTitle: "Anmeldung bestätigt!", doneText: "Danke. In wenigen Augenblicken erhältst du eine Willkommens-E-Mail.", invalidTitle: "Ungültiger Link", invalidText: "Dieser Link ist ungültig, wurde bereits verwendet oder ist abgelaufen. Wenn du den Newsletter erhalten möchtest, melde dich erneut auf der Website an.",
    expiredTitle: "Link abgelaufen", expiredText: "Dieser Link ist abgelaufen. Melde dich erneut auf der Website an, um einen neuen zu erhalten.",
    unsubTitle: "Newsletter abbestellen", unsubText: "Bestätige, dass du keine Newsletter-E-Mails mehr erhalten möchtest.", unsubBtn: "Abmeldung bestätigen", unsubDone: "Abmeldung registriert", unsubDoneText: "Du erhältst den Newsletter nicht mehr. Hinweise zu Käufen oder Buchungen werden weiterhin gesendet.",
    busy: "Nicht verfügbar", busyText: "Der Vorgang konnte nicht abgeschlossen werden. Bitte versuche es in einigen Minuten erneut.", many: "Zu viele Anfragen", manyText: "Bitte warte einige Minuten und versuche es erneut.",
  },
  en: {
    confirmTitle: "Confirm your subscription", confirmText: "Click the button to confirm that you want to receive the weekly newsletter.", confirmBtn: "Confirm my subscription",
    doneTitle: "Subscription confirmed!", doneText: "Thank you. You will receive a welcome email in a moment.", invalidTitle: "Invalid link", invalidText: "This link is invalid, was already used or has expired. If you want to receive the newsletter, subscribe again on the website.",
    expiredTitle: "Link expired", expiredText: "This link has expired. Subscribe again on the website to get a new one.",
    unsubTitle: "Unsubscribe from the newsletter", unsubText: "Confirm that you no longer want to receive the newsletter emails.", unsubBtn: "Confirm unsubscribe", unsubDone: "Unsubscribed", unsubDoneText: "You will no longer receive the newsletter. Notices about your purchases or bookings, if any, will still be sent.",
    busy: "Not available", busyText: "We could not complete the operation. Please try again in a few minutes.", many: "Too many requests", manyText: "Please wait a few minutes and try again.",
  },
};

const tokenOf = (req: Request) => String(req.params.token ?? "").slice(0, 120);
const fail = (res: Response, l: Locale) => page(res, 503, T[l].busy, `<div class="sheet"><h1>${esc(T[l].busy)}</h1><p>${esc(T[l].busyText)}</p></div>`);
const bad = (res: Response, l: Locale, expired = false) => page(res, 404, T[l][expired ? "expiredTitle" : "invalidTitle"], `<div class="sheet"><h1>${esc(T[l][expired ? "expiredTitle" : "invalidTitle"])}</h1><p>${esc(T[l][expired ? "expiredText" : "invalidText"])}</p></div>`);
const log = (event: string, e: unknown) => console.error(JSON.stringify({ ctx: "Newsletter", event, error: e instanceof Error ? e.message.slice(0, 200) : "error" }));

export function createNewsletterPublicRouter(): Router {
  const r = express.Router();
  const form = express.urlencoded({ extended: false, limit: "8kb" });
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `nl:${ipKeyGenerator(req.ip ?? "")}`,
    handler: (_req, res) => page(res, 429, T.es.many, `<div class="sheet"><h1>${esc(T.es.many)} · ${esc(T.de.many)}</h1><p>${esc(T.es.manyText)}</p><p>${esc(T.de.manyText)}</p></div>`),
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
      if (!TOKEN_RE.test(tokenOf(req))) return bad(res, "de");
      const p = await newsletterService().peekConfirm(tokenOf(req));
      const l = templateLocale(p.locale);
      if (p.state !== "valid") return bad(res, l, p.state === "expired");
      page(res, 200, T[l].confirmTitle, `<div class="sheet"><h1>${esc(T[l].confirmTitle)}</h1><p>${esc(T[l].confirmText)}</p><form method="post"><button type="submit">${esc(T[l].confirmBtn)}</button></form></div>`);
    } catch (e) {
      if (!(e instanceof NewsletterNotInstalled)) log("confirm_get", e);
      fail(res, "de");
    }
  });
  r.post("/newsletter/confirmar/:token", form, async (req, res) => {
    try {
      if (!TOKEN_RE.test(tokenOf(req))) return bad(res, "de");
      const c = await newsletterService().confirm(tokenOf(req));
      const l = templateLocale(c.locale);
      if (c.state !== "confirmed") return bad(res, l, c.state === "expired");
      page(res, 200, T[l].doneTitle, `${notice("ok", T[l].doneTitle)}<div class="sheet"><h1>${esc(T[l].doneTitle)}</h1><p>${esc(T[l].doneText)}</p></div>`);
    } catch (e) {
      if (!(e instanceof NewsletterNotInstalled)) log("confirm_post", e);
      fail(res, "de");
    }
  });

  r.get("/newsletter/baja/:token", async (req, res) => {
    try {
      const sl = await newsletterService().unsubscribeLocale(tokenOf(req), unsubscribeSecrets(), verifyUnsubscribeToken);
      if (!sl) return bad(res, "de");
      const l = templateLocale(sl);
      page(res, 200, T[l].unsubTitle, `<div class="sheet"><h1>${esc(T[l].unsubTitle)}</h1><p>${esc(T[l].unsubText)}</p><form method="post"><button type="submit">${esc(T[l].unsubBtn)}</button></form></div>`);
    } catch (e) {
      if (!(e instanceof NewsletterNotInstalled)) log("unsub_get", e);
      fail(res, "de");
    }
  });
  r.post("/newsletter/baja/:token", form, async (req, res) => {
    try {
      const svc = newsletterService();
      const l = normalizeLocale(await svc.unsubscribeLocale(tokenOf(req), unsubscribeSecrets(), verifyUnsubscribeToken), "de");
      const ok = await svc.unsubscribeByToken(tokenOf(req), unsubscribeSecrets(), verifyUnsubscribeToken);
      if (!ok) return bad(res, "de");
      page(res, 200, T[l].unsubDone, `${notice("ok", T[l].unsubDone)}<div class="sheet"><h1>${esc(T[l].unsubDone)}</h1><p>${esc(T[l].unsubDoneText)}</p></div>`);
    } catch (e) {
      if (!(e instanceof NewsletterNotInstalled)) log("unsub_post", e);
      fail(res, "de");
    }
  });
  r.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    return fail(res, "de");
  });
  return r;
}
