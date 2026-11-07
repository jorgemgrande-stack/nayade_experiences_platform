/**
 * Persistencia de Brevo marketing en la BD de la empresa (migración `db/migrations/0042_brevo_marketing.sql`):
 * consentimiento por cliente del CRM con historial inmutable, ajustes de la conexión, ejecuciones y estado por contacto.
 * Sin las tablas → `BrevoNotInstalled`.
 */
import { sql } from "drizzle-orm";
import { getTenantDatabase } from "../_core/dbRegistry";
import type { Candidate, ConsentStatus, PreviousSync } from "./plan";

export class BrevoNotInstalled extends Error {
  constructor() {
    super("El conector de Brevo aún no está instalado en la base de datos de la empresa");
    this.name = "BrevoNotInstalled";
  }
}
export class RunInProgress extends Error {
  constructor() {
    super("Ya hay una sincronización en curso");
    this.name = "RunInProgress";
  }
}

export interface Settings {
  listId: number | null;
  listName: string | null;
  autoSync: boolean;
  connectedAt: string | null;
  disconnectedAt: string | null;
}
export interface Consent {
  clientId: number;
  status: ConsentStatus;
  source: string;
  evidence: string | null;
  grantedAt: string | null;
  withdrawnAt: string | null;
  updatedBy: string;
}
export interface ConsentLogEntry {
  clientId: number;
  previousStatus: ConsentStatus | null;
  newStatus: ConsentStatus;
  source: string;
  evidence: string | null;
  actor: string;
  createdAt?: string;
}
export type RunTrigger = "manual" | "job" | "retry";
export type RunStatus = "running" | "completed" | "partial" | "failed";
export interface RunStats {
  apiCalls: number;
  exported: number;
  removed: number;
  unsubscribed: number;
  skipped: number;
  errors: number;
}
export interface Run extends RunStats {
  id: number;
  trigger: RunTrigger;
  status: RunStatus;
  listId: number | null;
  errorMessage: string | null;
  retryOf: number | null;
  actor: string | null;
  startedAt: string;
  finishedAt: string | null;
}
export interface ClientRow {
  clientId: number;
  name: string;
  email: string;
  consent: ConsentStatus | null;
  consentSource: string | null;
  consentAt: string | null;
  syncStatus: PreviousSync["status"] | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface BrevoMarketingStore {
  settings(): Promise<Settings>;
  saveSettings(patch: Partial<Pick<Settings, "listId" | "listName" | "autoSync">> & { connected?: boolean; disconnected?: boolean }, actor: string): Promise<void>;

  consent(clientId: number): Promise<Consent | null>;
  /** Cambia el estado vigente y añade la fila del historial a la vez. */
  setConsent(next: Omit<Consent, "grantedAt" | "withdrawnAt">, log: ConsentLogEntry): Promise<void>;
  consentLog(clientId: number): Promise<ConsentLogEntry[]>;
  /**
   * Baja atómica: retira el consentimiento (o registra la retirada si no había) con su fila del historial, salvo que ya
   * estuviera retirado. Devuelve si ha cambiado algo (dos bajas a la vez: una sola fila del historial).
   */
  withdrawOnce(clientId: number, source: string, evidence: string | null, actor: string): Promise<boolean>;
  clientEmail(clientId: number): Promise<string | null>;
  clientExists(clientId: number): Promise<boolean>;
  clients(q: string, limit: number): Promise<ClientRow[]>;
  consentCounts(): Promise<{ granted: number; withdrawn: number }>;

  /** Clientes con consentimiento registrado o que ya pasaron por la lista. */
  candidates(): Promise<Candidate[]>;
  previous(): Promise<Map<number, PreviousSync>>;
  recordSync(rows: Array<{ clientId: number; email: string; status: PreviousSync["status"]; error?: string | null }>, runId: number): Promise<void>;

  /** Da por fallidas las ejecuciones «en curso» de hace más de `olderThanMs` (el proceso se cayó a mitad). */
  failStaleRuns(olderThanMs: number): Promise<number>;
  /** Abre una ejecución; si ya hay otra en curso, `RunInProgress` (lo garantiza la BD). */
  startRun(trigger: RunTrigger, listId: number, actor: string, retryOf: number | null): Promise<number>;
  finishRun(id: number, status: Exclude<RunStatus, "running">, stats: RunStats, errorMessage: string | null): Promise<void>;
  runs(limit: number): Promise<Run[]>;
  run(id: number): Promise<Run | null>;
}

// ── En memoria (pruebas) ─────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

export class MemoryBrevoMarketingStore implements BrevoMarketingStore {
  private set: Settings = { listId: null, listName: null, autoSync: false, connectedAt: null, disconnectedAt: null };
  private cons = new Map<number, Consent>();
  log: ConsentLogEntry[] = [];
  private sync = new Map<number, PreviousSync & { error: string | null; at: string }>();
  private runRows: Run[] = [];
  clientRows: Array<{ id: number; name: string; email: string }> = [];

