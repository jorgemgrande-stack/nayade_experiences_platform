/**
 * Servicios de clientes externos (`/cp/v1/external/*`, operadores del CRM) y aceptación pública del contrato
 * (`/cp/v1/public/contract-acceptance`, sin sesión: solo con el token de un solo uso del enlace).
 *
 *   GET  /external?companyId=                 crm:read        contrataciones externas
 *   POST /external                            orders:write    nueva contratación (contrato del CRM + calendario), o borrador
 *   PATCH /external/:id                       orders:write    edición del borrador
 *   POST /external/:id/cancel                 orders:write    cancelación antes de Stripe (borrador, aceptación o autorización pendientes)
 *   (un descuento o recargo comercial exige además orders:approve)
 *   GET  /external/:id                        crm:read        detalle: contrato, aceptaciones, cobros e historial
 *   GET  /external/:id/document               crm:read        documento contractual exacto y su huella
 *   POST /external/:id/acceptance             orders:write    enlace de aceptación para el representante
 *   POST /external/:id/payment-setup          orders:write    enlace de Stripe para autorizar el método de pago (sin cargo)
 *   POST /external/:id/setup-link             orders:write    enlace de continuación para el firmante (copiar o reenviar por correo)
 *   POST /external/:id/decision               orders:approve  primera mensualidad cuando el método llegó tarde
 *   POST /external/:id/portal                 orders:write    enlace al portal de facturación de Stripe
 *   POST /external/evaluate                   ops:write       evaluación del margen de cobro (día 5)
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import { StripeGatewayError } from "../stripe/gateway";
import { ExternalError } from "./types";
import type { ExternalService } from "./service";
import { DEFAULT_LOGO_URL, fetchBrandLogo } from "../documents/brandPdf";
import { CONTRACT_CSS, contractBodyHtml, contractHeaderHtml, contractIssuer, contractPageHtml, renderContractPdf } from "./presentation";

type Presentation = Awaited<ReturnType<ExternalService["presentation"]>>;
const madrid = (ms: number) => new Date(ms).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "long", timeStyle: "short" });
/** Recuadro de aceptación del PDF del operador: aceptado (con la evidencia) o pendiente. */
function acceptanceBox(p: Presentation): { title: string; lines: string[] } {
  if (p.accepted?.acceptedAt) return { title: "Aceptado electrónicamente", lines: [`Aceptado por ${p.accepted.acceptedName ?? p.accepted.signerName} el ${madrid(p.accepted.acceptedAt)} (versión ${p.view.version}).`, ...(p.view.declaration ? [p.view.declaration] : [])] };
  return { title: "Aceptación electrónica pendiente", lines: [p.view.signer ? `Firmante previsto: ${p.view.signer.name}${p.view.signer.role ? ` · ${p.view.signer.role}` : ""}.` : "Aún no se ha enviado el enlace de aceptación.", ...(p.view.declaration ? [p.view.declaration] : [])] };
}
function acceptanceSummaryHtml(p: Presentation): string {
  const b = acceptanceBox(p);
  return `<section class="accept"><h3>${esc(b.title)}</h3>${b.lines.map((l) => `<p>${esc(l)}</p>`).join("")}</section>`;
}

const STATUS: Record<ExternalError["code"], number> = { forbidden: 403, not_found: 404, invalid_input: 400, invalid_state: 409, conflict: 409, unavailable: 503 };

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof ExternalError) return void res.status(STATUS[e.code]).json({ error: e.code, message: e.message });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: "Parámetros no válidos" });
      if (e instanceof StripeGatewayError) {
        opsLog("warn", "External", "gateway_error", { code: e.code, retryable: e.retryable });
        return void res.status(e.retryable ? 503 : 502).json({ error: "stripe_error", code: e.code, retryable: e.retryable, message: "Stripe ha devuelto un error" });
      }
      opsLog("error", "External", "internal_error", { method: req.method, error: e instanceof Error ? e.name : "error" });
      recordFailure("external.failed");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

