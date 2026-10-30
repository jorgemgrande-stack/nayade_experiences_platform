/**
 * Medición y agregación: `UsageAggregator` es un `MeterSink` que acumula en cubos horarios por
 * tenant y métrica y los vuelca a un `UsageStore`. También ofrece lectura inmediata del
 * consumo todavía no volcado, para que las cuotas no tengan ventana ciega.
 *
 * Contadores COMPARTIDOS entre réplicas (`SharedCounterStore`, tabla `usage_windows` de `es_erm`, `db/erm/0001_windows.sql`):
 * una fila por (tenant, métrica, periodo, inicio de ventana) que se incrementa con un UPSERT atómico. Sobreviven a los
 * reinicios y todas las réplicas ven el mismo valor; los usan el limitador de tasa distribuido y las cuotas día/mes.
 */
import type mysql from "mysql2/promise";
import { Metrics, meter, type MeterEvent, type MeterSink } from "../metering";
import { opsLog } from "../ops/log";
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

// ─── Contadores compartidos por ventana ─────────────────────────────────────────────────────────

export type CounterPeriod = "minute" | "day" | "month";

export interface WindowKey {
  tenantId: string;
  metric: string;
  period: CounterPeriod;
  /** Inicio de la ventana en ms UTC. */
  windowStart: number;
}

export interface SharedCounterStore {
  /** Suma `delta` (entero, puede ser negativo) y devuelve el valor resultante, en UNA operación atómica. */
  incr(k: WindowKey, delta: number): Promise<number>;
  /** Suma por lotes (volcado de lo medido); no devuelve valores. */
  addMany(rows: Array<WindowKey & { delta: number }>): Promise<void>;
  get(k: WindowKey): Promise<number>;
  /** Borra ventanas anteriores a `before[period]` (ms). Devuelve las filas borradas. */
  purge(before: Record<CounterPeriod, number>): Promise<number>;
}

/** Retención de ventanas: lo justo para depurar; el histórico de consumo vive en `usage_hourly`. */
export const COUNTER_RETENTION_MS: Record<CounterPeriod, number> = {
  minute: 2 * 3_600_000,
  day: 40 * 86_400_000,
  month: 400 * 86_400_000,
};

export function counterWindowStart(period: CounterPeriod, now: number): number {
  const d = new Date(now);
  if (period === "minute") return Math.floor(now / 60_000) * 60_000;
  if (period === "day") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

const wkey = (k: WindowKey): string => `${k.tenantId}\u0000${k.metric}\u0000${k.period}\u0000${k.windowStart}`;
const unkey = (s: string): WindowKey => {
  const [tenantId, metric, period, w] = s.split("\u0000");
  return { tenantId, metric, period: period as CounterPeriod, windowStart: Number(w) };
};

/**
 * Almacén en memoria. UNA instancia compartida por varios limitadores o motores simula la base común (pruebas);
 * como almacén real solo vale para una réplica sin `ERM_DATABASE_URL` (no sobrevive a reinicios).
 */
export class MemoryCounterStore implements SharedCounterStore {
  private rows = new Map<string, number>();
  private fail = false;
  calls = 0;
  setFailing(f: boolean): void {
    this.fail = f;
  }
  private check(): void {
    this.calls++;
    if (this.fail) throw new Error("almacén de contadores no disponible");
  }
  async incr(k: WindowKey, delta: number): Promise<number> {
    this.check();
    const v = Math.max(0, (this.rows.get(wkey(k)) ?? 0) + Math.trunc(delta));
    this.rows.set(wkey(k), v);
    return v;
  }
  async addMany(rows: Array<WindowKey & { delta: number }>): Promise<void> {
    this.check();
    for (const r of rows) this.rows.set(wkey(r), (this.rows.get(wkey(r)) ?? 0) + r.delta);
  }
  async get(k: WindowKey): Promise<number> {
    this.check();
    return this.rows.get(wkey(k)) ?? 0;
  }
  async purge(before: Record<CounterPeriod, number>): Promise<number> {
    this.check();
    let n = 0;
    for (const k of Array.from(this.rows.keys())) {
      const w = unkey(k);
      if (w.windowStart < before[w.period]) {
        this.rows.delete(k);
        n++;
      }
    }
    return n;
  }
  size(): number {
    return this.rows.size;
  }
}

/**
 * Almacén en MySQL (`es_erm.usage_windows`). El incremento y la lectura van en la MISMA sentencia:
 * `value = LAST_INSERT_ID(value + ?)` deja el valor resultante en el `insertId` de la respuesta, sin transacción
 * ni segunda consulta, y sin carreras entre réplicas (el UPSERT bloquea la fila).
 * `LAST_INSERT_ID` es sin signo: el valor se acota en 0 (un contador nunca baja de cero; las restas deshacen reservas).
 */
export class MysqlCounterStore implements SharedCounterStore {
  constructor(private pool: Pick<mysql.Pool, "query">) {}

  async incr(k: WindowKey, delta: number): Promise<number> {
    const d = Math.trunc(delta);
    const [r] = await this.pool.query<mysql.ResultSetHeader>(
      `INSERT INTO usage_windows (tenant_id, metric, period, window_start, value) VALUES (?, ?, ?, ?, LAST_INSERT_ID(GREATEST(?, 0)))
       ON DUPLICATE KEY UPDATE value = LAST_INSERT_ID(GREATEST(value + ?, 0))`,
      [k.tenantId, k.metric, k.period, k.windowStart, d, d],
    );
    return Number(r.insertId);
  }

  async addMany(rows: Array<WindowKey & { delta: number }>): Promise<void> {
    const values = rows.filter((r) => Math.trunc(r.delta) !== 0).map((r) => [r.tenantId, r.metric, r.period, r.windowStart, Math.trunc(r.delta)]);
    if (!values.length) return;
    await this.pool.query(
      `INSERT INTO usage_windows (tenant_id, metric, period, window_start, value) VALUES ?
       ON DUPLICATE KEY UPDATE value = value + VALUES(value)`,
      [values],
    );
  }

  async get(k: WindowKey): Promise<number> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT value FROM usage_windows WHERE tenant_id = ? AND metric = ? AND period = ? AND window_start = ?",
      [k.tenantId, k.metric, k.period, k.windowStart],
    );
    return Number(rows[0]?.value ?? 0);
  }

  async purge(before: Record<CounterPeriod, number>): Promise<number> {
    let n = 0;
    for (const p of Object.keys(before) as CounterPeriod[]) {
      const [r] = await this.pool.query<mysql.ResultSetHeader>(
        "DELETE FROM usage_windows WHERE period = ? AND window_start < ? LIMIT 5000",
        [p, before[p]],
      );
      n += r.affectedRows;
    }
    return n;
  }
}

