/**
 * Social Token Net · Tokens internos (capacidad `social-token-net-tokens`) — acceso a datos. Lógica pura en
 * shared/loyalty.ts.
 *
 * Núcleo adaptado de Segolife (server/segolife/tokens/tokenLedgerService.ts → `postMovementInTx`): la ÚNICA función que
 * escribe monedero + libro, siempre en la misma transacción.
 *  - Atomicidad: monedero y libro se actualizan juntos o no se actualiza nada.
 *  - Concurrencia: el monedero se lee con `SELECT … FOR UPDATE`; dos movimientos simultáneos del mismo cliente quedan
 *    serializados por MySQL. Las lecturas dentro de la sección crítica son de bloqueo (ven lo último confirmado).
 *  - Idempotencia: cada movimiento lleva una clave única (documento origen, reversión del movimiento o clave de la
 *    operación del panel). Repetirla devuelve el movimiento existente sin repetir el efecto.
 *  - Inmutabilidad: un movimiento nunca se edita; una corrección es un movimiento nuevo de signo contrario.
 *  - Saldo nunca negativo en operaciones ordinarias (canje, ajuste). Única excepción (Segolife, política de reversión):
 *    anular una emisión ya gastada puede dejar el saldo en negativo; las siguientes emisiones lo compensan.
 *
 * Dónde se emiten puntos (compras CONFIRMADAS, nunca movimientos bancarios propios):
 *  - Venta del TPV con cliente del CRM: dentro de la transacción del cobro (tpv.createSale), junto al inventario. Si la
 *    venta se identifica solo por correo, al enlazar el cliente tras el cobro (misma clave: nunca dos veces).
 *  - Pedido de la tienda online pagado: al confirmarse el pago (notificación de Redsys).
 *  - Anulaciones y devoluciones (módulo de anulaciones y control diario): se anula la emisión, una sola vez.
 * Sin la capacidad activa o con el programa desactivado, no se emite nada. Las tablas (migración
 * db/migrations/0026_loyalty_tokens) no están en drizzle/schema.ts a propósito, como el inventario: sin ellas, nada
 * cambia en ventas ni pedidos.
 */
import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { madridDateKey, madridMidnightMs } from "./utils/timezone";
import { clientCommunityIds, stnIntegrationActive } from "./stnIntegration";
import {
  LOYALTY_CAPABILITY,
  addMonthsMs,
  applyCampaignToAmount,
  clampCampaignExtra,
  computePurchaseBase,
  expiredPoints,
  findActionRule,
  findApplicableCampaign,
  periodStartKey,
  type LedgerKind,
  type LimitPeriod,
  type CampaignScope,
  type LoyaltyCampaign,
  type LoyaltyRule,
  type PurchaseLine,
  type RuleCalc,
  type RuleScope,
  type RuleTrigger,
} from "../shared/loyalty";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type LoyaltyExec = Pick<Db, "execute">;

export interface Actor {
  id: number | null;
  name: string | null;
}

async function db(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

async function rows<T>(exec: LoyaltyExec, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}

async function header(exec: LoyaltyExec, q: SQL): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: r.affectedRows ?? 0, insertId: Number(r.insertId ?? 0) };
}

/** Empresa sin la migración 0026: no hay programa de puntos (todo como siempre). */
export function isMissingLoyaltySchema(e: unknown): boolean {
  for (let x: any = e, depth = 0; x && depth < 5; x = x.cause, depth++) {
    if (x.code === "ER_NO_SUCH_TABLE" || x.code === "ER_BAD_FIELD_ERROR") return true;
  }
  return false;
}

function isDuplicateKey(e: unknown): boolean {
  for (let x: any = e, depth = 0; x && depth < 5; x = x.cause, depth++) {
    if (x.code === "ER_DUP_ENTRY" || x.errno === 1062) return true;
  }
  return false;
}

/** ¿Incluye la empresa los tokens internos? (`write`: activa; sin `write`: activa o solo lectura). Si no puede verificarse, no. */
export async function loyaltyLicensed(write: boolean): Promise<boolean> {
  try {
    return (await getCapabilityAccess().check(LOYALTY_CAPABILITY, { write })).allowed;
  } catch {
    return false;
  }
}

export async function assertLoyalty(write: boolean): Promise<void> {
  if (!(await loyaltyLicensed(write))) throw new TRPCError({ code: "FORBIDDEN", message: "Los tokens internos no están incluidos en tu plan." });
}

/** Ejecuta en una transacción (o en la que ya está en curso). */
async function inTx<T>(fn: (tx: LoyaltyExec) => Promise<T>, exec?: LoyaltyExec): Promise<T> {
  if (exec) return fn(exec);
  const d = await db();
  return d.transaction((tx) => fn(tx as unknown as LoyaltyExec));
}

const n = (v: unknown): number => Number(v ?? 0);
const nOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

// ─── Programa ────────────────────────────────────────────────────────────────

export interface Program {
  enabled: boolean;
  pointsName: string;
  eqPoints: number | null;
  eqEuros: number | null;
  expiryMonths: number | null;
  updatedAt: number | null;
  updatedBy: string | null;
}

const DEFAULT_PROGRAM: Program = { enabled: false, pointsName: "puntos", eqPoints: null, eqEuros: null, expiryMonths: null, updatedAt: null, updatedBy: null };

export async function getProgram(exec?: LoyaltyExec): Promise<Program> {
  const [r] = await rows<any>(exec ?? (await db()), sql`SELECT enabled, points_name, eq_points, eq_euros, expiry_months, updated_at, updated_by FROM loyalty_program WHERE id = 1`);
  if (!r) return { ...DEFAULT_PROGRAM };
  return {
    enabled: !!n(r.enabled),
    pointsName: r.points_name || "puntos",
    eqPoints: nOrNull(r.eq_points),
    eqEuros: nOrNull(r.eq_euros),
    expiryMonths: nOrNull(r.expiry_months),
    updatedAt: nOrNull(r.updated_at),
    updatedBy: r.updated_by ?? null,
  };
}

