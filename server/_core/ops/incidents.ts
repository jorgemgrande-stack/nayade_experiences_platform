/**
 * Gestión de incidencias operativas.
 *
 *  - Deduplicación: una incidencia abierta por `dedupeKey`; repetirla solo actualiza
 *    `lastSeenAt` y el contador (no inunda de avisos).
 *  - Ciclo: open → acknowledged → resolved. Resolver cierra; si el problema reaparece, se abre
 *    una nueva con el mismo `dedupeKey`.
 *  - Notificación solo al abrir y al reabrir (no en cada repetición).
 */
import type mysql from "mysql2/promise";

export type Severity = "info" | "warning" | "critical";
export type IncidentStatus = "open" | "acknowledged" | "resolved";

export interface Incident {
  id: number;
  dedupeKey: string;
  tenantId: string | null;
  kind: string;
  severity: Severity;
  title: string;
  details: Record<string, string | number | boolean | null>;
  status: IncidentStatus;
  openedAt: number;
  lastSeenAt: number;
  occurrences: number;
  acknowledgedBy: string | null;
  resolvedAt: number | null;
  resolvedBy: string | null;
}

export interface IncidentStore {
  findOpen(dedupeKey: string): Promise<Incident | null>;
  insert(i: Omit<Incident, "id">): Promise<Incident>;
  update(id: number, patch: Partial<Omit<Incident, "id">>): Promise<Incident>;
  get(id: number): Promise<Incident | null>;
  list(opts?: { status?: IncidentStatus; tenantId?: string; limit?: number }): Promise<Incident[]>;
}

export interface IncidentNotifier {
  notify(i: Incident, event: "opened" | "reopened" | "escalated" | "resolved"): Promise<void>;
}

export class MemoryIncidentStore implements IncidentStore {
  private rows: Incident[] = [];
  private seq = 0;
  async findOpen(k: string) {
    return this.rows.find((r) => r.dedupeKey === k && r.status !== "resolved") ?? null;
  }
  async insert(i: Omit<Incident, "id">) {
    const r = { ...i, id: ++this.seq };
    this.rows.push(r);
    return { ...r };
  }
  async update(id: number, patch: Partial<Omit<Incident, "id">>) {
    const r = this.rows.find((x) => x.id === id)!;
    Object.assign(r, patch);
    return { ...r };
  }
  async get(id: number) {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async list(opts: { status?: IncidentStatus; tenantId?: string; limit?: number } = {}) {
    return this.rows
      .filter((r) => (!opts.status || r.status === opts.status) && (!opts.tenantId || r.tenantId === opts.tenantId))
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(0, opts.limit ?? 200)
      .map((r) => ({ ...r }));
  }
}

const map = (r: any): Incident => ({
  id: Number(r.id),
  dedupeKey: r.dedupe_key,
  tenantId: r.tenant_id ?? null,
  kind: r.kind,
  severity: r.severity,
  title: r.title,
  details: typeof r.details === "string" ? JSON.parse(r.details) : (r.details ?? {}),
  status: r.status,
  openedAt: Number(r.opened_at),
  lastSeenAt: Number(r.last_seen_at),
  occurrences: Number(r.occurrences),
  acknowledgedBy: r.acknowledged_by ?? null,
  resolvedAt: r.resolved_at === null || r.resolved_at === undefined ? null : Number(r.resolved_at),
  resolvedBy: r.resolved_by ?? null,
});

const COLS: Array<[keyof Incident, string]> = [
  ["dedupeKey", "dedupe_key"], ["tenantId", "tenant_id"], ["kind", "kind"], ["severity", "severity"], ["title", "title"],
  ["details", "details"], ["status", "status"], ["openedAt", "opened_at"], ["lastSeenAt", "last_seen_at"],
  ["occurrences", "occurrences"], ["acknowledgedBy", "acknowledged_by"], ["resolvedAt", "resolved_at"], ["resolvedBy", "resolved_by"],
];

export class MysqlIncidentStore implements IncidentStore {
  constructor(private pool: Pick<mysql.Pool, "query">) {}

  async findOpen(k: string) {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM ops_incidents WHERE dedupe_key = ? AND status <> 'resolved' ORDER BY id DESC LIMIT 1",
      [k],
    );
    return r[0] ? map(r[0]) : null;
  }
  async insert(i: Omit<Incident, "id">) {
    const cols = COLS.map(([, c]) => c);
    const vals = COLS.map(([p]) => (p === "details" ? JSON.stringify(i.details) : (i as Record<string, unknown>)[p] ?? null));
    const [res] = await this.pool.query<mysql.ResultSetHeader>(
      `INSERT INTO ops_incidents (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      vals,
    );
    return (await this.get(res.insertId))!;
  }
  async update(id: number, patch: Partial<Omit<Incident, "id">>) {
    const used = COLS.filter(([p]) => p in patch);
    if (used.length) {
      await this.pool.query(`UPDATE ops_incidents SET ${used.map(([, c]) => `${c} = ?`).join(",")} WHERE id = ?`, [
        ...used.map(([p]) => (p === "details" ? JSON.stringify((patch as Incident).details) : (patch as Record<string, unknown>)[p] ?? null)),
        id,
      ]);
    }
    return (await this.get(id))!;
  }
  async get(id: number) {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM ops_incidents WHERE id = ?", [id]);
    return r[0] ? map(r[0]) : null;
  }
  async list(opts: { status?: IncidentStatus; tenantId?: string; limit?: number } = {}) {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.status) (where.push("status = ?"), args.push(opts.status));
    if (opts.tenantId) (where.push("tenant_id = ?"), args.push(opts.tenantId));
    const [r] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM ops_incidents${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY opened_at DESC LIMIT ${Math.min(500, opts.limit ?? 200)}`,
      args,
    );
    return r.map(map);
  }
}