/** Avisos del almacén compartido: `opsLog` + métrica, como mucho uno por operación cada minuto (sin inundar el log). */
export function sharedStoreWarner(now: () => number = Date.now): (op: string, e: unknown) => void {
  const last = new Map<string, number>();
  return (op, e) => {
    meter("erm.shared_store.unavailable", 1, "count", { op });
    const t = now();
    if ((last.get(op) ?? -Infinity) > t - 60_000) return;
    last.set(op, t);
    const code = (e as { code?: unknown })?.code;
    opsLog("warn", "ERM", "shared_store_unavailable", { op, error: typeof code === "string" ? code : e instanceof Error ? e.name : "error" });
  };
}

/** Métricas con cuota día/mes que se cuentan en los contadores compartidos (poco volumen, coste o límite duro). */
export const SHARED_COUNTER_METRICS: readonly string[] = [
  Metrics.EMAIL_SENT,
  Metrics.STORAGE_WRITE_BYTES,
  Metrics.LLM_TOKENS_INPUT,
  Metrics.LLM_TOKENS_OUTPUT,
  Metrics.AI_IMAGES,
  Metrics.AI_AUDIO_SECONDS,
  Metrics.DATA_EXPORT_RUNS,
  Metrics.DATA_EXPORT_BYTES,
];

const QUOTA_PERIODS: CounterPeriod[] = ["day", "month"];

/**
 * Cuotas día/mes sobre los contadores compartidos. Es un `MeterSink`: lo medido se acumula en local y se vuelca en lote
 * (`addMany`) cada pocos segundos. Para los límites duros, `reserve()` incrementa el contador ANTES de consumir y comprueba
 * el resultado de forma atómica (si se pasa, se deshace): así dos réplicas no pueden conceder a la vez la última unidad.
 * Lo reservado queda como «crédito» que absorbe la medición posterior del mismo consumo, para no contarlo dos veces.
 */
export class SharedUsageCounters implements MeterSink {
  private pending = new Map<string, number>();
  private credit = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private lastPurge = 0;
  private readonly metrics: Set<string>;
  private readonly now: () => number;
  private readonly warn: (op: string, e: unknown) => void;

  constructor(
    private store: SharedCounterStore,
    private opts: { metrics?: readonly string[]; now?: () => number; flushMs?: number; purgeEveryMs?: number; maxPendingKeys?: number; warn?: (op: string, e: unknown) => void } = {},
  ) {
    this.metrics = new Set(opts.metrics ?? SHARED_COUNTER_METRICS);
    this.now = opts.now ?? Date.now;
    this.warn = opts.warn ?? sharedStoreWarner(this.now);
  }

