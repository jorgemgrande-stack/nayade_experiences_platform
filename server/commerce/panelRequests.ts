/**
 * Solicitudes desde el marketplace del PANEL de cada empresa (`POST /cp/v1/commerce/tenants/:t/requests`), llamado
 * por el servidor del Core con la empresa y la persona de la sesión:
 *  - `info`: «Solicitar información» de un producto bajo solicitud (o disponible sin compra en línea).
 *  - `waitlist`: «Me interesa» de un producto próximamente o en preparación.
 *
 * Reutiliza las solicitudes web del CRM (WebRequestService): la solicitud cuelga de un lead, con su idempotencia,
 * sus duplicados en 24 h y el aviso interno al equipo (leadNotices). Sin tipos nuevos en la base: Connect y extras
 * van como «Información sobre una extensión» y Elephant Net como «Información sobre un módulo sectorial»; el interés
 * por algo que aún no existe se distingue por la página de origen y el mensaje.
 *
 * Garantías: solo productos que esa empresa ve en su catálogo (nunca internos ni retirados); el contacto es el de la
 * sesión que envía el Core (nunca un campo libre del navegador); la clave de idempotencia se aísla por empresa. Nada
 * se contrata ni se cobra.
 *
 * Ámbito: `commerce:support` o `commerce:purchase` (el token del Core).
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { quoteCatalogFromSite } from "../catalog/snapshot";
import { withoutInternal, type SiteDocument } from "../web/service";
import type { WebRequestService } from "../crm/webRequests";
import type { CrmStore } from "../crm/store";
import { CrmError, type LeadRequestType } from "../crm/types";
import { panelCatalog } from "./panelCatalog";

export const PANEL_REQUEST_SOURCE = "panel:/admin/ampliar";
/** Versión de privacidad de las solicitudes del panel: la persona ya es cliente y actúa desde su cuenta. */
export const PANEL_PRIVACY_VERSION = "panel-cliente";

const tenant = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
export const panelRequestBody = z
  .object({
    type: z.enum(["info", "waitlist"]),
    interest: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    message: z.string().trim().max(2000).optional(),
    requester: z.object({ name: z.string().trim().min(1).max(160), email: z.string().trim().toLowerCase().email().max(200) }).strict(),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  })
  .strict();
export type PanelRequestBody = z.infer<typeof panelRequestBody>;

export class PanelRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Registra la solicitud. `site`: el sitio publicado; `internal`: la empresa puede ver productos internos de prueba.
 */
export async function receivePanelRequest(
  d: { site: SiteDocument; internal: boolean; requests: WebRequestService; crm: CrmStore },
  tenantId: string,
  b: PanelRequestBody,
): Promise<{ outcome: string; reference: string; status: string }> {
  const visible = d.internal ? d.site : withoutInternal(d.site);
  const item = panelCatalog(quoteCatalogFromSite(visible).products, { version: "", purchasesEnabled: false }).items.find((i) => i.key === b.interest);
  if (!item) throw new PanelRequestError(404, "not_found", "Ese producto no está en tu catálogo");
  const upcoming = item.commercialStatus === "coming_soon" || item.commercialStatus === "in_preparation";
  if (b.type === "waitlist" && !upcoming) throw new PanelRequestError(409, "invalid_state", "Ese producto ya se puede solicitar: pide información");
  if (b.type === "info" && upcoming) throw new PanelRequestError(409, "invalid_state", "Ese producto todavía no está disponible: usa «Me interesa»");

  const company = (await d.crm.list("companies", {}, { desc: true, limit: 5000 })).find((c) => c.tenantId === tenantId) ?? null;
  const type: LeadRequestType = /^net_|^industry_module$/.test(item.family) ? "module_info" : "extension_info";
  const lead = b.type === "waitlist" ? `Me interesa ${item.name} (próximamente). Avisadnos cuando esté disponible.` : `Solicita información sobre ${item.name}.`;
  const message = [lead, `Empresa cliente: ${company?.name ?? tenantId} (${tenantId}).`, b.message ? `Mensaje: ${b.message}` : ""].filter(Boolean).join("\n");
  try {
    const { outcome, request } = await d.requests.receive(
      {
        type,
        name: b.requester.name,
        email: b.requester.email,
        company: company?.name ?? tenantId,
        message,
        interest: item.key,
        sourcePage: `${PANEL_REQUEST_SOURCE}/${item.key}${b.type === "waitlist" ? "#me-interesa" : ""}`,
        marketingConsent: false,
        privacyVersion: PANEL_PRIVACY_VERSION,
      },
      // La clave del Core, aislada por empresa: la de otra empresa nunca devuelve esta solicitud
      { idempotencyKey: `panel:${tenantId}:${b.idempotencyKey}`, ipHash: null },
    );
    return { outcome, reference: request.reference, status: request.status };
  } catch (e) {
    if (e instanceof CrmError && e.code === "conflict") throw new PanelRequestError(409, "conflict", e.message);
    throw e;
  }
}

/** Token del Core: `commerce:support` o `commerce:purchase`. */
function requireCore(req: Request, res: Response, next: NextFunction) {
  const scopes = getAuth(req)?.scopes;
  if (!scopes || !(scopes.has("commerce:support") || scopes.has("commerce:purchase"))) return void res.status(403).json({ error: "forbidden", scope: "commerce:support" });
  next();
}

/** Rutas del Core (montar bajo /commerce). */
export function createPanelRequestsRouter(d: { site: () => Promise<SiteDocument>; requests: WebRequestService; crm: CrmStore; internalTenants?: ReadonlySet<string> }): Router {
  const r = express.Router();
  r.post("/tenants/:tenantId/requests", requireCore, (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const t = tenant.safeParse(req.params.tenantId);
    const b = panelRequestBody.safeParse(req.body);
    if (!t.success || !b.success) return void res.status(400).json({ error: "invalid_request", message: b.success ? "tenantId" : b.error.issues.map((i) => i.path.join(".") || i.message).join(", ") });
    d.site()
      .then((site) => receivePanelRequest({ site, internal: !!d.internalTenants?.has(t.data), requests: d.requests, crm: d.crm }, t.data, b.data))
      .then((x) => void res.status(x.outcome === "created" ? 201 : 200).json({ request: x }))
      .catch((e) => {
        if (e instanceof PanelRequestError) return void res.status(e.status).json({ error: e.code, message: e.message });
        opsLog("error", "Commerce", "panel_request_failed", { error: e instanceof Error ? e.name : "error" });
        res.status(500).json({ error: "internal_error", message: "Error interno" });
      });
  });
  return r;
}
