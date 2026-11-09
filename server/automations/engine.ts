/**
 * Automatizaciones avanzadas · motor PURO (sin BD ni red): evaluación de condiciones, momento de cada paso, qué paso
 * toca a cada entidad (secuencias con retardo, reintentos acotados y pasos fuera de plazo), topes diarios y textos con
 * variables. La tarea programada y la simulación usan exactamente estas funciones.
 */
import {
  AUTOMATION_LIMITS,
  AUTOMATION_TRIGGERS,
  stepKeyOf,
  toNumber,
  type AutomationCondition,
  type AutomationEntityType,
  type AutomationRuleInput,
  type AutomationStep,
  type AutomationTrigger,
  type FieldDef,
  type RunStatus,
  type TriggerDef,
} from "../../shared/automations";

const MIN = 60_000;

/** Lo que el Core sabe de una entidad candidata (oportunidad, presupuesto, reserva o factura). */
export interface AutomationEntity {
  type: AutomationEntityType;
  id: number;
  /** Momento del hecho (ms) o, en «reserva próxima», el inicio de la reserva. */
  anchorAt: number;
  email: string | null;
  name: string | null;
  /** Oportunidad asociada (la propia o la del presupuesto). */
  leadId: number | null;
  /** Responsable de la oportunidad, si lo hay. */
  ownerId: number | null;
  fields: Record<string, string | number | null>;
  vars: Record<string, string>;
  ctaPath: string;
}

export interface StoredRule extends AutomationRuleInput {
  id: number;
  enabled: boolean;
  /** Desde cuándo está activa (ms): lo anterior no la dispara. */
  enabledAt: number | null;
  templateKey: string | null;
  archived: boolean;
  createdBy: number | null;
  updatedBy: number | null;
  updatedAt: string;
}

export interface RunKey {
  ruleId: number;
  entityType: AutomationEntityType;
  entityId: number;
  /** Clave estable del paso (identifica la ejecución). */
  stepKey: string;
  /** Posición del paso cuando se ejecutó (para mostrarla). */
  stepIndex: number;
}

export interface RunRow extends RunKey {
  action: string;
  status: RunStatus;
  reason: string | null;
  attempts: number;
  lastAttemptAt: number | null;
}

/** Clave única de una ejecución: un disparo por regla, entidad y paso (por su clave estable, no por su posición). */
export const runKeyOf = (ruleId: number, e: Pick<AutomationEntity, "type" | "id">, steps: readonly AutomationStep[], stepIndex: number): RunKey => ({ ruleId, entityType: e.type, entityId: e.id, stepIndex, stepKey: stepKeyOf(steps[stepIndex], stepIndex) });
export const runKeyText = (k: RunKey) => `auto:${k.ruleId}:${k.entityType}:${k.entityId}:${k.stepKey}`;

// ─── Condiciones ─────────────────────────────────────────────────────────────

const isEmpty = (v: unknown) => v == null || String(v).trim() === "";
const norm = (v: unknown) => String(v ?? "").trim().toLocaleLowerCase("es");

export function evaluateCondition(field: FieldDef, raw: unknown, c: AutomationCondition): boolean {
  if (c.op === "empty") return isEmpty(raw);
  if (c.op === "not_empty") return !isEmpty(raw);
  if (field.type === "number") {
    const n = toNumber(raw);
    const v = toNumber(c.value);
    if (n == null || v == null) return c.op === "neq" ? n !== v : false;
    switch (c.op) {
      case "eq": return n === v;
      case "neq": return n !== v;
      case "gt": return n > v;
      case "gte": return n >= v;
      case "lt": return n < v;
      case "lte": return n <= v;
      default: return false;
    }
  }
  const a = norm(raw);
  const b = norm(c.value);
  switch (c.op) {
    case "eq": return a === b;
    case "neq": return a !== b;
    case "contains": return field.type === "text" && b !== "" && a.includes(b);
    default: return false;
  }
}

/** ¿Cumple la entidad TODAS las condiciones? (sin condiciones, sí). Un campo desconocido no se cumple. */
export function matchesConditions(trigger: AutomationTrigger, conditions: readonly AutomationCondition[], entity: Pick<AutomationEntity, "fields">): boolean {
  const t = AUTOMATION_TRIGGERS[trigger] as TriggerDef;
  return conditions.every((c) => {
    const f = t.fields.find((x) => x.key === c.field);
    return f ? evaluateCondition(f, entity.fields[c.field], c) : false;
  });
}

// ─── Pasos y secuencias ──────────────────────────────────────────────────────

export function stepDueAt(trigger: AutomationTrigger, anchorAt: number, delayMinutes: number): number {
  return (AUTOMATION_TRIGGERS[trigger] as TriggerDef).timing === "before" ? anchorAt - delayMinutes * MIN : anchorAt + delayMinutes * MIN;
}

