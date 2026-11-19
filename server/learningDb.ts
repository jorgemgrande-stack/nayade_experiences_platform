/**
 * Elephant LMS (lógica de BD): matrículas nominativas, autorización de contenido y progreso. Todo va contra la BD de la
 * empresa en curso (getDb): el aislamiento entre empresas es el de siempre (una base de datos por empresa).
 *
 * Reglas que protegen el acceso:
 *  - Una matrícula solo nace de un pago confirmado (referencia + importe + verificador), de una concesión
 *    administrativa con motivo o de una demostración. Todo lo demás (solicitud, presupuesto, checkout...) no cuenta.
 *  - Idempotencia: `idempotency_key` es única. La misma compra no crea dos matrículas aunque el evento llegue repetido o
 *    dos procesos a la vez (INSERT ... ON DUPLICATE KEY, y se devuelve la existente).
 *  - La vigencia se evalúa al leer (shared/learning.ts); la caducidad programada solo cambia el estado y deja historial.
 *  - Nada se borra: toda acción deja un evento inmutable. La pérdida de acceso no toca el progreso.
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import {
  DAY_MS, DEMO_MS, LearningRuleError, adminKey, assertPaymentConfirmed, assertReason, computeWindow, demoKey, evaluateAny, matchRules,
  mergeModules, paymentKey, progressPercent, type AccessRule, type EnrollmentView, type PaymentEvidence, type StartMode,
} from "../shared/learning";

export class LearningError extends Error {
  constructor(readonly code: "NOT_FOUND" | "BAD_REQUEST" | "FORBIDDEN" | "CONFLICT", message: string) {
    super(message);
  }
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Exec = Pick<Db, "execute">;
async function db(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  return d;
}
async function rows<T = Record<string, any>>(exec: Exec, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return Array.isArray(r) ? r : [];
}
async function run(exec: Exec, q: SQL): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: Number(r?.affectedRows ?? 0), insertId: Number(r?.insertId ?? 0) };
}
const n = (v: unknown) => Number(v ?? 0);

/** Empresa sin la migración 0079: no hay formación digital. */
export function isMissingLearningSchema(e: unknown): boolean {
  for (let x: any = e, depth = 0; x && depth < 5; x = x.cause, depth++) {
    if (x?.code === "ER_NO_SUCH_TABLE" || /doesn't exist/i.test(String(x?.message ?? "")) && /learning_/.test(String(x?.message ?? ""))) return true;
  }
  return false;
}

export interface EnrollmentRow {
  id: number;
  userId: number;
  clientId: number | null;
  courseId: number;
  status: "active" | "suspended" | "revoked" | "expired";
  source: "payment" | "admin" | "demo";
  startsAt: number;
  endsAt: number | null;
  experienceId: number | null;
  variantId: number | null;
  paymentRef: string | null;
  grantReason: string | null;
  moduleIds: number[];
  createdAt: number;
}

function mapEnrollment(r: Record<string, any>, moduleIds: number[]): EnrollmentRow {
  return {
    id: n(r.id), userId: n(r.user_id), clientId: r.client_id == null ? null : n(r.client_id), courseId: n(r.course_id), status: r.status, source: r.source,
    startsAt: n(r.starts_at), endsAt: r.ends_at == null ? null : n(r.ends_at), experienceId: r.experience_id == null ? null : n(r.experience_id),
    variantId: r.variant_id == null ? null : n(r.variant_id), paymentRef: r.payment_ref ?? null, grantReason: r.grant_reason ?? null, moduleIds, createdAt: n(r.created_at),
  };
}

async function modulesOf(exec: Exec, enrollmentIds: number[], lock = false): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (!enrollmentIds.length) return out;
  const list = await rows(exec, sql`SELECT enrollment_id, module_id FROM learning_enrollment_modules WHERE enrollment_id IN (${sql.join(enrollmentIds.map((i) => sql`${i}`), sql`, `)}) ORDER BY module_id ${lock ? sql`FOR SHARE` : sql``}`);
  for (const r of list) out.set(n(r.enrollment_id), [...(out.get(n(r.enrollment_id)) ?? []), n(r.module_id)]);
  return out;
}

async function event(exec: Exec, enrollmentId: number, type: string, actorUserId: number | null, detail: Record<string, unknown>, now = Date.now()) {
  await run(exec, sql`INSERT INTO learning_access_events (enrollment_id, type, actor_user_id, detail, created_at) VALUES (${enrollmentId}, ${type}, ${actorUserId}, ${JSON.stringify(detail)}, ${now})`);
}

// ─── Reglas de acceso (catálogo → contenido) ───────────────────────────────────────────────────────────────────────

