/**
 * Ensamblado del Resource Manager en el proceso.
 *
 *  - `installErm()` fija el sumidero de medición (agregador) y crea el motor de cuotas.
 *  - `enforceQuota()` es el punto que usan los sitios de consumo (almacenamiento, correo,
 *    IA…). Sin ERM instalado es un no-op: el modo single no cambia de comportamiento.
 */
import mysql from "mysql2/promise";
import { Metrics, setMeterSink } from "../metering";
import { tenantResourceGuard } from "./middleware";
import { TenantConcurrencyLimiter, TenantRateLimiter } from "./limiters";
import { QuotaEngine, parseDefaultQuotas, type DefaultQuota } from "./quota";
import type { AlertSink, QuotaPolicyReader, UsageStore } from "./types";
import { QuotaExceededError } from "./types";
import { MemoryUsageStore, MysqlUsageStore, UsageAggregator } from "./usage";

export interface ErmInstance {
  aggregator: UsageAggregator;
  engine: QuotaEngine;
  rate: TenantRateLimiter;
  concurrency: TenantConcurrencyLimiter;
  guard: ReturnType<typeof tenantResourceGuard>;
  stop(): Promise<void>;
}

let instance: ErmInstance | null = null;

export const logAlertSink: AlertSink = {
  alert(a) {
    console.warn(JSON.stringify({ ctx: "QuotaAlert", ...a }));
  },
};

export function installErm(deps: {
  policy: QuotaPolicyReader;
  store: UsageStore;
  alerts?: AlertSink;
  defaults?: DefaultQuota[];
  flushMs?: number;
}): ErmInstance {
  if (instance) void instance.stop();
  const aggregator = new UsageAggregator(deps.store, { flushMs: deps.flushMs });
  const engine = new QuotaEngine(deps.policy, deps.store, aggregator, {
    alerts: deps.alerts ?? logAlertSink,
    defaults: deps.defaults,
  });
  const rate = new TenantRateLimiter();
  const concurrency = new TenantConcurrencyLimiter();
  setMeterSink(aggregator);
  aggregator.start();
  instance = {
    aggregator,
    engine,
    rate,
    concurrency,
    guard: tenantResourceGuard(engine, rate, concurrency),
    async stop() {
      setMeterSink(null);
      await aggregator.stop();
    },
  };
  return instance;
}

/** Instalación a partir del entorno y la conexión del registro (solo se usa en multi). */
export function installErmFromEnv(policy: QuotaPolicyReader, env: NodeJS.ProcessEnv = process.env): ErmInstance {
  let store: UsageStore;
  let pool: mysql.Pool | null = null;
  if (env.ERM_DATABASE_URL) {
    pool = mysql.createPool({ uri: env.ERM_DATABASE_URL, connectionLimit: 3 });
    store = new MysqlUsageStore(pool);
  } else {
    console.warn(JSON.stringify({ ctx: "ERM", event: "usage_store_in_memory" }));
    store = new MemoryUsageStore();
  }
  const inst = installErm({
    policy,
    store,
    defaults: parseDefaultQuotas(env.ERM_DEFAULT_QUOTAS) ?? undefined,
  });
  const stop = inst.stop;
  inst.stop = async () => {
    await stop();
    await pool?.end().catch(() => undefined);
  };
  return inst;
}

export function getErm(): ErmInstance | null {
  return instance;
}

/**
 * Comprueba la cuota antes de consumir un recurso. Lanza `QuotaExceededError` si un límite
 * duro se superaría. Sin ERM instalado no hace nada.
 */
export async function enforceQuota(metric: string, quantity = 1): Promise<void> {
  if (!instance) return;
  try {
    await instance.engine.assert(metric, quantity);
  } catch (e) {
    if (e instanceof QuotaExceededError) throw e;
    // fallo del motor (p. ej. sin contexto de tenant): no se concede lo que no se pudo medir
    // en modo multi, pero tampoco se rompe el flujo por un error de medición
  }
}

export { Metrics };

/** Solo pruebas. */
export async function _resetErmForTests(): Promise<void> {
  if (instance) await instance.stop();
  instance = null;
}