/** Espera antes de reintentar un paso fallido: 15 min por intento hecho. Un paso «en curso» más de 60 min se da por abandonado
 * (un envío o una tarea tardan segundos; con 60 min no se repite una acción lenta que aún no se ha cerrado). */
export const retryBackoffMs = (attempts: number) => Math.max(1, attempts) * 15 * MIN;
export const STALE_RUNNING_MS = 60 * MIN;

export function isTerminal(r: Pick<RunRow, "status" | "attempts">, maxAttempts: number = AUTOMATION_LIMITS.maxAttempts): boolean {
  return r.status === "done" || r.status === "skipped" || (r.status === "failed" && r.attempts >= maxAttempts);
}

export function retryReady(r: Pick<RunRow, "status" | "attempts" | "lastAttemptAt">, now: number): boolean {
  const last = r.lastAttemptAt ?? 0;
  if (r.status === "failed") return r.attempts < AUTOMATION_LIMITS.maxAttempts && now - last >= retryBackoffMs(r.attempts);
  if (r.status === "running") return now - last >= STALE_RUNNING_MS;
  return false;
}

export type StepPlan =
  /** Ejecutar el paso `step` (`retry`: reintento de un fallido o abandonado; `exhausted`: abandonado sin intentos). */
  | { kind: "run"; step: number; retry: boolean; exhausted: boolean; late: number[] }
  | { kind: "wait"; until: number | null; late: number[] }
  | { kind: "finished"; late: number[] };

/**
 * Qué toca hacer ahora con una entidad. Los pasos van en orden: uno no empieza hasta que el anterior terminó (hecho,
 * omitido o fallido sin más intentos). Un paso cuyo momento es anterior a la activación de la regla no aplica (p. ej.
 * «24 h antes» de una reserva de dentro de 2 h); uno que debió ejecutarse hace más de `catchUpMinutes` queda en `late`
 * (se registra omitido y la secuencia sigue). Como mucho un paso por entidad y pasada.
 */
export function planEntity(rule: Pick<StoredRule, "trigger" | "steps">, anchorAt: number, runs: readonly RunRow[], now: number, since: number, catchUpMinutes: number = AUTOMATION_LIMITS.catchUpMinutes): StepPlan {
  const late: number[] = [];
  for (let i = 0; i < rule.steps.length; i++) {
    const key = stepKeyOf(rule.steps[i], i);
    const r = runs.find((x) => x.stepKey === key);
    if (r) {
      if (isTerminal(r)) continue;
      if (retryReady(r, now)) return { kind: "run", step: i, retry: true, exhausted: r.attempts >= AUTOMATION_LIMITS.maxAttempts, late };
      return { kind: "wait", until: null, late };
    }
    const due = stepDueAt(rule.trigger, anchorAt, rule.steps[i].delayMinutes);
    if (due < since) continue;
    if (now < due) return { kind: "wait", until: due, late };
    if (now - due > catchUpMinutes * MIN) {
      late.push(i);
      continue;
    }
    return { kind: "run", step: i, retry: false, exhausted: false, late };
  }
  return { kind: "finished", late };
}

// ─── Topes ───────────────────────────────────────────────────────────────────

export interface CapState {
  ruleUsed: number;
  ruleCap: number;
  companyUsed: number;
  companyCap: number;
}
/** ¿Cabe una acción más hoy? (tope de la regla y tope de la empresa). */
export const capAllows = (c: CapState) => c.ruleUsed < c.ruleCap && c.companyUsed < c.companyCap;

/** Día AAAA-MM-DD en Madrid (los topes son por día natural de la empresa). */
export function madridDay(ms: number): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

/** Instante UTC de una fecha y hora de pared de Madrid («2026-11-09», «10:30»). */
export function madridWallToUtc(day: string, time: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const t = /^(\d{1,2}):(\d{2})/.exec(time ?? "") ?? [null, "00", "00"];
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
  // Diferencia de Madrid con UTC en ese momento (1 o 2 h según el horario de verano)
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
  const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
  const asMadrid = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
  return guess - (asMadrid - guess);
}

// ─── Textos ──────────────────────────────────────────────────────────────────

/** Sustituye {{variable}}; una variable desconocida o vacía queda en blanco. Una sola línea si `oneLine`. */
export function renderText(tpl: string, vars: Record<string, string>, oneLine = false): string {
  const out = tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, k: string) => vars[k.toLowerCase()] ?? "");
  return oneLine ? out.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim() : out.trim();
}

const EMAIL_RE = /^[^\s@<>"',;:()\\[\]]+@[^\s@<>"',;:()\\[\]]+\.[^\s@<>"',;:()\\[\]]+$/;
export function validEmail(v: string | null | undefined): string | null {
  const e = (v ?? "").trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

export const eurText = (n: number | null | undefined) => (n == null ? "" : n.toLocaleString("es-ES", { style: "currency", currency: "EUR" }));
export const dayText = (day: string) => {
  const ms = madridWallToUtc(day, "12:00");
  return ms == null ? day : new Date(ms).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" });
};
