/**
 * Social Token Net · Tokens internos — recompensas y canjes (STN-2). Lógica pura en shared/loyalty.ts; libro y
 * monederos en server/loyaltyDb.ts.
 *
 * Canje (adaptado de Segolife benefitPurchaseService.ts): UNA transacción — monedero bloqueado (y caducidad pendiente
 * aplicada), fila de la recompensa bloqueada (`SELECT … FOR UPDATE`: dos canjes de la última unidad quedan en serie),
 * unidades y límite por cliente contados en caliente sobre los canjes (nunca un contador aparte), movimiento «canje» del
 * libro (rechaza el saldo insuficiente) y el canje con su código. Si algo falla, no queda nada a medias.
 *
 * Validación en mostrador (adaptado de Segolife benefitRedemptionService.ts): el código es de un solo uso; se marca
 * «usado» con un UPDATE condicional (`status = 'emitido'`), así dos lecturas simultáneas del mismo código nunca ganan
 * ambas. Cada intento (también los fallidos) queda registrado.
 *
 * Anulación del canje (administración): devuelve los puntos una sola vez. Caducidad: un código no usado a tiempo pasa
 * a «caducado» y devuelve los puntos; se aplica al consultar canjes, al validar y desde el área del cliente.
 */
import crypto from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import {
  ensureWallet,
  expireWalletInTx,
  getProgram,
  isMissingLoyaltySchema,
  loyaltyLicensed,
  postMovementInTx,
  reverseMovementInTx,
  type Actor,
  type LoyaltyExec,
} from "./loyaltyDb";
import { madridDateKey, madridMidnightMs } from "./utils/timezone";
import { clientCommunityIds, stnIntegrationActive } from "./stnIntegration";
import {
  REWARD_DENIAL_MESSAGES,
  generateRedemptionCode,
  normalizeRedemptionCode,
  periodStartKey,
  rewardDenial,
  type CheckResult,
  type LimitPeriod,
  type LoyaltyReward,
  type RedemptionStatus,
} from "../shared/loyalty";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

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

async function inTx<T>(fn: (tx: LoyaltyExec) => Promise<T>): Promise<T> {
  const d = await db();
  return d.transaction((tx) => fn(tx as unknown as LoyaltyExec));
}

const n = (v: unknown): number => Number(v ?? 0);
const nOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const DAY = 86_400_000;

function isDuplicateKey(e: unknown): boolean {
  for (let x: any = e, depth = 0; x && depth < 5; x = x.cause, depth++) {
    if (x.code === "ER_DUP_ENTRY" || x.errno === 1062) return true;
  }
  return false;
}

// ─── Catálogo de recompensas ─────────────────────────────────────────────────

function toReward(r: any): LoyaltyReward {
  return {
    id: n(r.id), name: r.name, description: r.description ?? null, costPoints: n(r.cost_points), stock: nOrNull(r.stock), perClientLimit: nOrNull(r.per_client_limit),
    limitPeriod: (r.limit_period ?? null) as LimitPeriod | null, codeValidDays: n(r.code_valid_days) || 30, active: !!n(r.active), startsAt: nOrNull(r.starts_at), endsAt: nOrNull(r.ends_at),
  };
}

export type RewardInput = Omit<LoyaltyReward, "id">;

/**
 * Social Token Net Complete: comunidades a las que está reservada cada recompensa (vacío = para todos los clientes).
 * Sin la migración 0030, ninguna.
 */
export async function rewardCommunityMap(exec?: LoyaltyExec): Promise<Map<number, number[]>> {
  try {
    const r = await rows<any>(exec ?? (await db()), sql`SELECT reward_id, community_id FROM loyalty_reward_communities WHERE active = 1 ORDER BY reward_id, community_id`);
    const out = new Map<number, number[]>();
    for (const x of r) out.set(n(x.reward_id), [...(out.get(n(x.reward_id)) ?? []), n(x.community_id)]);
    return out;
  } catch (e) {
    if (isMissingLoyaltySchema(e)) return new Map();
    throw e;
  }
}

