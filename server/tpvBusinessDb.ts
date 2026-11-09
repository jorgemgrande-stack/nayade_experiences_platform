/**
 * Caja de Business y Enterprise (estrategia TPV del 09/11/2026), migración 0064. Lo decide siempre el servidor:
 *  - Operadores por caja (Business, `registerOperators`): con alguno asignado, solo ellos y la administración del
 *    TPV operan esa caja. El rol `supervisor` por caja es la gestión avanzada de permisos (Enterprise).
 *  - Devoluciones y anulaciones autorizadas (Business, `authorizedReturns`): el operador la pide con motivo y un
 *    supervisor (permiso `tpv.authorize` o supervisor de esa caja) la aprueba, y se ejecuta, o la rechaza.
 *  - Supervisión centralizada e informes consolidados por establecimiento (Enterprise).
 * Si la empresa baja de plan, las asignaciones y solicitudes se conservan y dejan de aplicarse (nada se borra).
 */
import { TRPCError } from "@trpc/server";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { cashRegisters, cashSessions, tpvSales, users } from "../drizzle/schema";
import { legacyDb } from "./_core/legacyDb";
import { checkPermission } from "./customRolesAccess";
import { cancelTpvSale } from "./routers/dailyControl";
import { companySites } from "./sitesDb";
import { siteOfStored } from "../shared/sites";
import { companyCutoff, isDuplicateKeyError, registerOperationalDay, tpvFeatureEnabled } from "./tpvRulesDb";
import { receivedSaleCondition } from "./tpvSessionTotals";

const db = legacyDb();
type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const [r] = (await db.execute(q)) as unknown as [Row[]];
  return Array.isArray(r) ? r : [];
}
type Actor = { id: number; role: string; name?: string | null; email?: string | null };
const actorName = (u: Actor) => u.name ?? u.email ?? null;
const roleOf = (u: Actor) => String(u.role);

// ─── Operadores por caja ──────────────────────────────────────────────────────

export const OPERATOR_ROLES = ["operator", "supervisor"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export interface RegisterOperator {
  registerId: number;
  userId: number;
  role: OperatorRole;
  name: string | null;
  email: string | null;
}

export async function listRegisterOperators(registerId?: number): Promise<RegisterOperator[]> {
  const list = await rows(sql`SELECT o.register_id, o.user_id, o.role, u.name, u.email FROM tpv_register_operators o
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.removed_at IS NULL ${registerId ? sql`AND o.register_id = ${registerId}` : sql``} ORDER BY o.register_id, o.id`);
  return list.map((r) => ({ registerId: Number(r.register_id), userId: Number(r.user_id), role: (r.role === "supervisor" ? "supervisor" : "operator") as OperatorRole, name: r.name == null ? null : String(r.name), email: r.email == null ? null : String(r.email) }));
}

/**
 * Fija los operadores de una caja (lista completa). Los retirados se marcan con fecha (no se borran). El rol
 * `supervisor` exige Enterprise (gestión avanzada de permisos).
 */
export async function setRegisterOperators(registerId: number, wanted: Array<{ userId: number; role: OperatorRole }>, actor: Actor): Promise<RegisterOperator[]> {
  if (!(await tpvFeatureEnabled("registerOperators"))) throw new TRPCError({ code: "FORBIDDEN", message: "Operadores y permisos por caja forma parte del plan Business. Puedes ampliar tu plan desde «Suscripción»." });
  if (wanted.some((w) => w.role === "supervisor") && !(await tpvFeatureEnabled("advancedPermissions"))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Los supervisores por caja forman parte de la gestión avanzada de permisos del plan Enterprise. Puedes ampliar tu plan desde «Suscripción»." });
  }
  const [reg] = await db.select({ id: cashRegisters.id }).from(cashRegisters).where(eq(cashRegisters.id, registerId));
  if (!reg) throw new TRPCError({ code: "NOT_FOUND", message: "La caja no existe" });
  const ids = Array.from(new Set(wanted.map((w) => w.userId)));
  if (ids.length) {
    const found = await db.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), eq(users.isActive, true)));
    if (found.length !== ids.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Algún usuario no existe o está desactivado" });
  }
  const now = Date.now();
  const current = await listRegisterOperators(registerId);
  const want = new Map(wanted.map((w) => [w.userId, w.role]));
  for (const c of current) {
    const role = want.get(c.userId);
    if (role === undefined) {
      await db.execute(sql`UPDATE tpv_register_operators SET removed_at = ${now}, removed_by = ${actor.id}, active_key = NULL WHERE register_id = ${registerId} AND user_id = ${c.userId} AND removed_at IS NULL`);
    } else if (role !== c.role) {
      await db.execute(sql`UPDATE tpv_register_operators SET role = ${role} WHERE register_id = ${registerId} AND user_id = ${c.userId} AND removed_at IS NULL`);
    }
  }
  for (const [userId, role] of Array.from(want.entries())) {
    if (current.some((c) => c.userId === userId)) continue;
    try {
      await db.execute(sql`INSERT INTO tpv_register_operators (register_id, user_id, role, created_by, created_at, active_key) VALUES (${registerId}, ${userId}, ${role}, ${actor.id}, ${now}, ${`${registerId}:${userId}`})`);
    } catch (e) {
      if (!isDuplicateKeyError(e)) throw e; // ya asignado por otra petición a la vez
    }
  }
  return listRegisterOperators(registerId);
}

