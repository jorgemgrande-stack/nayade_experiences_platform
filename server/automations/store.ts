/**
 * Automatizaciones avanzadas · almacén en la BD de la empresa en curso (migración db/migrations/0063_connect_automations).
 * Tablas fuera de drizzle/schema.ts y SQL parametrizado. Aislamiento: cada empresa tiene su base (getTenantDatabase).
 *
 *  - `automation_rules`: reglas (apagadas al crearse; nada se borra: se archivan).
 *  - `automation_runs`: una fila por regla, entidad y paso (clave única). `claim` la reserva ANTES de actuar (INSERT
 *    IGNORE, o reintento de un fallido con intentos o de uno abandonado), `settle` la cierra. Dos réplicas a la vez nunca
 *    ejecutan dos veces el mismo paso.
 *  - `automation_notices`: avisos al equipo (uno por ejecución).
 * Sin las tablas → `AutomationsNotInstalled`.
 */
import { sql } from "drizzle-orm";
import { getTenantDatabase } from "../_core/dbRegistry";
import { AUTOMATION_LIMITS, stepKeyOf, type AutomationCondition, type AutomationRuleInput, type AutomationStep, type AutomationTrigger, type RunStatus } from "../../shared/automations";
import { STALE_RUNNING_MS, type RunKey, type RunRow, type StoredRule } from "./engine";

export class AutomationsNotInstalled extends Error {
  constructor() {
    super("Las automatizaciones aún no están preparadas en tu empresa: falta aplicar la actualización 0063_connect_automations de su base de datos. Inténtalo de nuevo en unos minutos.");
    this.name = "AutomationsNotInstalled";
  }
}

export interface HistoryRow extends RunRow {
  id: number;
  ruleName: string;
  detail: string | null;
  runDay: string;
  finishedAt: number | null;
  createdAt: string;
}

export interface NoticeRow {
  id: number;
  ruleId: number;
  title: string;
  body: string | null;
  entityType: string;
  entityId: number;
  ctaPath: string | null;
  createdAt: string;
}

export interface NewNotice {
  key: RunKey;
  title: string;
  body: string | null;
  ctaPath: string | null;
}

export interface AutomationStore {
  listRules(includeArchived?: boolean): Promise<StoredRule[]>;
  getRule(id: number): Promise<StoredRule | null>;
  createRule(input: AutomationRuleInput, userId: number | null, templateKey: string | null): Promise<number>;
  /** Guardar una regla encendida reinicia su activación (`now`): los pasos cambiados no se aplican a lo anterior. */
  updateRule(id: number, input: AutomationRuleInput, userId: number | null, now: number): Promise<boolean>;
  /** Encender fija `enabled_at` (lo anterior no dispara la regla); apagar lo conserva. */
  setEnabled(id: number, enabled: boolean, at: number, userId: number | null): Promise<boolean>;
  archive(id: number, userId: number | null): Promise<boolean>;
  runsFor(ruleId: number, entityType: string, entityIds: number[]): Promise<RunRow[]>;
  /** Reserva el paso antes de actuar: nuevo, o reintento de un fallido con intentos o de uno abandonado. */
  claim(k: RunKey, action: string, now: number, day: string): Promise<boolean>;
  settle(k: RunKey, status: Exclude<RunStatus, "running">, reason: string | null, detail: string | null, now: number): Promise<void>;
  /** Deja constancia de un paso omitido sin ejecutar nada (si ya había fila, no la toca). */
  skip(k: RunKey, action: string, reason: string, now: number, day: string): Promise<void>;
  /** Acciones hechas o en curso ese día (de una regla o de toda la empresa). */
  usedOn(day: string, ruleId?: number): Promise<number>;
  history(opts: { ruleId?: number; limit: number }): Promise<HistoryRow[]>;
  addNotice(n: NewNotice): Promise<void>;
  notices(sinceMs: number, limit: number): Promise<NoticeRow[]>;
}

