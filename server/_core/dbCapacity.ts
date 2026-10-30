/**
 * Capacidad GLOBAL del servidor MySQL compartido (todas las réplicas del Core y los demás servicios).
 *
 * El presupuesto de pools de empresa (`DB_TENANT_CONNECTION_BUDGET`) es por proceso: con N réplicas se multiplica. Al
 * arrancar se lee `max_connections` del servidor y se rebaja el presupuesto de este proceso a su parte segura:
 *
 *   presupuesto ≤ (max_connections − reserva global) / réplicas − pools fijos del proceso
 *
 *  - réplicas del Core: `DB_CORE_REPLICAS` (por defecto 1);
 *  - reserva global para el resto de servicios (plano de control, CRM, copias, administración): `DB_SERVER_RESERVE`
 *    (por defecto 40);
 *  - pools fijos de cada proceso del Core (registro, ERM…): `DB_FIXED_PER_PROCESS` (por defecto 10).
 *
 * En marcha, cada `DB_CAPACITY_CHECK_MS` (30 s) se leen las conexiones en uso del servidor: al pasar del 90 % no se
 * abren pools NUEVOS de empresa (los abiertos siguen; el resto espera o recibe 503) y se levanta al bajar del 80 %.
 * Si no se puede leer la capacidad, no se cambia nada (sigue el presupuesto configurado).
 */
import { opsLog } from "./ops/log";
import { intFromEnv } from "./dbPoolConfig";

type Env = Record<string, string | undefined>;

export interface CapacityInput {
  maxConnections: number;
  replicas: number;
  reserve: number;
  fixedPerProcess: number;
  configuredBudget: number;
  connectionsPerTenant: number;
}

/** Presupuesto seguro de pools de empresa para un proceso (nunca por debajo de un pool ni por encima del configurado). */
export function safeTenantBudget(i: CapacityInput): { budget: number; capped: boolean } {
  const share = Math.floor((i.maxConnections - i.reserve) / Math.max(1, i.replicas)) - i.fixedPerProcess;
  const budget = Math.max(i.connectionsPerTenant, Math.min(i.configuredBudget, share));
  return { budget, capped: budget < i.configuredBudget };
}

/** Presión con histéresis: se activa por encima de `high` y se levanta por debajo de `low` (fracciones de max). */
export function nextPressure(prev: boolean, used: number, max: number, high = 0.9, low = 0.8): boolean {
  if (!(max > 0)) return prev;
  const r = used / max;
  return prev ? r >= low : r >= high;
}

export interface CapacityDeps {
  serverConnections(): Promise<{ max: number; used: number }>;
  capBudget(max: number): number;
  setPressure(on: boolean): void;
  configured: { connectionBudget: number; connectionsPerTenant: number };
}

/** Ajusta el presupuesto al arrancar y vigila la presión; devuelve la función para detenerlo. */
export function startDbCapacityWatch(d: CapacityDeps, env: Env = process.env): () => void {
  const replicas = intFromEnv(env, "DB_CORE_REPLICAS", 1, 1, 100);
  const reserve = intFromEnv(env, "DB_SERVER_RESERVE", 40, 0, 10_000);
  const fixedPerProcess = intFromEnv(env, "DB_FIXED_PER_PROCESS", 10, 0, 1_000);
  const everyMs = intFromEnv(env, "DB_CAPACITY_CHECK_MS", 30_000, 5_000, 600_000);
  let pressure = false;
  let planned = false;

  const check = async () => {
    try {
      const { max, used } = await d.serverConnections();
      if (!planned) {
        planned = true;
        const plan = safeTenantBudget({ maxConnections: max, replicas, reserve, fixedPerProcess, configuredBudget: d.configured.connectionBudget, connectionsPerTenant: d.configured.connectionsPerTenant });
        const applied = d.capBudget(plan.budget);
        opsLog(plan.capped ? "warn" : "info", "DbCapacity", "budget_planned", { maxConnections: max, replicas, reserve, fixedPerProcess, configured: d.configured.connectionBudget, applied });
      }
      const next = nextPressure(pressure, used, max);
      if (next !== pressure) {
        pressure = next;
        d.setPressure(next);
        opsLog(next ? "warn" : "info", "DbCapacity", next ? "server_pressure_on" : "server_pressure_off", { used, max });
      }
    } catch {
      // Sin lectura de capacidad no se cambia nada: sigue el presupuesto configurado
    }
  };
  void check();
  const timer = setInterval(() => void check(), everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