async function isTpvAdmin(user: Actor): Promise<boolean> {
  const role = roleOf(user);
  return checkPermission(user.id, role, "tpv.backoffice", ["admin"]);
}

/**
 * ¿Puede este usuario operar la caja? Sin operadores asignados (o sin la función en el plan), como siempre.
 * Con operadores: solo ellos y la administración del TPV.
 */
export async function assertRegisterOperator(registerId: number, user: Actor): Promise<void> {
  const ops = await rows(sql`SELECT user_id FROM tpv_register_operators WHERE register_id = ${registerId} AND removed_at IS NULL`);
  if (!ops.length) return;
  if (ops.some((o) => Number(o.user_id) === user.id)) return;
  if (!(await tpvFeatureEnabled("registerOperators").catch(() => true))) return;
  if (await isTpvAdmin(user)) return;
  throw new TRPCError({ code: "FORBIDDEN", message: "Esta caja tiene operadores asignados y no estás entre ellos. Pide a la administración que te asigne." });
}

export async function assertSessionOperator(sessionId: number, user: Actor): Promise<void> {
  const [s] = await db.select({ registerId: cashSessions.registerId }).from(cashSessions).where(eq(cashSessions.id, sessionId));
  if (s) await assertRegisterOperator(s.registerId, user);
}

/** ¿Puede autorizar devoluciones y anulaciones de esa caja? Permiso `tpv.authorize` o supervisor de la caja (Enterprise). */
export async function canAuthorizeReturns(registerId: number, user: Actor): Promise<boolean> {
  const role = roleOf(user);
  if (await checkPermission(user.id, role, "tpv.authorize", ["admin"])) return true;
  if (!(await tpvFeatureEnabled("advancedPermissions").catch(() => false))) return false;
  const [r] = await rows(sql`SELECT 1 AS x FROM tpv_register_operators WHERE register_id = ${registerId} AND user_id = ${user.id} AND role = 'supervisor' AND removed_at IS NULL`);
  return !!r;
}

// ─── Devoluciones y anulaciones autorizadas ──────────────────────────────────

export const RETURN_ACTIONS = ["cancel", "refund"] as const;
export type ReturnAction = (typeof RETURN_ACTIONS)[number];

export interface ReturnRequest {
  id: number;
  saleId: number;
  ticketNumber: string | null;
  sessionId: number;
  registerId: number;
  action: ReturnAction;
  amount: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedBy: number | null;
  requestedByName: string | null;
  decidedByName: string | null;
  decisionNotes: string | null;
  decidedAt: number | null;
  createdAt: number;
}
const toRequest = (r: Row): ReturnRequest => ({
  id: Number(r.id),
  saleId: Number(r.sale_id),
  ticketNumber: r.ticketNumber == null ? null : String(r.ticketNumber),
  sessionId: Number(r.session_id),
  registerId: Number(r.register_id),
  action: (r.action === "refund" ? "refund" : "cancel") as ReturnAction,
  amount: Number(r.amount),
  reason: String(r.reason),
  status: String(r.status) as ReturnRequest["status"],
  requestedBy: r.requested_by == null ? null : Number(r.requested_by),
  requestedByName: r.requested_by_name == null ? null : String(r.requested_by_name),
  decidedByName: r.decided_by_name == null ? null : String(r.decided_by_name),
  decisionNotes: r.decision_notes == null ? null : String(r.decision_notes),
  decidedAt: r.decided_at == null ? null : Number(r.decided_at),
  createdAt: Number(r.created_at),
});
const SELECT_REQ = sql`SELECT q.*, s.ticketNumber FROM tpv_return_requests q LEFT JOIN tpv_sales s ON s.id = q.sale_id`;

