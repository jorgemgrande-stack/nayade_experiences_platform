/**
 * Dominios propios desde el panel de la empresa (canal del Core, montar bajo /commerce): estado, alta, comprobación,
 * dominio principal y desconexión. La empresa es la de la ruta, que fija el Core con la sesión (nunca el navegador),
 * y cada operación comprueba en el servicio que el dominio es de esa empresa.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth } from "../controlPlane/auth";
import { CustomDomainError, type CustomDomainService } from "../controlPlane/customDomains";
import { RegistryError } from "../_core/tenantRegistry/contract";
import { isValidTenantId } from "../_core/tenant";

const tenant = z.string().refine(isValidTenantId);
const domainParam = z.string().min(3).max(253);
const who = z.string().trim().max(80).optional();

function requireCore(req: Request, res: Response, next: NextFunction) {
  const scopes = getAuth(req)?.scopes;
  if (!scopes || !(scopes.has("commerce:support") || scopes.has("commerce:purchase"))) return void res.status(403).json({ error: "forbidden", scope: "commerce:support" });
  next();
}

export function createPanelDomainsRouter(svc: CustomDomainService, log: (event: string, data: Record<string, unknown>) => void = () => undefined): Router {
  const r = express.Router();
  const run = (res: Response, p: Promise<unknown>, status = 200) =>
    p.then(
      (body) => void res.status(status).json(body),
      (e: unknown) => {
        if (e instanceof CustomDomainError) return void res.status(e.status).json({ error: e.code, message: e.message });
        if (e instanceof RegistryError) {
          const st = e.code === "not_found" ? 404 : e.code === "forbidden" ? 404 : e.code === "invalid_domain" ? 400 : 409;
          return void res.status(st).json({ error: e.code, message: st === 404 ? "Ese dominio no está en tu cuenta" : e.message });
        }
        log("panel_domains_failed", { error: e instanceof Error ? e.name : "error" });
        res.status(500).json({ error: "internal_error", message: "Error interno" });
      },
    );
  const parse = (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const t = tenant.safeParse(req.params.tenantId);
    if (!t.success) return void res.status(400).json({ error: "invalid_request", message: "tenantId" });
    return t.data;
  };
  r.get("/tenants/:tenantId/domains", requireCore, (req, res) => {
    const t = parse(req, res);
    if (t) void run(res, svc.overview(t).then((overview) => ({ overview })));
  });
  r.post("/tenants/:tenantId/domains", requireCore, (req, res) => {
    const t = parse(req, res);
    if (!t) return;
    const b = z.object({ domain: z.string().min(3).max(260), requestedBy: who }).safeParse(req.body);
    if (!b.success) return void res.status(400).json({ error: "invalid_request", message: "domain" });
    void run(res, svc.add(t, b.data.domain, b.data.requestedBy).then((domain) => ({ domain })), 201);
  });
  for (const action of ["check", "primary", "disconnect"] as const) {
    r.post(`/tenants/:tenantId/domains/:domain/${action}`, requireCore, (req, res) => {
      const t = parse(req, res);
      if (!t) return;
      const d = domainParam.safeParse(req.params.domain);
      const b = z.object({ requestedBy: who }).safeParse(req.body ?? {});
      if (!d.success || !b.success) return void res.status(400).json({ error: "invalid_request", message: "domain" });
      const by = b.data.requestedBy;
      if (action === "check") void run(res, svc.check(t, d.data, by).then((domain) => ({ domain })));
      else if (action === "primary") void run(res, svc.setPrimary(t, d.data, by).then((overview) => ({ overview })));
      else void run(res, svc.disconnect(t, d.data, by).then((overview) => ({ overview })));
    });
  }
  return r;
}
