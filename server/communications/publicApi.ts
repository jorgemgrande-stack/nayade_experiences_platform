/**
 * Páginas públicas del Centro de envíos (/cp/v1/public/comunicaciones), sin sesión: solo con el enlace firmado.
 *  - GET  /baja?t=…      confirmación de la baja (la finalidad del enlace o todas las comerciales).
 *  - POST /baja?t=…      registra la baja; también la baja en un clic de los clientes de correo (RFC 8058, cuerpo
 *                        `List-Unsubscribe=One-Click`).
 *  - GET  /encuesta?t=…  valoración de 1 a 5 y comentario de un ticket resuelto.
 *  - POST /encuesta?t=…  guarda (o corrige) la valoración.
 * HTML sin scripts, sin datos personales en la página y con límite de peticiones por IP.
 */
import express, { type Request, type Response, type Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { DEFAULT_MAIL_LOGO_URL } from "../mail/policy";
import { PURPOSE_LABEL } from "./consent";
import type { CommunicationsService } from "./service";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const CSS =
  "body{margin:0;background:#F7F7F9;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#111827}main{max-width:560px;margin:40px auto;padding:0 16px}" +
  ".sheet{background:#fff;border:1px solid #ECECEF;border-radius:16px;padding:28px 30px;border-top:3px solid #FF3131}h1{font-size:24px;line-height:30px;margin:18px 0 12px}" +
  "p{font-size:15px;line-height:23px;color:#374151}button{background:#FF3131;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:15px;font-weight:700;cursor:pointer;margin:0 8px 8px 0}" +
  "button.sec{background:#fff;color:#111827;border:1px solid #D1D5DB}fieldset{border:0;padding:0;margin:12px 0}label.r{display:inline-block;margin:0 10px 8px 0;font-size:15px}" +
  "textarea{width:100%;box-sizing:border-box;min-height:110px;border:1px solid #D1D5DB;border-radius:10px;padding:10px;font:inherit}.muted{color:#6B7280;font-size:13px}" +
  "footer{text-align:center;color:#8A93A3;font-size:12px;margin:18px 0 40px}";

function page(res: Response, status: number, title: string, body: string) {
  res.status(status);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; img-src ${new URL(DEFAULT_MAIL_LOGO_URL).origin}; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
  res.send(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${CSS}</style></head>` +
      `<body><main><div class="sheet"><img src="${esc(DEFAULT_MAIL_LOGO_URL)}" width="184" height="23" alt="Big Elephant"><h1>${esc(title)}</h1>${body}</div><footer>Big Elephant · bigelephant.es</footer></main></body></html>`,
  );
}
const invalid = (res: Response) => page(res, 404, "Enlace no válido", "<p>Este enlace no es válido o ya no está disponible. Si necesitas ayuda, escríbenos a soporte@bigelephant.es.</p>");
const tokenOf = (req: Request) => (typeof req.query.t === "string" ? req.query.t.slice(0, 200) : "");

export function createCommunicationsPublicRouter(svc: CommunicationsService): Router {
  const r = express.Router();
  r.use(rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? "")}` }));
  const form = express.urlencoded({ extended: false, limit: "8kb" });
  const action = (req: Request, path: string) => `${req.baseUrl}${path}?t=${encodeURIComponent(tokenOf(req))}`;

  r.get("/baja", (req, res) => {
    const t = svc.unsubscribeTarget(tokenOf(req));
    if (!t) return invalid(res);
    const what = t.scope === "all" ? "todas las comunicaciones comerciales" : `«${PURPOSE_LABEL[t.scope]}»`;
    page(
      res,
      200,
      "Baja de comunicaciones comerciales",
      `<p>Si confirmas, dejarás de recibir ${esc(what)} de Big Elephant.</p><p>Seguirás recibiendo los mensajes de servicio de tu cuenta (seguridad, facturas o incidencias).</p>` +
        `<form method="post" action="${esc(action(req, "/baja"))}"><button type="submit" name="alcance" value="enlace">Confirmar la baja</button>${t.scope === "all" ? "" : '<button class="sec" type="submit" name="alcance" value="todas">Darme de baja de todas las comerciales</button>'}</form>`,
    );
  });
  r.post("/baja", form, async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const oneClick = body["List-Unsubscribe"] === "One-Click";
      const done = await svc.unsubscribe(tokenOf(req), { all: body.alcance === "todas", channel: oneClick ? "one_click" : "link", ip: req.ip ?? null });
      if (!done) return invalid(res);
      const what = done.purposes.length > 1 ? "comunicaciones comerciales" : `comunicaciones de «${PURPOSE_LABEL[done.purposes[0]]}»`;
      page(res, 200, "Baja registrada", `<p>No volverás a recibir ${esc(what)} de Big Elephant.</p><p class="muted">Si cambias de opinión, escríbenos a soporte@bigelephant.es.</p>`);
    } catch {
      page(res, 500, "No disponible", "<p>No hemos podido registrar la baja. Inténtalo de nuevo en unos minutos.</p>");
    }
  });

  r.get("/encuesta", async (req, res) => {
    try {
      const v = await svc.surveyView(tokenOf(req));
      if (!v) return invalid(res);
      const radios = [1, 2, 3, 4, 5].map((n) => `<label class="r"><input type="radio" name="rating" value="${n}" required${v.rating === n ? " checked" : ""}> ${n}</label>`).join("");
      page(
        res,
        200,
        "¿Cómo te hemos ayudado?",
        `<p>Valora la atención que recibiste en la solicitud ${esc(v.ticketRef)} (1 = muy mal, 5 = excelente).</p><form method="post" action="${esc(action(req, "/encuesta"))}"><fieldset>${radios}</fieldset><p><label>Comentario (opcional)<br><textarea name="comment" maxlength="2000">${esc(v.comment ?? "")}</textarea></label></p><button type="submit">Enviar valoración</button></form>${v.rating ? '<p class="muted">Ya nos enviaste una valoración; puedes corregirla.</p>' : ""}`,
      );
    } catch {
      page(res, 500, "No disponible", "<p>No hemos podido cargar la encuesta. Inténtalo de nuevo en unos minutos.</p>");
    }
  });
  r.post("/encuesta", form, async (req, res) => {
    try {
      const done = await svc.surveySubmit(tokenOf(req), req.body);
      if (!done) return invalid(res);
      page(res, 200, "¡Gracias por tu valoración!", "<p>Tu opinión nos ayuda a mejorar Big Elephant.</p>");
    } catch (e) {
      if (e instanceof z.ZodError) return page(res, 400, "Falta la valoración", "<p>Elige una puntuación de 1 a 5 y vuelve a enviarla.</p>");
      page(res, 500, "No disponible", "<p>No hemos podido guardar tu valoración. Inténtalo de nuevo en unos minutos.</p>");
    }
  });
  return r;
}