async function requestByKey(key: string): Promise<ReturnRequest | null> {
  const [r] = await rows(sql`${SELECT_REQ} WHERE q.idempotency_key = ${key}`);
  return r ? toRequest(r) : null;
}
async function requestById(id: number): Promise<ReturnRequest | null> {
  const [r] = await rows(sql`${SELECT_REQ} WHERE q.id = ${id}`);
  return r ? toRequest(r) : null;
}

export async function assertReturnsFeature(): Promise<void> {
  if (!(await tpvFeatureEnabled("authorizedReturns"))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Devoluciones y anulaciones autorizadas forma parte del plan Business. Puedes ampliar tu plan desde «Suscripción»." });
  }
}

/** Pide una devolución o anulación (idempotente por clave; una sola pendiente por venta). */
export async function requestReturn(input: { saleId: number; action: ReturnAction; reason: string; key: string }, user: Actor): Promise<ReturnRequest> {
  await assertReturnsFeature();
  const prev = await requestByKey(input.key);
  if (prev) {
    if (prev.saleId !== input.saleId || prev.action !== input.action) throw new TRPCError({ code: "CONFLICT", message: "Esa clave ya se usó para otra solicitud" });
    return prev;
  }
  const [sale] = await db.select({ id: tpvSales.id, status: tpvSales.status, total: tpvSales.total, sessionId: tpvSales.sessionId }).from(tpvSales).where(eq(tpvSales.id, input.saleId));
  if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "Venta no encontrada" });
  if (sale.status !== "paid") throw new TRPCError({ code: "BAD_REQUEST", message: "Solo se puede devolver o anular una venta cobrada" });
  const [session] = await db.select({ registerId: cashSessions.registerId }).from(cashSessions).where(eq(cashSessions.id, sale.sessionId));
  if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sesión de caja no encontrada" });
  await assertRegisterOperator(session.registerId, user);
  try {
    await db.execute(sql`INSERT INTO tpv_return_requests (sale_id, session_id, register_id, action, amount, reason, status, requested_by, requested_by_name, idempotency_key, pending_key, created_at)
      VALUES (${sale.id}, ${sale.sessionId}, ${session.registerId}, ${input.action}, ${String(sale.total)}, ${input.reason}, 'pending', ${user.id}, ${actorName(user)}, ${input.key}, ${`sale:${sale.id}`}, ${Date.now()})`);
  } catch (e) {
    if (!isDuplicateKeyError(e)) throw e;
    const again = await requestByKey(input.key);
    if (again && again.saleId === input.saleId && again.action === input.action) return again;
    throw new TRPCError({ code: "CONFLICT", message: "Esta venta ya tiene una solicitud pendiente" });
  }
  return (await requestByKey(input.key))!;
}

export async function listReturnRequests(o: { status?: ReturnRequest["status"]; registerIds?: number[] | null }): Promise<ReturnRequest[]> {
  const list = await rows(sql`${SELECT_REQ} WHERE 1 = 1 ${o.status ? sql`AND q.status = ${o.status}` : sql``} ORDER BY q.id DESC LIMIT 200`);
  return list.map(toRequest).filter((r) => !o.registerIds || o.registerIds.includes(r.registerId));
}

/**
 * Decide una solicitud. Aprobarla la ejecuta (venta anulada o devuelta, con su reposición y la contabilidad como en el
 * Control diario). Repetir la misma decisión devuelve el resultado; nadie decide su propia solicitud.
 */