export async function listRewards(): Promise<Array<LoyaltyReward & { committed: number; used: number; communityIds: number[] }>> {
  const d = await db();
  const list = await rows<any>(d, sql`SELECT * FROM loyalty_rewards ORDER BY active DESC, cost_points, id`);
  const counts = await rows<any>(d, sql`SELECT reward_id, SUM(status IN ('emitido', 'usado')) AS committed, SUM(status = 'usado') AS used FROM loyalty_redemptions GROUP BY reward_id`);
  const byId = new Map(counts.map((c) => [n(c.reward_id), { committed: n(c.committed), used: n(c.used) }]));
  const exclusive = await rewardCommunityMap(d);
  return list.map((r) => ({ ...toReward(r), ...(byId.get(n(r.id)) ?? { committed: 0, used: 0 }), communityIds: exclusive.get(n(r.id)) ?? [] }));
}

/**
 * ¿Puede este cliente ver y canjear una recompensa exclusiva de comunidad? Solo con la integración (comunidades y
 * tokens a la vez) y siendo miembro activo de alguna de sus comunidades. Sin la integración, las exclusivas no se
 * muestran a nadie (no pasan a ser para todos) y se conservan para cuando vuelva.
 */
async function exclusiveAllowed(communityIds: number[], clientId: number | null, write: boolean): Promise<boolean> {
  if (!communityIds.length) return true;
  if (!clientId || !(await stnIntegrationActive(write))) return false;
  const mine = await clientCommunityIds(clientId);
  return communityIds.some((c) => mine.has(c));
}

export async function saveReward(id: number | null, r: RewardInput): Promise<{ id: number }> {
  const d = await db();
  const now = Date.now();
  if (id) {
    const res = await header(d, sql`UPDATE loyalty_rewards SET name = ${r.name}, description = ${r.description}, cost_points = ${r.costPoints}, stock = ${r.stock}, per_client_limit = ${r.perClientLimit},
      limit_period = ${r.limitPeriod}, code_valid_days = ${r.codeValidDays}, active = ${r.active ? 1 : 0}, starts_at = ${r.startsAt}, ends_at = ${r.endsAt}, updated_at = ${now} WHERE id = ${id}`);
    if (!res.affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "Recompensa no encontrada" });
    return { id };
  }
  const res = await header(d, sql`INSERT INTO loyalty_rewards (name, description, cost_points, stock, per_client_limit, limit_period, code_valid_days, active, starts_at, ends_at, created_at, updated_at)
    VALUES (${r.name}, ${r.description}, ${r.costPoints}, ${r.stock}, ${r.perClientLimit}, ${r.limitPeriod}, ${r.codeValidDays}, ${r.active ? 1 : 0}, ${r.startsAt}, ${r.endsAt}, ${now}, ${now})`);
  return { id: res.insertId };
}

/**
 * Recompensas que un cliente puede ver ahora (activas y vigentes), con lo que queda. Las exclusivas de comunidad, solo
 * si `clientId` es miembro (Social Token Net Complete); sin cliente, nunca.
 */
export async function availableRewards(clientId: number | null = null): Promise<Array<LoyaltyReward & { remaining: number | null; exclusive: boolean }>> {
  const now = Date.now();
  const out: Array<LoyaltyReward & { remaining: number | null; exclusive: boolean }> = [];
  for (const r of await listRewards()) {
    if (!(r.active && (r.startsAt == null || r.startsAt <= now) && (r.endsAt == null || r.endsAt >= now))) continue;
    if (!(await exclusiveAllowed(r.communityIds, clientId, false))) continue;
    const { communityIds, ...rest } = r;
    out.push({ ...rest, remaining: r.stock == null ? null : Math.max(0, r.stock - r.committed), exclusive: communityIds.length > 0 });
  }
  return out;
}

