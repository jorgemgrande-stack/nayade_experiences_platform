/**
 * Excepciones comerciales de cuota (registro 0016): contratos, validación y almacén en memoria.
 *
 *  - Las crea y revoca el plano de control (operador con `quotas:write`); el Core solo las lee.
 *  - Una excepción tiene inicio y caducidad obligatoria; la vigencia se decide por fecha en cada lectura
 *    (`exceptionState`), así que al caducar el límite vuelve solo al contractual, sin tareas.
 *  - Solo puede haber una excepción no revocada y no caducada por empresa, métrica y periodo.
 *  - Cada alta y revocación deja una fila en el historial (quién, cuándo, motivo y valores).
 */
import { exceptionState, type PolicyPeriod, type QuotaException } from "./policy";

export const EXCEPTION_MAX_DAYS = 366;
const DAY = 86_400_000;

export interface QuotaExceptionHistoryRow {
  id: number;
  exceptionId: number;
  tenantId: string;
  action: "created" | "revoked";
  actor: string;
  at: number;
  details: Record<string, unknown>;
}

export interface NewQuotaException {
  tenantId: string;
  metric: string;
  period: PolicyPeriod;
  originalLimit: number | null;
  newLimit: number | null;
  reason: string;
  operator: string;
  startsAt: number;
  expiresAt: number;
}

export interface QuotaExceptionReader {
  exceptions(tenantId: string): Promise<QuotaException[]>;
}

export interface QuotaExceptionStore extends QuotaExceptionReader {
  create(input: NewQuotaException, now: number): Promise<QuotaException>;
  revoke(tenantId: string, id: number, meta: { actor: string; reason: string; now: number }): Promise<QuotaException>;
  history(tenantId: string, limit?: number): Promise<QuotaExceptionHistoryRow[]>;
}

export class QuotaExceptionError extends Error {
  constructor(
    public readonly code: "invalid_input" | "conflict" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "QuotaExceptionError";
  }
}

const TENANT_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const METRIC_RE = /^[a-z][a-z0-9_.]{1,63}$/;

/** Validación común (memoria y MySQL). Lanza `QuotaExceptionError("invalid_input")`. */
export function validateNewException(x: NewQuotaException, now: number): NewQuotaException {
  if (!TENANT_RE.test(x.tenantId)) throw new QuotaExceptionError("invalid_input", "Empresa no válida");
  if (!METRIC_RE.test(x.metric)) throw new QuotaExceptionError("invalid_input", "Métrica no válida");
  const reason = x.reason.trim();
  if (reason.length < 5 || reason.length > 300) throw new QuotaExceptionError("invalid_input", "El motivo es obligatorio (entre 5 y 300 caracteres)");
  const operator = x.operator.trim();
  if (!operator) throw new QuotaExceptionError("invalid_input", "Falta el responsable");
  for (const v of [x.newLimit, x.originalLimit]) {
    if (v !== null && (!Number.isSafeInteger(v) || v < 0)) throw new QuotaExceptionError("invalid_input", "Los límites deben ser enteros no negativos");
  }
  if (!Number.isSafeInteger(x.startsAt) || !Number.isSafeInteger(x.expiresAt)) throw new QuotaExceptionError("invalid_input", "Fechas no válidas");
  if (x.expiresAt <= x.startsAt) throw new QuotaExceptionError("invalid_input", "La caducidad debe ser posterior al inicio");
  if (x.expiresAt <= now) throw new QuotaExceptionError("invalid_input", "La caducidad debe ser futura");
  if (x.expiresAt - x.startsAt > EXCEPTION_MAX_DAYS * DAY) throw new QuotaExceptionError("invalid_input", `Una excepción dura como máximo ${EXCEPTION_MAX_DAYS} días: para más, cambia el contrato`);
  return { ...x, reason, operator: operator.slice(0, 100) };
}

/** ¿Choca con otra excepción no revocada y no caducada de la misma métrica y periodo? */
export function blocking(list: readonly QuotaException[], x: Pick<NewQuotaException, "metric" | "period">, now: number): QuotaException | undefined {
  return list.find((e) => e.metric === x.metric && e.period === x.period && (exceptionState(e, now) === "active" || exceptionState(e, now) === "scheduled"));
}

export const CONFLICT_MESSAGE = "Ya hay una excepción vigente o programada para esa cuota: revócala antes de crear otra";

export class MemoryQuotaExceptionStore implements QuotaExceptionStore {
  private rows: QuotaException[] = [];
  private log: QuotaExceptionHistoryRow[] = [];
  private seq = 0;
  private hseq = 0;
  failing = false;

  async exceptions(tenantId: string) {
    if (this.failing) throw new Error("registro no disponible");
    return this.rows.filter((r) => r.tenantId === tenantId).map((r) => ({ ...r }));
  }
  async create(input: NewQuotaException, now: number) {
    const x = validateNewException(input, now);
    if (blocking(await this.exceptions(x.tenantId), x, now)) throw new QuotaExceptionError("conflict", CONFLICT_MESSAGE);
    const row: QuotaException = { ...x, id: ++this.seq, status: "active", revokedAt: null, revokedBy: null, revokeReason: null, createdAt: now, updatedAt: now };
    this.rows.push(row);
    this.log.push({ id: ++this.hseq, exceptionId: row.id, tenantId: x.tenantId, action: "created", actor: x.operator, at: now, details: historyDetails(row) });
    return { ...row };
  }
  async revoke(tenantId: string, id: number, meta: { actor: string; reason: string; now: number }) {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.id === id);
    if (!row) throw new QuotaExceptionError("not_found", "Excepción no encontrada");
    const reason = checkRevoke(row, meta);
    Object.assign(row, { status: "revoked", revokedAt: meta.now, revokedBy: meta.actor.slice(0, 100), revokeReason: reason, updatedAt: meta.now });
    this.log.push({ id: ++this.hseq, exceptionId: id, tenantId, action: "revoked", actor: meta.actor.slice(0, 100), at: meta.now, details: { ...historyDetails(row), reason } });
    return { ...row };
  }
  async history(tenantId: string, limit = 200) {
    return this.log
      .filter((h) => h.tenantId === tenantId)
      .sort((a, b) => b.at - a.at || b.id - a.id)
      .slice(0, limit)
      .map((h) => ({ ...h }));
  }
}

/** Revocar: solo una excepción no revocada y no caducada, con motivo. Devuelve el motivo limpio. */
export function checkRevoke(row: QuotaException, meta: { reason: string; now: number }): string {
  const st = exceptionState(row, meta.now);
  if (st === "revoked") throw new QuotaExceptionError("conflict", "La excepción ya estaba revocada");
  if (st === "expired") throw new QuotaExceptionError("conflict", "La excepción ya ha caducado: no hace falta revocarla");
  const reason = meta.reason.trim();
  if (reason.length < 5 || reason.length > 300) throw new QuotaExceptionError("invalid_input", "El motivo de la revocación es obligatorio (entre 5 y 300 caracteres)");
  return reason;
}

export function historyDetails(e: QuotaException): Record<string, unknown> {
  return { metric: e.metric, period: e.period, originalLimit: e.originalLimit, newLimit: e.newLimit, reason: e.reason, startsAt: e.startsAt, expiresAt: e.expiresAt };
}

/** Excepción con su estado deducido de la fecha (para la API y el CRM). */
export const withState = (e: QuotaException, now: number) => ({ ...e, state: exceptionState(e, now) });