export async function decideReturn(input: { id: number; approve: boolean; notes?: string }, user: Actor): Promise<ReturnRequest> {
  await assertReturnsFeature();
  const req = await requestById(input.id);
  if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Solicitud no encontrada" });
  if (!(await canAuthorizeReturns(req.registerId, user))) throw new TRPCError({ code: "FORBIDDEN", message: "No puedes autorizar devoluciones ni anulaciones de esta caja" });
  const target = input.approve ? "approved" : "rejected";
  if (req.status !== "pending") {
    if (req.status === target) return req;
    throw new TRPCError({ code: "CONFLICT", message: "Esta solicitud ya está resuelta" });
  }
  if (req.requestedBy === user.id) throw new TRPCError({ code: "FORBIDDEN", message: "La solicitud la tiene que autorizar otra persona" });
  // Se reclama la solicitud (pending → decidida): dos supervisores a la vez no la ejecutan dos veces
  const [res] = (await db.execute(sql`UPDATE tpv_return_requests SET status = ${target}, decided_by = ${user.id}, decided_by_name = ${actorName(user)}, decision_notes = ${input.notes ?? null}, decided_at = ${Date.now()}, pending_key = NULL
    WHERE id = ${input.id} AND status = 'pending'`)) as unknown as [{ affectedRows?: number }];
  if (Number(res?.affectedRows ?? 0) !== 1) {
    const now = await requestById(input.id);
    if (now?.status === target) return now;
    throw new TRPCError({ code: "CONFLICT", message: "Esta solicitud ya está resuelta" });
  }
  if (input.approve) {
    const [sale] = await db.select({ status: tpvSales.status }).from(tpvSales).where(eq(tpvSales.id, req.saleId));
    if (sale?.status === "paid") await cancelTpvSale(req.saleId, { id: user.id, name: actorName(user) }, req.action === "refund" ? "refunded" : "cancelled");
  }
  return (await requestById(input.id))!;
}

// ─── Enterprise: supervisión centralizada e informes consolidados ────────────

export interface SiteOverview {
  siteId: string;
  siteName: string;
  registers: Array<{ id: number; name: string; isActive: boolean; openSession: { id: number; cashierName: string; openedAt: number } | null }>;
  todaySales: number;
  todayTickets: number;
  pendingReturns: number;
  closuresWithDifference: number;
}

/** Todas las cajas de todos los establecimientos, en directo (Enterprise). */
export async function supervisionOverview(): Promise<{ day: string; sites: SiteOverview[] }> {
  const sites = await companySites();
  const regs = await db.select().from(cashRegisters);
  const open = await db.select({ id: cashSessions.id, registerId: cashSessions.registerId, cashierName: cashSessions.cashierName, openedAt: cashSessions.openedAt }).from(cashSessions).where(eq(cashSessions.status, "open"));
  const company = await companyCutoff();
  const day = await registerOperationalDay(Date.now(), null, company);
  const since = Date.now() - 2 * 86_400_000;
  const recent = await db.select({ id: cashSessions.id, registerId: cashSessions.registerId, openedAt: cashSessions.openedAt }).from(cashSessions).where(gte(cashSessions.openedAt, since));
  const pending = await rows(sql`SELECT register_id, COUNT(*) AS n FROM tpv_return_requests WHERE status = 'pending' GROUP BY register_id`);
  const diffs = await rows(sql`SELECT s.registerId AS register_id, COUNT(*) AS n FROM fin_cash_closures c JOIN cash_sessions s ON s.id = c.source_entity_id
    WHERE c.source_entity_type = 'tpv_session' AND c.status_fcc = 'difference' GROUP BY s.registerId`).catch(() => [] as Row[]);
  const regById = new Map(regs.map((r) => [r.id, r]));
  const todaySessions: number[] = [];
  for (const s of recent) {
    const reg = regById.get(s.registerId);
    if (reg && (await registerOperationalDay(Number(s.openedAt), reg.cutoffTime ?? null, company)) === day) todaySessions.push(s.id);
  }
  const sales = todaySessions.length
    ? await db.select({ sessionId: tpvSales.sessionId, total: tpvSales.total }).from(tpvSales).where(and(inArray(tpvSales.sessionId, todaySessions), receivedSaleCondition()))
    : [];
  const sessionRegister = new Map(recent.map((s) => [s.id, s.registerId]));
  const siteOfReg = (id: number) => siteOfStored(regById.get(id)?.siteId ?? null, sites.primarySiteId);
  const out: SiteOverview[] = sites.sites.map((site) => ({ siteId: site.siteId, siteName: site.name, registers: [], todaySales: 0, todayTickets: 0, pendingReturns: 0, closuresWithDifference: 0 }));
  const bySite = (siteId: string) => out.find((o) => o.siteId === siteId) ?? out[0];
  for (const r of regs) {
    const s = open.find((o) => o.registerId === r.id);
    bySite(siteOfReg(r.id))?.registers.push({ id: r.id, name: r.name, isActive: r.isActive, openSession: s ? { id: s.id, cashierName: s.cashierName, openedAt: Number(s.openedAt) } : null });
  }
  for (const x of sales) {
    const site = bySite(siteOfReg(sessionRegister.get(x.sessionId) ?? 0));
    if (site) { site.todaySales += Number(x.total); site.todayTickets += 1; }
  }
  for (const p of pending) { const site = bySite(siteOfReg(Number(p.register_id))); if (site) site.pendingReturns += Number(p.n); }
  for (const d of diffs) { const site = bySite(siteOfReg(Number(d.register_id))); if (site) site.closuresWithDifference += Number(d.n); }
  for (const o of out) o.todaySales = Math.round(o.todaySales * 100) / 100;
  return { day, sites: out.filter((o) => o.registers.length > 0 || o.todayTickets > 0) };
}