// ─── Canje ───────────────────────────────────────────────────────────────────

export interface RedeemResult {
  applied: boolean;
  redemptionId: number;
  code: string;
  expiresAt: number;
  points: number;
  balance: number;
  rewardName: string;
}

/**
 * Canjea una recompensa para un cliente del CRM. Idempotente por `key` (reenvío del formulario o doble clic).
 * `channel`: «cliente» (su área de puntos) o «panel» (el personal, con el cliente delante).
 */
export async function redeemReward(input: { clientId: number; rewardId: number; key: string; actor: Actor; channel: "cliente" | "panel" }): Promise<RedeemResult> {
  if (!(await loyaltyLicensed(true))) throw new TRPCError({ code: "FORBIDDEN", message: "Los tokens internos no están incluidos en el plan de la empresa." });
  const program = await getProgram();
  if (!program.enabled) throw new TRPCError({ code: "BAD_REQUEST", message: "El programa de puntos no está activo." });
  const idemKey = `canje:${input.key}`.slice(0, 160);
  const prev = await findRedemptionByKey(idemKey);
  if (prev) return prev;
  const [c] = await rows<any>(await db(), sql`SELECT id FROM clients WHERE id = ${input.clientId}`);
  if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente no encontrado" });
  // Recompensa exclusiva de comunidad (Social Token Net Complete): solo sus miembros
  const exclusive = (await rewardCommunityMap()).get(input.rewardId) ?? [];
  if (!(await exclusiveAllowed(exclusive, input.clientId, true))) throw new TRPCError({ code: "FORBIDDEN", message: "Esta recompensa es exclusiva para los miembros de una comunidad." });
  await ensureWallet(input.clientId);
  try {
    return await inTx(async (tx) => {
      const now = Date.now();
      // Orden fijo de bloqueo: monedero (con la caducidad pendiente) y después la recompensa
      await expireWalletInTx(tx, input.clientId, now);
      const [w] = await rows<any>(tx, sql`SELECT balance FROM loyalty_wallets WHERE client_id = ${input.clientId} FOR UPDATE`);
      const [rr] = await rows<any>(tx, sql`SELECT * FROM loyalty_rewards WHERE id = ${input.rewardId} FOR UPDATE`);
      if (!rr) throw new TRPCError({ code: "NOT_FOUND", message: "Recompensa no encontrada" });
      const reward = toReward(rr);
      const [committed] = await rows<any>(tx, sql`SELECT COUNT(*) AS c FROM loyalty_redemptions WHERE reward_id = ${reward.id} AND status IN ('emitido', 'usado') FOR SHARE`);
      let clientCommitted = 0;
      if (reward.perClientLimit != null) {
        const key = periodStartKey(reward.limitPeriod ?? "lifetime", madridDateKey(new Date(now)));
        const since = key ? madridMidnightMs(key) : 0;
        const [cc] = await rows<any>(tx, sql`SELECT COUNT(*) AS c FROM loyalty_redemptions WHERE reward_id = ${reward.id} AND client_id = ${input.clientId} AND status IN ('emitido', 'usado') AND created_at >= ${since} FOR SHARE`);
        clientCommitted = n(cc?.c);
      }
      const denial = rewardDenial(reward, { at: now, committed: n(committed?.c), clientCommitted, balance: n(w?.balance) });
      if (denial) throw new TRPCError({ code: denial === "out_of_stock" ? "CONFLICT" : "BAD_REQUEST", message: REWARD_DENIAL_MESSAGES[denial] });
      const mv = await postMovementInTx(tx, {
        clientId: input.clientId, kind: "canje", direction: "debit", amount: reward.costPoints, reason: reward.name, sourceType: "redemption", sourceId: input.key,
        idemKey, actor: input.actor,
      });
      const expiresAt = now + reward.codeValidDays * DAY;
      for (let attempt = 0; ; attempt++) {
        const code = generateRedemptionCode((len) => crypto.randomBytes(len));
        try {
          const res = await header(tx, sql`INSERT INTO loyalty_redemptions (reward_id, client_id, ledger_id, points, code, status, expires_at, channel, idem_key, created_by, created_at)
            VALUES (${reward.id}, ${input.clientId}, ${mv.ledgerId}, ${reward.costPoints}, ${code}, 'emitido', ${expiresAt}, ${input.channel}, ${idemKey}, ${input.actor.name?.slice(0, 200) ?? null}, ${now})`);
          return { applied: true, redemptionId: res.insertId, code, expiresAt, points: reward.costPoints, balance: mv.balance, rewardName: reward.name };
        } catch (e) {
          // Código repetido (improbable): se genera otro. Otro error, o demasiados intentos, deshacen el canje
          if (!isDuplicateKey(e) || attempt >= 4 || /idem/.test(String((e as any)?.sqlMessage ?? (e as any)?.cause?.sqlMessage ?? ""))) throw e;
        }
      }
    });
  } catch (e) {
    if (isDuplicateKey(e)) {
      const again = await findRedemptionByKey(idemKey);
      if (again) return again;
    }
    throw e;
  }
}