export async function listRules(exec?: Exec): Promise<AccessRule[]> {
  const e = exec ?? (await db());
  const list = await rows(e, sql`SELECT * FROM learning_access_rules ORDER BY id`);
  const mods = await rows(e, sql`SELECT rule_id, module_id FROM learning_access_rule_modules ORDER BY module_id`);
  return list.map((r) => ({
    id: n(r.id), experienceId: n(r.experience_id), variantId: r.variant_id == null ? null : n(r.variant_id), courseId: n(r.course_id),
    moduleIds: mods.filter((m) => n(m.rule_id) === n(r.id)).map((m) => n(m.module_id)), durationDays: r.duration_days == null ? null : n(r.duration_days),
    startMode: r.start_mode as StartMode, fixedStart: r.fixed_start == null ? null : n(r.fixed_start), active: !!n(r.active),
  }));
}

export interface RuleInput {
  experienceId: number;
  variantId: number | null;
  courseId: number;
  moduleIds: number[];
  durationDays: number | null;
  startMode: StartMode;
  fixedStart: number | null;
  active: boolean;
}

export async function saveRule(input: RuleInput, id?: number): Promise<number> {
  if (!input.moduleIds.length) throw new LearningError("BAD_REQUEST", "La regla debe abrir al menos un módulo.");
  if (input.startMode === "fixed_date" && input.fixedStart == null) throw new LearningError("BAD_REQUEST", "Indica la fecha de inicio.");
  const d = await db();
  const now = Date.now();
  return d.transaction(async (tx) => {
    const mods = await rows(tx, sql`SELECT id FROM learning_modules WHERE course_id = ${input.courseId} AND id IN (${sql.join(input.moduleIds.map((m) => sql`${m}`), sql`, `)})`);
    if (mods.length !== new Set(input.moduleIds).size) throw new LearningError("BAD_REQUEST", "Algún módulo no pertenece al curso.");
    let ruleId = id ?? 0;
    if (id) {
      const r = await run(tx, sql`UPDATE learning_access_rules SET experience_id = ${input.experienceId}, variant_id = ${input.variantId}, course_id = ${input.courseId}, duration_days = ${input.durationDays},
        start_mode = ${input.startMode}, fixed_start = ${input.fixedStart}, active = ${input.active ? 1 : 0}, updated_at = ${now} WHERE id = ${id}`);
      const [exists] = await rows(tx, sql`SELECT id FROM learning_access_rules WHERE id = ${id}`);
      if (!exists && !r.affectedRows) throw new LearningError("NOT_FOUND", "La regla no existe.");
    } else {
      ruleId = (await run(tx, sql`INSERT INTO learning_access_rules (experience_id, variant_id, course_id, duration_days, start_mode, fixed_start, active, created_at, updated_at)
        VALUES (${input.experienceId}, ${input.variantId}, ${input.courseId}, ${input.durationDays}, ${input.startMode}, ${input.fixedStart}, ${input.active ? 1 : 0}, ${now}, ${now})`)).insertId;
    }
    await run(tx, sql`DELETE FROM learning_access_rule_modules WHERE rule_id = ${ruleId}`);
    for (const m of Array.from(new Set(input.moduleIds))) await run(tx, sql`INSERT INTO learning_access_rule_modules (rule_id, module_id) VALUES (${ruleId}, ${m})`);
    return ruleId;
  });
}

// ─── Concesión de matrículas ──────────────────────────────────────────────────────────────────────────────────────

interface GrantCore {
  userId: number;
  clientId: number | null;
  courseId: number;
  moduleIds: number[];
  source: "payment" | "admin" | "demo";
  startsAt: number;
  endsAt: number | null;
  experienceId?: number | null;
  variantId?: number | null;
  enrollmentId?: number | null;
  orderId?: number | null;
  quoteId?: number | null;
  paymentRef?: string | null;
  paymentAmountCents?: number | null;
  reason?: string | null;
  actorUserId: number | null;
  idempotencyKey: string;
}

/**
 * Crea la matrícula si no existe su clave; si existe, la devuelve SIN tocarla. Dos llamadas simultáneas con la misma
 * clave: la primera inserta y la segunda recibe la existente (clave única), así que nunca hay duplicados.
 */