type Row = Record<string, any>;
const iso = (v: unknown) => (v == null ? new Date(0).toISOString() : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const bool = (v: unknown) => v === true || v === 1 || v === "1";
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

const toRule = (r: Row): StoredRule => ({
  id: Number(r.id),
  name: String(r.name ?? ""),
  trigger: String(r.trigger_key) as AutomationTrigger,
  conditions: parseJson<AutomationCondition[]>(r.conditions_json, []),
  steps: parseJson<AutomationStep[]>(r.steps_json, []).map((s, i) => ({ ...s, key: stepKeyOf(s, i) })),
  dailyCap: Number(r.daily_cap ?? AUTOMATION_LIMITS.dailyCapDefault),
  enabled: bool(r.enabled),
  enabledAt: numOrNull(r.enabled_at),
  templateKey: r.template_key ?? null,
  archived: bool(r.is_archived),
  createdBy: numOrNull(r.created_by),
  updatedBy: numOrNull(r.updated_by),
  updatedAt: iso(r.updated_at),
});

const toRun = (r: Row): RunRow => ({
  ruleId: Number(r.rule_id),
  entityType: r.entity_type,
  entityId: Number(r.entity_id),
  stepKey: String(r.step_key),
  stepIndex: Number(r.step_index),
  action: String(r.action),
  status: r.status as RunStatus,
  reason: r.reason ?? null,
  attempts: Number(r.attempts ?? 0),
  lastAttemptAt: numOrNull(r.last_attempt_at),
});

function isMissingSchema(e: unknown): boolean {
  for (let x: any = e, i = 0; x && i < 6; x = x.cause, i++) {
    if ((x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) && /automation_/.test(String(x.sqlMessage ?? x.message ?? ""))) return true;
  }
  return false;
}

const clip = (v: string | null | undefined, n: number) => (v == null ? null : v.slice(0, n));

export class TenantDbAutomationStore implements AutomationStore {
  private async run<T>(fn: (d: NonNullable<Awaited<ReturnType<typeof getTenantDatabase>>>) => Promise<T>): Promise<T> {
    const d = await getTenantDatabase();
    if (!d) throw new Error("Base de datos no disponible");
    try {
      return await fn(d);
    } catch (e) {
      if (isMissingSchema(e)) throw new AutomationsNotInstalled();
      throw e;
    }
  }
  private rows(res: unknown): Row[] {
    return (res as [Row[]])[0] ?? [];
  }
  private affected(res: unknown): number {
    return Number((res as any)[0]?.affectedRows ?? 0);
  }

  listRules(includeArchived = false) {
    return this.run(async (d) => this.rows(await d.execute(sql`SELECT * FROM automation_rules WHERE (${includeArchived ? 1 : 0} = 1 OR is_archived = 0) ORDER BY id`)).map(toRule));
  }
  getRule(id: number) {
    return this.run(async (d) => {
      const r = this.rows(await d.execute(sql`SELECT * FROM automation_rules WHERE id = ${id} LIMIT 1`))[0];
      return r ? toRule(r) : null;
    });
  }
  createRule(input: AutomationRuleInput, userId: number | null, templateKey: string | null) {
    return this.run(async (d) => {
      const res = await d.execute(sql`INSERT INTO automation_rules (name, trigger_key, conditions_json, steps_json, enabled, daily_cap, template_key, created_by, updated_by)
        VALUES (${input.name}, ${input.trigger}, ${JSON.stringify(input.conditions)}, ${JSON.stringify(input.steps)}, 0, ${input.dailyCap}, ${templateKey}, ${userId}, ${userId})`);
      return Number((res as any)[0]?.insertId);
    });
  }
  updateRule(id: number, input: AutomationRuleInput, userId: number | null, now: number) {
    return this.run(async (d) =>
      this.affected(await d.execute(sql`UPDATE automation_rules SET enabled_at = IF(enabled = 1, ${now}, enabled_at), name = ${input.name}, trigger_key = ${input.trigger}, conditions_json = ${JSON.stringify(input.conditions)}, steps_json = ${JSON.stringify(input.steps)}, daily_cap = ${input.dailyCap}, updated_by = ${userId} WHERE id = ${id} AND is_archived = 0`)) > 0,
    );
  }
  setEnabled(id: number, enabled: boolean, at: number, userId: number | null) {
    return this.run(async (d) =>
      this.affected(
        await d.execute(
          enabled
            ? // MySQL aplica las asignaciones en orden: `enabled_at` se calcula con el `enabled` de antes
              sql`UPDATE automation_rules SET enabled_at = IF(enabled = 1 AND enabled_at IS NOT NULL, enabled_at, ${at}), enabled = 1, updated_by = ${userId} WHERE id = ${id} AND is_archived = 0`
            : sql`UPDATE automation_rules SET enabled = 0, updated_by = ${userId} WHERE id = ${id}`,
        ),
      ) > 0,
    );
  }
  archive(id: number, userId: number | null) {
    return this.run(async (d) => this.affected(await d.execute(sql`UPDATE automation_rules SET is_archived = 1, enabled = 0, updated_by = ${userId} WHERE id = ${id}`)) > 0);
  }
  runsFor(ruleId: number, entityType: string, entityIds: number[]) {
    if (!entityIds.length) return Promise.resolve([]);
    return this.run(async (d) =>
      this.rows(await d.execute(sql`SELECT * FROM automation_runs WHERE rule_id = ${ruleId} AND entity_type = ${entityType} AND entity_id IN (${sql.join(entityIds.map((i) => sql`${i}`), sql`, `)})`)).map(toRun),
    );
  }
  claim(k: RunKey, action: string, now: number, day: string) {
    return this.run(async (d) => {
      const ins = await d.execute(sql`INSERT IGNORE INTO automation_runs (rule_id, entity_type, entity_id, step_key, step_index, action, status, attempts, run_day, last_attempt_at)
        VALUES (${k.ruleId}, ${k.entityType}, ${k.entityId}, ${k.stepKey}, ${k.stepIndex}, ${action}, 'running', 1, ${day}, ${now})`);
      if (this.affected(ins) === 1) return true;
      // Reintento: fallido con intentos pendientes, o abandonado «en curso» (proceso interrumpido)
      const upd = await d.execute(sql`UPDATE automation_runs SET status = 'running', attempts = attempts + 1, action = ${action}, step_index = ${k.stepIndex}, run_day = ${day}, last_attempt_at = ${now}, reason = NULL
        WHERE rule_id = ${k.ruleId} AND entity_type = ${k.entityType} AND entity_id = ${k.entityId} AND step_key = ${k.stepKey}
          AND attempts < ${AUTOMATION_LIMITS.maxAttempts}
          AND (status = 'failed' OR (status = 'running' AND last_attempt_at < ${now - STALE_RUNNING_MS}))`);
      return this.affected(upd) === 1;
    });
  }
  settle(k: RunKey, status: Exclude<RunStatus, "running">, reason: string | null, detail: string | null, now: number) {
    return this.run(async (d) => {
      await d.execute(sql`UPDATE automation_runs SET status = ${status}, reason = ${clip(reason, 60)}, detail = ${clip(detail, 300)}, finished_at = ${now}
        WHERE rule_id = ${k.ruleId} AND entity_type = ${k.entityType} AND entity_id = ${k.entityId} AND step_key = ${k.stepKey}`);
    });
  }
  skip(k: RunKey, action: string, reason: string, now: number, day: string) {
    return this.run(async (d) => {
      await d.execute(sql`INSERT IGNORE INTO automation_runs (rule_id, entity_type, entity_id, step_key, step_index, action, status, reason, attempts, run_day, last_attempt_at, finished_at)
        VALUES (${k.ruleId}, ${k.entityType}, ${k.entityId}, ${k.stepKey}, ${k.stepIndex}, ${action}, 'skipped', ${clip(reason, 60)}, 0, ${day}, ${now}, ${now})`);
    });
  }
  usedOn(day: string, ruleId?: number) {
    return this.run(async (d) => {
      const r = this.rows(await d.execute(sql`SELECT COUNT(*) AS n FROM automation_runs WHERE run_day = ${day} AND status IN ('done', 'running') AND (${ruleId ?? 0} = 0 OR rule_id = ${ruleId ?? 0})`))[0];
      return Number(r?.n ?? 0);
    });
  }
  history(opts: { ruleId?: number; limit: number }) {
    return this.run(async (d) =>
      this.rows(
        await d.execute(sql`SELECT x.*, r.name AS rule_name FROM automation_runs x JOIN automation_rules r ON r.id = x.rule_id
          WHERE (${opts.ruleId ?? 0} = 0 OR x.rule_id = ${opts.ruleId ?? 0}) ORDER BY x.id DESC LIMIT ${opts.limit}`),
      ).map((r) => ({ ...toRun(r), id: Number(r.id), ruleName: String(r.rule_name ?? ""), detail: r.detail ?? null, runDay: String(r.run_day), finishedAt: numOrNull(r.finished_at), createdAt: iso(r.created_at) })),
    );
  }
  addNotice(n: NewNotice) {
    return this.run(async (d) => {
      const k = n.key;
      await d.execute(sql`INSERT IGNORE INTO automation_notices (rule_id, run_id, title, body, entity_type, entity_id, cta_path)
        SELECT ${k.ruleId}, id, ${n.title.slice(0, 160)}, ${clip(n.body, 600)}, ${k.entityType}, ${k.entityId}, ${clip(n.ctaPath, 200)} FROM automation_runs
         WHERE rule_id = ${k.ruleId} AND entity_type = ${k.entityType} AND entity_id = ${k.entityId} AND step_key = ${k.stepKey}`);
    });
  }
  notices(sinceMs: number, limit: number) {
    return this.run(async (d) =>
      this.rows(await d.execute(sql`SELECT * FROM automation_notices WHERE created_at >= ${new Date(sinceMs)} ORDER BY id DESC LIMIT ${limit}`)).map((r) => ({
        id: Number(r.id), ruleId: Number(r.rule_id), title: String(r.title), body: r.body ?? null, entityType: String(r.entity_type), entityId: Number(r.entity_id), ctaPath: r.cta_path ?? null, createdAt: iso(r.created_at),
      })),
    );
  }
}

// ── En memoria (pruebas) ─────────────────────────────────────────────────────

type MemRun = RunRow & { id: number; detail: string | null; runDay: string; finishedAt: number | null; createdAt: string };

export class MemoryAutomationStore implements AutomationStore {
  rules: StoredRule[] = [];
  runs: MemRun[] = [];
  noticeRows: Array<NoticeRow & { runId: number }> = [];
  private seq = 0;
  private same = (r: RunKey, k: RunKey) => r.ruleId === k.ruleId && r.entityType === k.entityType && r.entityId === k.entityId && r.stepKey === k.stepKey;

  async listRules(includeArchived = false) {
    return this.rules.filter((r) => includeArchived || !r.archived).map((r) => structuredClone(r));
  }
  async getRule(id: number) {
    const r = this.rules.find((x) => x.id === id);
    return r ? structuredClone(r) : null;
  }
  async createRule(input: AutomationRuleInput, userId: number | null, templateKey: string | null) {
    const id = this.rules.length + 1;
    this.rules.push({ ...structuredClone(input), id, enabled: false, enabledAt: null, templateKey, archived: false, createdBy: userId, updatedBy: userId, updatedAt: new Date().toISOString() });
    return id;
  }
  async updateRule(id: number, input: AutomationRuleInput, userId: number | null, now: number) {
    const r = this.rules.find((x) => x.id === id && !x.archived);
    if (!r) return false;
    Object.assign(r, structuredClone(input), { updatedBy: userId, ...(r.enabled ? { enabledAt: now } : {}) });
    return true;
  }
  async setEnabled(id: number, enabled: boolean, at: number, userId: number | null) {
    const r = this.rules.find((x) => x.id === id && (!enabled || !x.archived));
    if (!r) return false;
    if (enabled && !r.enabled) r.enabledAt = at;
    r.enabled = enabled;
    r.updatedBy = userId;
    return true;
  }
  async archive(id: number, userId: number | null) {
    const r = this.rules.find((x) => x.id === id);
    if (!r) return false;
    Object.assign(r, { archived: true, enabled: false, updatedBy: userId });
    return true;
  }
  async runsFor(ruleId: number, entityType: string, ids: number[]) {
    return this.runs.filter((r) => r.ruleId === ruleId && r.entityType === entityType && ids.includes(r.entityId)).map((r) => ({ ...r }));
  }
  async claim(k: RunKey, action: string, now: number, day: string) {
    const r = this.runs.find((x) => this.same(x, k));
    if (!r) {
      this.runs.push({ ...k, id: ++this.seq, action, status: "running", reason: null, attempts: 1, lastAttemptAt: now, detail: null, runDay: day, finishedAt: null, createdAt: new Date(now).toISOString() });
      return true;
    }
    const retry = r.attempts < AUTOMATION_LIMITS.maxAttempts && (r.status === "failed" || (r.status === "running" && (r.lastAttemptAt ?? 0) < now - STALE_RUNNING_MS));
    if (!retry) return false;
    Object.assign(r, { status: "running", attempts: r.attempts + 1, action, stepIndex: k.stepIndex, runDay: day, lastAttemptAt: now, reason: null });
    return true;
  }
  async settle(k: RunKey, status: Exclude<RunStatus, "running">, reason: string | null, detail: string | null, now: number) {
    const r = this.runs.find((x) => this.same(x, k));
    if (r) Object.assign(r, { status, reason, detail, finishedAt: now });
  }
  async skip(k: RunKey, action: string, reason: string, now: number, day: string) {
    if (this.runs.some((x) => this.same(x, k))) return;
    this.runs.push({ ...k, id: ++this.seq, action, status: "skipped", reason, attempts: 0, lastAttemptAt: now, detail: null, runDay: day, finishedAt: now, createdAt: new Date(now).toISOString() });
  }
  async usedOn(day: string, ruleId?: number) {
    return this.runs.filter((r) => r.runDay === day && (r.status === "done" || r.status === "running") && (ruleId == null || r.ruleId === ruleId)).length;
  }
  async history(opts: { ruleId?: number; limit: number }) {
    return this.runs
      .filter((r) => opts.ruleId == null || r.ruleId === opts.ruleId)
      .sort((a, b) => b.id - a.id)
      .slice(0, opts.limit)
      .map((r) => ({ ...r, ruleName: this.rules.find((x) => x.id === r.ruleId)?.name ?? "" }));
  }
  async addNotice(n: NewNotice) {
    const run = this.runs.find((x) => this.same(x, n.key));
    if (!run || this.noticeRows.some((x) => x.runId === run.id)) return;
    this.noticeRows.push({ id: this.noticeRows.length + 1, runId: run.id, ruleId: n.key.ruleId, title: n.title, body: n.body, entityType: n.key.entityType, entityId: n.key.entityId, ctaPath: n.ctaPath, createdAt: new Date().toISOString() });
  }
  async notices(_since: number, limit: number) {
    return [...this.noticeRows].reverse().slice(0, limit).map(({ runId: _r, ...n }) => n);
  }
}
