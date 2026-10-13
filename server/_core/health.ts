/**
 * Endpoints de salud para el orquestador (Railway) y la monitorización.
 *
 *   GET /healthz  — liveness: el proceso responde. No toca ninguna dependencia.
 *   GET /readyz   — readiness: además comprueba que la base de datos responde.
 *
 * Públicos y sin autenticación por diseño. No devuelven versiones, mensajes de error,
 * nombres de host ni ningún detalle interno: solo un estado y un código HTTP.
 */
import { Router } from "express";

export type HealthDeps = {
  /** Comprobación de la base de datos. Debe rechazar si no responde. */
  ping?: () => Promise<void>;
  /** Tiempo máximo de espera de la comprobación (ms). */
  timeoutMs?: number;
};

async function defaultPing(): Promise<void> {
  const [{ getDb }, { sql }] = await Promise.all([import("../db"), import("drizzle-orm")]);
  const db = await getDb();
  if (!db) throw new Error("sin conexión");
  await db.execute(sql`SELECT 1`);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function createHealthRouter(deps: HealthDeps = {}): Router {
  const ping = deps.ping ?? defaultPing;
  const timeoutMs = deps.timeoutMs ?? 3000;
  const router = Router();

  router.get("/healthz", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ status: "ok" });
  });

  router.get("/readyz", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      await withTimeout(ping(), timeoutMs);
      res.status(200).json({ status: "ready", checks: { database: "ok" } });
    } catch {
      res.status(503).json({ status: "degraded", checks: { database: "error" } });
    }
  });

  return router;
}