async function grantCore(exec: Exec, g: GrantCore, now: number): Promise<{ enrollment: EnrollmentRow; created: boolean }> {
  if (!g.moduleIds.length) throw new LearningError("BAD_REQUEST", "La matrícula debe abrir al menos un módulo.");
  const mods = await rows(exec, sql`SELECT id FROM learning_modules WHERE course_id = ${g.courseId} AND id IN (${sql.join(g.moduleIds.map((m) => sql`${m}`), sql`, `)})`);
  if (mods.length !== new Set(g.moduleIds).size) throw new LearningError("BAD_REQUEST", "Algún módulo no pertenece al curso.");
  const ins = await run(exec, sql`INSERT INTO learning_enrollments
    (user_id, client_id, course_id, status, source, starts_at, ends_at, experience_id, variant_id, enrollment_id, order_id, quote_id, payment_ref, payment_amount_cents, grant_reason, granted_by, idempotency_key, created_at, updated_at)
    VALUES (${g.userId}, ${g.clientId}, ${g.courseId}, 'active', ${g.source}, ${g.startsAt}, ${g.endsAt}, ${g.experienceId ?? null}, ${g.variantId ?? null}, ${g.enrollmentId ?? null}, ${g.orderId ?? null}, ${g.quoteId ?? null},
      ${g.paymentRef ?? null}, ${g.paymentAmountCents ?? null}, ${g.reason ?? null}, ${g.actorUserId}, ${g.idempotencyKey}, ${now}, ${now})
    ON DUPLICATE KEY UPDATE id = id`);
  // Lectura con bloqueo: en REPETIBLE READ una lectura normal no vería la fila que otra transacción acaba de confirmar con la misma clave
  const [row] = await rows(exec, sql`SELECT * FROM learning_enrollments WHERE idempotency_key = ${g.idempotencyKey} LIMIT 1 FOR UPDATE`);
  const id = n(row.id);
  // Con CLIENT_FOUND_ROWS `affectedRows` es 1 también cuando la fila ya existía: solo `insertId` distingue «insertada ahora»
  const created = ins.insertId > 0 && ins.insertId === id;
  if (created) {
    for (const m of Array.from(new Set(g.moduleIds))) await run(exec, sql`INSERT IGNORE INTO learning_enrollment_modules (enrollment_id, module_id) VALUES (${id}, ${m})`);
    await event(exec, id, "granted", g.actorUserId, { source: g.source, startsAt: g.startsAt, endsAt: g.endsAt, moduleIds: g.moduleIds, paymentRef: g.paymentRef ?? null, reason: g.reason ?? null, variantId: g.variantId ?? null }, now);
  }
  const mods2 = await modulesOf(exec, [id], true);
  return { enrollment: mapEnrollment(row, mods2.get(id) ?? []), created };
}

/** Reintenta una transacción que MySQL abortó por interbloqueo o espera excesiva (dos concesiones simultáneas de la misma clave). */
async function withRetry<T>(fn: () => Promise<T>, attempts = 8): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      let retry = false;
      for (let x: any = e, depth = 0; x && depth < 5; x = x.cause, depth++) if (x?.errno === 1213 || x?.errno === 1205 || x?.code === "ER_LOCK_DEADLOCK" || x?.code === "ER_LOCK_WAIT_TIMEOUT") retry = true;
      if (!retry || i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 15 + Math.floor(Math.random() * 60) * i));
    }
  }
}

export interface PaymentGrantInput {
  userId: number;
  clientId: number | null;
  experienceId: number;
  variantId: number | null;
  /** Operación comercial de origen: p. ej. { kind: "enrollment", id: 7 } o { kind: "order", id: 55 } */
  operation: { kind: string; id: number };
  enrollmentId?: number | null;
  orderId?: number | null;
  quoteId?: number | null;
  payment: Partial<PaymentEvidence> | null;
  actorUserId: number | null;
  now?: number;
}

/**
 * Libera el acceso de una compra con PAGO CONFIRMADO según las reglas de catálogo. Sin pago verificado lanza
 * PAYMENT_NOT_CONFIRMED. Sin regla para la variante (p. ej. RECONNECT LIVE) no crea nada.
 */
export async function grantFromPayment(input: PaymentGrantInput): Promise<{ granted: Array<{ enrollment: EnrollmentRow; created: boolean }>; rules: number }> {
  const pay = assertPaymentConfirmed(input.payment);
  const now = input.now ?? Date.now();
  const d = await db();
  return withRetry(() => d.transaction(async (tx) => {
    const rules = matchRules(await listRules(tx), input.experienceId, input.variantId);
    const granted: Array<{ enrollment: EnrollmentRow; created: boolean }> = [];
    for (const rule of rules) {
      const w = computeWindow({ startMode: rule.startMode, fixedStart: rule.fixedStart, durationDays: rule.durationDays, grantedAt: now });
      granted.push(
        await grantCore(tx, {
          userId: input.userId, clientId: input.clientId, courseId: rule.courseId, moduleIds: rule.moduleIds, source: "payment", startsAt: w.startsAt, endsAt: w.endsAt,
          experienceId: input.experienceId, variantId: input.variantId, enrollmentId: input.enrollmentId ?? null, orderId: input.orderId ?? null, quoteId: input.quoteId ?? null,
          paymentRef: pay.reference, paymentAmountCents: pay.amountCents, actorUserId: input.actorUserId,
          idempotencyKey: paymentKey({ operationKind: input.operation.kind, operationId: input.operation.id, ruleId: rule.id, userId: input.userId }),
        }, now),
      );
    }
    return { granted, rules: rules.length };
  }));
}