async function findRedemptionByKey(idemKey: string): Promise<RedeemResult | null> {
  const [r] = await rows<any>(await db(), sql`SELECT r.id, r.code, r.expires_at, r.points, w.balance, rw.name FROM loyalty_redemptions r
    JOIN loyalty_rewards rw ON rw.id = r.reward_id LEFT JOIN loyalty_wallets w ON w.client_id = r.client_id WHERE r.idem_key = ${idemKey}`);
  return r ? { applied: false, redemptionId: n(r.id), code: r.code, expiresAt: n(r.expires_at), points: n(r.points), balance: n(r.balance), rewardName: r.name } : null;
}

// ─── Caducidad y anulación ───────────────────────────────────────────────────

/** Cierra un canje (anulado o caducado) y devuelve sus puntos. Dentro de una transacción; una sola vez. */
async function closeRedemptionInTx(tx: LoyaltyExec, id: number, to: "anulado" | "caducado", reason: string, actor: Actor, now: number): Promise<boolean> {
  // Orden fijo de bloqueo, como en el canje: primero el monedero del cliente y después el canje
  const [owner] = await rows<any>(tx, sql`SELECT client_id FROM loyalty_redemptions WHERE id = ${id}`);
  if (!owner) throw new TRPCError({ code: "NOT_FOUND", message: "Canje no encontrado" });
  await tx.execute(sql`SELECT id FROM loyalty_wallets WHERE client_id = ${owner.client_id} FOR UPDATE`);
  const [r] = await rows<any>(tx, sql`SELECT id, ledger_id, status, expires_at FROM loyalty_redemptions WHERE id = ${id} FOR UPDATE`);
  if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Canje no encontrado" });
  const allowed = to === "caducado" ? r.status === "emitido" && n(r.expires_at) <= now : r.status === "emitido" || r.status === "usado";
  if (!allowed) return false;
  await tx.execute(sql`UPDATE loyalty_redemptions SET status = ${to}, closed_at = ${now}, close_reason = ${reason.slice(0, 300)} WHERE id = ${id}`);
  await reverseMovementInTx(tx, n(r.ledger_id), reason, actor);
  return true;
}

/** Caduca los códigos vencidos sin usar (de un cliente o de todos) y devuelve sus puntos. */
export async function expireRedemptions(clientId?: number): Promise<number> {
  try {
    const now = Date.now();
    const list = await rows<{ id: number }>(await db(), clientId
      ? sql`SELECT id FROM loyalty_redemptions WHERE status = 'emitido' AND expires_at <= ${now} AND client_id = ${clientId} ORDER BY id LIMIT 500`
      : sql`SELECT id FROM loyalty_redemptions WHERE status = 'emitido' AND expires_at <= ${now} ORDER BY id LIMIT 500`);
    let done = 0;
    for (const r of list) {
      if (await inTx((tx) => closeRedemptionInTx(tx, n(r.id), "caducado", "Código de canje caducado sin usar", { id: null, name: "Sistema" }, now))) done++;
    }
    return done;
  } catch (e) {
    if (isMissingLoyaltySchema(e)) return 0;
    throw e;
  }
}