/** Ventas, tickets y descuadres por establecimiento en un periodo (Enterprise). */
export async function consolidatedReport(dateFrom: string, dateTo: string): Promise<{ dateFrom: string; dateTo: string; sites: Array<{ siteId: string; siteName: string; tickets: number; total: number; sessions: number; difference: number }>; total: number; tickets: number }> {
  const from = Date.parse(`${dateFrom}T00:00:00Z`) - 86_400_000;
  const to = Date.parse(`${dateTo}T00:00:00Z`) + 2 * 86_400_000;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to - from > 400 * 86_400_000 || dateFrom > dateTo) throw new TRPCError({ code: "BAD_REQUEST", message: "Periodo no válido (como mucho un año)" });
  const sites = await companySites();
  const regs = await db.select().from(cashRegisters);
  const regById = new Map(regs.map((r) => [r.id, r]));
  const company = await companyCutoff();
  const sessions = await db.select().from(cashSessions).where(and(gte(cashSessions.openedAt, from), lte(cashSessions.openedAt, to)));
  const inRange: typeof sessions = [];
  for (const s of sessions) {
    const d = await registerOperationalDay(Number(s.openedAt), regById.get(s.registerId)?.cutoffTime ?? null, company);
    if (d >= dateFrom && d <= dateTo) inRange.push(s);
  }
  const sales = inRange.length ? await db.select({ sessionId: tpvSales.sessionId, total: tpvSales.total }).from(tpvSales).where(and(inArray(tpvSales.sessionId, inRange.map((s) => s.id)), receivedSaleCondition())) : [];
  const out = new Map(sites.sites.map((s) => [s.siteId, { siteId: s.siteId, siteName: s.name, tickets: 0, total: 0, sessions: 0, difference: 0 }]));
  const siteOfSession = new Map(inRange.map((s) => [s.id, siteOfStored(s.siteId ?? null, sites.primarySiteId)]));
  const get = (id: string) => out.get(id) ?? out.get(sites.primarySiteId)!;
  for (const s of inRange) {
    const row = get(siteOfSession.get(s.id)!);
    row.sessions += 1;
    if (s.status === "closed") row.difference += Number(s.cashDifference ?? 0);
  }
  for (const x of sales) { const row = get(siteOfSession.get(x.sessionId)!); row.tickets += 1; row.total += Number(x.total); }
  const list = Array.from(out.values()).map((r) => ({ ...r, total: Math.round(r.total * 100) / 100, difference: Math.round(r.difference * 100) / 100 }));
  return { dateFrom, dateTo, sites: list, total: Math.round(list.reduce((a, r) => a + r.total, 0) * 100) / 100, tickets: list.reduce((a, r) => a + r.tickets, 0) };
}