export interface AdminGrantInput {
  userId: number;
  clientId?: number | null;
  courseId: number;
  moduleIds: number[];
  durationDays: number | null;
  startsAt?: number;
  reason: string;
  actorUserId: number;
  nonce: string;
  now?: number;
}

/** Concesión administrativa expresamente registrada (con motivo y autor). */
export async function grantAdmin(input: AdminGrantInput): Promise<{ enrollment: EnrollmentRow; created: boolean }> {
  const reason = assertReason(input.reason);
  const now = input.now ?? Date.now();
  const startsAt = input.startsAt ?? now;
  const endsAt = input.durationDays == null ? null : startsAt + Math.round(input.durationDays) * DAY_MS;
  const d = await db();
  return withRetry(() => d.transaction((tx) =>
    grantCore(tx, { userId: input.userId, clientId: input.clientId ?? null, courseId: input.courseId, moduleIds: input.moduleIds, source: "admin", startsAt, endsAt, reason, actorUserId: input.actorUserId, idempotencyKey: adminKey({ userId: input.userId, courseId: input.courseId, nonce: input.nonce }) }, now)));
}

export interface DemoGrantInput {
  userId: number;
  clientId?: number | null;
  courseId: number;
  moduleIds: number[];
  /** Evento que lo activa (p. ej. «workshop-2026-11-25»): un mismo evento da una sola demostración por persona */
  trigger: string;
  actorUserId: number | null;
  /** Minutos de acceso (por defecto 60) */
  minutes?: number;
  now?: number;
}

/** Acceso de demostración: individual, de 60 minutos desde su apertura, sobre los módulos indicados. Un disparador, una vez. */
export async function grantDemo(input: DemoGrantInput): Promise<{ enrollment: EnrollmentRow; created: boolean }> {
  const now = input.now ?? Date.now();
  const ms = input.minutes ? Math.min(input.minutes, 24 * 60) * 60_000 : DEMO_MS;
  const d = await db();
  return withRetry(() => d.transaction((tx) =>
    grantCore(tx, { userId: input.userId, clientId: input.clientId ?? null, courseId: input.courseId, moduleIds: input.moduleIds, source: "demo", startsAt: now, endsAt: now + ms, reason: `Demostración (${input.trigger})`, actorUserId: input.actorUserId, idempotencyKey: demoKey({ userId: input.userId, courseId: input.courseId, trigger: input.trigger }) }, now)));
}

// ─── Gestión de matrículas (auditada) ─────────────────────────────────────────────────────────────────────────────

async function lockEnrollment(tx: Exec, id: number): Promise<Record<string, any>> {
  const [r] = await rows(tx, sql`SELECT * FROM learning_enrollments WHERE id = ${id} FOR UPDATE`);
  if (!r) throw new LearningError("NOT_FOUND", "La matrícula no existe.");
  return r;
}

export async function revokeEnrollment(id: number, reason: string, actorUserId: number, now = Date.now()): Promise<EnrollmentRow> {
  const why = assertReason(reason);
  const d = await db();
  return d.transaction(async (tx) => {
    const r = await lockEnrollment(tx, id);
    if (r.status !== "revoked") {
      await run(tx, sql`UPDATE learning_enrollments SET status = 'revoked', updated_at = ${now} WHERE id = ${id}`);
      await event(tx, id, "revoked", actorUserId, { reason: why, previous: r.status }, now);
    }
    return (await getEnrollment(id, tx))!;
  });
}

export async function suspendEnrollment(id: number, reason: string, actorUserId: number, now = Date.now()): Promise<EnrollmentRow> {
  const why = assertReason(reason);
  const d = await db();
  return d.transaction(async (tx) => {
    const r = await lockEnrollment(tx, id);
    if (r.status === "revoked") throw new LearningError("CONFLICT", "Una matrícula revocada no se suspende: se reactiva con motivo.");
    if (r.status !== "suspended") {
      await run(tx, sql`UPDATE learning_enrollments SET status = 'suspended', updated_at = ${now} WHERE id = ${id}`);
      await event(tx, id, "suspended", actorUserId, { reason: why, previous: r.status }, now);
    }
    return (await getEnrollment(id, tx))!;
  });
}

