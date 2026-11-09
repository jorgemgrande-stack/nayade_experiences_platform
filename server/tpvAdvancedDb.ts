/**
 * TPV Advanced (Elephant Connect, capacidad `pos-advanced`, migración 0065): arqueos y conciliaciones, turnos de
 * operador, entrega y recepción de caja, autorizaciones especiales, correcciones trazables, auditoría unificada e
 * informes. Todo en la BD de la empresa en curso (`legacyDb()`), en tablas propias: nunca modifica el cierre de caja
 * ni su foto inmutable (`tpv_session_closures`), ni las ventas o movimientos del TPV.
 *
 * Reglas:
 *  - Operaciones económicas idempotentes por la clave del intento (como `tpv.addCashMovement`): repetir con la misma
 *    clave devuelve el mismo registro; la misma clave con otros datos, CONFLICT.
 *  - Lo que depende del estado de la caja se decide con el bloqueo de la sesión (`withTenantLock`): dos entregas o dos
 *    turnos a la vez nunca rompen las reglas (una entrega pendiente y un turno abierto por sesión).
 *  - Arqueos y entregas recibidas son inmutables: las correcciones van aparte (`tpv_adv_corrections`).
 *  - Una caja cerrada no admite turnos ni entregas nuevas (sí terminar un turno o el arqueo de cierre).
 *  - Sin DELETE: lo que se retira se marca (estado `cancelled`).
 */
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { legacyDb } from "./_core/legacyDb";
import { withTenantLock } from "./tpvSaleIdempotency";
import { computeSessionPaymentTotals } from "./tpvSessionTotals";
import { correctionsCashDelta, getClosureSnapshot, listCorrections } from "./tpvRulesDb";
import { madridRangeMs } from "./tpvReports";
import {
  AUTH_KINDS,
  AUTH_KIND_LABELS,
  AUTH_VALIDITY_MS,
  COUNT_KIND_LABELS,
  CORRECTION_TARGET_LABELS,
  HANDOVER_STATUS_LABELS,
  RECON_METHODS,
  authorizationRequired,
  authorizationUsable,
  filterAudit,
  fromCents,
  handoverOutcome,
  moneyDiff,
  normalizeDenominations,
  reconcile,
  sortAudit,
  validateDayRange,
  validateRule,
  type AuditEvent,
  type AuditType,
  type AuthKind,
  type AuthRule,
  type CorrectionTarget,
  type CountKind,
  type ReconMethod,
} from "../shared/tpvAdvanced";

const db = legacyDb();

type Row = Record<string, unknown>;
type Exec = { execute: (q: SQL) => Promise<unknown> };

async function rowsOf(q: SQL, x: Exec = db as unknown as Exec): Promise<Row[]> {
  const [r] = (await x.execute(q)) as unknown as [Row[]];
  return Array.isArray(r) ? r : [];
}
async function affected(q: SQL, x: Exec = db as unknown as Exec): Promise<number> {
  const [r] = (await x.execute(q)) as unknown as [{ affectedRows?: number }];
  return Number(r?.affectedRows ?? 0);
}
async function insertId(q: SQL, x: Exec = db as unknown as Exec): Promise<number> {
  const [r] = (await x.execute(q)) as unknown as [{ insertId?: number }];
  return Number(r?.insertId ?? 0);
}

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const strOrNull = (v: unknown) => (v === null || v === undefined ? null : String(v));
const same = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 0.005);

/** ¿Es el error del índice único (dos intentos a la vez con la misma clave)? */
export function isDuplicateKeyError(e: unknown): boolean {
  const err = e as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  return /ER_DUP_ENTRY|Duplicate entry/.test(`${err?.code ?? ""} ${err?.message ?? ""} ${err?.cause?.code ?? ""} ${err?.cause?.message ?? ""}`);
}

export interface Actor {
  id: number;
  name: string;
}

const conflict = (message: string) => new TRPCError({ code: "CONFLICT", message });
const notFound = (message: string) => new TRPCError({ code: "NOT_FOUND", message });
const badRequest = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const forbidden = (message: string) => new TRPCError({ code: "FORBIDDEN", message });

/** Con el bloqueo de la sesión de caja: lo que dependa de su estado se decide de uno en uno. */
function withSessionLock<T>(sessionId: number, fn: () => Promise<T>): Promise<T> {
  return withTenantLock("tpv_advsession", `s${sessionId}`, 10, "Se está registrando otra operación en esta caja. Inténtalo de nuevo en unos segundos.", fn);
}

/**
 * Registro idempotente: busca por clave; si no está, crea dentro del bloqueo (volviendo a buscar) y, si choca con el
 * índice único (otro proceso a la vez), devuelve el del otro intento. `matches` decide si la clave es del mismo intento.
 */
async function idempotent<T>(find: () => Promise<T | null>, matches: (t: T) => boolean, create: () => Promise<T>, conflictMessage: string): Promise<T> {
  const check = (t: T) => {
    if (!matches(t)) throw conflict(conflictMessage);
    return t;
  };
  const before = await find();
  if (before) return check(before);
  try {
    return await create();
  } catch (e) {
    if (!isDuplicateKeyError(e)) throw e;
    const again = await find();
    if (again) return check(again);
    throw e;
  }
}

// ─── Sesiones de caja ────────────────────────────────────────────────────────

export interface SessionInfo {
  id: number;
  registerId: number;
  registerName: string;
  status: "open" | "closed";
  openingAmount: number;
  cashierName: string;
  siteId: string | null;
  openedAt: number;
  closedAt: number | null;
}

const toSession = (r: Row): SessionInfo => ({
  id: Number(r.id),
  registerId: Number(r.registerId),
  registerName: String(r.registerName ?? `Caja ${r.registerId}`),
  status: String(r.status) === "closed" ? "closed" : "open",
  openingAmount: num(r.openingAmount),
  cashierName: String(r.cashierName ?? ""),
  siteId: strOrNull(r.site_id),
  openedAt: num(r.openedAt),
  closedAt: numOrNull(r.closedAt),
});

const SESSION_SELECT = sql`SELECT s.id, s.registerId, r.name AS registerName, s.status_cs AS status, s.openingAmount, s.cashierName, s.site_id, s.openedAt, s.closedAt
  FROM cash_sessions s LEFT JOIN cash_registers r ON r.id = s.registerId`;

export async function getSession(sessionId: number): Promise<SessionInfo> {
  const [r] = await rowsOf(sql`${SESSION_SELECT} WHERE s.id = ${sessionId}`);
  if (!r) throw notFound("La sesión de caja no existe");
  return toSession(r);
}

/** Sesiones abiertas y las cerradas de los últimos días (para elegir caja en el panel). */
export async function listSessions(recentDays = 7): Promise<SessionInfo[]> {
  const since = Date.now() - recentDays * 86_400_000;
  return (await rowsOf(sql`${SESSION_SELECT} WHERE s.status_cs = 'open' OR s.openedAt >= ${since} ORDER BY (s.status_cs = 'open') DESC, s.openedAt DESC LIMIT 100`)).map(toSession);
}

/**
 * Lo esperado por método. Caja abierta: fondo + efectivo cobrado + entradas − salidas (como el cierre del TPV). Caja
 * cerrada: la foto inmutable del cierre más el efecto de sus correcciones posteriores.
 */
