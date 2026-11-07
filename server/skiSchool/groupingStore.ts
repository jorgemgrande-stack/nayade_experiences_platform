/**
 * Bolsa de inscripción de los turnos de cursillos y escuelita (migración `db/migrations/0044_ski_grupos.sql`). Un alumno
 * de la bolsa pasa a «colocado» una sola vez (con su sesión y su inscripción) o se anula; nada se borra.
 */
import { sql } from "drizzle-orm";
import { getTenantDatabase } from "../_core/dbRegistry";
import { ModuleNotInstalled } from "../sdk";
import { SKI_SCHOOL_ID } from "./manifest";

export interface PoolEntry {
  id: number;
  siteId: string;
  productId: number;
  date: string;
  startTime: string;
  name: string;
  age: number | null;
  level: string | null;
  language: string | null;
  notes: string | null;
  status: "pending" | "placed" | "cancelled";
  sessionId: number | null;
  participantId: number | null;
}
export type NewPoolEntry = Omit<PoolEntry, "id" | "status" | "sessionId" | "participantId">;
export interface Turn {
  siteId: string;
  productId: number;
  date: string;
  startTime: string;
}

export interface SkiGroupingStore {
  pool(t: Turn): Promise<PoolEntry[]>;
  entry(id: number): Promise<PoolEntry | null>;
  addEntry(x: NewPoolEntry, actor: string): Promise<number>;
  /** Solo si sigue pendiente; devuelve si cambió. */
  markPlaced(id: number, sessionId: number, participantId: number): Promise<boolean>;
  cancelEntry(id: number): Promise<boolean>;
}

export class MemorySkiGroupingStore implements SkiGroupingStore {
  private rows: PoolEntry[] = [];
  async pool(t: Turn) {
    return this.rows.filter((r) => r.siteId === t.siteId && r.productId === t.productId && r.date === t.date && r.startTime === t.startTime).map((r) => ({ ...r }));
  }
  async entry(id: number) {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async addEntry(x: NewPoolEntry) {
    const id = this.rows.length + 1;
    this.rows.push({ ...x, id, status: "pending", sessionId: null, participantId: null });
    return id;
  }
  async markPlaced(id: number, sessionId: number, participantId: number) {
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.status !== "pending") return false;
    Object.assign(r, { status: "placed", sessionId, participantId });
    return true;
  }
  async cancelEntry(id: number) {
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.status !== "pending") return false;
    r.status = "cancelled";
    return true;
  }
}

type Row = Record<string, unknown>;
type Db = NonNullable<Awaited<ReturnType<typeof getTenantDatabase>>>;
const rowsOf = (res: unknown): Row[] => (res as [Row[]])[0];
const affected = (res: unknown) => Number((res as [{ affectedRows: number }])[0].affectedRows);
const COLS = sql.raw("id, site_id, product_id, DATE_FORMAT(session_date, '%Y-%m-%d') AS session_date, start_time, full_name, age, level, language, notes, status, session_id, participant_id");
const toEntry = (r: Row): PoolEntry => ({
  id: Number(r.id),
  siteId: String(r.site_id),
  productId: Number(r.product_id),
  date: String(r.session_date),
  startTime: String(r.start_time),
  name: String(r.full_name),
  age: r.age == null ? null : Number(r.age),
  level: r.level == null ? null : String(r.level),
  language: r.language == null ? null : String(r.language),
  notes: r.notes == null ? null : String(r.notes),
  status: r.status as PoolEntry["status"],
  sessionId: r.session_id == null ? null : Number(r.session_id),
  participantId: r.participant_id == null ? null : Number(r.participant_id),
});

function isMissingTable(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146) return /ski_school_/.test(String(e.sqlMessage ?? e.message ?? ""));
  }
  return false;
}

export class TenantDbSkiGroupingStore implements SkiGroupingStore {
  private async exec<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const db = await getTenantDatabase();
    if (!db) throw new Error("Base de datos no disponible");
    try {
      return await fn(db);
    } catch (e) {
      if (isMissingTable(e)) throw new ModuleNotInstalled(SKI_SCHOOL_ID);
      throw e;
    }
  }
  pool(t: Turn) {
    return this.exec(async (db) =>
      rowsOf(
        await db.execute(sql`SELECT ${COLS} FROM ski_school_enrollment_pool WHERE site_id = ${t.siteId} AND product_id = ${t.productId} AND session_date = ${t.date} AND start_time = ${t.startTime} ORDER BY id`),
      ).map(toEntry),
    );
  }
  entry(id: number) {
    return this.exec(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT ${COLS} FROM ski_school_enrollment_pool WHERE id = ${id}`));
      return r ? toEntry(r) : null;
    });
  }
  addEntry(x: NewPoolEntry, actor: string) {
    return this.exec(async (db) => {
      const res = await db.execute(sql`
        INSERT INTO ski_school_enrollment_pool (site_id, product_id, session_date, start_time, full_name, age, level, language, notes, created_by)
        VALUES (${x.siteId}, ${x.productId}, ${x.date}, ${x.startTime}, ${x.name}, ${x.age}, ${x.level}, ${x.language}, ${x.notes}, ${actor.slice(0, 100)})`);
      return Number((res as unknown as [{ insertId: number }])[0].insertId);
    });
  }
  markPlaced(id: number, sessionId: number, participantId: number) {
    return this.exec(
      async (db) =>
        affected(await db.execute(sql`UPDATE ski_school_enrollment_pool SET status = 'placed', session_id = ${sessionId}, participant_id = ${participantId}, placed_at = CURRENT_TIMESTAMP(3) WHERE id = ${id} AND status = 'pending'`)) === 1,
    );
  }
  cancelEntry(id: number) {
    return this.exec(async (db) => affected(await db.execute(sql`UPDATE ski_school_enrollment_pool SET status = 'cancelled' WHERE id = ${id} AND status = 'pending'`)) === 1);
  }
}
