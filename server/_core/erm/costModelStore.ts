/**
 * Tarifas del Resource Manager editables desde Admin y auditadas (registro 0014). Una sola fila vigente con versión
 * (concurrencia optimista: quien guarda dice sobre qué versión cambia) y un historial completo con motivo y autor.
 * Sin fila, el coste sale de ERM_COST_MODEL o de la estimación declarada. Nunca son precios de venta.
 */
import type mysql from "mysql2/promise";
import { z } from "zod";
import { costModelInputSchema, type CostModel } from "./costs";

export type CostModelInput = z.infer<typeof costModelInputSchema>;

export interface StoredCostModel {
  version: number;
  model: CostModelInput;
  updatedBy: string;
  updatedAt: number;
}

export interface CostModelChange {
  version: number;
  model: CostModelInput;
  reason: string;
  changedBy: string;
  changedAt: number;
}

export class CostModelConflict extends Error {
  constructor(public readonly current: number) {
    super(`Las tarifas cambiaron mientras se editaban (versión actual ${current}): recarga y vuelve a intentarlo`);
    this.name = "CostModelConflict";
  }
}

export interface CostModelStore {
  get(): Promise<StoredCostModel | null>;
  /** Guarda sobre `expectedVersion` (0 si no había ninguna). Lanza CostModelConflict si otra persona guardó antes. */
  save(input: CostModelInput, o: { expectedVersion: number; reason: string; actor: string; now: number }): Promise<StoredCostModel>;
  history(limit: number): Promise<CostModelChange[]>;
}

/** Modelo vigente para el cálculo: el de Admin si existe; si no, el del entorno (o la estimación). */
export function activeCostModel(stored: StoredCostModel | null, fallback: { model: CostModel; error: string | null }): { model: CostModel; error: string | null; origin: "admin" | "entorno" | "estimación"; version: number | null } {
  if (stored) {
    const m = stored.model;
    return {
      model: { source: "configuración", note: m.note ?? "Tarifas configuradas en Admin", currency: "EUR", rates: m.rates, sharedMonthlyCents: m.sharedMonthlyCents, sharedBasis: m.sharedBasis, ...(m.sharedEvidence ? { sharedEvidence: m.sharedEvidence } : {}) },
      error: null,
      origin: "admin",
      version: stored.version,
    };
  }
  return { ...fallback, origin: fallback.model.source === "configuración" ? "entorno" : "estimación", version: null };
}

export class MemoryCostModelStore implements CostModelStore {
  private cur: StoredCostModel | null = null;
  private log: CostModelChange[] = [];
  async get() {
    return this.cur ? structuredClone(this.cur) : null;
  }
  async save(input: CostModelInput, o: { expectedVersion: number; reason: string; actor: string; now: number }) {
    const v = this.cur?.version ?? 0;
    if (v !== o.expectedVersion) throw new CostModelConflict(v);
    this.cur = { version: v + 1, model: structuredClone(input), updatedBy: o.actor, updatedAt: o.now };
    this.log.unshift({ version: v + 1, model: structuredClone(input), reason: o.reason, changedBy: o.actor, changedAt: o.now });
    return structuredClone(this.cur);
  }
  async history(limit: number) {
    return structuredClone(this.log.slice(0, limit));
  }
}

export class MysqlCostModelStore implements CostModelStore {
  constructor(private pool: mysql.Pool) {}
  async get(): Promise<StoredCostModel | null> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT version, model_json, updated_by, updated_at FROM erm_cost_model WHERE id = 1");
    const r = rows[0];
    return r ? { version: Number(r.version), model: costModelInputSchema.parse(JSON.parse(String(r.model_json))), updatedBy: String(r.updated_by), updatedAt: Number(r.updated_at) } : null;
  }
  async save(input: CostModelInput, o: { expectedVersion: number; reason: string; actor: string; now: number }): Promise<StoredCostModel> {
    const model = costModelInputSchema.parse(input);
    const json = JSON.stringify(model);
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const [rows] = await c.query<mysql.RowDataPacket[]>("SELECT version FROM erm_cost_model WHERE id = 1 FOR UPDATE");
      const v = rows[0] ? Number(rows[0].version) : 0;
      if (v !== o.expectedVersion) throw new CostModelConflict(v);
      const next = v + 1;
      await c.query(
        "INSERT INTO erm_cost_model (id, version, model_json, updated_by, updated_at) VALUES (1, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE version = VALUES(version), model_json = VALUES(model_json), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)",
        [next, json, o.actor.slice(0, 100), o.now],
      );
      await c.query("INSERT INTO erm_cost_model_history (version, model_json, reason, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)", [next, json, o.reason.slice(0, 300), o.actor.slice(0, 100), o.now]);
      await c.commit();
      return { version: next, model, updatedBy: o.actor, updatedAt: o.now };
    } catch (e) {
      await c.rollback().catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }
  async history(limit: number): Promise<CostModelChange[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT version, model_json, reason, changed_by, changed_at FROM erm_cost_model_history ORDER BY id DESC LIMIT ?", [limit]);
    return rows.map((r) => ({ version: Number(r.version), model: JSON.parse(String(r.model_json)), reason: String(r.reason), changedBy: String(r.changed_by), changedAt: Number(r.changed_at) }));
  }
}