export async function saveProgram(p: Omit<Program, "updatedAt" | "updatedBy">, actor: Actor): Promise<Program> {
  const d = await db();
  const now = Date.now();
  await d.execute(sql`INSERT INTO loyalty_program (id, enabled, points_name, eq_points, eq_euros, expiry_months, updated_at, updated_by)
    VALUES (1, ${p.enabled ? 1 : 0}, ${p.pointsName}, ${p.eqPoints}, ${p.eqEuros}, ${p.expiryMonths}, ${now}, ${actor.name})
    ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), points_name = VALUES(points_name), eq_points = VALUES(eq_points), eq_euros = VALUES(eq_euros),
      expiry_months = VALUES(expiry_months), updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)`);
  return getProgram(d);
}

// ─── Núcleo: monedero + libro ────────────────────────────────────────────────

export type Direction = "credit" | "debit";

export interface MovementInput {
  clientId: number;
  kind: LedgerKind;
  direction: Direction;
  /** Siempre positivo: `direction` decide el signo. */
  amount: number;
  reason?: string | null;
  sourceType: string;
  sourceId?: string | null;
  sourceRef?: string | null;
  ruleId?: number | null;
  campaignId?: number | null;
  /** Puntos extra de campaña incluidos en el movimiento (negativos en la anulación). */
  campaignPoints?: number;
  reversesId?: number | null;
  expiresAt?: number | null;
  idemKey?: string | null;
  metadata?: Record<string, unknown> | null;
  actor: Actor;
  /** SOLO la anulación de una emisión: puede dejar el saldo en negativo. */
  allowNegative?: boolean;
}

export interface MovementResult {
  applied: boolean;
  ledgerId: number;
  amount: number;
  balance: number;
}

export class LoyaltyError extends TRPCError {
  constructor(public reasonCode: "INVALID_AMOUNT" | "INSUFFICIENT_BALANCE" | "NOT_FOUND" | "ALREADY_REVERSED" | "REASON_REQUIRED" | "PROGRAM_DISABLED", message: string) {
    super({ code: reasonCode === "NOT_FOUND" ? "NOT_FOUND" : reasonCode === "ALREADY_REVERSED" ? "CONFLICT" : "BAD_REQUEST", message });
  }
}

/**
 * Crea el monedero del cliente si no existía, FUERA de la transacción del movimiento (conexión propia, confirmación
 * inmediata). Así la transacción solo bloquea una fila que ya existe: crearlo dentro (INSERT IGNORE + FOR UPDATE)
 * interbloquea dos movimientos simultáneos del mismo cliente.
 */
export async function ensureWallet(clientId: number): Promise<void> {
  const d = await db();
  const [w] = await rows<any>(d, sql`SELECT id FROM loyalty_wallets WHERE client_id = ${clientId}`);
  if (w) return;
  const now = Date.now();
  await d.execute(sql`INSERT IGNORE INTO loyalty_wallets (client_id, balance, lifetime_earned, lifetime_spent, created_at, updated_at) VALUES (${clientId}, 0, 0, 0, ${now}, ${now})`);
}

type WalletLock = { id: number; balance: number; lifetimeEarned: number; lifetimeSpent: number };

/** Monedero del cliente bloqueado para esta transacción. Si aún no existe (no se llamó a ensureWallet), se crea aquí. */
async function lockWallet(tx: LoyaltyExec, clientId: number, now: number): Promise<WalletLock> {
  const read = async () => (await rows<any>(tx, sql`SELECT id, balance, lifetime_earned, lifetime_spent FROM loyalty_wallets WHERE client_id = ${clientId} FOR UPDATE`))[0];
  let w = await read();
  if (!w) {
    await tx.execute(sql`INSERT IGNORE INTO loyalty_wallets (client_id, balance, lifetime_earned, lifetime_spent, created_at, updated_at) VALUES (${clientId}, 0, 0, 0, ${now}, ${now})`);
    w = await read();
  }
  return { id: n(w.id), balance: n(w.balance), lifetimeEarned: n(w.lifetime_earned), lifetimeSpent: n(w.lifetime_spent) };
}

/**
 * Movimiento ya aplicado con esa clave. Lectura sin bloqueo (un SELECT … FOR UPDATE de una clave que no existe bloquea
 * el hueco del índice e interbloquea movimientos de clientes distintos); si la lectura no lo ve, la clave única corta
 * el INSERT y se relee con bloqueo (`locking`), que sí ve lo último confirmado.
 */
async function existingByKey(tx: LoyaltyExec, idemKey: string, locking = false): Promise<MovementResult | null> {
  const [e] = await rows<any>(tx, locking
    ? sql`SELECT l.id, l.amount, l.balance_after FROM loyalty_ledger l WHERE l.idem_key = ${idemKey} LOCK IN SHARE MODE`
    : sql`SELECT l.id, l.amount, l.balance_after FROM loyalty_ledger l WHERE l.idem_key = ${idemKey}`);
  if (!e) return null;
  const [w] = await rows<any>(tx, sql`SELECT w.balance FROM loyalty_wallets w JOIN loyalty_ledger l ON l.wallet_id = w.id WHERE l.id = ${e.id}`);
  return { applied: false, ledgerId: n(e.id), amount: n(e.amount), balance: n(w?.balance ?? e.balance_after) };
}