/** Reactivar una matrícula suspendida, revocada o caducada. La ventana sigue siendo la suya (prorrogar es otra acción). */
export async function reactivateEnrollment(id: number, reason: string, actorUserId: number, now = Date.now()): Promise<EnrollmentRow> {
  const why = assertReason(reason);
  const d = await db();
  return d.transaction(async (tx) => {
    const r = await lockEnrollment(tx, id);
    if (r.status !== "active") {
      await run(tx, sql`UPDATE learning_enrollments SET status = 'active', updated_at = ${now} WHERE id = ${id}`);
      await event(tx, id, "reactivated", actorUserId, { reason: why, previous: r.status }, now);
    }
    return (await getEnrollment(id, tx))!;
  });
}

/** Prórroga administrativa: fija el nuevo fin (o sin límite) y, si estaba caducada, la deja activa. Siempre con motivo. */
export async function extendEnrollment(id: number, newEndsAt: number | null, reason: string, actorUserId: number, now = Date.now()): Promise<EnrollmentRow> {
  const why = assertReason(reason);
  const d = await db();
  return d.transaction(async (tx) => {
    const r = await lockEnrollment(tx, id);
    if (r.status === "revoked") throw new LearningError("CONFLICT", "Una matrícula revocada no se prorroga: reactívala antes, con motivo.");
    if (newEndsAt != null && newEndsAt <= now) throw new LearningError("BAD_REQUEST", "La nueva fecha de fin debe ser futura.");
    const previous = r.ends_at == null ? null : n(r.ends_at);
    await run(tx, sql`UPDATE learning_enrollments SET ends_at = ${newEndsAt}, status = ${r.status === "expired" ? "active" : r.status}, updated_at = ${now} WHERE id = ${id}`);
    await event(tx, id, "extended", actorUserId, { reason: why, previousEndsAt: previous, newEndsAt, previousStatus: r.status }, now);
    return (await getEnrollment(id, tx))!;
  });
}

/** Amplía los módulos de una matrícula (ampliación de modalidad ya pagada): misma cuenta, mismo historial. */
export async function addModules(id: number, moduleIds: number[], reason: string, actorUserId: number, evidence: { paymentRef?: string | null } = {}, now = Date.now()): Promise<EnrollmentRow> {
  const why = assertReason(reason);
  const d = await db();
  return d.transaction(async (tx) => {
    const r = await lockEnrollment(tx, id);
    const mods = await rows(tx, sql`SELECT id FROM learning_modules WHERE course_id = ${n(r.course_id)} AND id IN (${sql.join(moduleIds.map((m) => sql`${m}`), sql`, `)})`);
    if (mods.length !== new Set(moduleIds).size) throw new LearningError("BAD_REQUEST", "Algún módulo no pertenece al curso.");
    const before = (await modulesOf(tx, [id])).get(id) ?? [];
    for (const m of Array.from(new Set(moduleIds))) await run(tx, sql`INSERT IGNORE INTO learning_enrollment_modules (enrollment_id, module_id) VALUES (${id}, ${m})`);
    await run(tx, sql`UPDATE learning_enrollments SET updated_at = ${now} WHERE id = ${id}`);
    await event(tx, id, "modules_added", actorUserId, { reason: why, before, after: mergeModules(before, moduleIds), paymentRef: evidence.paymentRef ?? null }, now);
    return (await getEnrollment(id, tx))!;
  });
}

/** Tarea programada: pasa a `expired` las matrículas activas vencidas y lo registra. Idempotente. */
export async function expireDue(now = Date.now()): Promise<number> {
  const d = await db();
  return d.transaction(async (tx) => {
    const due = await rows(tx, sql`SELECT id FROM learning_enrollments WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= ${now} FOR UPDATE`);
    for (const r of due) {
      await run(tx, sql`UPDATE learning_enrollments SET status = 'expired', updated_at = ${now} WHERE id = ${n(r.id)} AND status = 'active'`);
      await event(tx, n(r.id), "expired", null, { at: now }, now);
    }
    return due.length;
  });
}

export async function getEnrollment(id: number, exec?: Exec): Promise<EnrollmentRow | null> {
  const e = exec ?? (await db());
  const [r] = await rows(e, sql`SELECT * FROM learning_enrollments WHERE id = ${id}`);
  if (!r) return null;
  return mapEnrollment(r, (await modulesOf(e, [id])).get(id) ?? []);
}