  async settings() {
    return { ...this.set };
  }
  async saveSettings(p: Partial<Pick<Settings, "listId" | "listName" | "autoSync">> & { connected?: boolean; disconnected?: boolean }) {
    if (p.listId !== undefined) this.set.listId = p.listId;
    if (p.listName !== undefined) this.set.listName = p.listName;
    if (p.autoSync !== undefined) this.set.autoSync = p.autoSync;
    if (p.connected) this.set.connectedAt = now();
    if (p.disconnected) this.set.disconnectedAt = now();
  }
  async consent(clientId: number) {
    const c = this.cons.get(clientId);
    return c ? { ...c } : null;
  }
  async setConsent(next: Omit<Consent, "grantedAt" | "withdrawnAt">, log: ConsentLogEntry) {
    const prev = this.cons.get(next.clientId);
    this.cons.set(next.clientId, { ...next, grantedAt: next.status === "granted" ? now() : (prev?.grantedAt ?? null), withdrawnAt: next.status === "withdrawn" ? now() : null });
    this.log.push({ ...log, createdAt: now() });
  }
  async consentLog(clientId: number) {
    return this.log.filter((l) => l.clientId === clientId).map((l) => ({ ...l }));
  }
  async withdrawOnce(clientId: number, source: string, evidence: string | null, actor: string) {
    const prev = this.cons.get(clientId);
    if (prev?.status === "withdrawn") return false;
    await this.setConsent({ clientId, status: "withdrawn", source, evidence, updatedBy: actor }, { clientId, previousStatus: prev?.status ?? null, newStatus: "withdrawn", source, evidence, actor });
    return true;
  }
  async clientEmail(clientId: number) {
    return this.clientRows.find((c) => c.id === clientId)?.email ?? null;
  }
  async clientExists(clientId: number) {
    return this.clientRows.some((c) => c.id === clientId);
  }
  async clients(q: string, limit: number) {
    const t = q.trim().toLowerCase();
    return this.clientRows
      .filter((c) => !t || c.name.toLowerCase().includes(t) || c.email.toLowerCase().includes(t))
      .slice(0, limit)
      .map((c) => {
        const k = this.cons.get(c.id);
        const s = this.sync.get(c.id);
        return { clientId: c.id, name: c.name, email: c.email, consent: k?.status ?? null, consentSource: k?.source ?? null, consentAt: k ? (k.withdrawnAt ?? k.grantedAt) : null, syncStatus: s?.status ?? null, lastSyncedAt: s?.at ?? null, lastError: s?.error ?? null };
      });
  }
  async consentCounts() {
    const all = Array.from(this.cons.values());
    return { granted: all.filter((c) => c.status === "granted").length, withdrawn: all.filter((c) => c.status === "withdrawn").length };
  }
  async candidates() {
    const ids = new Set([...Array.from(this.cons.keys()), ...Array.from(this.sync.keys())]);
    return this.clientRows.filter((c) => ids.has(c.id)).map((c) => ({ clientId: c.id, email: c.email, name: c.name, consent: this.cons.get(c.id)?.status ?? null }));
  }
  async previous() {
    return new Map(Array.from(this.sync.entries()).map(([k, v]) => [k, { email: v.email, status: v.status }]));
  }
  async recordSync(rows: Array<{ clientId: number; email: string; status: PreviousSync["status"]; error?: string | null }>) {
    for (const r of rows) this.sync.set(r.clientId, { email: r.email, status: r.status, error: r.error ?? null, at: now() });
  }
  async failStaleRuns(olderThanMs: number) {
    const before = new Date(Date.now() - olderThanMs);
    let n = 0;
    for (const r of this.runRows) if (r.status === "running" && new Date(r.startedAt) < before) (r.status = "failed"), (r.errorMessage = "Ejecución interrumpida"), n++;
    return n;
  }
  async startRun(trigger: RunTrigger, listId: number, actor: string, retryOf: number | null) {
    if (this.runRows.some((r) => r.status === "running")) throw new RunInProgress();
    const id = this.runRows.length + 1;
    this.runRows.push({ id, trigger, status: "running", listId, apiCalls: 0, exported: 0, removed: 0, unsubscribed: 0, skipped: 0, errors: 0, errorMessage: null, retryOf, actor, startedAt: now(), finishedAt: null });
    return id;
  }
  async finishRun(id: number, status: Exclude<RunStatus, "running">, stats: RunStats, errorMessage: string | null) {
    Object.assign(this.runRows.find((r) => r.id === id)!, stats, { status, errorMessage, finishedAt: now() });
  }
  async runs(limit: number) {
    return [...this.runRows].reverse().slice(0, limit).map((r) => ({ ...r }));
  }
  async run(id: number) {
    const r = this.runRows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  /** Solo pruebas: fecha de inicio de una ejecución. */
  _ageRun(id: number, startedAt: Date) {
    this.runRows.find((r) => r.id === id)!.startedAt = startedAt.toISOString();
  }
}

// ── BD de la empresa ─────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type Db = NonNullable<Awaited<ReturnType<typeof getTenantDatabase>>>;
const rowsOf = (res: unknown): Row[] => (res as [Row[]])[0];
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));
const str = (v: unknown) => (v == null ? null : String(v));