const SEV_RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

export class IncidentService {
  constructor(
    private store: IncidentStore,
    private notifier?: IncidentNotifier,
    private now: () => number = Date.now,
  ) {}

  /** Abre o actualiza (idempotente por `dedupeKey`). */
  async raise(input: {
    dedupeKey: string;
    kind: string;
    severity: Severity;
    title: string;
    tenantId?: string | null;
    details?: Record<string, string | number | boolean | null>;
  }): Promise<Incident> {
    const t = this.now();
    const open = await this.store.findOpen(input.dedupeKey);
    if (open) {
      const escalated = SEV_RANK[input.severity] > SEV_RANK[open.severity];
      const upd = await this.store.update(open.id, {
        lastSeenAt: t,
        occurrences: open.occurrences + 1,
        details: input.details ?? open.details,
        severity: escalated ? input.severity : open.severity,
        title: input.title,
      });
      if (escalated) await this.safeNotify(upd, "escalated");
      return upd;
    }
    const prev = (await this.store.list({ limit: 500 })).find((i) => i.dedupeKey === input.dedupeKey);
    const created = await this.store.insert({
      dedupeKey: input.dedupeKey,
      tenantId: input.tenantId ?? null,
      kind: input.kind,
      severity: input.severity,
      title: input.title.slice(0, 200),
      details: input.details ?? {},
      status: "open",
      openedAt: t,
      lastSeenAt: t,
      occurrences: 1,
      acknowledgedBy: null,
      resolvedAt: null,
      resolvedBy: null,
    });
    await this.safeNotify(created, prev ? "reopened" : "opened");
    return created;
  }

  async acknowledge(id: number, by: string): Promise<Incident> {
    const i = await this.must(id);
    if (i.status === "resolved") return i;
    return this.store.update(id, { status: "acknowledged", acknowledgedBy: by.slice(0, 100) });
  }

  async resolve(id: number, by: string): Promise<Incident> {
    const i = await this.must(id);
    if (i.status === "resolved") return i;
    const upd = await this.store.update(id, { status: "resolved", resolvedAt: this.now(), resolvedBy: by.slice(0, 100) });
    await this.safeNotify(upd, "resolved");
    return upd;
  }

  /** Cierra automáticamente lo que ya no se observa (`activeKeys` = claves vigentes en esta pasada). */
  async autoResolve(activeKeys: Set<string>, kindPrefix: string): Promise<number> {
    let n = 0;
    for (const i of await this.store.list({ limit: 500 })) {
      if (i.status !== "resolved" && i.kind.startsWith(kindPrefix) && !activeKeys.has(i.dedupeKey)) {
        await this.resolve(i.id, "auto");
        n++;
      }
    }
    return n;
  }

  /**
   * Cierra las incidencias abiertas cuyo tipo empieza por `kindPrefix` y que no se repiten desde hace `quietMs`
   * (p. ej. las de ritmo de fallos «rate.*», que se abren solas pero nadie las «deja de observar»).
   */
  async autoResolveQuiet(kindPrefix: string, quietMs: number, now: number): Promise<number> {
    let n = 0;
    for (const i of await this.store.list({ limit: 500 })) {
      if (i.status !== "resolved" && i.kind.startsWith(kindPrefix) && now - i.lastSeenAt > quietMs) {
        await this.resolve(i.id, "auto");
        n++;
      }
    }
    return n;
  }

  list(opts?: { status?: IncidentStatus; tenantId?: string; limit?: number }) {
    return this.store.list(opts);
  }

  private async must(id: number) {
    const i = await this.store.get(id);
    if (!i) throw new Error("Incidencia no encontrada");
    return i;
  }

  private async safeNotify(i: Incident, ev: "opened" | "reopened" | "escalated" | "resolved") {
    try {
      await this.notifier?.notify(i, ev);
    } catch {
      /* la notificación nunca rompe la operación */
    }
  }
}

/** Notificador por webhook (formato compatible con Slack/Teams: `{ text }`). */
export function webhookNotifier(url: string, fetchImpl: typeof fetch = fetch): IncidentNotifier {
  if (!/^https:\/\//.test(url)) throw new Error("El webhook de alertas debe ser https");
  return {
    async notify(i, event) {
      const icon = i.severity === "critical" ? "🔴" : i.severity === "warning" ? "🟠" : "🔵";
      const text = `${icon} [${event}] ${i.title}${i.tenantId ? ` (tenant ${i.tenantId})` : ""} — incidencia #${i.id}`;
      await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    },
  };
}
