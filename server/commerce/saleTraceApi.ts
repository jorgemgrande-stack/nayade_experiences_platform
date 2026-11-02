/**
 * Traza de las altas de pago para el operador (solo lectura), montada en `/cp/v1/orders` junto a los pedidos:
 *
 *   GET /cp/v1/orders/sales/recent?days=30&mode=live   orders:read   altas de pago recientes con su traza resumida
 *   GET /cp/v1/orders/:id/trace                         orders:read   traza completa de un pedido (6 pasos e incidencias)
 *
 * `days`: 1 a 90 (30 por defecto). `mode`: modo de los cobros (por defecto el del entorno). Se excluyen las empresas
 * internas de pruebas. Nunca cobra ni cambia nada.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import type { SaleTraceService } from "./saleTrace";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: e.issues.map((i) => i.path.join(".") || i.message).join(", ") });
      opsLog("error", "SaleTrace", "internal_error", { method: req.method, error: e instanceof Error ? e.name : "error" });
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

export function createSaleTraceRouter(svc: SaleTraceService): Router {
  const r = express.Router();
  r.get(
    "/sales/recent",
    requireScope("orders:read"),
    wrap(async (req, res) => {
      const q = z.object({ days: z.coerce.number().int().min(1).max(90).default(30), mode: z.enum(["test", "live"]).optional() }).parse(req.query);
      const mode = q.mode ?? svc.mode;
      res.setHeader("Cache-Control", "no-store");
      res.json({ mode, days: q.days, sales: await svc.recent(q.days, mode) });
    }),
  );
  r.get(
    "/:id/trace",
    requireScope("orders:read"),
    wrap(async (req, res) => {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const trace = await svc.trace(id);
      if (!trace) return void res.status(404).json({ error: "not_found", message: "Pedido no encontrado" });
      res.setHeader("Cache-Control", "no-store");
      res.json({ trace });
    }),
  );
  return r;
}
