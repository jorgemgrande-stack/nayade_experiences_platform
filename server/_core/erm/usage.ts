/**
 * Medición y agregación: `UsageAggregator` es un `MeterSink` que acumula en cubos horarios por
 * tenant y métrica y los vuelca a un `UsageStore`. También ofrece lectura inmediata del
 * consumo todavía no volcado, para que las cuotas no tengan ventana ciega.
 */
import type mysql from "mysql2/promise";
import type { MeterEvent, MeterSink } from "../metering";
import type { UsageStore } from "./types";

const HOUR = 3_600_000;
export const hourOf = (ms: number): number => Math.floor(ms / HOUR) * HOUR;

export class MemoryUsageStore implements UsageStore {
  private rows = new Map<string, number>();
  private fail = false;
  setFailing(f: boolean): void {
    this.fail = f;
  }
  async add(rows: Array<{ tenantId: string; metric: string; hourStart: number; quantity: number }>): Promise<void> {
    if (this.fail) throw new Error("almacén de uso no disponible");
    for (const r of rows) {
      const k = `${r.tenantId}\u0000${r.metric}\u0000${r.hourStart}`;
      this.rows.set(k, (this.rows.get(k) ?? 0) + r.quantity);
    }
  }
  async sum(tenantId: string, metric: string, from: number, to: number): Promise<number> {
    if (this.fail) throw new Error("almacén de uso no disponible");
    let s = 0;
    for (const [k, v] of Array.from(this.rows.entries())) {
      const [t, m, h] = k.split("\u0000");
      if (t === tenantId && m === metric && Number(h) >= from && Number(h) < to) s += v;
    }
    return s;
  }
  async list(tenantId: string, from: number, to: number) {
    const out: Array<{ metric: string; hourStart: number; quantity: number }> = [];
    for (const [k, v] of Array.from(this.rows.entries())) {
      const [t, m, h] = k.split("\u0000");
      if (t === tenantId && Number(h) >= from && Number(h) < to) out.push({ metric: m, hourStart: Number(h), quantity: v });
    }
    return out.sort((a, b) => a.hourStart - b.hourStart || a.metric.localeCompare(b.metric));
  }
}

/** Almacén en MySQL (`db/erm/0000_usage.sql`): una BD de métricas separada, escribible por el Core. */
export class MysqlUsageStore implements UsageStore {
  constructor(private pool: Pick<mysql.Pool, "query">) {}

  async add(rows: Array<{ tenantId: string; metric: string; hourStart: number; quantity: number }>): Promise<void> {
    if (!rows.length) return;
    const values = rows.map((r) => [r.tenantId, r.metric, new Date(r.hourStart), r.quantity]);
    await this.pool.query(
      `INSERT INTO usage_hourly (tenant_id, metric, hour_start, quantity) VALUES ?
       ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
      [values],
    );
  }

  async sum(tenantId: string, metric: string, from: number, to: number): Promise<number> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT COALESCE(SUM(quantity), 0) AS q FROM usage_hourly WHERE tenant_id = ? AND metric = ? AND hour_start >= ? AND hour_start < ?",
      [tenantId, metric, new Date(from), new Date(to)],
    );
    return Number(rows[0]?.q ?? 0);
  }

  async list(tenantId: string, from: number, to: number) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT metric, hour_start, quantity FROM usage_hourly WHERE tenant_id = ? AND hour_start >= ? AND hour_start < ? ORDER BY hour_start, metric",
      [tenantId, new Date(from), new Date(to)],
    );
    return rows.map((r) => ({ metric: r.metric as string, hourStart: new Date(r.hour_start).getTime(), quantity: Number(r.quantity) }));
  }
}

export class UsageAggregator implements MeterSink {
  private pending = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private failures = 0;

  constructor(
    private store: UsageStore,
    private opts: { flushMs?: number; now?: () => number; maxPendingKeys?: number } = {},
  ) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  record(e: MeterEvent): void {
    // Solo cantidades finitas y no negativas; los eventos «sin tenant» no se atribuyen
    if (!Number.isFinite(e.quantity) || e.quantity < 0) return;
    if (e.tenantId === "unresolved") return;
    const key = `${e.tenantId}\u0000${e.metric}\u0000${hourOf(e.at ?? this.now())}`;
    if (this.pending.size >= (this.opts.maxPendingKeys ?? 50_000) && !this.pending.has(key)) return; // protección de memoria
    this.pending.set(key, (this.pending.get(key) ?? 0) + e.quantity);
  }

  /** Consumo registrado y todavía no volcado en [from, to). */
  pendingSum(tenantId: string, metric: string, from: number, to: number): number {
    let s = 0;
    for (const [k, v] of Array.from(this.pending.entries())) {
      const [t, m, h] = k.split("\u0000");
      if (t === tenantId && m === metric && Number(h) >= from && Number(h) < to) s += v;
    }
    return s;
  }

  /** Vuelca lo pendiente. Si el almacén falla, se conserva para el siguiente intento. */
  async flush(): Promise<number> {
    if (this.pending.size === 0) return 0;
    const snapshot = this.pending;
    this.pending = new Map();
    const rows = Array.from(snapshot.entries()).map(([k, quantity]) => {
      const [tenantId, metric, h] = k.split("\u0000");
      return { tenantId, metric, hourStart: Number(h), quantity };
    });
    try {
      await this.store.add(rows);
      this.failures = 0;
      return rows.length;
    } catch {
      this.failures++;
      // Reincorporar sin perder lo registrado entretanto
      for (const [k, v] of Array.from(snapshot.entries())) this.pending.set(k, (this.pending.get(k) ?? 0) + v);
      return 0;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.opts.flushMs ?? 15_000);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  stats() {
    return { pendingKeys: this.pending.size, consecutiveFlushFailures: this.failures };
  }
}