export async function expectedTotals(s: SessionInfo): Promise<Record<ReconMethod, number>> {
  if (s.status === "closed") {
    const snap = await getClosureSnapshot(s.id);
    if (snap) {
      const delta = correctionsCashDelta(await listCorrections(s.id));
      return { cash: num(snap.expected_cash) + delta, card: num(snap.total_card), bizum: num(snap.total_bizum), other: num(snap.total_mixed) };
    }
  }
  const t = await computeSessionPaymentTotals(s.id);
  const [m] = await rowsOf(sql`SELECT COALESCE(SUM(CASE WHEN type_cm = 'in' THEN amount ELSE 0 END), 0) AS cin, COALESCE(SUM(CASE WHEN type_cm = 'out' THEN amount ELSE 0 END), 0) AS cout FROM cash_movements WHERE sessionId = ${s.id}`);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { cash: r2(s.openingAmount + t.totalCash + num(m?.cin) - num(m?.cout)), card: r2(t.totalCard), bizum: r2(t.totalBizum), other: r2(t.totalMixed) };
}

// ─── Arqueos ─────────────────────────────────────────────────────────────────

export interface CountRow {
  id: number;
  sessionId: number;
  registerId: number;
  shiftId: number | null;
  kind: CountKind;
  denominations: Record<string, number>;
  countedCash: number;
  expectedCash: number;
  cashDifference: number;
  declared: Record<ReconMethod, number | null>;
  expected: Record<ReconMethod, number>;
  differences: Record<ReconMethod, number | null>;
  notes: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: number;
}

const toCount = (r: Row): CountRow => {
  let denominations: Record<string, number> = {};
  try {
    denominations = JSON.parse(String(r.denominations ?? "{}"));
  } catch {
    denominations = {};
  }
  return {
    id: Number(r.id),
    sessionId: Number(r.session_id),
    registerId: Number(r.register_id),
    shiftId: numOrNull(r.shift_id),
    kind: String(r.kind) === "closing" ? "closing" : "intermediate",
    denominations,
    countedCash: num(r.counted_cash),
    expectedCash: num(r.expected_cash),
    cashDifference: num(r.cash_difference),
    declared: { cash: num(r.counted_cash), card: numOrNull(r.declared_card), bizum: numOrNull(r.declared_bizum), other: numOrNull(r.declared_other) },
    expected: { cash: num(r.expected_cash), card: num(r.expected_card), bizum: num(r.expected_bizum), other: num(r.expected_other) },
    differences: { cash: num(r.cash_difference), card: numOrNull(r.card_difference), bizum: numOrNull(r.bizum_difference), other: numOrNull(r.other_difference) },
    notes: strOrNull(r.notes),
    createdBy: numOrNull(r.created_by),
    createdByName: strOrNull(r.created_by_name),
    createdAt: num(r.created_at),
  };
};

export async function listCounts(sessionId: number): Promise<CountRow[]> {
  return (await rowsOf(sql`SELECT * FROM tpv_adv_counts WHERE session_id = ${sessionId} ORDER BY id`)).map(toCount);
}

export interface CountInput {
  sessionId: number;
  kind: CountKind;
  denominations: Record<string, number>;
  declaredCard?: number | null;
  declaredBizum?: number | null;
  declaredOther?: number | null;
  notes?: string | null;
  key: string;
}

/**
 * Arqueo con recuento por billetes y monedas y conciliación por método. Intermedio: solo con la caja abierta. De
 * cierre: uno por sesión, con la caja abierta (justo antes de cerrar) o ya cerrada (se compara con la foto del cierre).
 */
export async function createCount(input: CountInput, actor: Actor): Promise<CountRow> {
  const parsed = normalizeDenominations(input.denominations);
  if (!parsed.ok) throw badRequest(parsed.error);
  const counted = fromCents(parsed.totalCents);
  const find = async () => {
    const [r] = await rowsOf(sql`SELECT * FROM tpv_adv_counts WHERE idempotency_key = ${input.key}`);
    return r ? toCount(r) : null;
  };
  const matches = (c: CountRow) => c.sessionId === input.sessionId && c.kind === input.kind && same(c.countedCash, counted);
  return idempotent(find, matches, () =>
    withSessionLock(input.sessionId, async () => {
      const replay = await find();
      if (replay) {
        if (!matches(replay)) throw conflict("Esa clave ya se usó para otro arqueo");
        return replay;
      }
      const s = await getSession(input.sessionId);
      if (input.kind === "intermediate" && s.status === "closed") throw conflict("La caja está cerrada: registra el arqueo de cierre.");
      if (input.kind === "closing") {
        const [prev] = await rowsOf(sql`SELECT id FROM tpv_adv_counts WHERE session_id = ${s.id} AND kind = 'closing' LIMIT 1`);
        if (prev) throw conflict("Esta caja ya tiene su arqueo de cierre. Si hay que corregirlo, añade una corrección: el arqueo original se conserva.");
      }
      const expected = await expectedTotals(s);
      const rec = reconcile(expected, { cash: counted, card: input.declaredCard ?? null, bizum: input.declaredBizum ?? null, other: input.declaredOther ?? null });
      const by = Object.fromEntries(rec.map((r) => [r.method, r])) as Record<ReconMethod, (typeof rec)[number]>;
      const [shift] = await rowsOf(sql`SELECT id FROM tpv_adv_shifts WHERE session_id = ${s.id} AND status = 'open' ORDER BY id DESC LIMIT 1`);
      const m = (v: number | null) => (v === null ? null : money(v));
      await db.execute(sql`INSERT INTO tpv_adv_counts
        (session_id, register_id, shift_id, kind, denominations, counted_cash, expected_cash, cash_difference, declared_card, expected_card, card_difference, declared_bizum, expected_bizum, bizum_difference, declared_other, expected_other, other_difference, notes, created_by, created_by_name, idempotency_key, created_at)
        VALUES (${s.id}, ${s.registerId}, ${shift ? Number(shift.id) : null}, ${input.kind}, ${JSON.stringify(parsed.pieces)}, ${money(counted)}, ${money(by.cash.expected)}, ${money(by.cash.difference ?? 0)},
          ${m(by.card.declared)}, ${money(by.card.expected)}, ${m(by.card.difference)}, ${m(by.bizum.declared)}, ${money(by.bizum.expected)}, ${m(by.bizum.difference)},
          ${m(by.other.declared)}, ${money(by.other.expected)}, ${m(by.other.difference)}, ${input.notes ?? null}, ${actor.id}, ${actor.name}, ${input.key}, ${Date.now()})`);
      return (await find())!;
    }),
  "Esa clave ya se usó para otro arqueo");
}

// ─── Turnos ──────────────────────────────────────────────────────────────────

export interface ShiftRow {
  id: number;
  sessionId: number;
  registerId: number;
  operatorUserId: number;
  operatorName: string;
  status: "open" | "closed";
  openingCash: number;
  closingCash: number | null;
  startedAt: number;
  endedAt: number | null;
  notes: string | null;
  endKey: string | null;
}

const toShift = (r: Row): ShiftRow => ({
  id: Number(r.id),
  sessionId: Number(r.session_id),
  registerId: Number(r.register_id),
  operatorUserId: Number(r.operator_user_id),
  operatorName: String(r.operator_name),
  status: String(r.status) === "closed" ? "closed" : "open",
  openingCash: num(r.opening_cash),
  closingCash: numOrNull(r.closing_cash),
  startedAt: num(r.started_at),
  endedAt: numOrNull(r.ended_at),
  notes: strOrNull(r.notes),
  endKey: strOrNull(r.end_key),
});

export async function listShifts(sessionId: number): Promise<ShiftRow[]> {
  return (await rowsOf(sql`SELECT * FROM tpv_adv_shifts WHERE session_id = ${sessionId} ORDER BY id`)).map(toShift);
}