function isMissingTable(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146) return /brevo_|customer_marketing_/.test(String(e.sqlMessage ?? e.message ?? ""));
  }
  return false;
}
const isDuplicate = (err: unknown) => {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) if (e.code === "ER_DUP_ENTRY" || e.errno === 1062) return true;
  return false;
};

const toRun = (r: Row): Run => ({
  id: Number(r.id),
  trigger: r.trigger_kind as RunTrigger,
  status: r.status as RunStatus,
  listId: num(r.list_id),
  apiCalls: Number(r.api_calls),
  exported: Number(r.exported),
  removed: Number(r.removed),
  unsubscribed: Number(r.unsubscribed),
  skipped: Number(r.skipped),
  errors: Number(r.errors),
  errorMessage: str(r.error_message),
  retryOf: num(r.retry_of),
  actor: str(r.actor),
  startedAt: iso(r.started_at)!,
  finishedAt: iso(r.finished_at),
});

export class TenantDbBrevoMarketingStore implements BrevoMarketingStore {
  private async exec<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const db = await getTenantDatabase();
    if (!db) throw new Error("Base de datos no disponible");
    try {
      return await fn(db);
    } catch (e) {
      if (isMissingTable(e)) throw new BrevoNotInstalled();
      throw e;
    }
  }

  settings() {
    return this.exec(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT * FROM brevo_marketing_settings WHERE id = 1`));
      return r
        ? { listId: num(r.list_id), listName: str(r.list_name), autoSync: Number(r.auto_sync) === 1, connectedAt: iso(r.connected_at), disconnectedAt: iso(r.disconnected_at) }
        : { listId: null, listName: null, autoSync: false, connectedAt: null, disconnectedAt: null };
    });
  }
  saveSettings(p: Partial<Pick<Settings, "listId" | "listName" | "autoSync">> & { connected?: boolean; disconnected?: boolean }, actor: string) {
    return this.exec(async (db) => {
      await db.execute(sql`INSERT IGNORE INTO brevo_marketing_settings (id) VALUES (1)`);
      const sets = [sql`updated_by = ${actor.slice(0, 100)}`];
      if (p.listId !== undefined) sets.push(sql`list_id = ${p.listId}`);
      if (p.listName !== undefined) sets.push(sql`list_name = ${p.listName == null ? null : p.listName.slice(0, 200)}`);
      if (p.autoSync !== undefined) sets.push(sql`auto_sync = ${p.autoSync ? 1 : 0}`);
      if (p.connected) sets.push(sql`connected_at = CURRENT_TIMESTAMP(3)`);
      if (p.disconnected) sets.push(sql`disconnected_at = CURRENT_TIMESTAMP(3)`);
      await db.execute(sql`UPDATE brevo_marketing_settings SET ${sql.join(sets, sql`, `)} WHERE id = 1`);
    });
  }

  consent(clientId: number) {
    return this.exec(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT * FROM customer_marketing_consents WHERE client_id = ${clientId}`));
      return r
        ? { clientId, status: r.status as ConsentStatus, source: String(r.source), evidence: str(r.evidence), grantedAt: iso(r.granted_at), withdrawnAt: iso(r.withdrawn_at), updatedBy: String(r.updated_by) }
        : null;
    });
  }
  setConsent(next: Omit<Consent, "grantedAt" | "withdrawnAt">, log: ConsentLogEntry) {
    return this.exec((db) =>
      db.transaction(async (tx) => {
        const granted = next.status === "granted";
        await tx.execute(sql`
          INSERT INTO customer_marketing_consents (client_id, status, source, evidence, granted_at, withdrawn_at, updated_by)
          VALUES (${next.clientId}, ${next.status}, ${next.source}, ${next.evidence}, ${granted ? sql`CURRENT_TIMESTAMP(3)` : null}, ${granted ? null : sql`CURRENT_TIMESTAMP(3)`}, ${next.updatedBy.slice(0, 100)})
          ON DUPLICATE KEY UPDATE status = VALUES(status), source = VALUES(source), evidence = VALUES(evidence),
            granted_at = IF(VALUES(status) = 'granted', CURRENT_TIMESTAMP(3), granted_at),
            withdrawn_at = IF(VALUES(status) = 'withdrawn', CURRENT_TIMESTAMP(3), NULL), updated_by = VALUES(updated_by)`);
        await tx.execute(sql`
          INSERT INTO customer_marketing_consent_log (client_id, previous_status, new_status, source, evidence, actor)
          VALUES (${log.clientId}, ${log.previousStatus}, ${log.newStatus}, ${log.source}, ${log.evidence}, ${log.actor.slice(0, 100)})`);
      }),
    );
  }
  consentLog(clientId: number) {
    return this.exec(async (db) =>
      rowsOf(await db.execute(sql`SELECT * FROM customer_marketing_consent_log WHERE client_id = ${clientId} ORDER BY id`)).map((r) => ({
        clientId,
        previousStatus: r.previous_status as ConsentStatus | null,
        newStatus: r.new_status as ConsentStatus,
        source: String(r.source),
        evidence: str(r.evidence),
        actor: String(r.actor),
        createdAt: iso(r.created_at)!,
      })),
    );
  }
  async withdrawOnce(clientId: number, source: string, evidence: string | null, actor: string): Promise<boolean> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.exec((db) =>
          db.transaction(async (tx) => {
            const [cur] = rowsOf(await tx.execute(sql`SELECT status FROM customer_marketing_consents WHERE client_id = ${clientId} FOR UPDATE`));
            if (cur?.status === "withdrawn") return false;
            await tx.execute(sql`
              INSERT INTO customer_marketing_consents (client_id, status, source, evidence, granted_at, withdrawn_at, updated_by)
              VALUES (${clientId}, 'withdrawn', ${source}, ${evidence}, NULL, CURRENT_TIMESTAMP(3), ${actor.slice(0, 100)})
              ON DUPLICATE KEY UPDATE status = 'withdrawn', source = VALUES(source), evidence = VALUES(evidence), withdrawn_at = CURRENT_TIMESTAMP(3), updated_by = VALUES(updated_by)`);
            await tx.execute(sql`
              INSERT INTO customer_marketing_consent_log (client_id, previous_status, new_status, source, evidence, actor)
              VALUES (${clientId}, ${cur ? String(cur.status) : null}, 'withdrawn', ${source}, ${evidence}, ${actor.slice(0, 100)})`);
            return true;
          }),
        );
      } catch (e) {
        // Dos bajas a la vez sin fila previa: una gana; la otra se repite y ve la baja ya hecha
        const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
        if (attempt < 3 && (isDuplicate(e) || code === "ER_LOCK_DEADLOCK")) continue;
        throw e;
      }
    }
  }
  clientEmail(clientId: number) {
    return this.exec(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT email FROM clients WHERE id = ${clientId}`));
      return r?.email ? String(r.email).trim().toLowerCase() : null;
    });
  }
  clientExists(clientId: number) {
    return this.exec(async (db) => rowsOf(await db.execute(sql`SELECT id FROM clients WHERE id = ${clientId}`)).length > 0);
  }
  clients(q: string, limit: number) {
    const like = `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return this.exec(async (db) =>
      rowsOf(
        await db.execute(sql`
          SELECT c.id, c.name, c.email, m.status, m.source, COALESCE(m.withdrawn_at, m.granted_at) AS consent_at, s.status AS sync_status, s.last_synced_at, s.last_error
          FROM clients c
          LEFT JOIN customer_marketing_consents m ON m.client_id = c.id
          LEFT JOIN brevo_contact_sync s ON s.client_id = c.id
          ${q.trim() ? sql`WHERE c.name LIKE ${like} OR c.email LIKE ${like}` : sql``}
          ORDER BY m.updated_at IS NULL, m.updated_at DESC, c.id DESC LIMIT ${limit}`),
      ).map((r) => ({
        clientId: Number(r.id),
        name: String(r.name),
        email: String(r.email),
        consent: (r.status as ConsentStatus | null) ?? null,
        consentSource: str(r.source),
        consentAt: iso(r.consent_at),
        syncStatus: (r.sync_status as PreviousSync["status"] | null) ?? null,
        lastSyncedAt: iso(r.last_synced_at),
        lastError: str(r.last_error),
      })),
    );
  }
  consentCounts() {
    return this.exec(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT SUM(status = 'granted') AS g, SUM(status = 'withdrawn') AS w FROM customer_marketing_consents`));
      return { granted: Number(r?.g ?? 0), withdrawn: Number(r?.w ?? 0) };
    });
  }

  candidates() {
    return this.exec(async (db) =>
      rowsOf(
        await db.execute(sql`
          SELECT c.id, c.email, c.name, m.status FROM clients c
          LEFT JOIN customer_marketing_consents m ON m.client_id = c.id
          LEFT JOIN brevo_contact_sync s ON s.client_id = c.id
          WHERE m.client_id IS NOT NULL OR s.client_id IS NOT NULL`),
      ).map((r) => ({ clientId: Number(r.id), email: str(r.email), name: str(r.name), consent: (r.status as ConsentStatus | null) ?? null })),
    );
  }
  previous() {
    return this.exec(async (db) => new Map(rowsOf(await db.execute(sql`SELECT client_id, email_normalized, status FROM brevo_contact_sync`)).map((r) => [Number(r.client_id), { email: String(r.email_normalized), status: r.status as PreviousSync["status"] }])));
  }
  recordSync(rows: Array<{ clientId: number; email: string; status: PreviousSync["status"]; error?: string | null }>, runId: number) {
    if (!rows.length) return Promise.resolve();
    return this.exec(async (db) => {
      for (const r of rows) {
        await db.execute(sql`
          INSERT INTO brevo_contact_sync (client_id, email_normalized, status, last_synced_at, last_error, last_run_id)
          VALUES (${r.clientId}, ${r.email}, ${r.status}, ${r.status === "error" ? null : sql`CURRENT_TIMESTAMP(3)`}, ${r.error?.slice(0, 300) ?? null}, ${runId})
          ON DUPLICATE KEY UPDATE email_normalized = VALUES(email_normalized), status = VALUES(status),
            last_synced_at = IF(VALUES(status) = 'error', last_synced_at, CURRENT_TIMESTAMP(3)), last_error = VALUES(last_error), last_run_id = VALUES(last_run_id)`);
      }
    });
  }

  failStaleRuns(olderThanMs: number) {
    return this.exec(
      async (db) =>
        Number(
          (
            (await db.execute(sql`UPDATE brevo_sync_runs SET status = 'failed', error_message = 'Ejecución interrumpida', finished_at = CURRENT_TIMESTAMP(3) WHERE status = 'running' AND started_at < NOW(3) - INTERVAL ${Math.max(1, Math.round(olderThanMs / 1000))} SECOND`)) as unknown as [
              { affectedRows: number },
            ]
          )[0].affectedRows,
        ),
    );
  }
  startRun(trigger: RunTrigger, listId: number, actor: string, retryOf: number | null) {
    return this.exec(async (db) => {
      try {
        const res = await db.execute(sql`INSERT INTO brevo_sync_runs (trigger_kind, list_id, actor, retry_of) VALUES (${trigger}, ${listId}, ${actor.slice(0, 100)}, ${retryOf})`);
        return Number((res as unknown as [{ insertId: number }])[0].insertId);
      } catch (e) {
        if (isDuplicate(e)) throw new RunInProgress();
        throw e;
      }
    });
  }
  finishRun(id: number, status: Exclude<RunStatus, "running">, s: RunStats, errorMessage: string | null) {
    return this.exec(async (db) => {
      await db.execute(sql`
        UPDATE brevo_sync_runs SET status = ${status}, api_calls = ${s.apiCalls}, exported = ${s.exported}, removed = ${s.removed}, unsubscribed = ${s.unsubscribed},
          skipped = ${s.skipped}, errors = ${s.errors}, error_message = ${errorMessage?.slice(0, 500) ?? null}, finished_at = CURRENT_TIMESTAMP(3)
        WHERE id = ${id}`);
    });
  }
  runs(limit: number) {
    return this.exec(async (db) => rowsOf(await db.execute(sql`SELECT * FROM brevo_sync_runs ORDER BY id DESC LIMIT ${limit}`)).map(toRun));
  }
  run(id: number) {
    return this.exec(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT * FROM brevo_sync_runs WHERE id = ${id}`));
      return r ? toRun(r) : null;
    });
  }
}