  tracks(metric: string): boolean {
    return this.metrics.has(metric);
  }

  private key(tenantId: string, metric: string, period: CounterPeriod, at = this.now()): WindowKey {
    return { tenantId, metric, period, windowStart: counterWindowStart(period, at) };
  }

  record(e: MeterEvent): void {
    if (!this.metrics.has(e.metric) || e.tenantId === "unresolved") return;
    if (!Number.isFinite(e.quantity) || e.quantity <= 0) return;
    const qty = Math.ceil(e.quantity);
    for (const p of QUOTA_PERIODS) {
      const k = wkey(this.key(e.tenantId, e.metric, p, e.at ?? this.now()));
      const c = this.credit.get(k) ?? 0;
      const used = Math.min(c, qty);
      if (used > 0) {
        if (c - used > 0) this.credit.set(k, c - used);
        else this.credit.delete(k);
      }
      const rest = qty - used;
      if (rest <= 0) continue;
      if (this.pending.size >= (this.opts.maxPendingKeys ?? 50_000) && !this.pending.has(k)) continue;
      this.pending.set(k, (this.pending.get(k) ?? 0) + rest);
    }
  }

  /** Consumo de la ventana actual: contador compartido + lo medido aquí y aún no volcado. Lanza si el almacén falla. */
  async used(tenantId: string, metric: string, period: CounterPeriod): Promise<number> {
    const k = this.key(tenantId, metric, period);
    try {
      return (await this.store.get(k)) + (this.pending.get(wkey(k)) ?? 0);
    } catch (e) {
      this.warn("get", e);
      throw e;
    }
  }

  /**
   * Reserva atómica de `qty` contra `limit`. `ok: false` si no cabe (el contador queda como estaba).
   * Lanza si el almacén falla: quien llama decide degradar.
   */
  async reserve(tenantId: string, metric: string, period: CounterPeriod, qty: number, limit: number): Promise<{ ok: boolean; used: number }> {
    const q = Math.ceil(qty);
    const k = this.key(tenantId, metric, period);
    const kk = wkey(k);
    let total: number;
    try {
      total = await this.store.incr(k, q);
    } catch (e) {
      this.warn("reserve", e);
      throw e;
    }
    const before = total - q + (this.pending.get(kk) ?? 0);
    if (before + q > limit) {
      await this.store.incr(k, -q).catch((e) => this.warn("reserve_undo", e));
      return { ok: false, used: before };
    }
    this.credit.set(kk, (this.credit.get(kk) ?? 0) + q);
    return { ok: true, used: before };
  }

  /** Deshace una reserva concedida (otra cuota del mismo consumo la rechazó). */
  async release(tenantId: string, metric: string, period: CounterPeriod, qty: number): Promise<void> {
    const q = Math.ceil(qty);
    const k = this.key(tenantId, metric, period);
    const kk = wkey(k);
    const c = (this.credit.get(kk) ?? 0) - q;
    if (c > 0) this.credit.set(kk, c);
    else this.credit.delete(kk);
    await this.store.incr(k, -q).catch((e) => this.warn("release", e));
  }

  /** Vuelca lo medido. Si el almacén falla, se conserva para el siguiente intento. */
  async flush(): Promise<number> {
    const t = this.now();
    // El crédito de ventanas pasadas ya no puede absorber nada
    for (const k of Array.from(this.credit.keys())) {
      const w = unkey(k);
      if (w.windowStart < counterWindowStart(w.period, t)) this.credit.delete(k);
    }
    let n = 0;
    if (this.pending.size) {
      const snapshot = this.pending;
      this.pending = new Map();
      const rows = Array.from(snapshot.entries()).map(([k, delta]) => ({ ...unkey(k), delta }));
      try {
        await this.store.addMany(rows);
        n = rows.length;
      } catch (e) {
        this.warn("flush", e);
        for (const [k, v] of Array.from(snapshot.entries())) this.pending.set(k, (this.pending.get(k) ?? 0) + v);
        return 0;
      }
    }
    await this.maybePurge(t);
    return n;
  }

  private async maybePurge(t: number): Promise<void> {
    if (t - this.lastPurge < (this.opts.purgeEveryMs ?? 600_000)) return;
    this.lastPurge = t;
    const before = {
      minute: t - COUNTER_RETENTION_MS.minute,
      day: t - COUNTER_RETENTION_MS.day,
      month: t - COUNTER_RETENTION_MS.month,
    };
    await this.store.purge(before).catch((e) => this.warn("purge", e));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.opts.flushMs ?? 2_000);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  stats() {
    return { pendingKeys: this.pending.size, creditKeys: this.credit.size };
  }
}