/** Escribe un movimiento dentro de una transacción ya abierta. Nunca llamar fuera de una transacción. */
export async function postMovementInTx(tx: LoyaltyExec, m: MovementInput): Promise<MovementResult> {
  if (!Number.isInteger(m.amount) || m.amount <= 0) throw new LoyaltyError("INVALID_AMOUNT", "El importe de puntos debe ser un entero positivo");
  const now = Date.now();
  const wallet = await lockWallet(tx, m.clientId, now);
  const idemKey = m.idemKey ? m.idemKey.slice(0, 160) : null;
  if (idemKey) {
    const prev = await existingByKey(tx, idemKey);
    if (prev) return prev;
  }
  const delta = m.direction === "credit" ? m.amount : -m.amount;
  const balance = wallet.balance + delta;
  if (m.direction === "debit" && balance < 0 && !m.allowNegative) {
    throw new LoyaltyError("INSUFFICIENT_BALANCE", `Saldo insuficiente: hay ${wallet.balance} y se intentan descontar ${m.amount}`);
  }
  let ledgerId: number;
  try {
    ledgerId = (await header(tx, sql`INSERT INTO loyalty_ledger (wallet_id, client_id, kind, direction, amount, balance_after, campaign_points, reason, source_type, source_id, source_ref, rule_id, campaign_id, reverses_id, expires_at, idem_key, metadata, user_id, user_name, created_at)
      VALUES (${wallet.id}, ${m.clientId}, ${m.kind}, ${m.direction}, ${m.amount}, ${balance}, ${m.campaignPoints ?? 0}, ${m.reason?.slice(0, 300) ?? null}, ${m.sourceType},
        ${m.sourceId?.slice(0, 64) ?? null}, ${m.sourceRef?.slice(0, 100) ?? null}, ${m.ruleId ?? null}, ${m.campaignId ?? null}, ${m.reversesId ?? null}, ${m.expiresAt ?? null},
        ${idemKey}, ${m.metadata ? JSON.stringify(m.metadata) : null}, ${m.actor.id}, ${m.actor.name?.slice(0, 200) ?? null}, ${now})`)).insertId;
  } catch (e) {
    if (idemKey && isDuplicateKey(e)) {
      const prev = await existingByKey(tx, idemKey, true);
      if (prev) return prev;
    }
    throw e;
  }
  // Acumulados (Segolife): una anulación corrige el contador que infló el movimiento original, nunca infla el contrario
  const isReversal = m.reversesId != null;
  const earned = isReversal && m.direction === "debit" ? Math.max(0, wallet.lifetimeEarned - m.amount) : !isReversal && m.direction === "credit" && m.kind !== "ajuste" ? wallet.lifetimeEarned + m.amount : wallet.lifetimeEarned;
  const spent = isReversal && m.direction === "credit" ? Math.max(0, wallet.lifetimeSpent - m.amount) : !isReversal && m.direction === "debit" && m.kind === "canje" ? wallet.lifetimeSpent + m.amount : wallet.lifetimeSpent;
  await tx.execute(sql`UPDATE loyalty_wallets SET balance = ${balance}, lifetime_earned = ${earned}, lifetime_spent = ${spent}, updated_at = ${now} WHERE id = ${wallet.id}`);
  return { applied: true, ledgerId, amount: m.amount, balance };
}

/**
 * Caducidad: los puntos emitidos caducan a los meses configurados. Con los canjes consumiendo primero lo más antiguo,
 * el saldo que excede de los créditos aún vigentes está caducado y se descuenta con un movimiento «caducidad». Se
 * aplica al leer el monedero, antes de cada descuento y desde el panel.
 */
export async function expireWalletInTx(tx: LoyaltyExec, clientId: number, now = Date.now()): Promise<number> {
  const [w] = await rows<any>(tx, sql`SELECT balance FROM loyalty_wallets WHERE client_id = ${clientId} FOR UPDATE`);
  if (!w || n(w.balance) <= 0) return 0;
  const wallet = { balance: n(w.balance) };
  const [hasExpiring] = await rows<any>(tx, sql`SELECT id FROM loyalty_ledger WHERE client_id = ${clientId} AND direction = 'credit' AND expires_at IS NOT NULL AND expires_at <= ${now} LIMIT 1 FOR SHARE`);
  if (!hasExpiring) return 0;
  const [valid] = await rows<any>(tx, sql`SELECT COALESCE(SUM(amount), 0) AS v FROM loyalty_ledger WHERE client_id = ${clientId} AND direction = 'credit' AND (expires_at IS NULL OR expires_at > ${now}) FOR SHARE`);
  const expired = expiredPoints(wallet.balance, n(valid?.v));
  if (expired <= 0) return 0;
  await postMovementInTx(tx, { clientId, kind: "caducidad", direction: "debit", amount: expired, reason: "Puntos caducados", sourceType: "expiry", sourceId: madridDateKey(new Date(now)), actor: { id: null, name: "Sistema" } });
  return expired;
}

export async function expireWallet(clientId: number): Promise<number> {
  try {
    const [w] = await rows<any>(await db(), sql`SELECT balance FROM loyalty_wallets WHERE client_id = ${clientId}`);
    if (!w || n(w.balance) <= 0) return 0;
    return await inTx((tx) => expireWalletInTx(tx, clientId));
  } catch (e) {
    if (isMissingLoyaltySchema(e)) return 0;
    throw e;
  }
}

/** Procesa la caducidad de todos los monederos con saldo (panel). */
export async function expireAllWallets(): Promise<{ wallets: number; points: number }> {
  const d = await db();
  const list = await rows<{ client_id: number }>(d, sql`SELECT DISTINCT w.client_id FROM loyalty_wallets w JOIN loyalty_ledger l ON l.client_id = w.client_id
    WHERE w.balance > 0 AND l.direction = 'credit' AND l.expires_at IS NOT NULL AND l.expires_at <= ${Date.now()}`);
  let wallets = 0;
  let points = 0;
  for (const r of list) {
    const p = await expireWallet(n(r.client_id));
    if (p > 0) {
      wallets++;
      points += p;
    }
  }
  return { wallets, points };
}

// ─── Reglas y campañas ───────────────────────────────────────────────────────

function toRule(r: any): LoyaltyRule {
  return {
    id: n(r.id), name: r.name, trigger: (r.trigger_kind === "action" ? "action" : "purchase") as RuleTrigger, actionKey: r.action_key ?? null,
    scope: (["all", "product", "category"].includes(r.scope) ? r.scope : "all") as RuleScope, scopeId: nOrNull(r.scope_id),
    calc: (["per_euro", "percentage", "fixed"].includes(r.calc) ? r.calc : "per_euro") as RuleCalc, rate: nOrNull(r.rate), fixedPoints: nOrNull(r.fixed_points),
    minSpend: nOrNull(r.min_spend), maxPoints: nOrNull(r.max_points), limitCount: nOrNull(r.limit_count), limitPeriod: (r.limit_period ?? null) as LimitPeriod | null,
    priority: n(r.priority), active: !!n(r.active), startsAt: nOrNull(r.starts_at), endsAt: nOrNull(r.ends_at),
  };
}

