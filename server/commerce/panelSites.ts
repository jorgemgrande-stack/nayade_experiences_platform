/**
 * Sedes de la propia empresa desde su PANEL (capacidad Business `multi-site`), sobre el registro del plano de control
 * (`tenant_sites` y `tenant_site_details`), que es la única fuente de verdad de las sedes.
 *
 *   GET  /commerce/tenants/:t/sites                    lista, principal, límite del plan y uso
 *   POST /commerce/tenants/:t/sites                    alta { name, address?, phone?, email?, requestedBy }
 *   POST /commerce/tenants/:t/sites/:site              cambios { name?, address?, phone?, email?, requestedBy }
 *   POST /commerce/tenants/:t/sites/:site/archive      desactivar (nunca la principal) { requestedBy }
 *   POST /commerce/tenants/:t/sites/:site/restore      reactivar dentro del límite { requestedBy }
 *
 * Ámbito: el token de servicio del Core (`commerce:support` o `commerce:purchase`), con el tenant de la SESIÓN del
 * Core. El límite numérico de sedes lo aplica aquí OrganizationService (plan contratado, sedes adicionales y
 * excepciones de cuota); la licencia `multi-site` la comprueba el Core antes de llamar.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { OrganizationError, type OrganizationService } from "../organization/service";

const tenant = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
const site = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const who = z.string().trim().min(1).max(200);
const text = (max: number) => z.string().max(max).nullable().optional();
const createBody = z.object({ name: z.string().max(160), address: text(300), phone: text(40), email: text(200), requestedBy: who }).strict();
const updateBody = z.object({ name: z.string().max(160).optional(), address: text(300), phone: text(40), email: text(200), requestedBy: who }).strict();
const actionBody = z.object({ requestedBy: who }).strict();

/** Token del Core: `commerce:support` o `commerce:purchase`. */
function requireCore(req: Request, res: Response, next: NextFunction) {
  const scopes = getAuth(req)?.scopes;
  if (!scopes || !(scopes.has("commerce:support") || scopes.has("commerce:purchase"))) return void res.status(403).json({ error: "forbidden", scope: "commerce:support" });
  next();
}

const STATUS: Record<OrganizationError["code"], number> = { not_found: 404, invalid_input: 400, limit: 422, conflict: 409 };

/** Rutas del Core (montar bajo /commerce). `tenantExists`: la empresa de la ruta existe en el registro. */
export function createPanelSitesRouter(d: { org: Pick<OrganizationService, "panelSites" | "createPanelSite" | "updatePanelSite" | "archivePanelSite" | "restorePanelSite">; tenantExists: (tenantId: string) => Promise<boolean> }): Router {
  const r = express.Router();
  const handle =
    <B>(body: z.ZodType<B> | null, fn: (t: string, siteId: string | null, b: B, actor: string) => Promise<unknown>) =>
    (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store");
      const t = tenant.safeParse(req.params.tenantId);
      const s = req.params.siteId === undefined ? null : site.safeParse(req.params.siteId);
      const b = body ? body.safeParse(req.body ?? {}) : ({ success: true, data: undefined as B } as const);
      if (!t.success || (s && !s.success) || !b.success) {
        return void res.status(400).json({ error: "invalid_request", message: !b.success ? b.error.issues.map((i) => i.path.join(".") || i.message).join(", ") : "tenantId o sede" });
      }
      const requestedBy = (b.data as { requestedBy?: string } | undefined)?.requestedBy;
      const actor = `core:${requestedBy ?? "panel"}`.slice(0, 100);
      d.tenantExists(t.data)
        .then(async (exists) => {
          if (!exists) return void res.status(404).json({ error: "not_found", message: "Empresa no encontrada" });
          res.json({ sites: await fn(t.data, s ? s.data : null, b.data, actor) });
        })
        .catch((e) => {
          if (e instanceof OrganizationError) return void res.status(STATUS[e.code]).json({ error: e.code, message: e.message });
          opsLog("error", "Commerce", "panel_sites_failed", { error: e instanceof Error ? e.name : "error" });
          res.status(500).json({ error: "internal_error", message: "Error interno" });
        });
    };
  r.get("/tenants/:tenantId/sites", requireCore, handle(null, (t) => d.org.panelSites(t)));
  r.post("/tenants/:tenantId/sites", requireCore, handle(createBody, (t, _s, b, actor) => d.org.createPanelSite(t, b, actor)));
  r.post("/tenants/:tenantId/sites/:siteId", requireCore, handle(updateBody, (t, s, b, actor) => d.org.updatePanelSite(t, s!, b, actor)));
  r.post("/tenants/:tenantId/sites/:siteId/archive", requireCore, handle(actionBody, (t, s) => d.org.archivePanelSite(t, s!)));
  r.post("/tenants/:tenantId/sites/:siteId/restore", requireCore, handle(actionBody, (t, s) => d.org.restorePanelSite(t, s!)));
  return r;
}