/** Anulación de un canje (pendiente o usado) por administración: devuelve los puntos una sola vez. */
export async function cancelRedemption(id: number, reason: string, actor: Actor): Promise<{ cancelled: boolean }> {
  if (reason.trim().length < 3) throw new TRPCError({ code: "BAD_REQUEST", message: "La anulación necesita un motivo" });
  const done = await inTx((tx) => closeRedemptionInTx(tx, id, "anulado", reason.trim(), actor, Date.now()));
  if (!done) throw new TRPCError({ code: "CONFLICT", message: "Ese canje ya está anulado o caducado" });
  return { cancelled: true };
}

// ─── Validación en mostrador ─────────────────────────────────────────────────

export interface CodeView {
  result: CheckResult;
  redemptionId: number | null;
  status: RedemptionStatus | null;
  rewardName: string | null;
  points: number | null;
  clientName: string | null;
  expiresAt: number | null;
  usedAt: number | null;
  usedBy: string | null;
}

const EMPTY: CodeView = { result: "no_existe", redemptionId: null, status: null, rewardName: null, points: null, clientName: null, expiresAt: null, usedAt: null, usedBy: null };

async function viewOf(exec: LoyaltyExec, code: string, lock: boolean): Promise<Omit<CodeView, "result"> | null> {
  const [r] = await rows<any>(exec, lock
    ? sql`SELECT r.id, r.status, r.points, r.expires_at, r.used_at, r.used_by_name, r.reward_id, r.client_id FROM loyalty_redemptions r WHERE r.code = ${code} FOR UPDATE`
    : sql`SELECT r.id, r.status, r.points, r.expires_at, r.used_at, r.used_by_name, r.reward_id, r.client_id FROM loyalty_redemptions r WHERE r.code = ${code}`);
  if (!r) return null;
  const [rw] = await rows<any>(exec, sql`SELECT name FROM loyalty_rewards WHERE id = ${r.reward_id}`);
  const [cl] = await rows<any>(exec, sql`SELECT name FROM clients WHERE id = ${r.client_id}`);
  return {
    redemptionId: n(r.id), status: r.status, rewardName: rw?.name ?? null, points: n(r.points), clientName: cl?.name ?? null, expiresAt: n(r.expires_at),
    usedAt: nOrNull(r.used_at), usedBy: r.used_by_name ?? null,
  };
}

async function logCheck(redemptionId: number | null, code: string | null, result: CheckResult, actor: Actor): Promise<void> {
  try {
    // Sin el código completo: solo sus últimos 3 caracteres para reconocerlo
    await (await db()).execute(sql`INSERT INTO loyalty_redemption_checks (redemption_id, code_hint, result, user_id, user_name, created_at)
      VALUES (${redemptionId}, ${code ? `…${code.slice(-3)}` : null}, ${result}, ${actor.id}, ${actor.name?.slice(0, 200) ?? null}, ${Date.now()})`);
  } catch (e) {
    console.error("[Fidelización] No se pudo registrar la validación del código:", (e as Error).message);
  }
}

const statusResult = (s: RedemptionStatus): CheckResult => (s === "usado" ? "ya_usado" : s === "anulado" ? "anulado" : s === "caducado" ? "caducado" : "consulta");

/** Consulta un código sin usarlo (lo que verá el personal antes de entregar la recompensa). */
export async function checkCode(raw: string, actor: Actor): Promise<CodeView> {
  const code = normalizeRedemptionCode(raw);
  if (!code) {
    await logCheck(null, null, "no_existe", actor);
    return EMPTY;
  }
  await expireByCode(code);
  const v = await viewOf(await db(), code, false);
  const result: CheckResult = v ? statusResult(v.status!) : "no_existe";
  await logCheck(v?.redemptionId ?? null, code, result, actor);
  return v ? { ...v, result } : EMPTY;
}