function toCampaign(r: any): LoyaltyCampaign {
  return {
    // Un alcance desconocido nunca pasa a «todas»: «community» se conserva y solo se aplica con la integración activa
    id: n(r.id), name: r.name, scope: (["all", "product", "category", "community"].includes(r.scope) ? r.scope : "community") as CampaignScope, scopeId: nOrNull(r.scope_id),
    multiplier: nOrNull(r.multiplier), bonusPoints: nOrNull(r.bonus_points), budgetPoints: nOrNull(r.budget_points), perClientLimit: nOrNull(r.per_client_limit),
    limitPeriod: (r.limit_period ?? null) as LimitPeriod | null, priority: n(r.priority), active: !!n(r.active), startsAt: nOrNull(r.starts_at), endsAt: nOrNull(r.ends_at),
  };
}

export async function listRules(exec?: LoyaltyExec, onlyActive = false): Promise<LoyaltyRule[]> {
  const r = await rows<any>(exec ?? (await db()), onlyActive ? sql`SELECT * FROM loyalty_rules WHERE active = 1 ORDER BY priority DESC, id` : sql`SELECT * FROM loyalty_rules ORDER BY active DESC, priority DESC, id`);
  return r.map(toRule);
}

export async function listCampaigns(exec?: LoyaltyExec, onlyActive = false): Promise<LoyaltyCampaign[]> {
  const r = await rows<any>(exec ?? (await db()), onlyActive ? sql`SELECT * FROM loyalty_campaigns WHERE active = 1 ORDER BY priority DESC, id` : sql`SELECT * FROM loyalty_campaigns ORDER BY active DESC, priority DESC, id`);
  return r.map(toCampaign);
}

export type RuleInput = Omit<LoyaltyRule, "id">;
export type CampaignInput = Omit<LoyaltyCampaign, "id">;

export async function saveRule(id: number | null, r: RuleInput): Promise<{ id: number }> {
  const d = await db();
  const now = Date.now();
  if (id) {
    const res = await header(d, sql`UPDATE loyalty_rules SET name = ${r.name}, trigger_kind = ${r.trigger}, action_key = ${r.actionKey}, scope = ${r.scope}, scope_id = ${r.scopeId}, calc = ${r.calc},
      rate = ${r.rate}, fixed_points = ${r.fixedPoints}, min_spend = ${r.minSpend}, max_points = ${r.maxPoints}, limit_count = ${r.limitCount}, limit_period = ${r.limitPeriod},
      priority = ${r.priority}, active = ${r.active ? 1 : 0}, starts_at = ${r.startsAt}, ends_at = ${r.endsAt}, updated_at = ${now} WHERE id = ${id}`);
    if (!res.affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "Regla no encontrada" });
    return { id };
  }
  const res = await header(d, sql`INSERT INTO loyalty_rules (name, trigger_kind, action_key, scope, scope_id, calc, rate, fixed_points, min_spend, max_points, limit_count, limit_period, priority, active, starts_at, ends_at, created_at, updated_at)
    VALUES (${r.name}, ${r.trigger}, ${r.actionKey}, ${r.scope}, ${r.scopeId}, ${r.calc}, ${r.rate}, ${r.fixedPoints}, ${r.minSpend}, ${r.maxPoints}, ${r.limitCount}, ${r.limitPeriod}, ${r.priority}, ${r.active ? 1 : 0}, ${r.startsAt}, ${r.endsAt}, ${now}, ${now})`);
  return { id: res.insertId };
}

export async function saveCampaign(id: number | null, c: CampaignInput): Promise<{ id: number }> {
  const d = await db();
  const now = Date.now();
  if (id) {
    const res = await header(d, sql`UPDATE loyalty_campaigns SET name = ${c.name}, scope = ${c.scope}, scope_id = ${c.scopeId}, multiplier = ${c.multiplier}, bonus_points = ${c.bonusPoints},
      budget_points = ${c.budgetPoints}, per_client_limit = ${c.perClientLimit}, limit_period = ${c.limitPeriod}, priority = ${c.priority}, active = ${c.active ? 1 : 0},
      starts_at = ${c.startsAt}, ends_at = ${c.endsAt}, updated_at = ${now} WHERE id = ${id}`);
    if (!res.affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "Campaña no encontrada" });
    return { id };
  }
  const res = await header(d, sql`INSERT INTO loyalty_campaigns (name, scope, scope_id, multiplier, bonus_points, budget_points, per_client_limit, limit_period, priority, active, starts_at, ends_at, created_at, updated_at)
    VALUES (${c.name}, ${c.scope}, ${c.scopeId}, ${c.multiplier}, ${c.bonusPoints}, ${c.budgetPoints}, ${c.perClientLimit}, ${c.limitPeriod}, ${c.priority}, ${c.active ? 1 : 0}, ${c.startsAt}, ${c.endsAt}, ${now}, ${now})`);
  return { id: res.insertId };
}

/** Puntos extra de campaña ya concedidos (las anulaciones restan). */
export async function campaignUsage(exec?: LoyaltyExec): Promise<Map<number, number>> {
  const r = await rows<any>(exec ?? (await db()), sql`SELECT campaign_id, COALESCE(SUM(campaign_points), 0) AS used FROM loyalty_ledger WHERE campaign_id IS NOT NULL GROUP BY campaign_id`);
  return new Map(r.map((x) => [n(x.campaign_id), n(x.used)]));
}

export function periodSinceMs(period: LimitPeriod | null, now: number): number | null {
  const key = periodStartKey(period ?? "lifetime", madridDateKey(new Date(now)));
  return key ? madridMidnightMs(key) : null;
}

/**
 * Puntos extra de una campaña sobre unos puntos base (orden de Segolife): la campaña se bloquea (`FOR UPDATE`, siempre
 * DESPUÉS del monedero) y se recorta por lo que queda de su presupuesto y del límite por cliente en el periodo. Dentro de
 * la transacción del movimiento. La usan las compras y los puntos por participar en comunidades.
 */