export async function getShift(id: number): Promise<ShiftRow> {
  const [r] = await rowsOf(sql`SELECT * FROM tpv_adv_shifts WHERE id = ${id}`);
  if (!r) throw notFound("El turno no existe");
  return toShift(r);
}

export async function startShift(input: { sessionId: number; openingCash: number; notes?: string | null; key: string }, actor: Actor): Promise<ShiftRow> {
  const find = async () => {
    const [r] = await rowsOf(sql`SELECT * FROM tpv_adv_shifts WHERE start_key = ${input.key}`);
    return r ? toShift(r) : null;
  };
  const matches = (t: ShiftRow) => t.sessionId === input.sessionId && t.operatorUserId === actor.id && same(t.openingCash, input.openingCash);
  return idempotent(find, matches, () =>
    withSessionLock(input.sessionId, async () => {
      const replay = await find();
      if (replay) {
        if (!matches(replay)) throw conflict("Esa clave ya se usó para otro turno");
        return replay;
      }
      const s = await getSession(input.sessionId);
      if (s.status !== "open") throw conflict("La caja está cerrada: no admite turnos nuevos.");
      const [open] = await rowsOf(sql`SELECT operator_name FROM tpv_adv_shifts WHERE session_id = ${s.id} AND status = 'open' LIMIT 1`);
      if (open) throw conflict(`Hay un turno abierto de ${String(open.operator_name)}. Termínalo o haz una entrega de caja antes de empezar otro.`);
      const id = await insertId(sql`INSERT INTO tpv_adv_shifts (session_id, register_id, operator_user_id, operator_name, status, opening_cash, started_at, started_by, notes, start_key)
        VALUES (${s.id}, ${s.registerId}, ${actor.id}, ${actor.name}, 'open', ${money(input.openingCash)}, ${Date.now()}, ${actor.id}, ${input.notes ?? null}, ${input.key})`);
      return getShift(id);
    }),
  "Esa clave ya se usó para otro turno");
}

/** Termina un turno (también con la caja ya cerrada). Lo termina su operador o la administración del TPV. */
export async function endShift(input: { shiftId: number; closingCash: number; notes?: string | null; key: string }, actor: Actor, canManage: boolean): Promise<ShiftRow> {
  const shift = await getShift(input.shiftId);
  if (shift.operatorUserId !== actor.id && !canManage) throw forbidden("Solo quien tiene el turno o la administración del TPV puede terminarlo.");
  return withSessionLock(shift.sessionId, async () => {
    const now = await getShift(input.shiftId);
    if (now.status === "closed") {
      if (now.endKey === input.key && same(now.closingCash, input.closingCash)) return now;
      throw conflict("Este turno ya está terminado.");
    }
    const n = await affected(sql`UPDATE tpv_adv_shifts SET status = 'closed', closing_cash = ${money(input.closingCash)}, ended_at = ${Date.now()}, ended_by = ${actor.id}, end_key = ${input.key},
      notes = COALESCE(${input.notes ?? null}, notes) WHERE id = ${input.shiftId} AND status = 'open'`);
    if (n !== 1) throw conflict("Este turno ya está terminado.");
    return getShift(input.shiftId);
  });
}

// ─── Entrega y recepción de caja ─────────────────────────────────────────────

export interface HandoverRow {
  id: number;
  sessionId: number;
  registerId: number;
  status: "pending" | "accepted" | "disputed" | "cancelled";
  fromUserId: number;
  fromName: string;
  fromShiftId: number | null;
  toUserId: number | null;
  toName: string | null;
  toShiftId: number | null;
  declaredCash: number;
  receivedCash: number | null;
  difference: number | null;
  declaredNotes: string | null;
  receivedNotes: string | null;
  declaredAt: number;
  receivedAt: number | null;
  cancelledAt: number | null;
  receiveKey: string | null;
}

const toHandover = (r: Row): HandoverRow => ({
  id: Number(r.id),
  sessionId: Number(r.session_id),
  registerId: Number(r.register_id),
  status: String(r.status) as HandoverRow["status"],
  fromUserId: Number(r.from_user_id),
  fromName: String(r.from_name),
  fromShiftId: numOrNull(r.from_shift_id),
  toUserId: numOrNull(r.to_user_id),
  toName: strOrNull(r.to_name),
  toShiftId: numOrNull(r.to_shift_id),
  declaredCash: num(r.declared_cash),
  receivedCash: numOrNull(r.received_cash),
  difference: numOrNull(r.difference),
  declaredNotes: strOrNull(r.declared_notes),
  receivedNotes: strOrNull(r.received_notes),
  declaredAt: num(r.declared_at),
  receivedAt: numOrNull(r.received_at),
  cancelledAt: numOrNull(r.cancelled_at),
  receiveKey: strOrNull(r.receive_key),
});

export async function listHandovers(sessionId: number): Promise<HandoverRow[]> {
  return (await rowsOf(sql`SELECT * FROM tpv_adv_handovers WHERE session_id = ${sessionId} ORDER BY id`)).map(toHandover);
}

export async function getHandover(id: number): Promise<HandoverRow> {
  const [r] = await rowsOf(sql`SELECT * FROM tpv_adv_handovers WHERE id = ${id}`);
  if (!r) throw notFound("La entrega de caja no existe");
  return toHandover(r);
}

async function activeUserName(userId: number): Promise<string> {
  const [u] = await rowsOf(sql`SELECT name, email, isActive FROM users WHERE id = ${userId}`);
  if (!u || !Number(u.isActive)) throw badRequest("La persona que recibe la caja no existe o está desactivada.");
  return String(u.name ?? u.email ?? `Usuario ${userId}`);
}

/** El operador saliente declara el efectivo que entrega. Una pendiente por sesión; caja cerrada, ninguna. */
export async function declareHandover(input: { sessionId: number; declaredCash: number; toUserId?: number | null; notes?: string | null; key: string }, actor: Actor): Promise<HandoverRow> {
  if (input.toUserId && input.toUserId === actor.id) throw badRequest("La caja se entrega a otra persona.");
  const find = async () => {
    const [r] = await rowsOf(sql`SELECT * FROM tpv_adv_handovers WHERE idempotency_key = ${input.key}`);
    return r ? toHandover(r) : null;
  };
  const matches = (h: HandoverRow) => h.sessionId === input.sessionId && h.fromUserId === actor.id && same(h.declaredCash, input.declaredCash);
  const toName = input.toUserId ? await activeUserName(input.toUserId) : null;
  return idempotent(find, matches, () =>
    withSessionLock(input.sessionId, async () => {
      const replay = await find();
      if (replay) {
        if (!matches(replay)) throw conflict("Esa clave ya se usó para otra entrega de caja");
        return replay;
      }
      const s = await getSession(input.sessionId);
      if (s.status !== "open") throw conflict("La caja está cerrada: no admite entregas nuevas.");
      const [pending] = await rowsOf(sql`SELECT id FROM tpv_adv_handovers WHERE session_id = ${s.id} AND status = 'pending' LIMIT 1`);
      if (pending) throw conflict("Ya hay una entrega de caja pendiente de recibir en esta caja.");
      const [shift] = await rowsOf(sql`SELECT id FROM tpv_adv_shifts WHERE session_id = ${s.id} AND status = 'open' AND operator_user_id = ${actor.id} LIMIT 1`);
      const id = await insertId(sql`INSERT INTO tpv_adv_handovers (session_id, register_id, status, from_user_id, from_name, from_shift_id, to_user_id, to_name, declared_cash, declared_notes, declared_at, idempotency_key)
        VALUES (${s.id}, ${s.registerId}, 'pending', ${actor.id}, ${actor.name}, ${shift ? Number(shift.id) : null}, ${input.toUserId ?? null}, ${toName}, ${money(input.declaredCash)}, ${input.notes ?? null}, ${Date.now()}, ${input.key})`);
      return getHandover(id);
    }),
  "Esa clave ya se usó para otra entrega de caja");
}

