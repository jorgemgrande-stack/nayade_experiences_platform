/**
 * Servicios de clientes externos (`/cp/v1/external/*`, operadores del CRM) y aceptación pública del contrato
 * (`/cp/v1/public/contract-acceptance`, sin sesión: solo con el token de un solo uso del enlace).
 *
 *   GET  /external?companyId=                 crm:read        contrataciones externas
 *   POST /external                            orders:write    nueva contratación (contrato del CRM + calendario)
 *   GET  /external/:id                        crm:read        detalle: contrato, aceptaciones, cobros e historial
 *   GET  /external/:id/document               crm:read        documento contractual exacto y su huella
 *   POST /external/:id/acceptance             orders:write    enlace de aceptación para el representante
 *   POST /external/:id/payment-setup          orders:write    enlace de Stripe para autorizar el método de pago (sin cargo)
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

const STATUS: Record<ExternalError["code"], number> = { not_found: 404, invalid_input: 400, invalid_state: 409, conflict: 409, unavailable: 503 };

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

const createBody = z
  .object({
    companyId: z.number().int().positive(),
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
    /** SOLO sandbox: fecha simulada inicial del reloj de prueba de Stripe (ms). */
    testClock: z.object({ frozenTime: z.number().int() }).strict().optional(),
  })
  .strict();
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
    const x = await svc.create(createBody.parse(req.body ?? {}), actor(req));
    opsLog("info", "External", "created", { externalId: x.id, companyId: x.companyId });
    res.status(201).json({ external: x });
  }));
  r.get("/:id", requireScope("crm:read"), wrap(async (req, res) => void res.json(await svc.detail(id(req)))));
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
  r.get("/autorizado", (_req, res) => send(res, 200, page("Método de pago autorizado", `<h1>Método de pago autorizado</h1><p class="ok">Gracias. Hemos recibido la autorización de tu método de pago. No se ha realizado ningún cobro: el primer cargo será en la fecha indicada en el contrato.</p>`)));
  r.get("/cancelado", (_req, res) => send(res, 200, page("Autorización no completada", `<h1>Autorización no completada</h1><p>No se ha registrado ningún método de pago ni se ha cobrado nada. Puedes volver a usar el enlace que te enviamos mientras siga vigente.</p>`)));
  r.get("/portal", (_req, res) => send(res, 200, page("Portal de facturación", `<h1>Portal de facturación</h1><p>Has salido del portal de facturación. Puedes cerrar esta ventana.</p>`)));
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
      .then((a) => send(res, 200, page("Contrato aceptado", `<h1>Contrato aceptado</h1><p class="ok">Hemos registrado tu aceptación (versión ${a.version}, ${esc(new Date(a.acceptedAt).toISOString())}).</p><p>El siguiente paso es autorizar el método de pago en Stripe: te enviaremos el enlace. No se ha realizado ningún cobro.</p>`)))
      .catch((e) => fail(res, e));
  });
  return r;
}