export async function campaignExtraInTx(tx: LoyaltyExec, candidate: LoyaltyCampaign | null, base: number, clientId: number, now: number): Promise<{ campaign: LoyaltyCampaign | null; extra: number; requestedExtra: number }> {
  let campaign = candidate;
  if (campaign) {
    const [locked] = await rows<any>(tx, sql`SELECT * FROM loyalty_campaigns WHERE id = ${campaign.id} FOR UPDATE`);
    campaign = locked && n(locked.active) ? toCampaign(locked) : null;
  }
  if (!campaign) return { campaign: null, extra: 0, requestedExtra: 0 };
  const requestedExtra = applyCampaignToAmount(campaign, base) - base;
  let budgetRemaining: number | null = null;
  if (campaign.budgetPoints != null) {
    const [u] = await rows<any>(tx, sql`SELECT COALESCE(SUM(campaign_points), 0) AS used FROM loyalty_ledger WHERE campaign_id = ${campaign.id} FOR SHARE`);
    budgetRemaining = campaign.budgetPoints - n(u?.used);
  }
  let perClientRemaining: number | null = null;
  if (campaign.perClientLimit != null) {
    const since = periodSinceMs(campaign.limitPeriod, now);
    const [u] = await rows<any>(tx, since == null
      ? sql`SELECT COALESCE(SUM(campaign_points), 0) AS used FROM loyalty_ledger WHERE campaign_id = ${campaign.id} AND client_id = ${clientId} FOR SHARE`
      : sql`SELECT COALESCE(SUM(campaign_points), 0) AS used FROM loyalty_ledger WHERE campaign_id = ${campaign.id} AND client_id = ${clientId} AND created_at >= ${since} FOR SHARE`);
    perClientRemaining = campaign.perClientLimit - n(u?.used);
  }
  return { campaign, extra: clampCampaignExtra(requestedExtra, { perClientRemaining, budgetRemaining }), requestedExtra };
}

// ─── Emisión por compras confirmadas ─────────────────────────────────────────

export interface PurchaseDocument {
  /** `hotel_folio`: folio de Hotel Net cerrado con factura (server/loyaltySectors.ts). */
  sourceType: "tpv_sale" | "reservation" | "hotel_folio";
  sourceId: string;
  sourceRef?: string | null;
  clientId: number | null;
  /** Líneas con su importe (impuestos incluidos, descuentos aplicados). `categoryId` se resuelve aquí si falta. */
  lines: PurchaseLine[];
  actor: Actor;
}

export interface IssueResult {
  points: number;
  ledgerId: number;
  balance: number;
  pointsName: string;
  applied: boolean;
}

