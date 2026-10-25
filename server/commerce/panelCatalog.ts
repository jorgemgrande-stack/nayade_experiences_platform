/**
 * Catálogo de módulos y ampliaciones para el PANEL de cada empresa (`GET /cp/v1/commerce/tenants/:t/catalog`).
 *
 * Solo lectura y solo lo publicado: qué existe, en qué estado comercial está y si se puede comprar en línea HOY. No
 * calcula importes de una compra (eso es la vista previa de compra, que sigue siendo la única fuente) ni cambia
 * nada. Lo interno (`internalOnly`) solo lo ven las empresas de prueba autorizadas para comprarlo.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { quoteCatalogFromSite } from "../catalog/snapshot";
import type { QuoteCatalogProduct } from "../catalog/quote";
import { withoutInternal, type SiteDocument } from "../web/service";

export interface PanelCatalogItem {
  key: string;
  name: string;
  family: string;
  /** `module`: se activa entero; `quantity`: ampliación por unidades (usuarios, sedes, almacenamiento). */
  kind: "module" | "quantity";
  metric: string | null;
  step: number | null;
  commercialStatus: "coming_soon" | "in_preparation" | "on_request" | "available";
  capabilities: string[];
  /** Precio mensual publicado (sin calcular prorrateos ni impuestos de la empresa). */
  monthly: { amountCents: number; currency: string; taxIncluded: boolean; unit: string | null } | null;
  /** Se puede comprar desde el panel ahora mismo (compra en línea encendida y producto a la venta). */
  purchasable: boolean;
}

export interface PanelCatalog {
  version: string;
  purchasesEnabled: boolean;
  items: PanelCatalogItem[];
}

/**
 * Familias que tienen sentido en el panel: módulos (Net, Connect, sectoriales, paquetes) y ampliaciones. Los planes se
 * cambian por otra vía; el uso y los servicios profesionales no se activan desde aquí.
 */
const PANEL_FAMILIES = new Set(["extension", "industry_module", "net_module", "net_bundle", "connect", "connect_bundle", "addon", "extra"]);

export function panelCatalog(products: QuoteCatalogProduct[], o: { version: string; purchasesEnabled: boolean }): PanelCatalog {
  const items: PanelCatalogItem[] = [];
  for (const p of products) {
    if (p.commercialStatus === "unpublished") continue;
    const quantity = !!p.addonFor;
    if (!quantity && !PANEL_FAMILIES.has(p.family)) continue;
    const monthly = p.prices.find((x) => x.kind === "monthly") ?? null;
    // Todas las familias del panel se contratan como extensión o módulo sectorial (CONTRACT_FAMILY): a la venta = comprable
    const sellable = p.commercialStatus === "available";
    items.push({
      key: p.key,
      name: p.name,
      family: p.family,
      kind: quantity ? "quantity" : "module",
      metric: p.addonFor?.metric ?? null,
      step: p.addonFor?.step ?? null,
      commercialStatus: p.commercialStatus,
      capabilities: p.capabilities,
      monthly: monthly ? { amountCents: monthly.amountCents, currency: monthly.currency, taxIncluded: monthly.taxIncluded, unit: monthly.unit } : null,
      purchasable: o.purchasesEnabled && sellable,
    });
  }
  items.sort((a, b) => a.kind.localeCompare(b.kind) || a.family.localeCompare(b.family) || a.name.localeCompare(b.name, "es"));
  return { version: o.version, purchasesEnabled: o.purchasesEnabled, items };
}

const tenant = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);

/** Rutas del Core (montar bajo /commerce), con el mismo token de servicio que la compra. */
export function createPanelCatalogRouter(d: { site: () => Promise<SiteDocument>; purchasesEnabled: boolean; internalTenants?: ReadonlySet<string> }): Router {
  const r = express.Router();
  r.get("/tenants/:tenantId/catalog", requireScope("commerce:purchase"), (req: Request, res: Response, _next: NextFunction) => {
    const parsed = tenant.safeParse(req.params.tenantId);
    if (!parsed.success) return void res.status(400).json({ error: "invalid_request", message: "tenantId" });
    d.site()
      .then((site) => {
        const visible = d.internalTenants?.has(parsed.data) ? site : withoutInternal(site);
        const c = quoteCatalogFromSite(visible);
        res.setHeader("Cache-Control", "no-store");
        res.json({ catalog: panelCatalog(c.products, { version: c.version, purchasesEnabled: d.purchasesEnabled }) });
      })
      .catch((e) => {
        opsLog("error", "Commerce", "panel_catalog_failed", { error: e instanceof Error ? e.name : "error" });
        res.status(500).json({ error: "internal_error", message: "Error interno" });
      });
  });
  return r;
}
