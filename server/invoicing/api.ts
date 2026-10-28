/**
 * Facturación propia (`/cp/v1/invoicing/*`, operadores del CRM). Contrato: docs/elephant-source/CONTRATO_COBROS_FACTURACION.md §5.
 *
 *   GET  /invoicing/invoices?companyId=&status=&billingRef=   billing:read   facturas (borradores y expedidas)
 *   GET  /invoicing/fiscal-check?companyId=                   billing:read   ¿bastan los datos fiscales de la empresa para facturar?
 *   GET  /invoicing/invoices/:id                              billing:read   factura y lo que falta para expedirla
 *   GET  /invoicing/invoices/:id/document                     billing:read   documento imprimible (HTML)
 *   POST /invoicing/generate                                  billing:write  borradores devengados y estado de cobro (idempotente)
 *   POST /invoicing/invoices/:id/issue                        billing:write  expedir (número, datos congelados, huella)
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { invoiceHtml } from "./document";
import type { InvoicingService } from "./service";
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

export function createInvoicingRouter(svc: InvoicingService, issuer: FiscalParty): Router {
  const r = express.Router();
  r.use(express.json({ limit: "16kb" }));
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