/** Categoría de los productos del catálogo de esas líneas (las que no la traen). */
async function withCategories(exec: LoyaltyExec, lines: PurchaseLine[]): Promise<PurchaseLine[]> {
  const ids = Array.from(new Set(lines.filter((l) => l.productId && l.categoryId == null).map((l) => l.productId!)));
  if (!ids.length) return lines;
  const r = await rows<{ id: number; categoryId: number }>(exec, sql`SELECT id, categoryId FROM experiences WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  const cat = new Map(r.map((x) => [n(x.id), n(x.categoryId)]));
  // Un id que no es del catálogo de productos (pack, artículo libre) solo cuenta para las reglas «todas las compras»
  return lines.map((l) => (l.productId && l.categoryId == null ? (cat.has(l.productId) ? { ...l, categoryId: cat.get(l.productId)! } : { ...l, productId: null }) : l));
}

/**
 * Emite los puntos de una compra confirmada (orden de Segolife: regla base → campaña → límites → libro). Idempotente
 * por documento. `exec`: la transacción del cobro (lo emitido se deshace con ella). Sin cliente, sin licencia activa,
 * con el programa desactivado o sin regla aplicable, no hace nada y devuelve null.
 */
export async function issuePurchasePoints(doc: PurchaseDocument, exec?: LoyaltyExec): Promise<IssueResult | null> {
  if (!doc.clientId || !doc.lines.some((l) => l.amount > 0)) return null;
  if (!(await loyaltyLicensed(true))) return null;
  try {
    const program0 = await getProgram();
    if (!program0.enabled) return null;
    // Campañas «miembros de una comunidad»: solo con comunidades y tokens a la vez (Social Token Net Complete)
    const communityIds = (await stnIntegrationActive(true)) ? await clientCommunityIds(doc.clientId) : null;
    await ensureWallet(doc.clientId);
    return await inTx(async (tx) => {
      const program = await getProgram(tx);
      if (!program.enabled) return null;
      const now = Date.now();
      const lines = await withCategories(tx, doc.lines);
      const breakdown = computePurchaseBase(await listRules(tx, true), lines, now);
      if (breakdown.base <= 0) return null;
      const clientId = doc.clientId!;
      // Orden fijo de bloqueo: monedero y después campaña (nunca al revés)
      await lockWallet(tx, clientId, now);
      const idemKey = `${doc.sourceType}:${doc.sourceId}`;
      const prev = await existingByKey(tx, idemKey);
      if (prev) return { points: prev.amount, ledgerId: prev.ledgerId, balance: prev.balance, pointsName: program.pointsName, applied: false };

      const { campaign, extra, requestedExtra } = await campaignExtraInTx(tx, findApplicableCampaign(await listCampaigns(tx, true), lines, now, { communityIds }), breakdown.base, clientId, now);
      const points = breakdown.base + extra;
      const res = await postMovementInTx(tx, {
        clientId, kind: "emision", direction: "credit", amount: points, reason: breakdown.byRule.map((r) => r.ruleName).join(" · ").slice(0, 300) || "Compra",
        sourceType: doc.sourceType, sourceId: doc.sourceId, sourceRef: doc.sourceRef ?? null, ruleId: breakdown.byRule[0]?.ruleId ?? null,
        campaignId: extra > 0 ? campaign!.id : null, campaignPoints: extra, expiresAt: program.expiryMonths ? addMonthsMs(now, program.expiryMonths) : null,
        idemKey, metadata: { byRule: breakdown.byRule, base: breakdown.base, campaignId: campaign?.id ?? null, campaignExtraRequested: requestedExtra, campaignExtra: extra },
        actor: doc.actor,
      });
      return { points: res.amount, ledgerId: res.ledgerId, balance: res.balance, pointsName: program.pointsName, applied: res.applied };
    }, exec);
  } catch (e) {
    if (isMissingLoyaltySchema(e)) return null;
    throw e;
  }
}

/** Puntos de una venta del TPV ya cobrada cuyo cliente se ha enlazado después (por correo). Nunca rompe la venta. */
export async function issueTpvSalePointsAfterLink(saleId: number, actor: Actor): Promise<IssueResult | null> {
  try {
    const d = await db();
    const [sale] = await rows<any>(d, sql`SELECT id, ticketNumber, clientId, status_ts AS status, subtotal, total FROM tpv_sales WHERE id = ${saleId}`);
    if (!sale || sale.status !== "paid" || !sale.clientId) return null;
    const items = await rows<any>(d, sql`SELECT productType_tsi AS productType, productId, subtotal_tsi AS subtotal, is_manual FROM tpv_sale_items WHERE saleId = ${saleId}`);
    const sum = items.reduce((s, i) => s + n(i.subtotal), 0);
    const ratio = sum > 0 ? n(sale.total) / sum : 1;
    return await issuePurchasePoints({
      sourceType: "tpv_sale", sourceId: String(saleId), sourceRef: sale.ticketNumber, clientId: n(sale.clientId), actor,
      lines: items.map((i) => ({ productId: i.productType === "experience" && !n(i.is_manual) && n(i.productId) > 0 ? n(i.productId) : null, categoryId: null, amount: n(i.subtotal) * ratio })),
    });
  } catch (e) {
    console.error("[Fidelización] No se pudieron emitir los puntos de la venta", saleId, (e as Error).message);
    return null;
  }
}

/**
 * Pedido de la tienda online pagado: emite los puntos de cada línea (reserva) pagada del pedido, para su cliente del
 * CRM (enlazado o por su correo). Idempotente: una notificación de pago repetida no emite dos veces.
 */
export async function applyOnlineOrderPoints(merchantOrder: string): Promise<number> {
  if (!(await loyaltyLicensed(true))) return 0;
  try {
    const d = await db();
    const lines = await rows<any>(d, sql`SELECT r.id, r.product_id, r.amount_total, r.amount_paid, r.reservation_number, COALESCE(r.client_id, c.id) AS client_id
      FROM reservations r LEFT JOIN clients c ON c.email = r.customer_email
      WHERE r.merchant_order = ${merchantOrder} AND r.status = 'paid' AND r.channel = 'ONLINE_DIRECTO' ORDER BY r.id`);
    let issued = 0;
    for (const r of lines) {
      if (!r.client_id) continue;
      const cents = n(r.amount_paid) > 0 ? n(r.amount_paid) : n(r.amount_total);
      const res = await issuePurchasePoints({
        sourceType: "reservation", sourceId: String(r.id), sourceRef: r.reservation_number ?? merchantOrder, clientId: n(r.client_id),
        lines: [{ productId: n(r.product_id) || null, categoryId: null, amount: cents / 100 }], actor: { id: null, name: "Tienda online" },
      });
      if (res?.applied) issued += res.points;
    }
    return issued;
  } catch (e) {
    if (isMissingLoyaltySchema(e)) return 0;
    throw e;
  }
}

// ─── Acciones permitidas ─────────────────────────────────────────────────────

/** Puntos por una acción permitida (alta, reseña, encuesta…). Idempotente por acción y clave; respeta el límite de la regla. */
export async function awardActionPoints(input: { clientId: number; action: string; key: string; actor: Actor; note?: string | null }): Promise<IssueResult> {
  await assertClient(input.clientId);
  await ensureWallet(input.clientId);
  return inTx(async (tx) => {
    const program = await getProgram(tx);
    if (!program.enabled) throw new LoyaltyError("PROGRAM_DISABLED", "Activa el programa de puntos antes de premiar acciones.");
    const now = Date.now();
    const rule = findActionRule(await listRules(tx, true), input.action, now);
    if (!rule) throw new TRPCError({ code: "BAD_REQUEST", message: "No hay ninguna regla activa que premie esa acción." });
    const points = Math.min(rule.calc === "fixed" ? rule.fixedPoints ?? 0 : 0, rule.maxPoints ?? Number.MAX_SAFE_INTEGER);
    if (points <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "La regla de esa acción no da puntos (usa puntos fijos)." });
    await lockWallet(tx, input.clientId, now);
    const idemKey = `action:${input.action}:${input.key}`;
    const prev = await existingByKey(tx, idemKey);
    if (prev) return { points: prev.amount, ledgerId: prev.ledgerId, balance: prev.balance, pointsName: program.pointsName, applied: false };
    if (rule.limitCount != null) {
      const since = periodSinceMs(rule.limitPeriod, now);
      const [c] = await rows<any>(tx, since == null
        ? sql`SELECT COUNT(*) AS c FROM loyalty_ledger WHERE rule_id = ${rule.id} AND client_id = ${input.clientId} AND kind = 'emision' FOR SHARE`
        : sql`SELECT COUNT(*) AS c FROM loyalty_ledger WHERE rule_id = ${rule.id} AND client_id = ${input.clientId} AND kind = 'emision' AND created_at >= ${since} FOR SHARE`);
      if (n(c?.c) >= rule.limitCount) throw new TRPCError({ code: "BAD_REQUEST", message: "Este cliente ya ha alcanzado el límite de esa acción en el periodo." });
    }
    const res = await postMovementInTx(tx, {
      clientId: input.clientId, kind: "emision", direction: "credit", amount: points, reason: [rule.name, input.note].filter(Boolean).join(" · ").slice(0, 300),
      sourceType: "action", sourceId: input.key, sourceRef: input.action, ruleId: rule.id, expiresAt: program.expiryMonths ? addMonthsMs(now, program.expiryMonths) : null,
      idemKey, actor: input.actor,
    });
    return { points: res.amount, ledgerId: res.ledgerId, balance: res.balance, pointsName: program.pointsName, applied: res.applied };
  });
}

// ─── Ajustes y anulaciones ───────────────────────────────────────────────────

async function assertClient(clientId: number): Promise<void> {
  const [c] = await rows<any>(await db(), sql`SELECT id FROM clients WHERE id = ${clientId}`);
  if (!c) throw new LoyaltyError("NOT_FOUND", "Cliente no encontrado");
}

/** Ajuste manual con motivo (solo administración). Nunca deja el saldo en negativo. */
export async function adjustPoints(input: { clientId: number; direction: Direction; amount: number; reason: string; key: string; actor: Actor }): Promise<MovementResult> {
  if (!input.reason.trim()) throw new LoyaltyError("REASON_REQUIRED", "El ajuste necesita un motivo");
  await assertClient(input.clientId);
  await ensureWallet(input.clientId);
  return inTx(async (tx) => {
    if (input.direction === "debit") await expireWalletInTx(tx, input.clientId);
    return postMovementInTx(tx, {
      clientId: input.clientId, kind: "ajuste", direction: input.direction, amount: input.amount, reason: input.reason, sourceType: "manual", sourceId: input.key,
      idemKey: `manual:${input.key}`, actor: input.actor,
    });
  });
}

/** Anula un movimiento (emisión, ajuste o canje) con otro de signo contrario. Una sola vez. */
export async function reverseMovementInTx(tx: LoyaltyExec, ledgerId: number, reason: string, actor: Actor): Promise<MovementResult> {
  const [o] = await rows<any>(tx, sql`SELECT * FROM loyalty_ledger WHERE id = ${ledgerId}`);
  if (!o) throw new LoyaltyError("NOT_FOUND", "Movimiento no encontrado");
  if (!["emision", "ajuste", "canje"].includes(o.kind)) throw new TRPCError({ code: "BAD_REQUEST", message: "Ese movimiento no se puede anular" });
  await lockWallet(tx, n(o.client_id), Date.now());
  const prev = await existingByKey(tx, `rev:${ledgerId}`);
  if (prev) return prev;
  return postMovementInTx(tx, {
    clientId: n(o.client_id), kind: "anulacion", direction: o.direction === "credit" ? "debit" : "credit", amount: n(o.amount), reason,
    sourceType: o.source_type ?? "reversal", sourceId: o.source_id ?? null, sourceRef: o.source_ref ?? null, ruleId: nOrNull(o.rule_id), campaignId: nOrNull(o.campaign_id),
    campaignPoints: -n(o.campaign_points), reversesId: ledgerId, idemKey: `rev:${ledgerId}`, actor,
    // Anular una emisión ya gastada puede dejar el saldo en negativo (deuda que compensan las siguientes emisiones)
    allowNegative: o.direction === "credit",
  });
}

export async function reverseMovement(ledgerId: number, reason: string, actor: Actor): Promise<MovementResult> {
  if (!reason.trim()) throw new LoyaltyError("REASON_REQUIRED", "La anulación necesita un motivo");
  return inTx(async (tx) => {
    const [r] = await rows<any>(tx, sql`SELECT id FROM loyalty_ledger WHERE reverses_id = ${ledgerId} LIMIT 1`);
    if (r) throw new LoyaltyError("ALREADY_REVERSED", "Ese movimiento ya está anulado");
    const [o] = await rows<any>(tx, sql`SELECT kind FROM loyalty_ledger WHERE id = ${ledgerId}`);
    // Un canje se anula desde su canje (anula también el código); aquí devolvería los puntos con el código aún válido
    if (o?.kind === "canje") throw new TRPCError({ code: "BAD_REQUEST", message: "Los canjes se anulan desde la pestaña Canjes (así el código deja de valer)." });
    return reverseMovementInTx(tx, ledgerId, reason, actor);
  });
}

/**
 * Anula los puntos emitidos por esos documentos (anulación o devolución). Una sola vez por movimiento: repetirlo no
 * descuenta dos veces. No exige la capacidad: si se emitió, se anula.
 */
export async function reverseSources(sources: Array<{ sourceType: "tpv_sale" | "reservation"; sourceId: string }>, actor: Actor, reason: string): Promise<number> {
  if (!sources.length) return 0;
  try {
    const d = await db();
    let applied = 0;
    for (const s of sources) {
      const list = await rows<{ id: number }>(d, sql`SELECT id FROM loyalty_ledger WHERE source_type = ${s.sourceType} AND source_id = ${s.sourceId} AND kind = 'emision' ORDER BY id`);
      for (const m of list) {
        const res = await inTx((tx) => reverseMovementInTx(tx, n(m.id), reason, actor));
        if (res.applied) applied++;
      }
    }
    return applied;
  } catch (e) {
    if (isMissingLoyaltySchema(e)) return 0;
    throw e;
  }
}

/** Anula los puntos de una venta del TPV anulada. Nunca rompe la anulación: un fallo se registra y se sigue. */
export async function reverseTpvSalePoints(saleId: number, actor: Actor): Promise<void> {
  try {
    await reverseSources([{ sourceType: "tpv_sale", sourceId: String(saleId) }], actor, "Venta del TPV anulada");
  } catch (e) {
    console.error("[Fidelización] No se pudieron anular los puntos de la venta", saleId, (e as Error).message);
  }
}

/** Anula los puntos de una reserva o pedido anulado (y de la venta del TPV que la originó, si la hay). Nunca rompe la anulación. */
export async function reverseReservationPoints(reservationIds: number[], actor: Actor, reason = "Pedido o reserva anulada"): Promise<void> {
  const ids = reservationIds.filter((x) => Number.isInteger(x) && x > 0);
  if (!ids.length) return;
  try {
    const d = await db();
    const sales = await rows<{ id: number }>(d, sql`SELECT id FROM tpv_sales WHERE reservationId IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    await reverseSources(
      [...ids.map((i) => ({ sourceType: "reservation" as const, sourceId: String(i) })), ...sales.map((s) => ({ sourceType: "tpv_sale" as const, sourceId: String(s.id) }))],
      actor,
      reason,
    );
  } catch (e) {
    console.error("[Fidelización] No se pudieron anular los puntos de", ids.join(","), (e as Error).message);
  }
}

