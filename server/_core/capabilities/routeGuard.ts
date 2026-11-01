/**
 * Aplicación de licencias por capacidad a las rutas tRPC existentes del Core.
 *
 * Cada ruta se asocia a la capacidad del catálogo que la licencia. La clave puede ser el procedimiento
 * completo (`reservations.createAndPay`), un sub-router (`crm.invoices`) o el namespace (`crm`):
 * gana la más específica. Las consultas (GET) se permiten en `read_only`; las mutaciones (POST)
 * exigen la capacidad activa. Lo no listado no se comprueba aquí (auth, públicos, sistema). En modo
 * `single` no se aplica.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { procedureNames } from "../modules/routeGuard";
import type { CapabilityAccess } from "./access";
import { opsLog } from "../ops/log";
import { recordFailure } from "../ops/failureAlerts";
import { extensionCapabilityRoutes } from "../modules/panelNavigation";

/** procedimiento, sub-router o namespace tRPC → capacidad (ids de server/catalog/capabilities.ts). */
export const TRPC_ROUTER_CAPABILITIES: Record<string, string> = {
  // Essential (todos los planes): CRM, ecommerce, CMS, facturación, administración
  crm: "crm-leads",
  "crm.clients": "crm-contacts",
  "crm.leads": "crm-leads",
  "crm.leadSources": "crm-leads",
  "crm.pipeline": "crm-leads",
  "crm.quotes": "crm-quotes",
  "crm.paymentPlans": "crm-quotes",
  "crm.timeline": "crm-quotes",
  "crm.products": "shop-catalog",
  "crm.catalog": "shop-catalog",
  "crm.reservations": "shop-orders",
  "crm.invoices": "bill-invoices",
  "crm.pendingPayments": "bill-payments",
  proposals: "crm-quotes",
  commercialFollowup: "crm-tasks",
  crmTags: "crm-tags",
  crmTasks: "crm-tasks",
  products: "shop-catalog",
  packs: "shop-catalog",
  timeSlots: "shop-catalog",
  reservations: "shop-orders",
  "reservations.createAndPay": "shop-checkout",
  "reservations.cartCheckout": "shop-checkout",
  bookings: "shop-orders",
  cancellations: "shop-orders",
  discounts: "shop-coupons",
  cms: "cms-editor",
  // Blog, también su parte pública: sin contratar no se sirve; en solo lectura se sigue leyendo
  blog: "cms-blog",
  homeModules: "cms-editor",
  gallery: "cms-editor",
  accounting: "bill-reports",
  documentNumbers: "bill-series",
  tpv: "bill-cash",
  cashRegister: "bill-cash",
  emailTemplates: "comms-email",
  emailCommunications: "auto-basic",
  admin: "admin-users",
  config: "admin-panel",
  onboarding: "admin-panel",
  notifications: "admin-panel",
  // Asistente inicial: en solo lectura (prueba vencida) no se reconfigura
  setupWizard: "admin-panel",
  // Portada del panel: cada fuente comprueba además su propia capacidad (coreHomeDb.ts)
  coreHome: "admin-panel",
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

/**
 * Procedimientos públicos dentro de un namespace licenciado: los lee la web de cada empresa (aviso de cookies,
 * contacto…) y no exigen capacidad, como el resto de lo público.
 */
export const PUBLIC_PROCEDURES: ReadonlySet<string> = new Set(["config.getPublicSettings"]);

/** Capacidad que licencia un procedimiento: procedimiento completo, después sub-router, después namespace. */
export function capabilityForProcedure(proc: string, map: Record<string, string> = TRPC_ROUTER_CAPABILITIES): string | undefined {
  if (PUBLIC_PROCEDURES.has(proc)) return undefined;
  const parts = proc.split(".");
  return map[proc] ?? (parts.length > 2 ? map[`${parts[0]}.${parts[1]}`] : undefined) ?? map[parts[0]];
}

/**
 * Sin mapa explícito se usa TRPC_ROUTER_CAPABILITIES completado con los namespaces que declaran las extensiones en
 * su manifiesto (`panel.api`, contrato 1.2); la tabla fija gana si ambas definen el mismo.
 */
export function capabilityRouteGuard(getAccess: () => CapabilityAccess, map?: Record<string, string>): RequestHandler {
  let routes: Record<string, string> | null = map ?? null;
  return async (req: Request, res: Response, next: NextFunction) => {
    routes ??= { ...extensionCapabilityRoutes(), ...TRPC_ROUTER_CAPABILITIES };
    const needed = new Set<string>();
    for (const proc of procedureNames(req.url ?? "")) {
      const cap = capabilityForProcedure(proc, routes);
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
          opsLog("warn", "Licensing", "capability_denied", { capability: cap, status: d.status ?? null, write });
          res.status(403).json({ error: { json: { message: d.reason, code: -32003, data: { code: "FORBIDDEN", httpStatus: 403, capability: cap, status: d.status } } } });
          return;
        }
      }
      next();
    } catch {
      opsLog("error", "Licensing", "capability_check_failed", { write });
      recordFailure("licensing.check_failed");
      res.status(503).json({ error: { json: { message: "No se pudo verificar la licencia", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 503 } } } });
    }
  };
}
