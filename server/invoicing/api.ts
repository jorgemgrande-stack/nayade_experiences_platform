/**
 * Facturación propia (`/cp/v1/invoicing/*`, operadores del CRM). Contrato: docs/elephant-source/CONTRATO_COBROS_FACTURACION.md §5.
 *
 *   GET  /invoicing/invoices?companyId=&status=&billingRef=   billing:read   facturas (borradores y expedidas)
 *   GET  /invoicing/fiscal-check?companyId=                   billing:read   ¿bastan los datos fiscales de la empresa para facturar?
 *   GET  /invoicing/invoices/:id                              billing:read   factura y lo que falta para expedirla
 *   GET  /invoicing/invoices/:id/document                     billing:read   documento imprimible (HTML)
 *   POST /invoicing/generate                                  billing:write  borradores devengados y estado de cobro (idempotente)
 *   POST /invoicing/invoices/:id/issue                        billing:write  expedir (número, datos congelados, huella)
 *   GET  /invoicing/charges?companyId=&status=                billing:read   cargos extraordinarios y gastos variables (CRM 0028)
 *   POST /invoicing/charges                                   billing:write  nuevo cargo en borrador (idempotente por clave)
 *   POST /invoicing/charges/:id/approve                       orders:approve aprobar: nace su factura por devengo
 *   POST /invoicing/charges/:id/cancel                        billing:write  anular un borrador (con motivo)
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { invoiceHtml } from "./document";
import type { InvoicingService } from "./service";
import type { ChargeService } from "./charges";
import { InvoicingError, type FiscalParty } from "./types";

const STATUS: Record<InvoicingError["code"], number> = { not_found: 404, invalid_input: 400, invalid_state: 409, conflict: 409, unavailable: 503 };

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof InvoicingError) return void res.status(STATUS[e.code]).json({ error: e.code, message: e.message });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_input", message: e.issues.map((i) => i.message).join("; ") });
      opsLog("error", "Invoicing", "request_failed", { path: req.path, message: e instanceof Error ? e.message.slice(0, 200) : String(e) });
      res.status(500).json({ error: "internal", message: "Error interno" });
    });
  };

const id = z.coerce.number().int().positive();
const actorOf = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`.slice(0, 100);

const chargeBody = z.object({
  idempotencyKey: z.string().min(1).max(120),
  companyId: id,
  kind: z.enum(["extraordinary", "variable_cost"]),
  concept: z.string().max(200),
  amountCents: z.number().int().optional(),
  taxRateBp: z.number().int(),
  dueDate: z.string().max(10),
  method: z.enum(["payment_link", "card_on_file", "offline"]).optional(),
  mandateRef: z.string().max(120).nullable().optional(),
  agreementRef: z.string().max(80).nullable().optional(),
  billingRef: z.string().max(80).nullable().optional(),
  detail: z
    .object({ provider: z.string().max(80).optional(), periodStart: z.string().max(10).optional(), periodEnd: z.string().max(10).optional(), costCents: z.number().int().optional(), marginBp: z.number().int().optional(), marginCents: z.number().int().optional() })
    .strict()
    .nullable()
    .optional(),
});

export function createInvoicingRouter(svc: InvoicingService, issuer: FiscalParty, charges?: ChargeService): Router {
  const r = express.Router();
  r.use(express.json({ limit: "16kb" }));
  if (charges) {
    r.get("/charges", requireScope("billing:read"), wrap(async (req, res) => {
      const q = z.object({ companyId: id.optional(), status: z.enum(["draft", "approved", "cancelled"]).optional() }).parse(req.query);
      res.json({ charges: await charges.list(q) });
    }));
    r.post("/charges", requireScope("billing:write"), wrap(async (req, res) => {
      const out = await charges.create(chargeBody.parse(req.body), actorOf(req));
      if (out.created) opsLog("info", "Invoicing", "charge_created", { chargeId: out.charge.id, companyId: out.charge.companyId, kind: out.charge.kind });
      res.status(out.created ? 201 : 200).json(out);
    }));
    // Aprobar compromete un importe y crea su factura: lo hace quien aprueba contrataciones
    r.post("/charges/:id/approve", requireScope("orders:approve"), wrap(async (req, res) => {
      const out = await charges.approve(id.parse(req.params.id), actorOf(req));
      opsLog("info", "Invoicing", "charge_approved", { chargeId: out.charge.id, invoiceId: out.invoice.id });
      res.json(out);
    }));
    r.post("/charges/:id/cancel", requireScope("billing:write"), wrap(async (req, res) => {
      const b = z.object({ reason: z.string().max(300) }).parse(req.body ?? {});
      res.json({ charge: await charges.cancel(id.parse(req.params.id), b.reason, actorOf(req)) });
    }));
  }
  r.get("/invoices", requireScope("billing:read"), wrap(async (req, res) => {
    const q = z.object({ companyId: id.optional(), status: z.enum(["draft", "issued", "rectified"]).optional(), billingRef: z.string().max(80).optional() }).parse(req.query);
    res.json({ invoices: await svc.list(q) });
  }));
  r.get("/fiscal-check", requireScope("billing:read"), wrap(async (req, res) => void res.json(await svc.fiscalCheck(z.object({ companyId: id }).parse(req.query).companyId))));
  r.get("/invoices/:id", requireScope("billing:read"), wrap(async (req, res) => void res.json(await svc.readiness(id.parse(req.params.id)))));
  r.get("/invoices/:id/document", requireScope("billing:read"), wrap(async (req, res) => {
    const inv = await svc.must(id.parse(req.params.id));
    res.type("html").setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    res.send(invoiceHtml(inv, issuer));
  }));
  r.post("/generate", requireScope("billing:write"), wrap(async (req, res) => {
    const b = z.object({ companyId: id.optional() }).parse(req.body ?? {});
    const rep = await svc.generateExternal(actorOf(req), b);
    opsLog("info", "Invoicing", "generated", { created: rep.created.length, existing: rep.existing, payments: rep.payments.length, warnings: rep.warnings.length });
    res.json(rep);
  }));
  r.post("/invoices/:id/issue", requireScope("billing:write"), wrap(async (req, res) => {
    const inv = await svc.issue(id.parse(req.params.id), actorOf(req));
    opsLog("info", "Invoicing", "issued", { invoiceId: inv.id, number: inv.number });
    res.json({ invoice: inv });
  }));
  return r;
}