/**
 * El operador entrante recibe la caja: cuenta el efectivo y confirma (o queda la diferencia anotada). Termina el turno
 * de quien entrega y, con la caja abierta y sin otro turno en curso, empieza el de quien recibe con lo recibido.
 */
export async function receiveHandover(input: { handoverId: number; receivedCash: number; notes?: string | null; key: string }, actor: Actor): Promise<HandoverRow> {
  const h0 = await getHandover(input.handoverId);
  return withSessionLock(h0.sessionId, async () => {
    const h = await getHandover(input.handoverId);
    if (h.status !== "pending") {
      if (h.receiveKey === input.key && same(h.receivedCash, input.receivedCash)) return h;
      throw conflict(h.status === "cancelled" ? "Esta entrega de caja está anulada." : "Esta entrega de caja ya se recibió.");
    }
    if (h.fromUserId === actor.id) throw forbidden("Quien entrega la caja no puede recibirla: debe confirmarla otra persona.");
    if (h.toUserId && h.toUserId !== actor.id) throw forbidden(`Esta entrega es para ${h.toName ?? "otra persona"}.`);
    const out = handoverOutcome(h.declaredCash, input.receivedCash);
    const s = await getSession(h.sessionId);
    const now = Date.now();
    await db.transaction(async (tx) => {
      const x = tx as unknown as Exec;
      const n = await affected(sql`UPDATE tpv_adv_handovers SET status = ${out.status}, received_cash = ${money(input.receivedCash)}, difference = ${money(out.difference)},
        received_notes = ${input.notes ?? null}, received_at = ${now}, to_user_id = ${actor.id}, to_name = ${actor.name}, receive_key = ${input.key}
        WHERE id = ${h.id} AND status = 'pending'`, x);
      if (n !== 1) throw conflict("Esta entrega de caja ya se recibió.");
      // Termina el turno de quien entrega (con lo que declaró)
      await x.execute(sql`UPDATE tpv_adv_shifts SET status = 'closed', closing_cash = ${money(h.declaredCash)}, ended_at = ${now}, ended_by = ${actor.id}
        WHERE session_id = ${h.sessionId} AND status = 'open' AND operator_user_id = ${h.fromUserId}`);
      if (s.status === "open") {
        const [other] = await rowsOf(sql`SELECT id FROM tpv_adv_shifts WHERE session_id = ${h.sessionId} AND status = 'open' LIMIT 1`, x);
        if (!other) {
          const shiftId = await insertId(sql`INSERT INTO tpv_adv_shifts (session_id, register_id, operator_user_id, operator_name, status, opening_cash, started_at, started_by, notes, start_key)
            VALUES (${h.sessionId}, ${h.registerId}, ${actor.id}, ${actor.name}, 'open', ${money(input.receivedCash)}, ${now}, ${actor.id}, ${"Turno iniciado al recibir la caja"}, ${`entrega-${h.id}`})`, x);
          await x.execute(sql`UPDATE tpv_adv_handovers SET to_shift_id = ${shiftId} WHERE id = ${h.id}`);
        }
      }
    });
    return getHandover(h.id);
  });
}

/** Anula una entrega aún pendiente (quien la declaró o la administración del TPV). */
export async function cancelHandover(handoverId: number, actor: Actor, canManage: boolean): Promise<HandoverRow> {
  const h = await getHandover(handoverId);
  if (h.fromUserId !== actor.id && !canManage) throw forbidden("Solo quien declaró la entrega o la administración del TPV puede anularla.");
  if (h.status === "cancelled") return h;
  const n = await affected(sql`UPDATE tpv_adv_handovers SET status = 'cancelled', cancelled_at = ${Date.now()}, cancelled_by = ${actor.id} WHERE id = ${handoverId} AND status = 'pending'`);
  if (n !== 1) throw conflict("Esta entrega de caja ya se recibió: no se puede anular. Si hay un error, añade una corrección.");
  return getHandover(handoverId);
}

// ─── Correcciones de registros (el original no cambia) ───────────────────────

export interface RecordCorrectionRow {
  id: number;
  targetKind: CorrectionTarget;
  targetId: number;
  sessionId: number;
  amount: number | null;
  reason: string;
  createdByName: string | null;
  createdAt: number;
}

const toRecordCorrection = (r: Row): RecordCorrectionRow => ({
  id: Number(r.id),
  targetKind: String(r.target_kind) as CorrectionTarget,
  targetId: Number(r.target_id),
  sessionId: Number(r.session_id),
  amount: numOrNull(r.amount),
  reason: String(r.reason),
  createdByName: strOrNull(r.created_by_name),
  createdAt: num(r.created_at),
});

export async function listRecordCorrections(sessionId: number): Promise<RecordCorrectionRow[]> {
  return (await rowsOf(sql`SELECT * FROM tpv_adv_corrections WHERE session_id = ${sessionId} ORDER BY id`)).map(toRecordCorrection);
}

const TARGET_TABLE: Record<CorrectionTarget, SQL> = { count: sql.raw("tpv_adv_counts"), shift: sql.raw("tpv_adv_shifts"), handover: sql.raw("tpv_adv_handovers") };

export async function addRecordCorrection(input: { targetKind: CorrectionTarget; targetId: number; amount: number | null; reason: string; key: string }, actor: Actor): Promise<RecordCorrectionRow> {
  const [t] = await rowsOf(sql`SELECT session_id FROM ${TARGET_TABLE[input.targetKind]} WHERE id = ${input.targetId}`);
  if (!t) throw notFound(`${CORRECTION_TARGET_LABELS[input.targetKind]}: no existe`);
  const sessionId = Number(t.session_id);
  const find = async () => {
    const [r] = await rowsOf(sql`SELECT * FROM tpv_adv_corrections WHERE idempotency_key = ${input.key}`);
    return r ? toRecordCorrection(r) : null;
  };
  const matches = (c: RecordCorrectionRow) => c.targetKind === input.targetKind && c.targetId === input.targetId && same(c.amount, input.amount);
  return idempotent(find, matches, async () => {
    await db.execute(sql`INSERT INTO tpv_adv_corrections (target_kind, target_id, session_id, amount, reason, created_by, created_by_name, idempotency_key, created_at)
      VALUES (${input.targetKind}, ${input.targetId}, ${sessionId}, ${input.amount === null ? null : money(input.amount)}, ${input.reason}, ${actor.id}, ${actor.name}, ${input.key}, ${Date.now()})`);
    return (await find())!;
  }, "Esa clave ya se usó para otra corrección");
}

// ─── Autorizaciones especiales ───────────────────────────────────────────────

export async function listRules(): Promise<(AuthRule & { label: string; updatedByName: string | null; updatedAt: number | null })[]> {
  const stored = new Map((await rowsOf(sql`SELECT * FROM tpv_adv_auth_rules`)).map((r) => [String(r.kind), r]));
  return AUTH_KINDS.map((kind) => {
    const r = stored.get(kind);
    return { kind, label: AUTH_KIND_LABELS[kind], enabled: !!r && Number(r.enabled) === 1, threshold: r ? numOrNull(r.threshold) : null, updatedByName: r ? strOrNull(r.updated_by_name) : null, updatedAt: r ? num(r.updated_at) : null };
  });
}

