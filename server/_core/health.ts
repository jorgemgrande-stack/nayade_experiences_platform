/**
 * Endpoints de salud para el orquestador (Railway) y la monitorización.
 *
 *   GET /healthz  — liveness: el proceso responde. No toca ninguna dependencia.
 *   GET /readyz   — readiness: además comprueba las bases de datos de las que depende:
 *                    · single/shadow: la base de datos de la aplicación (`checks.database`).
 *                    · multi: la BD del registro (`checks.registry`) y, si el host de la petición
 *                      es el dominio de una empresa servible, la BD de esa empresa
 *                      (`checks.tenantDatabase`). En multi no existe una BD «por defecto».
 *
 * Públicos y sin autenticación por diseño. No devuelven versiones, mensajes de error,
 * nombres de host ni ningún detalle interno: solo un estado por comprobación y un código HTTP.
 * El diagnóstico detallado de una empresa está en el plano de control (`/cp/v1/tenants/:id/diagnostics`).
 */
import { Router, type Request } from "express";

export type CheckState = "ok" | "error";

export type HealthDeps = {
  /** Comprobación de la base de datos (single). Debe rechazar si no responde. */
  ping?: () => Promise<void>;
  /** Comprobación de la BD del registro (multi). */
  registryPing?: () => Promise<void>;
  /**
   * Comprobación de la BD de la empresa del host de la petición (multi). Devuelve `null` si el host
   * no corresponde a ninguna empresa servible (p. ej. la sonda interna del orquestador).
   */
  tenantPing?: (req: Request) => Promise<(() => Promise<void>) | null>;
  /** Tiempo máximo de espera de cada comprobación (ms). */
  timeoutMs?: number;
};

async function defaultPing(): Promise<void> {
  const [{ getDb }, { sql }] = await Promise.all([import("../db"), import("drizzle-orm")]);
  const db = await getDb();
  if (!db) throw new Error("sin conexión");
  await db.execute(sql`SELECT 1`);
}

/** Comprobaciones del modo multi; las fija `installTenantResolution` al crear el runtime del registro. */
let runtimeChecks: Pick<HealthDeps, "registryPing" | "tenantPing"> | null = null;

export function configureHealthChecks(c: Pick<HealthDeps, "registryPing" | "tenantPing"> | null): void {
  runtimeChecks = c;
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
  const timeoutMs = deps.timeoutMs ?? 3000;
  const router = Router();
  const run = (fn: () => Promise<void>): Promise<CheckState> =>
    withTimeout(Promise.resolve().then(fn), timeoutMs).then(
      () => "ok" as const,
      () => "error" as const,
    );

  router.get("/healthz", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ status: "ok" });
  });

  router.get("/readyz", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const checks: Record<string, CheckState> = {};
    const registryPing = deps.registryPing ?? runtimeChecks?.registryPing;
    const tenantPing = deps.tenantPing ?? runtimeChecks?.tenantPing;
    if (registryPing && !deps.ping) {
      checks.registry = await run(registryPing);
      if (tenantPing && checks.registry === "ok") {
        let fn: (() => Promise<void>) | null = null;
        try {
          fn = await withTimeout(tenantPing(req), timeoutMs);
        } catch {
          checks.tenantDatabase = "error";
        }
        if (fn) checks.tenantDatabase = await run(fn);
      }
    } else {
      checks.database = await run(deps.ping ?? defaultPing);
    }
    const ok = Object.values(checks).every((c) => c === "ok");
    res.status(ok ? 200 : 503).json({ status: ok ? "ready" : "degraded", checks });
  });

  return router;
}