// ─── Consultas del panel ─────────────────────────────────────────────────────

export interface WalletRow {
  clientId: number;
  name: string;
  email: string;
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  updatedAt: number;
}

export async function listWallets(f: { search?: string; limit: number; offset: number }): Promise<{ items: WalletRow[]; total: number }> {
  const d = await db();
  const like = f.search?.trim() ? `%${f.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const where = like ? sql`(c.name LIKE ${like} OR c.email LIKE ${like})` : sql`1 = 1`;
  const [count] = await rows<any>(d, sql`SELECT COUNT(*) AS t FROM loyalty_wallets w JOIN clients c ON c.id = w.client_id WHERE ${where}`);
  const list = await rows<any>(d, sql`SELECT w.client_id, c.name, c.email, w.balance, w.lifetime_earned, w.lifetime_spent, w.updated_at
    FROM loyalty_wallets w JOIN clients c ON c.id = w.client_id WHERE ${where} ORDER BY w.updated_at DESC, w.id DESC LIMIT ${f.limit} OFFSET ${f.offset}`);
  return {
    total: n(count?.t),
    items: list.map((w) => ({ clientId: n(w.client_id), name: w.name, email: w.email, balance: n(w.balance), lifetimeEarned: n(w.lifetime_earned), lifetimeSpent: n(w.lifetime_spent), updatedAt: n(w.updated_at) })),
  };
}

export interface LedgerRow {
  id: number;
  kind: LedgerKind;
  direction: Direction;
  amount: number;
  balanceAfter: number;
  campaignPoints: number;
  reason: string | null;
  sourceType: string | null;
  sourceId: string | null;
  sourceRef: string | null;
  ruleId: number | null;
  campaignId: number | null;
  reversesId: number | null;
  reversed: boolean;
  expiresAt: number | null;
  userName: string | null;
  createdAt: number;
}

export async function clientLedger(clientId: number, limit = 100, offset = 0): Promise<LedgerRow[]> {
  const d = await db();
  const list = await rows<any>(d, sql`SELECT l.*, (SELECT r.id FROM loyalty_ledger r WHERE r.reverses_id = l.id LIMIT 1) AS reversed_by
    FROM loyalty_ledger l WHERE l.client_id = ${clientId} ORDER BY l.created_at DESC, l.id DESC LIMIT ${limit} OFFSET ${offset}`);
  return list.map((l) => ({
    id: n(l.id), kind: l.kind, direction: l.direction, amount: n(l.amount), balanceAfter: n(l.balance_after), campaignPoints: n(l.campaign_points), reason: l.reason ?? null,
    sourceType: l.source_type ?? null, sourceId: l.source_id ?? null, sourceRef: l.source_ref ?? null, ruleId: nOrNull(l.rule_id), campaignId: nOrNull(l.campaign_id),
    reversesId: nOrNull(l.reverses_id), reversed: l.reversed_by != null, expiresAt: nOrNull(l.expires_at), userName: l.user_name ?? null, createdAt: n(l.created_at),
  }));
}

export async function walletOf(clientId: number): Promise<{ clientId: number; name: string; email: string; balance: number; lifetimeEarned: number; lifetimeSpent: number } | null> {
  const d = await db();
  const [c] = await rows<any>(d, sql`SELECT c.id, c.name, c.email, w.balance, w.lifetime_earned, w.lifetime_spent FROM clients c LEFT JOIN loyalty_wallets w ON w.client_id = c.id WHERE c.id = ${clientId}`);
  if (!c) return null;
  return { clientId: n(c.id), name: c.name, email: c.email, balance: n(c.balance), lifetimeEarned: n(c.lifetime_earned), lifetimeSpent: n(c.lifetime_spent) };
}

/** Clientes del CRM para elegir titular (buscador del panel). */
export async function searchClients(q: string): Promise<Array<{ id: number; name: string; email: string }>> {
  const d = await db();
  const like = `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const r = await rows<any>(d, sql`SELECT id, name, email FROM clients WHERE name LIKE ${like} OR email LIKE ${like} ORDER BY name LIMIT 20`);
  return r.map((c) => ({ id: n(c.id), name: c.name, email: c.email }));
}

