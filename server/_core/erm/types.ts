/**
 * Elephant Resource Manager — contratos.
 *
 * Capas separadas:
 *  1. Medición   : `meter()` → `UsageAggregator` (sumidero) → `UsageStore`
 *  2. Agregación : cubos horarios por tenant y métrica (UTC)
 *  3. Política   : `QuotaPolicyReader` (límites por tenant; origen: plano de control)
 *  4. Aplicación : `QuotaEngine` + limitadores (tasa, concurrencia) + guardas HTTP
 */

export type QuotaPeriod = "minute" | "hour" | "day" | "month";
export type QuotaEnforcement = "hard" | "soft";

export interface Quota {
  tenantId: string;
  metric: string;
  period: QuotaPeriod;
  limit: number;
  /** `hard`: se rechaza al superarlo. `soft`: se permite y se alerta. */
  enforcement: QuotaEnforcement;
}

export interface QuotaPolicyReader {
  listQuotas(tenantId: string): Promise<Quota[]>;
}

export interface UsageStore {
  /** Suma `quantity` al cubo horario (`hourStart` en ms UTC, múltiplo de 3 600 000). */
  add(rows: Array<{ tenantId: string; metric: string; hourStart: number; quantity: number }>): Promise<void>;
  /** Suma de la métrica en [from, to) (ms). */
  sum(tenantId: string, metric: string, from: number, to: number): Promise<number>;
  /** Cubos para exportación. */
  list(tenantId: string, from: number, to: number): Promise<Array<{ metric: string; hourStart: number; quantity: number }>>;
}

export interface QuotaDecision {
  allowed: boolean;
  /** `ok` | `exceeded` (duro) | `soft_exceeded` (permitido, alerta) | `unavailable` */
  reason: "ok" | "exceeded" | "soft_exceeded" | "unavailable";
  metric: string;
  limit?: number;
  used?: number;
  period?: QuotaPeriod;
}

export class QuotaExceededError extends Error {
  readonly httpStatus = 429;
  constructor(
    public readonly metric: string,
    public readonly decision: QuotaDecision,
  ) {
    super(`Cuota excedida para ${metric}`);
    this.name = "QuotaExceededError";
  }
}

export interface QuotaAlert {
  tenantId: string;
  metric: string;
  period: QuotaPeriod;
  /** 0.8, 1.0… */
  threshold: number;
  used: number;
  limit: number;
  at: number;
}

export interface AlertSink {
  alert(a: QuotaAlert): void;
}
