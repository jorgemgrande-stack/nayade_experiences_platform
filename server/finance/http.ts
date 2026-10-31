/**
 * Piezas HTTP comunes de /cp/v1/finance (fases 1A y 1B): traducción de errores (`FinanceError` → 400/404/409/422/503,
 * zod → 400, resto → 500 sin detalles) y actor de la petición.
 */
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { getAuth } from "../controlPlane/auth";
import { requestIdOf } from "../_core/ops/requestContext";
import { opsLog } from "../_core/ops/log";
import { FINANCE_ERROR_STATUS, FinanceError, type FinanceActor } from "./types";

export const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof FinanceError) return void res.status(FINANCE_ERROR_STATUS[e.code]).json({ error: e.code, message: e.message });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_input", message: `Datos no válidos: ${e.issues.map((i) => `${i.path.join(".") || "petición"} (${i.message})`).join("; ")}`.slice(0, 500) });
      opsLog("error", "Finance", "request_failed", { path: req.path, message: e instanceof Error ? e.message.slice(0, 200) : String(e) });
      res.status(500).json({ error: "internal", message: "Error interno" });
    });
  };

export const actorOf = (req: Request): FinanceActor => {
  const a = getAuth(req)!.actor;
  return { by: `${a.type}:${a.id}`.slice(0, 100), requestId: requestIdOf(req) ?? null };
};