export async function listEnrollments(filter: { userId?: number; courseId?: number } = {}): Promise<Array<EnrollmentRow & { userName: string | null; userEmail: string | null }>> {
  const d = await db();
  const where: SQL[] = [];
  if (filter.userId) where.push(sql`e.user_id = ${filter.userId}`);
  if (filter.courseId) where.push(sql`e.course_id = ${filter.courseId}`);
  const list = await rows(d, sql`SELECT e.*, u.name AS user_name, u.email AS user_email FROM learning_enrollments e LEFT JOIN users u ON u.id = e.user_id ${where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``} ORDER BY e.id DESC LIMIT 500`);
  const mods = await modulesOf(d, list.map((r) => n(r.id)));
  return list.map((r) => ({ ...mapEnrollment(r, mods.get(n(r.id)) ?? []), userName: r.user_name ?? null, userEmail: r.user_email ?? null }));
}

export async function enrollmentEvents(id: number): Promise<Array<{ id: number; type: string; actorUserId: number | null; detail: unknown; createdAt: number }>> {
  const d = await db();
  const list = await rows(d, sql`SELECT * FROM learning_access_events WHERE enrollment_id = ${id} ORDER BY id`);
  return list.map((r) => ({ id: n(r.id), type: String(r.type), actorUserId: r.actor_user_id == null ? null : n(r.actor_user_id), detail: typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail, createdAt: n(r.created_at) }));
}

// ─── Autorización de contenido ────────────────────────────────────────────────────────────────────────────────────

export async function enrollmentViews(userId: number, courseId: number, exec?: Exec): Promise<EnrollmentView[]> {
  const e = exec ?? (await db());
  const list = await rows(e, sql`SELECT * FROM learning_enrollments WHERE user_id = ${userId} AND course_id = ${courseId}`);
  const mods = await modulesOf(e, list.map((r) => n(r.id)));
  return list.map((r) => ({ status: r.status, startsAt: n(r.starts_at), endsAt: r.ends_at == null ? null : n(r.ends_at), moduleIds: mods.get(n(r.id)) ?? [] }));
}

export interface BlockLocation {
  blockId: number;
  lessonId: number;
  moduleId: number;
  courseId: number;
  courseStatus: string;
}

export async function locateBlock(blockId: number): Promise<BlockLocation | null> {
  const d = await db();
  const [r] = await rows(d, sql`SELECT b.id AS block_id, l.id AS lesson_id, m.id AS module_id, c.id AS course_id, c.status AS course_status
    FROM learning_blocks b JOIN learning_lessons l ON l.id = b.lesson_id JOIN learning_modules m ON m.id = l.module_id JOIN learning_courses c ON c.id = m.course_id WHERE b.id = ${blockId}`);
  return r ? { blockId: n(r.block_id), lessonId: n(r.lesson_id), moduleId: n(r.module_id), courseId: n(r.course_id), courseStatus: String(r.course_status) } : null;
}

/** ¿Puede este usuario abrir este módulo ahora? Un curso no publicado solo lo ven las matrículas administrativas y de demostración... nunca el público. */
export async function canAccessModule(userId: number | null, courseId: number, moduleId: number, now = Date.now()) {
  if (!userId) return { allowed: false as const, reason: "no_enrollment" as const };
  const d = await db();
  const [course] = await rows(d, sql`SELECT status FROM learning_courses WHERE id = ${courseId}`);
  if (!course || course.status !== "published") return { allowed: false as const, reason: "no_enrollment" as const };
  return evaluateAny(await enrollmentViews(userId, courseId, d), moduleId, now);
}

export async function canAccessBlock(userId: number | null, blockId: number, now = Date.now()) {
  const loc = await locateBlock(blockId);
  if (!loc) return { allowed: false as const, reason: "no_enrollment" as const, location: null };
  const dec = await canAccessModule(userId, loc.courseId, loc.moduleId, now);
  return { ...dec, location: loc };
}

// ─── Aula del alumno ──────────────────────────────────────────────────────────────────────────────────────────────

export interface MyCourse {
  courseId: number;
  slug: string;
  title: string;
  status: "active" | "scheduled" | "expired" | "suspended" | "revoked";
  startsAt: number;
  endsAt: number | null;
  source: string;
  moduleIds: number[];
  totalLessons: number;
  completedLessons: number;
  percent: number;
  lastLessonId: number | null;
}