export async function getRule(kind: AuthKind): Promise<AuthRule> {
  return (await listRules()).find((r) => r.kind === kind)!;
}

export async function setRule(input: { kind: AuthKind; enabled: boolean; threshold: number | null }, actor: Actor): Promise<AuthRule> {
  const err = validateRule(input.kind, input.threshold);
  if (err) throw badRequest(err);
  await db.execute(sql`INSERT INTO tpv_adv_auth_rules (kind, enabled, threshold, updated_by, updated_by_name, updated_at)
    VALUES (${input.kind}, ${input.enabled ? 1 : 0}, ${input.threshold === null ? null : money(input.threshold)}, ${actor.id}, ${actor.name}, ${Date.now()})
    ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), threshold = VALUES(threshold), updated_by = VALUES(updated_by), updated_by_name = VALUES(updated_by_name), updated_at = VALUES(updated_at)`);
  return getRule(input.kind);
}

export interface AuthorizationRow {
  id: number;
  kind: AuthKind;
  status: "pending" | "approved" | "rejected" | "cancelled" | "used";
  sessionId: number | null;
  amount: number | null;
  threshold: number | null;
  reference: string | null;
  reason: string;
  requestedBy: number;
  requestedByName: string;
  requestedAt: number;
  decidedBy: number | null;
  decidedByName: string | null;
  decidedAt: number | null;
  decisionNote: string | null;
  usedAt: number | null;
  usedRef: string | null;
  /** Aprobada y aún dentro de su validez. */
  usable: boolean;
}

const toAuth = (r: Row): AuthorizationRow => {
  const a = {
    id: Number(r.id),
    kind: String(r.kind) as AuthKind,
    status: String(r.status) as AuthorizationRow["status"],
    sessionId: numOrNull(r.session_id),
    amount: numOrNull(r.amount),
    threshold: numOrNull(r.threshold),
    reference: strOrNull(r.reference),
    reason: String(r.reason),
    requestedBy: Number(r.requested_by),
    requestedByName: String(r.requested_by_name),
    requestedAt: num(r.requested_at),
    decidedBy: numOrNull(r.decided_by),
    decidedByName: strOrNull(r.decided_by_name),
    decidedAt: numOrNull(r.decided_at),
    decisionNote: strOrNull(r.decision_note),
    usedAt: numOrNull(r.used_at),
    usedRef: strOrNull(r.used_ref),
    usable: false,
  };
  a.usable = authorizationUsable(a, Date.now());
  return a;
};

export async function getAuthorization(id: number): Promise<AuthorizationRow> {
  const [r] = await rowsOf(sql`SELECT * FROM tpv_adv_authorizations WHERE id = ${id}`);
  if (!r) throw notFound("La autorización no existe");
  return toAuth(r);
}

export async function listAuthorizations(f: { status?: AuthorizationRow["status"] | null; sessionId?: number | null; requestedBy?: number | null; limit?: number }): Promise<AuthorizationRow[]> {
  const where: SQL[] = [sql`1 = 1`];
  if (f.status) where.push(sql`status = ${f.status}`);
  if (f.sessionId) where.push(sql`session_id = ${f.sessionId}`);
  if (f.requestedBy) where.push(sql`requested_by = ${f.requestedBy}`);
  return (await rowsOf(sql`SELECT * FROM tpv_adv_authorizations WHERE ${sql.join(where, sql` AND `)} ORDER BY id DESC LIMIT ${Math.min(f.limit ?? 100, 500)}`)).map(toAuth);
}

/** ¿Necesita autorización esta operación con las reglas de la empresa? */
export async function checkRequirement(kind: AuthKind, amount: number | null): Promise<{ required: boolean; rule: AuthRule }> {
  const rule = await getRule(kind);
  return { required: authorizationRequired(rule, amount), rule };
}

export async function requestAuthorization(input: { kind: AuthKind; sessionId?: number | null; amount?: number | null; reference?: string | null; reason: string; key: string }, actor: Actor): Promise<AuthorizationRow> {
  const find = async () => {
    const [r] = await rowsOf(sql`SELECT * FROM tpv_adv_authorizations WHERE idempotency_key = ${input.key}`);
    return r ? toAuth(r) : null;
  };
  const matches = (a: AuthorizationRow) => a.kind === input.kind && a.requestedBy === actor.id && (a.sessionId ?? null) === (input.sessionId ?? null) && same(a.amount, input.amount ?? null);
  const before = await find();
  if (before) {
    if (!matches(before)) throw conflict("Esa clave ya se usó para otra solicitud");
    return before;
  }
  if (input.sessionId) await getSession(input.sessionId);
  const { required, rule } = await checkRequirement(input.kind, input.amount ?? null);
  if (!required) throw badRequest("Con las reglas de tu empresa, esta operación no necesita autorización.");
  return idempotent(find, matches, async () => {
    await db.execute(sql`INSERT INTO tpv_adv_authorizations (kind, status, session_id, amount, threshold, reference, reason, requested_by, requested_by_name, requested_at, idempotency_key)
      VALUES (${input.kind}, 'pending', ${input.sessionId ?? null}, ${input.amount == null ? null : money(input.amount)}, ${rule.threshold === null ? null : money(rule.threshold)}, ${input.reference ?? null}, ${input.reason}, ${actor.id}, ${actor.name}, ${Date.now()}, ${input.key})`);
    return (await find())!;
  }, "Esa clave ya se usó para otra solicitud");
}

/** Un supervisor (permiso `tpv.authorize`) aprueba o deniega. Nadie se autoriza a sí mismo. Repetir la misma decisión no cambia nada. */
export async function decideAuthorization(input: { id: number; approve: boolean; note?: string | null }, actor: Actor): Promise<AuthorizationRow> {
  const a = await getAuthorization(input.id);
  if (a.requestedBy === actor.id) throw forbidden("No puedes autorizar tu propia solicitud: debe hacerlo otro supervisor.");
  const status = input.approve ? "approved" : "rejected";
  if (a.status !== "pending") {
    if (a.decidedBy === actor.id && (a.status === status || (input.approve && a.status === "used"))) return a;
    throw conflict("Esta solicitud ya está resuelta.");
  }
  const n = await affected(sql`UPDATE tpv_adv_authorizations SET status = ${status}, decided_by = ${actor.id}, decided_by_name = ${actor.name}, decided_at = ${Date.now()}, decision_note = ${input.note ?? null}
    WHERE id = ${input.id} AND status = 'pending'`);
  if (n !== 1) {
    const now = await getAuthorization(input.id);
    if (now.decidedBy === actor.id && now.status === status) return now;
    throw conflict("Esta solicitud ya está resuelta.");
  }
  return getAuthorization(input.id);
}

/** Retira una solicitud pendiente o una autorización aún sin aplicar (quien la pidió o la administración del TPV). */
export async function cancelAuthorization(id: number, actor: Actor, canManage: boolean): Promise<AuthorizationRow> {
  const a = await getAuthorization(id);
  if (a.requestedBy !== actor.id && !canManage) throw forbidden("Solo quien la pidió o la administración del TPV puede retirarla.");
  if (a.status === "cancelled") return a;
  const n = await affected(sql`UPDATE tpv_adv_authorizations SET status = 'cancelled' WHERE id = ${id} AND status IN ('pending', 'approved')`);
  if (n !== 1) throw conflict("Esta autorización ya está resuelta o aplicada.");
  return getAuthorization(id);
}

