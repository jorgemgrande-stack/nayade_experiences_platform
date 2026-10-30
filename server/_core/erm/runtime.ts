/**
 * Ensamblado del Resource Manager en el proceso.
 *
 *  - `installErm()` fija el sumidero de medición (agregador) y crea el motor de cuotas.
 *  - `enforceQuota()` es el punto que usan los sitios de consumo (almacenamiento, correo,
 *    IA…). Sin ERM instalado es un no-op: el modo single no cambia de comportamiento.
 */
import mysql from "mysql2/promise";
import { Metrics, setMeterSink } from "../metering";
import { getTenantId } from "../tenant";
import { tenantResourceGuard } from "./middleware";
import { DistributedRateLimiter, TenantConcurrencyLimiter, TenantRateLimiter, type TenantRateGate } from "./limiters";
import { QuotaEngine, parseDefaultQuotas, type DefaultQuota, type QuotaEngineOptions } from "./quota";
import type { AlertSink, QuotaPolicyReader, UsageStore } from "./types";
import { QuotaExceededError } from "./types";
import {
  MemoryUsageStore,
  MysqlCounterStore,
  MysqlUsageStore,
  SharedUsageCounters,
  UsageAggregator,
  sharedStoreWarner,
  type SharedCounterStore,
} from "./usage";
import { fixedPoolOptions } from "../dbPoolConfig";
import { opsLog } from "../ops/log";

export interface ErmInstance {
  aggregator: UsageAggregator;
  engine: QuotaEngine;
  /** Contadores compartidos entre réplicas (cuotas día/mes); `null` sin almacén compartido. */
  counters: SharedUsageCounters | null;
  rate: TenantRateGate;
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
  /** Almacén de contadores COMPARTIDO entre réplicas. Sin él, tasa y cuotas día/mes se deciden en este proceso. */
  counters?: SharedCounterStore;
  /** Réplicas estimadas (límite local de emergencia si el almacén compartido cae). */
  replicasEstimate?: number;
  /** Valores por defecto de la fase comercial de cada empresa (prueba gratuita); ver `QuotaEngineOptions`. */
  phaseDefaults?: QuotaEngineOptions["phaseDefaults"];
}): ErmInstance {
  if (instance) void instance.stop();
  const aggregator = new UsageAggregator(deps.store, { flushMs: deps.flushMs });
  const warn = sharedStoreWarner();
  const counters = deps.counters ? new SharedUsageCounters(deps.counters, { warn }) : null;
  const engine = new QuotaEngine(deps.policy, deps.store, aggregator, {
    alerts: deps.alerts ?? logAlertSink,
    defaults: deps.defaults,
    ...(counters ? { counters } : {}),
    ...(deps.phaseDefaults ? { phaseDefaults: deps.phaseDefaults } : {}),
  });
  const rate: TenantRateGate = deps.counters
    ? new DistributedRateLimiter(deps.counters, { replicasEstimate: deps.replicasEstimate, onDegraded: warn })
    : new TenantRateLimiter();
  const concurrency = new TenantConcurrencyLimiter();
  setMeterSink(
    counters
      ? {
          record(e) {
            aggregator.record(e);
            counters.record(e);
          },
        }
      : aggregator,
  );
  aggregator.start();
  counters?.start();
  instance = {
    aggregator,
    engine,
    counters,
    rate,
    concurrency,
    guard: tenantResourceGuard(engine, rate, concurrency),
    async stop() {
      setMeterSink(null);
      await aggregator.stop();
      await counters?.stop();
    },
  };
  return instance;
}

/** `ERM_REPLICAS_ESTIMATE` (1-64; por defecto 2): reparto del límite de tasa si el almacén compartido cae. */
export function replicasEstimateFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.ERM_REPLICAS_ESTIMATE);
  return Number.isInteger(n) && n >= 1 && n <= 64 ? n : 2;
}

/** Instalación a partir del entorno y la conexión del registro (solo se usa en multi). */
export function installErmFromEnv(
  policy: QuotaPolicyReader,
  env: NodeJS.ProcessEnv = process.env,
  phaseDefaults?: QuotaEngineOptions["phaseDefaults"],
): ErmInstance {
  let store: UsageStore;
  let counters: SharedCounterStore | undefined;
  let pool: mysql.Pool | null = null;
  if (env.ERM_DATABASE_URL) {
    try {
      pool = mysql.createPool({ uri: env.ERM_DATABASE_URL, ...fixedPoolOptions("DB_ERM_POOL_CONNECTIONS", 3, env) });
    } catch (e) {
      // URL mal formada: el servicio arranca igual, con límites por proceso, y queda constancia
      opsLog("error", "ERM", "usage_store_url_invalid", { error: e instanceof Error ? e.name : "error" });
    }
  }
  if (pool) {
    store = new MysqlUsageStore(pool);
    // Sin la tabla `usage_windows` (falta `medicion-preparar`) cada uso falla, avisa y degrada al límite local
    counters = new MysqlCounterStore(pool);
  } else {
    // Sin base compartida: cuotas y tasa por proceso; los contadores se pierden al reiniciar
    opsLog("warn", "ERM", "usage_store_in_memory", { sharedCounters: false });
    store = new MemoryUsageStore();
  }
  const inst = installErm({
    policy,
    store,
    defaults: parseDefaultQuotas(env.ERM_DEFAULT_QUOTAS) ?? undefined,
    counters,
    replicasEstimate: replicasEstimateFromEnv(env),
    phaseDefaults,
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

export interface QuotaReservation {
  /** Liquida con el consumo real, ya medido con `meter` (0 si el consumo no llegó a ocurrir). Nunca lanza. */
  settle(actual: number): Promise<void>;
}

const NO_RESERVATION: QuotaReservation = { settle: async () => undefined };

/**
 * Reserva `quantity` ANTES de un consumo cuyo tamaño real solo se conoce después (tokens de IA): con varias réplicas, la
 * reserva atómica impide que todas concedan a la vez el final de la cuota. Lanza `QuotaExceededError` si no cabe. Sin
 * ERM, o si el motor falla, no reserva nada (como `enforceQuota`).
 */
export async function reserveQuota(metric: string, quantity: number): Promise<QuotaReservation> {
  if (!instance) return NO_RESERVATION;
  const engine = instance.engine;
  try {
    const { periods } = await engine.reserve(metric, quantity);
    if (!periods.length) return NO_RESERVATION;
    const tenantId = getTenantId();
    return { settle: (actual) => engine.settle(metric, periods, quantity, actual, tenantId).catch(() => undefined) };
  } catch (e) {
    if (e instanceof QuotaExceededError) throw e;
    return NO_RESERVATION;
  }
}

export { Metrics };

/** Solo pruebas. */
export async function _resetErmForTests(): Promise<void> {
  if (instance) await instance.stop();
  instance = null;
}