async function expireByCode(code: string): Promise<void> {
  const [r] = await rows<any>(await db(), sql`SELECT id FROM loyalty_redemptions WHERE code = ${code} AND status = 'emitido' AND expires_at <= ${Date.now()}`);
  if (r) await inTx((tx) => closeRedemptionInTx(tx, n(r.id), "caducado", "Código de canje caducado sin usar", { id: null, name: "Sistema" }, Date.now()));
}

/**
 * Usa el código (entrega de la recompensa). Un solo uso: UPDATE condicional sobre `status = 'emitido'`. Devuelve el
 * resultado («valido» si se ha usado ahora); cualquier otro resultado significa que NO se debe entregar.
 */
export async function consumeCode(raw: string, actor: Actor): Promise<CodeView> {
  const code = normalizeRedemptionCode(raw);
  if (!code) {
    await logCheck(null, null, "no_existe", actor);
    return EMPTY;
  }
  await expireByCode(code);
  const out = await inTx(async (tx): Promise<CodeView> => {
    const v = await viewOf(tx, code, true);
    if (!v) return EMPTY;
    if (v.status !== "emitido") return { ...v, result: statusResult(v.status!) };
    const now = Date.now();
    const res = await header(tx, sql`UPDATE loyalty_redemptions SET status = 'usado', used_at = ${now}, used_by_id = ${actor.id}, used_by_name = ${actor.name?.slice(0, 200) ?? null}
      WHERE id = ${v.redemptionId} AND status = 'emitido' AND expires_at > ${now}`);
    if (res.affectedRows !== 1) return { ...v, result: "ya_usado" };
    return { ...v, status: "usado", usedAt: now, usedBy: actor.name, result: "valido" };
  });
  await logCheck(out.redemptionId, code, out.result, actor);
  return out;
}

// ─── Consultas ───────────────────────────────────────────────────────────────

export interface RedemptionRow {
  id: number;
  rewardName: string;
  clientId: number;
  clientName: string;
  points: number;
  code: string;
  status: RedemptionStatus;
  channel: string;
  expiresAt: number;
  usedAt: number | null;
  usedBy: string | null;
  closeReason: string | null;
  createdAt: number;
}

export async function listRedemptions(f: { clientId?: number; status?: RedemptionStatus; limit: number; offset: number }): Promise<{ items: RedemptionRow[]; total: number }> {
  const d = await db();
  const conds: SQL[] = [sql`1 = 1`];
  if (f.clientId) conds.push(sql`r.client_id = ${f.clientId}`);
  if (f.status) conds.push(sql`r.status = ${f.status}`);
  const where = sql.join(conds, sql` AND `);
  const [count] = await rows<any>(d, sql`SELECT COUNT(*) AS t FROM loyalty_redemptions r WHERE ${where}`);
  const list = await rows<any>(d, sql`SELECT r.*, rw.name AS reward_name, c.name AS client_name FROM loyalty_redemptions r
    LEFT JOIN loyalty_rewards rw ON rw.id = r.reward_id LEFT JOIN clients c ON c.id = r.client_id WHERE ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ${f.limit} OFFSET ${f.offset}`);
  return {
    total: n(count?.t),
    items: list.map((r) => ({
      id: n(r.id), rewardName: r.reward_name ?? `#${r.reward_id}`, clientId: n(r.client_id), clientName: r.client_name ?? `#${r.client_id}`, points: n(r.points), code: r.code,
      status: r.status, channel: r.channel, expiresAt: n(r.expires_at), usedAt: nOrNull(r.used_at), usedBy: r.used_by_name ?? null, closeReason: r.close_reason ?? null, createdAt: n(r.created_at),
    })),
  };
}