/**
 * Aplica una autorización aprobada a la operación (una sola vez): misma operación, misma caja si la indicaba, importe
 * no mayor que el autorizado y dentro de su validez. Es lo que llamaría el gancho de una operación del TPV.
 */
export async function consumeAuthorization(input: { id: number; kind: AuthKind; amount?: number | null; sessionId?: number | null; usedRef: string }): Promise<AuthorizationRow> {
  const a = await getAuthorization(input.id);
  if (a.status === "used" && a.usedRef === input.usedRef) return a;
  if (a.kind !== input.kind) throw badRequest("Esta autorización es para otra operación.");
  if (!a.usable) throw conflict(a.status === "approved" ? "La autorización ha caducado: pide otra." : "La autorización no está aprobada.");
  if (a.sessionId && input.sessionId && a.sessionId !== input.sessionId) throw badRequest("Esta autorización es para otra caja.");
  if (a.amount !== null && typeof input.amount === "number" && Math.abs(input.amount) - Math.abs(a.amount) > 0.005) throw badRequest("El importe supera el autorizado.");
  const n = await affected(sql`UPDATE tpv_adv_authorizations SET status = 'used', used_at = ${Date.now()}, used_ref = ${input.usedRef} WHERE id = ${input.id} AND status = 'approved' AND decided_at >= ${Date.now() - AUTH_VALIDITY_MS}`);
  if (n !== 1) {
    const now = await getAuthorization(input.id);
    if (now.status === "used" && now.usedRef === input.usedRef) return now;
    throw conflict("La autorización ya se aplicó o ha caducado.");
  }
  return getAuthorization(input.id);
}

// ─── Operadores ──────────────────────────────────────────────────────────────

export async function listOperators(): Promise<{ id: number; name: string }[]> {
  return (await rowsOf(sql`SELECT id, name, email FROM users WHERE isActive = 1 AND role IN ('admin', 'agente', 'monitor', 'adminrest', 'controler') ORDER BY name LIMIT 500`)).map((r) => ({ id: Number(r.id), name: String(r.name ?? r.email ?? `Usuario ${r.id}`) }));
}

// ─── Detalle de una sesión ───────────────────────────────────────────────────

export async function sessionDetail(sessionId: number) {
  const session = await getSession(sessionId);
  const [expected, counts, shifts, handovers, corrections, authorizations] = await Promise.all([
    expectedTotals(session),
    listCounts(sessionId),
    listShifts(sessionId),
    listHandovers(sessionId),
    listRecordCorrections(sessionId),
    listAuthorizations({ sessionId, limit: 200 }),
  ]);
  return {
    session,
    expected,
    counts,
    shifts,
    handovers,
    corrections,
    authorizations,
    openShift: shifts.find((s) => s.status === "open") ?? null,
    pendingHandover: handovers.find((h) => h.status === "pending") ?? null,
    hasClosingCount: counts.some((c) => c.kind === "closing"),
  };
}

// ─── Auditoría ───────────────────────────────────────────────────────────────