const adjustmentBody = z.object({ type: z.enum(["discount", "surcharge"]), mode: z.enum(["percent", "amount"]), value: z.number().int(), reason: z.string().max(300) }).strict();
const termsBody = {
    service: z.object({ key: z.string().max(50), name: z.string().max(160) }).strict(),
    amountCents: z.number().int(),
    currency: z.string().length(3).optional(),
    taxRateBp: z.number().int(),
    billingDay: z.number().int().optional(),
    firstChargeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    graceDays: z.number().int().optional(),
    externalRef: z.string().max(200).nullable().optional(),
    conditions: z.string().max(15000),
    noticeDays: z.number().int().min(0).max(365).optional(),
    interval: z.enum(["month", "quarter", "year"]).optional(),
    durationPeriods: z.number().int().nullable().optional(),
    adjustment: adjustmentBody.nullable().optional(),
};
const createBody = z
  .object({
    companyId: z.number().int().positive(),
    ...termsBody,
    draft: z.boolean().optional(),
    /** SOLO sandbox: fecha simulada inicial del reloj de prueba de Stripe (ms). */
    testClock: z.object({ frozenTime: z.number().int() }).strict().optional(),
  })
  .strict();
const updateBody = z.object(termsBody).strict();
/** ¿Puede autorizar ajustes comerciales (descuentos o recargos)? */
const canAuthorize = (req: Request) => !!getAuth(req)?.scopes.has("orders:approve");
const id = (req: Request) => z.coerce.number().int().positive().parse(req.params.id);
const actor = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`.slice(0, 100);

export function createExternalRouter(svc: ExternalService): Router {
  const r = express.Router();
  r.get("/", requireScope("crm:read"), wrap(async (req, res) => {
    const companyId = req.query.companyId === undefined ? undefined : z.coerce.number().int().positive().parse(req.query.companyId);
    res.json({ external: await svc.list({ companyId }) });
  }));
  r.post("/evaluate", requireScope("ops:write"), wrap(async (_req, res) => void res.json({ overdue: await svc.evaluateOverdue() })));
  r.post("/", requireScope("orders:write"), wrap(async (req, res) => {
    const x = await svc.create(createBody.parse(req.body ?? {}), actor(req), { canAuthorize: canAuthorize(req) });
    opsLog("info", "External", "created", { externalId: x.id, companyId: x.companyId });
    res.status(201).json({ external: x });
  }));
  r.get("/:id", requireScope("crm:read"), wrap(async (req, res) => void res.json(await svc.detail(id(req)))));
  r.patch("/:id", requireScope("orders:write"), wrap(async (req, res) => void res.json({ external: await svc.updateDraft(id(req), updateBody.parse(req.body ?? {}), actor(req), { canAuthorize: canAuthorize(req) }) })));
  r.post("/:id/cancel", requireScope("orders:write"), wrap(async (req, res) => {
    const b = z.object({ reason: z.string().max(300) }).strict().parse(req.body ?? {});
    const x = await svc.cancel(id(req), b.reason, actor(req));
    opsLog("info", "External", "canceled", { externalId: x.id });
    res.json({ external: x });
  }));
  r.get("/:id/document", requireScope("crm:read"), wrap(async (req, res) => {
    const d = await svc.detail(id(req));
    const doc = await svc.document(d.external);
    res.json({ text: doc.text, sha256: doc.sha256, version: doc.version });
  }));
  // Presentación corporativa del documento registrado: HTML (vista previa) y PDF, con el mismo texto y huella
  r.get("/:id/document.html", requireScope("crm:read"), wrap(async (req, res) => {
    const p = await svc.presentation(id(req));
    res.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; img-src ${new URL(DEFAULT_LOGO_URL).origin}; base-uri 'none'`);
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(contractPageHtml(p.view, { raw: p.text, acceptance: acceptanceSummaryHtml(p) }));
  }));
  r.get("/:id/document.pdf", requireScope("crm:read"), wrap(async (req, res) => {
    const p = await svc.presentation(id(req));
    const pdf = await renderContractPdf(p.view, { logoPng: await fetchBrandLogo(), acceptance: acceptanceBox(p) });
    sendPdf(res, pdf, `${p.view.reference}-v${p.view.version}.pdf`);
  }));
  r.post("/:id/acceptance", requireScope("orders:write"), wrap(async (req, res) => {
    const { send, ...signer } = z.object({ name: z.string().max(160), email: z.string().max(254), role: z.string().max(120).nullable().optional(), taxId: z.string().max(32).nullable().optional(), send: z.boolean().optional() }).strict().parse(req.body ?? {});
    res.status(201).json({ acceptance: await svc.requestAcceptance(id(req), signer, actor(req), { send: send === true }) });
  }));
  r.post("/:id/payment-setup", requireScope("orders:write"), wrap(async (req, res) => void res.json({ setup: await svc.paymentSetup(id(req), actor(req)) })));
  r.post("/:id/setup-link", requireScope("orders:write"), wrap(async (req, res) => {
    const b = z.object({ send: z.boolean().optional() }).strict().parse(req.body ?? {});
    res.setHeader("Cache-Control", "no-store");
    res.json({ link: await svc.setupLink(id(req), actor(req), { send: b.send === true }) });
  }));
  r.post("/:id/decision", requireScope("orders:approve"), wrap(async (req, res) => {
    const body = z.object({ firstChargeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().max(300) }).strict().parse(req.body ?? {});
    res.json({ external: await svc.decideFirstCharge(id(req), body, actor(req)) });
  }));
  r.post("/:id/portal", requireScope("orders:write"), wrap(async (req, res) => void res.json({ url: await svc.portalLink(id(req)) })));
  return r;
}