/** Productos y categorías del catálogo (para el alcance de reglas y campañas). */
export async function catalogOptions() {
  const d = await db();
  const products = await rows<any>(d, sql`SELECT id, title FROM experiences ORDER BY title`);
  const categories = await rows<any>(d, sql`SELECT id, name FROM categories ORDER BY name`);
  return { products: products.map((p) => ({ id: n(p.id), title: p.title as string })), categories: categories.map((c) => ({ id: n(c.id), name: c.name as string })) };
}

export interface LoyaltyStats {
  issued: number;
  redeemed: number;
  expired: number;
  adjustedIn: number;
  adjustedOut: number;
  reversed: number;
  outstanding: number;
  wallets: number;
  walletsWithBalance: number;
  last30Issued: number;
  last30Redeemed: number;
  monthly: Array<{ month: string; issued: number; redeemed: number }>;
}

export async function stats(): Promise<LoyaltyStats> {
  const d = await db();
  const sums = await rows<any>(d, sql`SELECT kind, direction, COALESCE(SUM(amount), 0) AS s FROM loyalty_ledger GROUP BY kind, direction`);
  const sum = (kind: string, dir: Direction) => n(sums.find((x) => x.kind === kind && x.direction === dir)?.s);
  const [w] = await rows<any>(d, sql`SELECT COUNT(*) AS c, COALESCE(SUM(balance), 0) AS b, COALESCE(SUM(balance > 0), 0) AS p FROM loyalty_wallets`);
  const since30 = Date.now() - 30 * 86_400_000;
  const recent = await rows<any>(d, sql`SELECT kind, COALESCE(SUM(amount), 0) AS s FROM loyalty_ledger WHERE created_at >= ${since30} AND kind IN ('emision', 'canje') GROUP BY kind`);
  const since6 = Date.now() - 185 * 86_400_000;
  const monthlyRows = await rows<any>(d, sql`SELECT created_at, kind, amount FROM loyalty_ledger WHERE created_at >= ${since6} AND kind IN ('emision', 'canje')`);
  const months = new Map<string, { issued: number; redeemed: number }>();
  for (const m of monthlyRows) {
    const key = madridDateKey(new Date(n(m.created_at))).slice(0, 7);
    const acc = months.get(key) ?? { issued: 0, redeemed: 0 };
    if (m.kind === "emision") acc.issued += n(m.amount);
    else acc.redeemed += n(m.amount);
    months.set(key, acc);
  }
  return {
    issued: sum("emision", "credit"),
    redeemed: sum("canje", "debit"),
    expired: sum("caducidad", "debit"),
    adjustedIn: sum("ajuste", "credit"),
    adjustedOut: sum("ajuste", "debit"),
    reversed: sum("anulacion", "debit"),
    outstanding: n(w?.b),
    wallets: n(w?.c),
    walletsWithBalance: n(w?.p),
    last30Issued: n(recent.find((x) => x.kind === "emision")?.s),
    last30Redeemed: n(recent.find((x) => x.kind === "canje")?.s),
    monthly: Array.from(months.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v })),
  };
}