function rangeOf(from: string, to: string): { fromMs: number; toMs: number } {
  const err = validateDayRange(from, to);
  if (err) throw badRequest(err);
  const r = madridRangeMs(from, to);
  return { fromMs: r.fromMs, toMs: r.toMsExclusive };
}

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace(".", ",")} €`;

export const AUDIT_MAX_EVENTS = 2000;

/**
 * Registro cronológico unificado del periodo: lee las tablas del TPV (aperturas, cierres, ventas, anulaciones,
 * movimientos, correcciones de cierre) y las de TPV Advanced. No escribe nada. Las anulaciones y devoluciones constan
 * con la fecha de la venta (el TPV no guarda la hora de la anulación).
 */
export async function buildAudit(f: { from: string; to: string; registerId?: number | null; types?: AuditType[]; actor?: string | null }): Promise<{ events: AuditEvent[]; truncated: boolean }> {
  const { fromMs, toMs } = rangeOf(f.from, f.to);
  const regs = new Map((await rowsOf(sql`SELECT id, name FROM cash_registers`)).map((r) => [Number(r.id), String(r.name)]));
  const sessionReg = new Map<number, number>();
  const ev: AuditEvent[] = [];
  const push = (e: Omit<AuditEvent, "registerName">) => ev.push({ ...e, registerName: e.registerId ? regs.get(e.registerId) ?? `Caja ${e.registerId}` : null });
  const within = (col: string) => sql`${sql.raw(col)} >= ${fromMs} AND ${sql.raw(col)} < ${toMs}`;

  for (const s of await rowsOf(sql`SELECT id, registerId, cashierName, openingAmount, closingAmount, countedCash, cashDifference, status_cs, openedAt, closedAt FROM cash_sessions WHERE (${within("openedAt")}) OR (${within("closedAt")})`)) {
    const id = Number(s.id);
    const reg = Number(s.registerId);
    sessionReg.set(id, reg);
    const openedAt = num(s.openedAt);
    if (openedAt >= fromMs && openedAt < toMs) push({ at: openedAt, type: "session_open", sessionId: id, registerId: reg, actor: strOrNull(s.cashierName), amount: num(s.openingAmount), detail: `Fondo inicial ${eur(num(s.openingAmount))}`, ref: `so-${id}` });
    const closedAt = numOrNull(s.closedAt);
    if (String(s.status_cs) === "closed" && closedAt !== null && closedAt >= fromMs && closedAt < toMs) {
      push({ at: closedAt, type: "session_close", sessionId: id, registerId: reg, actor: strOrNull(s.cashierName), amount: num(s.cashDifference), detail: `Contado ${eur(num(s.countedCash))}, esperado ${eur(num(s.closingAmount))}, diferencia ${eur(num(s.cashDifference))}`, ref: `sc-${id}` });
    }
  }
  const regOfSession = async (ids: number[]) => {
    const missing = Array.from(new Set(ids.filter((i) => !sessionReg.has(i))));
    for (let i = 0; i < missing.length; i += 500) {
      const chunk = missing.slice(i, i + 500);
      for (const r of await rowsOf(sql`SELECT id, registerId FROM cash_sessions WHERE id IN (${sql.join(chunk.map((c) => sql`${c}`), sql`, `)})`)) sessionReg.set(Number(r.id), Number(r.registerId));
    }
  };

  const sales = await rowsOf(sql`SELECT id, sessionId, ticketNumber, total, status_ts, sellerName, createdAt, paidAt FROM tpv_sales WHERE ${within("createdAt")} AND status_ts <> 'pending' LIMIT 20000`);
  const movements = await rowsOf(sql`SELECT id, sessionId, type_cm, amount, reason, cashierName, createdAt FROM cash_movements WHERE ${within("createdAt")} LIMIT 20000`);
  const closedCorr = await rowsOf(sql`SELECT id, session_id, kind, amount, reason, created_by_name, created_at FROM tpv_session_corrections WHERE ${within("created_at")}`);
  await regOfSession([...sales.map((r) => Number(r.sessionId)), ...movements.map((r) => Number(r.sessionId)), ...closedCorr.map((r) => Number(r.session_id))]);
  const regFor = (sid: number) => sessionReg.get(sid) ?? null;

  for (const s of sales) {
    const sid = Number(s.sessionId);
    const at = num(s.paidAt) || num(s.createdAt);
    const status = String(s.status_ts);
    push({ at, type: "sale", sessionId: sid, registerId: regFor(sid), actor: strOrNull(s.sellerName), amount: num(s.total), detail: `Ticket ${String(s.ticketNumber)}`, ref: `sa-${s.id}` });
    if (status === "cancelled" || status === "refunded") {
      push({ at, type: "sale_void", sessionId: sid, registerId: regFor(sid), actor: strOrNull(s.sellerName), amount: num(s.total), detail: `Ticket ${String(s.ticketNumber)} ${status === "cancelled" ? "anulado" : "devuelto"} (fecha de la venta)`, ref: `sv-${s.id}` });
    }
  }
  for (const m of movements) {
    const sid = Number(m.sessionId);
    const out = String(m.type_cm) === "out";
    push({ at: num(m.createdAt), type: "cash_movement", sessionId: sid, registerId: regFor(sid), actor: strOrNull(m.cashierName), amount: out ? -num(m.amount) : num(m.amount), detail: `${out ? "Salida" : "Entrada"}: ${String(m.reason)}`, ref: `cm-${m.id}` });
  }
  for (const c of closedCorr) {
    const sid = Number(c.session_id);
    push({ at: num(c.created_at), type: "closed_correction", sessionId: sid, registerId: regFor(sid), actor: strOrNull(c.created_by_name), amount: num(c.amount), detail: String(c.reason), ref: `cc-${c.id}` });
  }
  for (const c of await rowsOf(sql`SELECT * FROM tpv_adv_counts WHERE ${within("created_at")}`)) {
    const k = toCount(c);
    push({ at: k.createdAt, type: "count", sessionId: k.sessionId, registerId: k.registerId, actor: k.createdByName, amount: k.cashDifference, detail: `${COUNT_KIND_LABELS[k.kind]}: contado ${eur(k.countedCash)}, esperado ${eur(k.expectedCash)}`, ref: `ar-${k.id}` });
  }
  for (const r of await rowsOf(sql`SELECT * FROM tpv_adv_shifts WHERE (${within("started_at")}) OR (${within("ended_at")})`)) {
    const t = toShift(r);
    if (t.startedAt >= fromMs && t.startedAt < toMs) push({ at: t.startedAt, type: "shift_start", sessionId: t.sessionId, registerId: t.registerId, actor: t.operatorName, amount: t.openingCash, detail: `Efectivo al empezar ${eur(t.openingCash)}`, ref: `ts-${t.id}` });
    if (t.endedAt !== null && t.endedAt >= fromMs && t.endedAt < toMs) push({ at: t.endedAt, type: "shift_end", sessionId: t.sessionId, registerId: t.registerId, actor: t.operatorName, amount: t.closingCash, detail: `Efectivo al acabar ${eur(t.closingCash ?? 0)}`, ref: `te-${t.id}` });
  }
  for (const r of await rowsOf(sql`SELECT * FROM tpv_adv_handovers WHERE (${within("declared_at")}) OR (${within("received_at")}) OR (${within("cancelled_at")})`)) {
    const h = toHandover(r);
    if (h.declaredAt >= fromMs && h.declaredAt < toMs) push({ at: h.declaredAt, type: "handover_declared", sessionId: h.sessionId, registerId: h.registerId, actor: h.fromName, amount: h.declaredCash, detail: `Entrega ${eur(h.declaredCash)}${h.toName ? ` a ${h.toName}` : ""}`, ref: `hd-${h.id}` });
    if (h.receivedAt !== null && h.receivedAt >= fromMs && h.receivedAt < toMs) push({ at: h.receivedAt, type: "handover_received", sessionId: h.sessionId, registerId: h.registerId, actor: h.toName, amount: h.difference, detail: `${HANDOVER_STATUS_LABELS[h.status]}: recibido ${eur(h.receivedCash ?? 0)} de ${h.fromName}`, ref: `hr-${h.id}` });
    if (h.cancelledAt !== null && h.cancelledAt >= fromMs && h.cancelledAt < toMs) push({ at: h.cancelledAt, type: "handover_cancelled", sessionId: h.sessionId, registerId: h.registerId, actor: h.fromName, amount: h.declaredCash, detail: "Entrega anulada antes de recibirla", ref: `hc-${h.id}` });
  }
  const authRows = await rowsOf(sql`SELECT * FROM tpv_adv_authorizations WHERE (${within("requested_at")}) OR (${within("decided_at")})`);
  await regOfSession(authRows.filter((r) => r.session_id != null).map((r) => Number(r.session_id)));
  for (const r of authRows) {
    const a = toAuth(r);
    const reg = a.sessionId ? regFor(a.sessionId) : null;
    if (a.requestedAt >= fromMs && a.requestedAt < toMs) push({ at: a.requestedAt, type: "auth_requested", sessionId: a.sessionId, registerId: reg, actor: a.requestedByName, amount: a.amount, detail: `${AUTH_KIND_LABELS[a.kind]}: ${a.reason}`, ref: `aq-${a.id}` });
    if (a.decidedAt !== null && a.decidedAt >= fromMs && a.decidedAt < toMs) push({ at: a.decidedAt, type: "auth_decided", sessionId: a.sessionId, registerId: reg, actor: a.decidedByName, amount: a.amount, detail: `${a.status === "rejected" ? "Denegada" : "Autorizada"}: ${AUTH_KIND_LABELS[a.kind]} (pedida por ${a.requestedByName})`, ref: `ad-${a.id}` });
  }
  const recCorr = (await rowsOf(sql`SELECT * FROM tpv_adv_corrections WHERE ${within("created_at")}`)).map(toRecordCorrection);
  await regOfSession(recCorr.map((c) => c.sessionId));
  for (const c of recCorr) {
    push({ at: c.createdAt, type: "record_correction", sessionId: c.sessionId, registerId: regFor(c.sessionId), actor: c.createdByName, amount: c.amount, detail: `${CORRECTION_TARGET_LABELS[c.targetKind]} n.º ${c.targetId}: ${c.reason}`, ref: `rc-${c.id}` });
  }
  const list = sortAudit(filterAudit(ev, { types: f.types, registerId: f.registerId, actor: f.actor }));
  return { events: list.slice(0, AUDIT_MAX_EVENTS), truncated: list.length > AUDIT_MAX_EVENTS };
}

// ─── Informes ────────────────────────────────────────────────────────────────

export interface ShiftReportRow {
  shiftId: number;
  sessionId: number;
  register: string;
  operator: string;
  operatorUserId: number;
  status: "open" | "closed";
  startedAt: number;
  endedAt: number | null;
  minutes: number;
  openingCash: number;
  closingCash: number | null;
  sales: number;
  salesTotal: number;
  cash: number;
  card: number;
  bizum: number;
  other: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  difference: number | null;
}

/**
 * Por turno: lo cobrado y los movimientos del intervalo del turno dentro de su sesión, el efectivo esperado al acabar
 * (al empezar + efectivo cobrado + entradas − salidas) y la diferencia con lo declarado.
 */
export async function shiftsReport(f: { from: string; to: string; registerId?: number | null }): Promise<ShiftReportRow[]> {
  const { fromMs, toMs } = rangeOf(f.from, f.to);
  const regs = new Map((await rowsOf(sql`SELECT id, name FROM cash_registers`)).map((r) => [Number(r.id), String(r.name)]));
  const shifts = (await rowsOf(sql`SELECT * FROM tpv_adv_shifts WHERE started_at >= ${fromMs} AND started_at < ${toMs} ${f.registerId ? sql`AND register_id = ${f.registerId}` : sql``} ORDER BY started_at LIMIT 5000`)).map(toShift);
  if (!shifts.length) return [];
  const sessionIds = Array.from(new Set(shifts.map((s) => s.sessionId)));
  const inList = sql.join(sessionIds.map((i) => sql`${i}`), sql`, `);
  const pays = await rowsOf(sql`SELECT s.id AS saleId, s.sessionId, COALESCE(s.paidAt, s.createdAt) AS at, s.total, p.method_tsp AS method, p.amount_tsp AS amount
    FROM tpv_sales s JOIN tpv_sale_payments p ON p.saleId = s.id AND p.status_tsp = 'completed'
    WHERE s.sessionId IN (${inList}) AND s.status_ts IN ('paid', 'cancelled', 'refunded')`);
  const moves = await rowsOf(sql`SELECT sessionId, type_cm, amount, createdAt FROM cash_movements WHERE sessionId IN (${inList})`);
  const now = Date.now();
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return shifts.map((t) => {
    const end = t.endedAt ?? now;
    const inShift = (at: number, sid: number) => sid === t.sessionId && at >= t.startedAt && at < end;
    const by: Record<ReconMethod, number> = { cash: 0, card: 0, bizum: 0, other: 0 };
    const sales = new Map<number, number>();
    for (const p of pays) {
      if (!inShift(num(p.at), Number(p.sessionId))) continue;
      const m = String(p.method);
      const k: ReconMethod = (RECON_METHODS as readonly string[]).includes(m) ? (m as ReconMethod) : "other";
      by[k] += num(p.amount);
      sales.set(Number(p.saleId), num(p.total));
    }
    let cashIn = 0;
    let cashOut = 0;
    for (const m of moves) {
      if (!inShift(num(m.createdAt), Number(m.sessionId))) continue;
      if (String(m.type_cm) === "in") cashIn += num(m.amount);
      else cashOut += num(m.amount);
    }
    const expectedCash = r2(t.openingCash + by.cash + cashIn - cashOut);
    return {
      shiftId: t.id,
      sessionId: t.sessionId,
      register: regs.get(t.registerId) ?? `Caja ${t.registerId}`,
      operator: t.operatorName,
      operatorUserId: t.operatorUserId,
      status: t.status,
      startedAt: t.startedAt,
      endedAt: t.endedAt,
      minutes: Math.max(0, Math.round((end - t.startedAt) / 60_000)),
      openingCash: t.openingCash,
      closingCash: t.closingCash,
      sales: sales.size,
      salesTotal: r2(Array.from(sales.values()).reduce((a, b) => a + b, 0)),
      cash: r2(by.cash),
      card: r2(by.card),
      bizum: r2(by.bizum),
      other: r2(by.other),
      cashIn: r2(cashIn),
      cashOut: r2(cashOut),
      expectedCash,
      difference: t.closingCash === null ? null : moneyDiff(t.closingCash, expectedCash),
    };
  });
}

export interface OperatorReportRow {
  operatorUserId: number;
  operator: string;
  shifts: number;
  minutes: number;
  sales: number;
  salesTotal: number;
  shiftDifference: number;
  handoversGiven: number;
  handoversReceived: number;
  handoverDifference: number;
  counts: number;
  countDifference: number;
}

/** Por operador: sus turnos, ventas, diferencias de turno, entregas (dadas y recibidas) y arqueos del periodo. */
export async function operatorsReport(f: { from: string; to: string; registerId?: number | null }): Promise<OperatorReportRow[]> {
  const { fromMs, toMs } = rangeOf(f.from, f.to);
  const reg = f.registerId ? sql`AND register_id = ${f.registerId}` : sql``;
  const out = new Map<number, OperatorReportRow>();
  const get = (id: number, name: string) => {
    let r = out.get(id);
    if (!r) out.set(id, (r = { operatorUserId: id, operator: name, shifts: 0, minutes: 0, sales: 0, salesTotal: 0, shiftDifference: 0, handoversGiven: 0, handoversReceived: 0, handoverDifference: 0, counts: 0, countDifference: 0 }));
    return r;
  };
  for (const s of await shiftsReport(f)) {
    const r = get(s.operatorUserId, s.operator);
    r.shifts += 1;
    r.minutes += s.minutes;
    r.sales += s.sales;
    r.salesTotal += s.salesTotal;
    r.shiftDifference += s.difference ?? 0;
  }
  for (const h of (await rowsOf(sql`SELECT * FROM tpv_adv_handovers WHERE declared_at >= ${fromMs} AND declared_at < ${toMs} AND status <> 'cancelled' ${reg}`)).map(toHandover)) {
    get(h.fromUserId, h.fromName).handoversGiven += 1;
    if (h.toUserId !== null && h.receivedAt !== null) {
      const r = get(h.toUserId, h.toName ?? `Usuario ${h.toUserId}`);
      r.handoversReceived += 1;
      r.handoverDifference += h.difference ?? 0;
    }
  }
  for (const c of (await rowsOf(sql`SELECT * FROM tpv_adv_counts WHERE created_at >= ${fromMs} AND created_at < ${toMs} ${reg}`)).map(toCount)) {
    if (c.createdBy === null) continue;
    const r = get(c.createdBy, c.createdByName ?? `Usuario ${c.createdBy}`);
    r.counts += 1;
    r.countDifference += c.cashDifference;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return Array.from(out.values())
    .map((r) => ({ ...r, salesTotal: r2(r.salesTotal), shiftDifference: r2(r.shiftDifference), handoverDifference: r2(r.handoverDifference), countDifference: r2(r.countDifference) }))
    .sort((a, b) => a.operator.localeCompare(b.operator, "es"));
}

export interface CountReportRow extends CountRow {
  register: string;
}

export async function countsReport(f: { from: string; to: string; registerId?: number | null }): Promise<CountReportRow[]> {
  const { fromMs, toMs } = rangeOf(f.from, f.to);
  const regs = new Map((await rowsOf(sql`SELECT id, name FROM cash_registers`)).map((r) => [Number(r.id), String(r.name)]));
  return (await rowsOf(sql`SELECT * FROM tpv_adv_counts WHERE created_at >= ${fromMs} AND created_at < ${toMs} ${f.registerId ? sql`AND register_id = ${f.registerId}` : sql``} ORDER BY created_at LIMIT 5000`))
    .map(toCount)
    .map((c) => ({ ...c, register: regs.get(c.registerId) ?? `Caja ${c.registerId}` }));
}

export async function handoversReport(f: { from: string; to: string; registerId?: number | null }): Promise<(HandoverRow & { register: string })[]> {
  const { fromMs, toMs } = rangeOf(f.from, f.to);
  const regs = new Map((await rowsOf(sql`SELECT id, name FROM cash_registers`)).map((r) => [Number(r.id), String(r.name)]));
  return (await rowsOf(sql`SELECT * FROM tpv_adv_handovers WHERE declared_at >= ${fromMs} AND declared_at < ${toMs} ${f.registerId ? sql`AND register_id = ${f.registerId}` : sql``} ORDER BY declared_at LIMIT 5000`))
    .map(toHandover)
    .map((h) => ({ ...h, register: regs.get(h.registerId) ?? `Caja ${h.registerId}` }));
}

export async function authorizationsReport(f: { from: string; to: string }): Promise<AuthorizationRow[]> {
  const { fromMs, toMs } = rangeOf(f.from, f.to);
  return (await rowsOf(sql`SELECT * FROM tpv_adv_authorizations WHERE requested_at >= ${fromMs} AND requested_at < ${toMs} ORDER BY requested_at LIMIT 5000`)).map(toAuth);
}