// ── Página pública de aceptación (sin scripts: formulario HTML) ───────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Página corporativa (logotipo, prestador y estilos del contrato) con el cuerpo ya maquetado. */
const docPage = (title: string, body: string) =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${CONTRACT_CSS}</style></head><body>${body}<footer class="site">Big Elephant · ${esc(contractIssuer().legalName)}</footer></body></html>`;
/** Mensajes sencillos (aceptado, error, vueltas de Stripe) con la misma imagen corporativa. */
const page = (title: string, body: string) => docPage(title, `<div class="doc"><article class="sheet">${contractHeaderHtml()}<div style="margin-top:24px">${body}</div></article></div>`);

const madridDateTime = (ms: number) => new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "long", timeStyle: "short" }).format(new Date(ms));
const money = (cents: number, currency: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency, useGrouping: "always" }).format(cents / 100);

/** Condiciones económicas aceptadas (las del contrato; aquí no se calcula nada nuevo). */
function termsHtml(t: { amountCents: number; taxCents: number; currency: string; billingDay: number; firstChargeAt: number; timezone: string; period?: string }): string {
  const first = new Intl.DateTimeFormat("es-ES", { timeZone: t.timezone, dateStyle: "long" }).format(new Date(t.firstChargeAt));
  return `<section class="accept"><h3>Condiciones de cobro</h3><p>Cuota ${esc(t.period ?? "mensual")}: <strong>${esc(money(t.amountCents, t.currency))}</strong> + IVA ${esc(money(t.taxCents, t.currency))} = <strong>${esc(money(t.amountCents + t.taxCents, t.currency))} ${t.period === "anual" ? "al año" : t.period === "trimestral" ? "al trimestre" : "al mes"}</strong>.</p><p>Se cobra el día ${t.billingDay} ${t.period ? "del mes en que empieza cada periodo" : "de cada mes"}. Primer cobro previsto: <strong>${esc(first)}</strong>.</p></section>`;
}

function send(res: Response, status: number, html: string) {
  res.status(status);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  // Solo el logotipo oficial como recurso externo; ni scripts ni otros orígenes
  res.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; img-src ${new URL(DEFAULT_LOGO_URL).origin}; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
  res.send(html);
}

function sendPdf(res: Response, pdf: Uint8Array, filename: string) {
  res.status(200);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(Buffer.from(pdf));
}

export function createContractAcceptanceRouter(svc: ExternalService): Router {
  const r = express.Router();
  r.use(rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? "")}` }));
  const fail = (res: Response, e: unknown) => {
    if (e instanceof ExternalError) return send(res, STATUS[e.code], page("Aceptación del contrato", `<h1>Aceptación del contrato</h1><p class="err">${esc(e.message)}</p>`));
    opsLog("error", "External", "acceptance_page_error", { error: e instanceof Error ? e.name : "error" });
    send(res, 500, page("Aceptación del contrato", `<h1>Aceptación del contrato</h1><p class="err">No se ha podido completar la operación. Inténtalo más tarde.</p>`));
  };
  // Vueltas desde Stripe: solo informan (la autorización se confirma con el webhook firmado, nunca con esta página)
  r.get("/autorizado", (req, res) => {
    svc
      .setupReturn(String(req.query.session_id ?? ""))
      .then((r) => {
        if (r.state === "confirmed")
          return send(res, 200, page("Contratación completada", `<h1>Contratación completada</h1><p class="ok">Stripe ha confirmado la autorización de tu método de pago y tu suscripción queda programada.</p><p>No se ha realizado ningún cobro. El primer cargo será el ${esc(new Intl.DateTimeFormat("es-ES", { timeZone: r.timezone ?? "Europe/Madrid", dateStyle: "long" }).format(new Date(r.firstChargeAt!)))}, conforme al contrato.</p>`));
        if (r.state === "pending")
          return send(res, 200, page("Confirmando la autorización", `<h1>Confirmando la autorización</h1><p>Hemos recibido tu autorización en Stripe y estamos esperando su confirmación, que suele llegar en unos segundos. No se ha realizado ningún cobro.</p><div class="actions"><a class="btn" href="?session_id=${encodeURIComponent(String(req.query.session_id))}">Comprobar de nuevo</a></div>`));
        send(res, 200, page("Autorización del método de pago", `<h1>Autorización del método de pago</h1><p>No encontramos esta autorización. Si acabas de completarla, espera unos segundos o consulta con tu contacto de Big Elephant. No se ha realizado ningún cobro.</p>`));
      })
      .catch((e) => fail(res, e));
  });
  r.get("/cancelado", (req, res) => {
    const t = String(req.query.t ?? "");
    const retry = /^[0-9.A-Za-z_-]{20,120}$/.test(t) ? `<div class="actions"><a class="btn" href="autorizar?t=${encodeURIComponent(t)}">Volver a intentarlo</a></div>` : "";
    send(res, 200, page("Autorización no completada", `<h1>Autorización no completada</h1><p>No se ha registrado ningún método de pago ni se ha cobrado nada. Tu aceptación del contrato sigue registrada.</p>${retry}`));
  });
  // Continuación tras la aceptación: abre (o reutiliza) la sesión segura de Stripe en modo setup, sin cargo
  r.get("/autorizar", (req, res) => {
    svc
      .continuePaymentSetup(String(req.query.t ?? ""))
      .then((r) => {
        if (r.kind === "redirect") {
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Referrer-Policy", "no-referrer");
          return void res.redirect(303, r.url);
        }
        const msg = r.status === "confirming" ? "Ya has autorizado tu método de pago: estamos recibiendo la confirmación de Stripe. No hace falta que hagas nada más." : r.status === "awaiting_acceptance" ? "El contrato todavía no está aceptado." : "Tu método de pago ya está autorizado. No hace falta que hagas nada más.";
        send(res, 200, page("Autorización del método de pago", `<h1>Autorización del método de pago</h1><p class="ok">${esc(msg)}</p>`));
      })
      .catch((e) => {
        // Enlace válido pero Stripe no responde: se puede reintentar con el mismo enlace (no duplica nada)
        if (!(e instanceof ExternalError) || e.code === "unavailable") {
          opsLog("warn", "External", "setup_continuation_failed", { error: e instanceof Error ? e.name : "error" });
          return send(res, 503, page("Autorización del método de pago", `<h1>Autorización del método de pago</h1><p class="err">No hemos podido conectar con Stripe en este momento. Tu aceptación sigue registrada y no se ha cobrado nada.</p><div class="actions"><a class="btn" href="?t=${encodeURIComponent(String(req.query.t ?? ""))}">Reintentar</a></div>`));
        }
        fail(res, e);
      });
  });
  r.get("/portal", (_req, res) => send(res, 200, page("Portal de facturación", `<h1>Portal de facturación</h1><p>Has salido del portal de facturación. Puedes cerrar esta ventana.</p>`)));
  // Vueltas del enlace de pago de un cargo: solo informan (el cobro se confirma con el webhook firmado de Stripe)
  r.get("/pago-recibido", (_req, res) => send(res, 200, page("Pago recibido", `<h1>Pago recibido</h1><p class="ok">Gracias. Stripe ha recibido tu pago. En unos minutos quedará registrado en tu factura; recibirás el justificante de Stripe en tu correo.</p>`)));
  r.get("/pago-cancelado", (_req, res) => send(res, 200, page("Pago no completado", `<h1>Pago no completado</h1><p>No se ha realizado ningún cobro. Puedes volver a usar el enlace de pago mientras siga vigente.</p>`)));
  r.get("/", (req, res) => {
    const token = String(req.query.token ?? "");
    svc
      .viewAcceptance(token)
      .then(async (v) => {
        // PDF del mismo documento (texto, versión y huella), con el firmante y la aceptación pendiente
        if (req.query.pdf === "1") {
          const pdf = await renderContractPdf(v.view, { logoPng: await fetchBrandLogo(), acceptance: { title: "Aceptación electrónica pendiente", lines: [v.declaration, `Enlace personal para ${v.signerName}, válido hasta el ${new Date(v.expiresAt).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}. Aceptar el contrato no autoriza ningún cobro.`] } });
          return sendPdf(res, pdf, `${v.view.reference}-v${v.version}.pdf`);
        }
        const form = `<section class="accept" id="aceptar"><h3>Aceptación y autorización de cobros recurrentes</h3>
<p>Firmante: <strong>${esc(v.signerName)}</strong>${v.signerRole ? ` · ${esc(v.signerRole)}` : ""}, en nombre de <strong>${esc(v.company)}</strong>.</p>
<form method="post" action="">
<input type="hidden" name="token" value="${esc(token)}">
<label>Nombre completo<input type="text" name="name" required maxlength="160" autocomplete="name"></label>
<label>NIF del firmante (opcional)<input type="text" name="taxId" maxlength="32"></label>
<label class="check"><input type="checkbox" name="accept" value="1" required><span>${esc(v.declaration)}</span></label>
<p class="muted">Aceptar el contrato no autoriza ningún cobro: después recibirás un enlace seguro de Stripe para autorizar el método de pago, sin cargo en ese momento. Los cobros recurrentes empezarán en la fecha indicada en el contrato.</p>
<div class="actions"><button class="btn" type="submit">Aceptar el contrato</button><a class="btn ghost" href="?token=${encodeURIComponent(token)}&amp;pdf=1">Descargar PDF</a></div>
</form></section>`;
        send(res, 200, docPage("Aceptación del contrato", contractBodyHtml(v.view, { acceptance: form, raw: v.document })));
      })
      .catch((e) => fail(res, e));
  });
  r.post("/", express.urlencoded({ extended: false, limit: "8kb" }), (req, res) => {
    const b = (req.body ?? {}) as Record<string, string>;
    svc
      .accept(String(b.token ?? req.query.token ?? ""), { name: String(b.name ?? ""), taxId: b.taxId ? String(b.taxId) : null, accept: b.accept === "1" }, { ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null })
      .then((a) =>
        send(
          res,
          200,
          page(
            "Contrato aceptado",
            `<h1>Contrato aceptado</h1><p class="ok">Hemos registrado tu aceptación (versión ${a.version}, ${esc(madridDateTime(a.acceptedAt))}).</p>` +
              termsHtml(a.terms) +
              (a.continueUrl
                ? `<p>No se ha realizado ningún cobro. <strong>Último paso:</strong> autoriza el método de pago en Stripe, la plataforma de pagos segura. Al autorizarlo hoy no se realiza ningún cargo.</p><div class="actions"><a class="btn" href="${esc(a.continueUrl)}">Autorizar método de pago</a></div><p class="muted">Si cierras esta página, tu contacto de Big Elephant puede facilitarte de nuevo el acceso. No tendrás que volver a aceptar el contrato.</p>`
                : `<p>No se ha realizado ningún cobro. Tu contacto de Big Elephant te facilitará el acceso para autorizar el método de pago.</p>`),
          ),
        ),
      )
      .catch((e) => fail(res, e));
  });
  return r;
}