/** Cursos de un alumno con su estado, fechas y progreso (el progreso se conserva aunque venza la matrícula). */
export async function myCourses(userId: number, now = Date.now()): Promise<MyCourse[]> {
  const d = await db();
  const enrollments = await rows(d, sql`SELECT e.*, c.slug, c.title, c.status AS course_status FROM learning_enrollments e JOIN learning_courses c ON c.id = e.course_id WHERE e.user_id = ${userId} AND c.status = 'published' ORDER BY e.id DESC`);
  const mods = await modulesOf(d, enrollments.map((r) => n(r.id)));
  const byCourse = new Map<number, MyCourse>();
  for (const r of enrollments) {
    const cid = n(r.course_id);
    const ids = mods.get(n(r.id)) ?? [];
    const view: EnrollmentView = { status: r.status, startsAt: n(r.starts_at), endsAt: r.ends_at == null ? null : n(r.ends_at), moduleIds: ids };
    const eff = view.status !== "active" ? view.status : now < view.startsAt ? "scheduled" : view.endsAt != null && now >= view.endsAt ? "expired" : "active";
    const prev = byCourse.get(cid);
    const rank = { active: 4, scheduled: 3, expired: 2, suspended: 1, revoked: 0 } as const;
    if (!prev) byCourse.set(cid, { courseId: cid, slug: r.slug, title: r.title, status: eff, startsAt: view.startsAt, endsAt: view.endsAt, source: r.source, moduleIds: ids, totalLessons: 0, completedLessons: 0, percent: 0, lastLessonId: null });
    else {
      prev.moduleIds = mergeModules(prev.moduleIds, ids);
      if (rank[eff] > rank[prev.status]) Object.assign(prev, { status: eff, startsAt: view.startsAt, endsAt: view.endsAt, source: r.source });
      else if (eff === prev.status && view.endsAt !== null && (prev.endsAt === null || view.endsAt > prev.endsAt)) prev.endsAt = view.endsAt;
    }
  }
  for (const c of Array.from(byCourse.values())) {
    const [t] = await rows(d, sql`SELECT COUNT(*) AS total FROM learning_lessons l JOIN learning_modules m ON m.id = l.module_id WHERE m.course_id = ${c.courseId} AND m.id IN (${sql.join(c.moduleIds.length ? c.moduleIds.map((m: number) => sql`${m}`) : [sql`0`], sql`, `)})`);
    const [p] = await rows(d, sql`SELECT COUNT(*) AS done FROM learning_progress p JOIN learning_lessons l ON l.id = p.lesson_id JOIN learning_modules m ON m.id = l.module_id WHERE p.user_id = ${userId} AND p.status = 'completed' AND m.course_id = ${c.courseId} AND m.id IN (${sql.join(c.moduleIds.length ? c.moduleIds.map((m: number) => sql`${m}`) : [sql`0`], sql`, `)})`);
    const [last] = await rows(d, sql`SELECT p.lesson_id FROM learning_progress p JOIN learning_lessons l ON l.id = p.lesson_id JOIN learning_modules m ON m.id = l.module_id WHERE p.user_id = ${userId} AND m.course_id = ${c.courseId} ORDER BY p.updated_at DESC LIMIT 1`);
    c.totalLessons = n(t?.total);
    c.completedLessons = n(p?.done);
    c.percent = progressPercent(c.totalLessons, c.completedLessons);
    c.lastLessonId = last ? n(last.lesson_id) : null;
  }
  return Array.from(byCourse.values());
}

/** Registra progreso de una lección. Exige que el usuario pueda abrir su módulo AHORA: abrir una página no completa nada. */
export async function recordProgress(userId: number, lessonId: number, p: { completed?: boolean; lastBlockId?: number | null }, now = Date.now()): Promise<{ status: "in_progress" | "completed" }> {
  const d = await db();
  const [loc] = await rows(d, sql`SELECT m.id AS module_id, m.course_id FROM learning_lessons l JOIN learning_modules m ON m.id = l.module_id WHERE l.id = ${lessonId}`);
  if (!loc) throw new LearningError("NOT_FOUND", "La lección no existe.");
  const dec = await canAccessModule(userId, n(loc.course_id), n(loc.module_id), now);
  if (!dec.allowed) throw new LearningError("FORBIDDEN", "No tienes acceso a esta lección.");
  const status = p.completed ? "completed" : "in_progress";
  await run(d, sql`INSERT INTO learning_progress (user_id, lesson_id, status, last_block_id, completed_at, updated_at)
    VALUES (${userId}, ${lessonId}, ${status}, ${p.lastBlockId ?? null}, ${p.completed ? now : null}, ${now})
    ON DUPLICATE KEY UPDATE status = IF(status = 'completed' AND VALUES(status) = 'in_progress', status, VALUES(status)),
      last_block_id = COALESCE(VALUES(last_block_id), last_block_id),
      completed_at = IF(VALUES(status) = 'completed', COALESCE(completed_at, VALUES(completed_at)), completed_at), updated_at = VALUES(updated_at)`);
  const [row] = await rows(d, sql`SELECT status FROM learning_progress WHERE user_id = ${userId} AND lesson_id = ${lessonId}`);
  return { status: row.status };
}

// ─── Recursos privados (ficheros del curso) ───────────────────────────────────────────────────────────────────────

