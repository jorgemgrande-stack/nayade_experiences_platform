/**
 * Aplicación de licencias por capacidad a las rutas tRPC existentes del Core.
 *
 * Cada namespace se asocia a la capacidad del catálogo que lo licencia. Las consultas (GET) se
 * permiten en `read_only`; las mutaciones (POST) exigen la capacidad activa. Lo no listado no se
 * comprueba aquí (auth, públicos, sistema). En modo `single` no se aplica.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { procedureNames } from "../modules/routeGuard";
import type { CapabilityAccess } from "./access";

/** namespace tRPC → capacidad (ids de server/catalog/capabilities.ts). */
export const TRPC_ROUTER_CAPABILITIES: Record<string, string> = {
  // Essential (todos los planes): CRM, ecommerce, CMS, facturación, administración
  crm: "crm-leads",
  proposals: "crm-quotes",
  commercialFollowup: "crm-tasks",
  products: "shop-catalog",
  packs: "shop-catalog",
  timeSlots: "shop-catalog",
  reservations: "shop-orders",
  bookings: "shop-orders",
  cancellations: "shop-orders",
  discounts: "shop-coupons",
  cms: "cms-editor",
  homeModules: "cms-editor",
  gallery: "cms-editor",
  accounting: "bill-reports",
  documentNumbers: "bill-series",
  tpv: "bill-cash",
  cashRegister: "bill-cash",
  emailTemplates: "comms-email",
  // Elephant Connect y extras
  hr: "people-hr",
  gestoria: "tax-filings",
  fiscalAudit: "tax-filings",
  bankMovements: "bank-import-pos",
  cardTerminalOperations: "bank-import-pos",
  cardTerminalBatches: "bank-import-pos",
  vapiCalls: "voice-ai",
  ghlInbox: "whatsapp-ai",
  ticketing: "deals-coupons",
  suppliers: "supplier-settlements",
  supplierPortal: "supplier-settlements",
  settlements: "supplier-settlements",
  partners: "supplier-settlements",
  // Elephant Net
  reav: "travel-net",
};

export function capabilityRouteGuard(getAccess: () => CapabilityAccess, map: Record<string, string> = TRPC_ROUTER_CAPABILITIES): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const needed = new Set<string>();
    for (const proc of procedureNames(req.url ?? "")) {
      const cap = map[proc.split(".")[0]];
      if (cap) needed.add(cap);
    }
    if (needed.size === 0) return next();
    // tRPC por HTTP: las consultas van por GET y las mutaciones por POST
    const write = req.method !== "GET" && req.method !== "HEAD";
    try {
      const access = getAccess();
      for (const cap of Array.from(needed)) {
        const d = await access.check(cap, { write });
        if (!d.allowed) {
          res.status(403).json({ error: { json: { message: d.reason, code: -32003, data: { code: "FORBIDDEN", httpStatus: 403, capability: cap, status: d.status } } } });
          return;
        }
      }
      next();
    } catch {
      res.status(503).json({ error: { json: { message: "No se pudo verificar la licencia", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 503 } } } });
    }
  };
}
