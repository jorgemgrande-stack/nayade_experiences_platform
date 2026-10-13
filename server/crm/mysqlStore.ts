/**
 * Almacén MySQL del CRM (`db/crm/0000_crm.sql`). Mapeo explícito propiedad ↔ columna; las
 * marcas de tiempo se guardan como BIGINT (ms) y `modules` como JSON.
 */
import type mysql from "mysql2/promise";
import type { CrmStore, Tables } from "./store";

type Col = { prop: string; col: string; json?: boolean };
const t = (prop: string, col?: string, json = false): Col => ({ prop, col: col ?? prop.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()), json });

const DEFS: Record<keyof Tables, { table: string; cols: Col[] }> = {
  companies: {
    table: "crm_companies",
    cols: [t("name"), t("taxId"), t("website"), t("sector"), t("address"), t("notes"), t("tenantId"), t("owner"), t("createdAt")],
  },
  contacts: { table: "crm_contacts", cols: [t("companyId"), t("name"), t("email"), t("phone"), t("role"), t("createdAt")] },
  leads: {
    table: "crm_leads",
    cols: [t("source"), t("name"), t("email"), t("phone"), t("companyName"), t("status"), t("owner"), t("notes"), t("convertedCompanyId"), t("convertedOpportunityId"), t("createdAt")],
  },
  opportunities: {
    table: "crm_opportunities",
    cols: [t("companyId"), t("title"), t("stage"), t("amountCents"), t("currency"), t("expectedClose"), t("probability"), t("owner"), t("lostReason"), t("createdAt"), t("closedAt")],
  },
  contracts: {
    table: "crm_contracts",
    cols: [t("companyId"), t("opportunityId"), t("planId"), t("modules", "modules", true), t("status"), t("amountCents"), t("currency"), t("startDate"), t("endDate"), t("documentUrl"), t("signedAt"), t("tenantId"), t("createdAt")],
  },
  activities: {
    table: "crm_activities",
    cols: [t("entityType"), t("entityId"), t("kind"), t("summary"), t("dueAt"), t("doneAt"), t("author"), t("createdAt")],
  },
};

const NUMERIC = new Set(["createdAt", "dueAt", "doneAt", "closedAt", "expectedClose", "startDate", "endDate", "signedAt", "amountCents"]);

function fromRow(table: keyof Tables, r: Record<string, unknown>): any {
  const out: Record<string, unknown> = { id: Number(r.id) };
  for (const c of DEFS[table].cols) {
    let v = r[c.col];
    if (c.json) v = typeof v === "string" ? JSON.parse(v) : (v ?? []);
    else if (v !== null && v !== undefined && NUMERIC.has(c.prop)) v = Number(v);
    else if (v !== null && v !== undefined && /Id$/.test(c.prop) && c.prop !== "tenantId" && c.prop !== "planId") v = Number(v);
    out[c.prop] = v ?? null;
  }
  return out;
}

const toValue = (c: Col, v: unknown) => (c.json ? JSON.stringify(v ?? []) : (v ?? null));

export class MysqlCrmStore implements CrmStore {
  constructor(private pool: Pick<mysql.Pool, "query">) {}

  async insert<T extends keyof Tables>(table: T, row: Omit<Tables[T], "id">): Promise<Tables[T]> {
    const d = DEFS[table];
    const cols = d.cols.filter((c) => c.prop in (row as object));
    const [res] = await this.pool.query<mysql.ResultSetHeader>(
      `INSERT INTO ${d.table} (${cols.map((c) => c.col).join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      cols.map((c) => toValue(c, (row as Record<string, unknown>)[c.prop])),
    );
    return (await this.get(table, res.insertId))!;
  }

  async get<T extends keyof Tables>(table: T, id: number): Promise<Tables[T] | null> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(`SELECT * FROM ${DEFS[table].table} WHERE id = ?`, [id]);
    return rows[0] ? fromRow(table, rows[0]) : null;
  }

  async update<T extends keyof Tables>(table: T, id: number, patch: Partial<Omit<Tables[T], "id">>): Promise<Tables[T]> {
    const d = DEFS[table];
    const cols = d.cols.filter((c) => c.prop in (patch as object));
    if (cols.length) {
      await this.pool.query(`UPDATE ${d.table} SET ${cols.map((c) => `${c.col} = ?`).join(",")} WHERE id = ?`, [
        ...cols.map((c) => toValue(c, (patch as Record<string, unknown>)[c.prop])),
        id,
      ]);
    }
    const r = await this.get(table, id);
    if (!r) throw new Error("not found");
    return r;
  }

  async list<T extends keyof Tables>(
    table: T,
    filter: Partial<Tables[T]> = {},
    opts: { limit?: number; desc?: boolean } = {},
  ): Promise<Tables[T][]> {
    const d = DEFS[table];
    const entries = Object.entries(filter).filter(([, v]) => v !== undefined);
    const where = entries.map(([k]) => {
      const c = d.cols.find((x) => x.prop === k);
      if (!c) throw new Error(`Filtro no válido: ${k}`);
      return `${c.col} = ?`;
    });
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM ${d.table}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY id ${opts.desc ? "DESC" : "ASC"}${opts.limit ? " LIMIT " + Math.min(5000, Math.floor(opts.limit)) : ""}`,
      entries.map(([, v]) => v),
    );
    return rows.map((r) => fromRow(table, r));
  }

  async remove(table: keyof Tables, id: number): Promise<void> {
    await this.pool.query(`DELETE FROM ${DEFS[table].table} WHERE id = ?`, [id]);
  }
}