export type ResourceAuthorization =
  | { allowed: true; enrollmentId: number; resourceId: number; objectId: string; kind: "video" | "audio" | "pdf" | "document" | "image"; originalName: string | null }
  | { allowed: false; reason: "no_enrollment" | "inactive" | "not_started" | "expired" | "module_not_granted" | "not_available" };

/**
 * ¿Puede este usuario abrir este recurso ahora? Hace falta que el recurso esté VERIFICADO (con fichero real), que lo use
 * algún bloque de un curso publicado y que una matrícula del usuario, en ventana y activa, abra el módulo de ese bloque.
 * Devuelve la matrícula que lo autoriza (para el registro de accesos). Nunca devuelve rutas de almacenamiento.
 */
export async function authorizeResource(userId: number | null, resourceId: number, now = Date.now()): Promise<ResourceAuthorization> {
  if (!userId) return { allowed: false, reason: "no_enrollment" };
  const d = await db();
  const [res] = await rows(d, sql`SELECT id, kind, status, stored_object_id, original_name FROM learning_resources WHERE id = ${resourceId}`);
  if (!res || res.status !== "verified" || !res.stored_object_id) return { allowed: false, reason: "not_available" };
  const uses = await rows(d, sql`SELECT DISTINCT m.id AS module_id, m.course_id FROM learning_blocks b JOIN learning_lessons l ON l.id = b.lesson_id JOIN learning_modules m ON m.id = l.module_id JOIN learning_courses c ON c.id = m.course_id WHERE b.resource_id = ${resourceId} AND c.status = 'published'`);
  if (!uses.length) return { allowed: false, reason: "not_available" };
  let last: ResourceAuthorization = { allowed: false, reason: "no_enrollment" };
  for (const u of uses) {
    const list = await rows(d, sql`SELECT * FROM learning_enrollments WHERE user_id = ${userId} AND course_id = ${n(u.course_id)} ORDER BY id`);
    const mods = await modulesOf(d, list.map((r) => n(r.id)));
    for (const r of list) {
      const view: EnrollmentView = { status: r.status, startsAt: n(r.starts_at), endsAt: r.ends_at == null ? null : n(r.ends_at), moduleIds: mods.get(n(r.id)) ?? [] };
      const dec = evaluateAny([view], n(u.module_id), now);
      if (dec.allowed) return { allowed: true, enrollmentId: n(r.id), resourceId, objectId: String(res.stored_object_id), kind: res.kind, originalName: res.original_name ?? null };
      last = { allowed: false, reason: dec.reason };
    }
  }
  return last;
}

/** Registro de un acceso relevante a un recurso (matrícula que lo autorizó). */
export async function logResourceOpened(enrollmentId: number, resourceId: number, userId: number, via: "stream" | "redirect" | "download", now = Date.now()) {
  const d = await db();
  await event(d, enrollmentId, "resource_opened", userId, { resourceId, via }, now);
}

export interface AttachResult {
  resourceId: number;
  duplicateOf: Array<{ resourceId: number; originalName: string | null }>;
}

const KIND_MIME: Record<string, RegExp> = { video: /^video\//, audio: /^audio\//, pdf: /^application\/pdf$/, document: /^application\//, image: /^image\// };

/** Asocia el fichero ya almacenado a un recurso pendiente: lo verifica (tipo coherente), guarda tamaño y huella y avisa de duplicados. */
export async function attachResourceFile(resourceId: number, f: { objectId: string; sha256: string; sizeBytes: number; mimeType: string; originalName: string | null }, actorUserId: number, now = Date.now()): Promise<AttachResult> {
  const d = await db();
  return d.transaction(async (tx) => {
    const [res] = await rows(tx, sql`SELECT id, kind FROM learning_resources WHERE id = ${resourceId} FOR UPDATE`);
    if (!res) throw new LearningError("NOT_FOUND", "El recurso no existe.");
    if (!(KIND_MIME[String(res.kind)] ?? /^$/).test(f.mimeType)) throw new LearningError("BAD_REQUEST", `El fichero (${f.mimeType}) no corresponde a un recurso de tipo ${res.kind}.`);
    const dups = await rows(tx, sql`SELECT id, original_name FROM learning_resources WHERE sha256 = ${f.sha256} AND id <> ${resourceId}`);
    await run(tx, sql`UPDATE learning_resources SET stored_object_id = ${f.objectId}, status = 'verified', mime_type = ${f.mimeType}, size_bytes = ${f.sizeBytes}, sha256 = ${f.sha256}, original_name = COALESCE(original_name, ${f.originalName}), updated_at = ${now} WHERE id = ${resourceId}`);
    return { resourceId, duplicateOf: dups.map((r) => ({ resourceId: n(r.id), originalName: r.original_name ?? null })) };
  });
}

export { LearningRuleError };
