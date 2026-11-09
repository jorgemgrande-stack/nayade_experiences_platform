/**
 * Persistencia de Ski Net · Fianzas (migración `db/migrations/0052_ski_net_fianzas.sql`) en la BD de la empresa. Tablas
 * fuera de `drizzle/schema.ts`, con SQL parametrizado (como server/lifeNetDb.ts). Si no existen (migración no
 * aplicada) se lanza `ModuleNotInstalled`.
 *
 * Toca la caja del TPV del Core solo para AÑADIR movimientos manuales (`cash_movements`) en una sesión abierta, dentro
 * de la misma transacción que cambia la fianza: o quedan los dos, o ninguno. Nada se borra: las fianzas se liquidan, los
 * cargos se cobran o se anulan con motivo, y cada paso deja su evento (justificante).
 */
import { sql, type SQL } from "drizzle-orm";
import { getTenantDatabase } from "../_core/dbRegistry";
import { ModuleNotInstalled } from "../sdk";
import type { CashMove, ChargeStatus, DepositMethod, DepositStatus, PayMethod, SettlementPlan } from "../../shared/skiDeposits";
import { SKI_RENTAL_ID } from "./manifest";
import { CASH_DEPOSIT_KIND, cashKindsInUse, recordCashMovementKind } from "../cashMovementKindsDb";

type Row = Record<string, unknown>;
type Db = NonNullable<Awaited<ReturnType<typeof getTenantDatabase>>>;
type Exec = Pick<Db, "execute">;
const rowsOf = (res: unknown): Row[] => (res as [Row[]])[0];
const insertIdOf = (res: unknown) => Number((res as [{ insertId: number }])[0].insertId);
const str = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));
const cut = (s: string | null | undefined, n: number) => (s == null ? null : s.slice(0, n));

export interface DepositRuleRow {
  id: number;
  siteId: string;
  ruleKey: string;
  modelId: number | null;
  assetType: string | null;
  amountCents: number;
  active: boolean;
}
export interface Deposit {
  id: number;
  siteId: string;
  deliveryId: number;
  customerName: string;
  amountCents: number;
  method: DepositMethod;
  externalRef: string | null;
  status: DepositStatus;
  collectSessionId: number | null;
  collectMovementId: number | null;
  collectedBy: string;
  collectedAt: number;
  damageCents: number | null;
  refundedCents: number | null;
  retainedCents: number | null;
  settleSessionId: number | null;
  settleReason: string | null;
  settleNote: string | null;
  damageSaleId: number | null;
  extraChargeId: number | null;
  settledBy: string | null;
  settledAt: number | null;
}
export interface DamageCharge {
  id: number;
  siteId: string;
  deliveryId: number;
  depositId: number | null;
  amountCents: number;
  reason: string;
  status: ChargeStatus;
  tpvSaleId: number | null;
  payMethod: PayMethod | null;
  paySessionId: number | null;
  createdBy: string;
  createdAt: number;
  paidBy: string | null;
  paidAt: number | null;
  cancelReason: string | null;
}
export interface DepositEvent {
  id: number;
  depositId: number | null;
  chargeId: number | null;
  deliveryId: number;
  kind: string;
  amountCents: number;
  method: string | null;
  cashSessionId: number | null;
  cashMovementId: number | null;
  tpvSaleId: number | null;
  note: string | null;
  actor: string;
  createdAt: number;
}
export interface DepositAttachment {
  id: number;
  depositId: number;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  createdBy: string;
  createdAt: number;
}
/** Venta del TPV de un cargo (por su clave). */
export interface ChargeSale {
  id: number;
  sessionId: number;
  status: string;
  ticketNumber: string | null;
  key: string;
  method: PayMethod | null;
}
export interface CashSessionInfo {
  id: number;
  siteId: string | null;
  open: boolean;
  registerName: string;
  cashierName: string;
}

const toRule = (r: Row): DepositRuleRow => ({ id: Number(r.id), siteId: String(r.site_id), ruleKey: String(r.rule_key), modelId: num(r.model_id), assetType: str(r.asset_type), amountCents: Number(r.amount_cents), active: Number(r.active) === 1 });
const toDeposit = (r: Row): Deposit => ({
  id: Number(r.id),
  siteId: String(r.site_id),
  deliveryId: Number(r.delivery_id),
  customerName: String(r.customer_name),
  amountCents: Number(r.amount_cents),
  method: r.method as DepositMethod,
  externalRef: str(r.external_ref),
  status: r.status as DepositStatus,
  collectSessionId: num(r.collect_session_id),
  collectMovementId: num(r.collect_movement_id),
  collectedBy: String(r.collected_by),
  collectedAt: Number(r.collected_at),
  damageCents: num(r.damage_cents),
  refundedCents: num(r.refunded_cents),
  retainedCents: num(r.retained_cents),
  settleSessionId: num(r.settle_session_id),
  settleReason: str(r.settle_reason),
  settleNote: str(r.settle_note),
  damageSaleId: num(r.damage_sale_id),
  extraChargeId: num(r.extra_charge_id),
  settledBy: str(r.settled_by),
  settledAt: num(r.settled_at),
});
const toCharge = (r: Row): DamageCharge => ({
  id: Number(r.id),
  siteId: String(r.site_id),
  deliveryId: Number(r.delivery_id),
  depositId: num(r.deposit_id),
  amountCents: Number(r.amount_cents),
  reason: String(r.reason),
  status: r.status as ChargeStatus,
  tpvSaleId: num(r.tpv_sale_id),
  payMethod: (r.pay_method as PayMethod | null) ?? null,
  paySessionId: num(r.pay_session_id),
  createdBy: String(r.created_by),
  createdAt: Number(r.created_at),
  paidBy: str(r.paid_by),
  paidAt: num(r.paid_at),
  cancelReason: str(r.cancel_reason),
});
const toEvent = (r: Row): DepositEvent => ({
  id: Number(r.id),
  depositId: num(r.deposit_id),
  chargeId: num(r.charge_id),
  deliveryId: Number(r.delivery_id),
  kind: String(r.kind),
  amountCents: Number(r.amount_cents),
  method: str(r.method),
  cashSessionId: num(r.cash_session_id),
  cashMovementId: num(r.cash_movement_id),
  tpvSaleId: num(r.tpv_sale_id),
  note: str(r.note),
  actor: String(r.actor),
  createdAt: Number(r.created_at),
});
const toAttachment = (r: Row): DepositAttachment => ({ id: Number(r.id), depositId: Number(r.deposit_id), fileUrl: String(r.file_url), fileName: String(r.file_name), mimeType: String(r.mime_type), createdBy: String(r.created_by), createdAt: Number(r.created_at) });

function isMissingTable(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146) return /ski_deposit/.test(String(e.sqlMessage ?? e.message ?? ""));
  }
  return false;
}

export interface NewEvent {
  siteId: string;
  deliveryId: number;
  depositId?: number | null;
  chargeId?: number | null;
  kind: string;
  amountCents: number;
  method?: string | null;
  cashSessionId?: number | null;
  cashMovementId?: number | null;
  tpvSaleId?: number | null;
  note?: string | null;
}

async function addEvent(tx: Exec, e: NewEvent, actor: string, now: number) {
  await tx.execute(sql`
    INSERT INTO ski_deposit_events (site_id, deposit_id, charge_id, delivery_id, kind, amount_cents, method, cash_session_id, cash_movement_id, tpv_sale_id, note, actor, created_at)
    VALUES (${e.siteId}, ${e.depositId ?? null}, ${e.chargeId ?? null}, ${e.deliveryId}, ${e.kind}, ${e.amountCents}, ${e.method ?? null}, ${e.cashSessionId ?? null},
            ${e.cashMovementId ?? null}, ${e.tpvSaleId ?? null}, ${cut(e.note, 300)}, ${actor.slice(0, 100)}, ${now})`);
}

/** Movimiento manual en la sesión de caja del TPV (`cash_movements`, importes en euros con dos decimales). */
async function addCashMovement(tx: Exec, sessionId: number, m: CashMove, cashierName: string, now: number): Promise<number> {
  const id = insertIdOf(
    await tx.execute(sql`INSERT INTO cash_movements (sessionId, type_cm, amount, reason, cashierName, createdAt)
      VALUES (${sessionId}, ${m.type}, ${(m.cents / 100).toFixed(2)}, ${m.reason.slice(0, 300)}, ${cashierName.slice(0, 200)}, ${now})`),
  );
  // Contabilidad general en uso: es una fianza (cobro o devolución), en la misma transacción. Sin ella, nada (como
  // siempre); las fianzas sin tipo se reconocen después por ski_deposit_events.cash_movement_id
  if (await cashKindsInUse(tx)) await recordCashMovementKind(tx, id, CASH_DEPOSIT_KIND);
  return id;
}

async function lockedSession(tx: Exec, sessionId: number): Promise<CashSessionInfo | null> {
  const [r] = rowsOf(
    await tx.execute(sql`SELECT s.id, s.site_id, s.status_cs, s.cashierName, r.name AS register_name FROM cash_sessions s LEFT JOIN cash_registers r ON r.id = s.registerId
      WHERE s.id = ${sessionId} FOR UPDATE`),
  );
  return r ? { id: Number(r.id), siteId: str(r.site_id), open: r.status_cs === "open", registerName: String(r.register_name ?? "Caja"), cashierName: String(r.cashierName ?? "") } : null;
}

export interface RegisterInput {
  siteId: string;
  deliveryId: number;
  customerName: string;
  amountCents: number;
  method: DepositMethod;
  externalRef: string | null;
  sessionId: number | null;
  movements: CashMove[];
  cashierName: string;
}

/** Almacén sobre la BD de la empresa en curso. */
export class TenantDbDepositStore {
  private async run<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const db = await getTenantDatabase();
    if (!db) throw new Error("Base de datos no disponible");
    try {
      return await fn(db);
    } catch (e) {
      if (isMissingTable(e)) throw new ModuleNotInstalled(SKI_RENTAL_ID);
      throw e;
    }
  }
  private many<T>(q: SQL, map: (r: Row) => T) {
    return this.run(async (db) => rowsOf(await db.execute(q)).map(map));
  }
  private async one<T>(q: SQL, map: (r: Row) => T) {
    return (await this.many(q, map))[0] ?? null;
  }

  // ── Reglas ──
  rules(siteId: string) {
    return this.many(sql`SELECT * FROM ski_deposit_rules WHERE site_id = ${siteId} ORDER BY rule_key`, toRule);
  }
  saveRule(siteId: string, key: string, modelId: number | null, assetType: string | null, amountCents: number | null, actor: string) {
    return this.run(async (db) => {
      const now = Date.now();
      if (amountCents == null) {
        await db.execute(sql`UPDATE ski_deposit_rules SET active = 0, updated_by = ${actor.slice(0, 100)}, updated_at = ${now} WHERE site_id = ${siteId} AND rule_key = ${key}`);
        return;
      }
      await db.execute(sql`
        INSERT INTO ski_deposit_rules (site_id, rule_key, model_id, asset_type, amount_cents, active, updated_by, updated_at)
        VALUES (${siteId}, ${key}, ${modelId}, ${assetType}, ${amountCents}, 1, ${actor.slice(0, 100)}, ${now})
        ON DUPLICATE KEY UPDATE amount_cents = VALUES(amount_cents), active = 1, updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`);
    });
  }

  // ── Consultas ──
  cashSession(sessionId: number) {
    return this.one(
      sql`SELECT s.id, s.site_id, s.status_cs, s.cashierName, r.name AS register_name FROM cash_sessions s LEFT JOIN cash_registers r ON r.id = s.registerId WHERE s.id = ${sessionId}`,
      (r): CashSessionInfo => ({ id: Number(r.id), siteId: str(r.site_id), open: r.status_cs === "open", registerName: String(r.register_name ?? "Caja"), cashierName: String(r.cashierName ?? "") }),
    );
  }
  /** Sesiones de caja abiertas (la sede se filtra en el servicio: NULL = principal). */
  openCashSessions() {
    return this.many(
      sql`SELECT s.id, s.site_id, s.status_cs, s.cashierName, r.name AS register_name FROM cash_sessions s LEFT JOIN cash_registers r ON r.id = s.registerId WHERE s.status_cs = 'open' ORDER BY s.openedAt DESC LIMIT 50`,
      (r): CashSessionInfo => ({ id: Number(r.id), siteId: str(r.site_id), open: true, registerName: String(r.register_name ?? "Caja"), cashierName: String(r.cashierName ?? "") }),
    );
  }
  deposit(id: number) {
    return this.one(sql`SELECT * FROM ski_deposits WHERE id = ${id}`, toDeposit);
  }
  depositByDelivery(deliveryId: number) {
    return this.one(sql`SELECT * FROM ski_deposits WHERE delivery_id = ${deliveryId}`, toDeposit);
  }
  deposits(siteId: string, f: { open?: boolean; since?: number } = {}) {
    const cond: SQL[] = [sql`site_id = ${siteId}`];
    if (f.open === true) cond.push(sql`status IN ('held', 'settling')`);
    if (f.open === false) cond.push(sql`status NOT IN ('held', 'settling')`);
    if (f.since != null) cond.push(sql`(status IN ('held', 'settling') OR collected_at >= ${f.since} OR settled_at >= ${f.since})`);
    return this.many(sql`SELECT * FROM ski_deposits WHERE ${sql.join(cond, sql` AND `)} ORDER BY id DESC LIMIT 1000`, toDeposit);
  }
  charge(id: number) {
    return this.one(sql`SELECT * FROM ski_deposit_charges WHERE id = ${id}`, toCharge);
  }
  charges(siteId: string, f: { deliveryId?: number; open?: boolean; since?: number } = {}) {
    const cond: SQL[] = [sql`site_id = ${siteId}`];
    if (f.deliveryId != null) cond.push(sql`delivery_id = ${f.deliveryId}`);
    if (f.open === true) cond.push(sql`status IN ('pending', 'paying')`);
    if (f.since != null) cond.push(sql`(status IN ('pending', 'paying') OR paid_at >= ${f.since})`);
    return this.many(sql`SELECT * FROM ski_deposit_charges WHERE ${sql.join(cond, sql` AND `)} ORDER BY id DESC LIMIT 1000`, toCharge);
  }
  events(siteId: string, deliveryId: number) {
    return this.many(sql`SELECT * FROM ski_deposit_events WHERE site_id = ${siteId} AND delivery_id = ${deliveryId} ORDER BY id`, toEvent);
  }
  attachments(depositId: number) {
    return this.many(sql`SELECT * FROM ski_deposit_attachments WHERE deposit_id = ${depositId} ORDER BY id`, toAttachment);
  }
  addAttachment(siteId: string, depositId: number, a: { fileUrl: string; fileName: string; mimeType: string }, actor: string) {
    return this.run(async (db) => {
      const id = insertIdOf(
        await db.execute(sql`INSERT INTO ski_deposit_attachments (site_id, deposit_id, file_url, file_name, mime_type, created_by, created_at)
          VALUES (${siteId}, ${depositId}, ${a.fileUrl.slice(0, 500)}, ${a.fileName.slice(0, 200)}, ${a.mimeType.slice(0, 80)}, ${actor.slice(0, 100)}, ${Date.now()})`),
      );
      return id;
    });
  }

  // ── Cobro de la fianza ──

  /**
   * Alta atómica: bloquea la entrega; si ya tiene fianza, la devuelve (doble clic); si no, `check` valida la sesión de
   * caja bloqueada y se graban la fianza, la entrada de caja (efectivo) y el evento.
   */
  register(x: RegisterInput, check: (session: CashSessionInfo | null) => void, actor: string): Promise<{ id: number; replayed: boolean }> {
    return this.run((db) =>
      db.transaction(async (tx) => {
        const [d] = rowsOf(await tx.execute(sql`SELECT id FROM ski_rental_deliveries WHERE id = ${x.deliveryId} AND site_id = ${x.siteId} FOR UPDATE`));
        if (!d) throw Object.assign(new Error("entrega"), { notFound: true });
        const [prev] = rowsOf(await tx.execute(sql`SELECT id FROM ski_deposits WHERE delivery_id = ${x.deliveryId}`));
        if (prev) return { id: Number(prev.id), replayed: true };
        const session = x.sessionId != null ? await lockedSession(tx, x.sessionId) : null;
        check(session);
        const now = Date.now();
        let movementId: number | null = null;
        for (const m of x.movements) movementId = await addCashMovement(tx, x.sessionId!, m, x.cashierName, now);
        const id = insertIdOf(
          await tx.execute(sql`
            INSERT INTO ski_deposits (site_id, delivery_id, customer_name, amount_cents, method, external_ref, status, collect_session_id, collect_movement_id, collected_by, collected_at)
            VALUES (${x.siteId}, ${x.deliveryId}, ${x.customerName.slice(0, 120)}, ${x.amountCents}, ${x.method}, ${cut(x.externalRef, 120)}, 'held', ${x.sessionId}, ${movementId},
                    ${actor.slice(0, 100)}, ${now})`),
        );
        await addEvent(tx, { siteId: x.siteId, deliveryId: x.deliveryId, depositId: id, kind: "collected", amountCents: x.amountCents, method: x.method, cashSessionId: x.sessionId, cashMovementId: movementId, note: x.externalRef }, actor, now);
        return { id, replayed: false };
      }),
    );
  }

  // ── Liquidación ──

  /**
   * Reserva la liquidación: bloquea la fianza y `decide` devuelve el plan (o null si ya está cerrada o liquidándose: se
   * continúa con el plan guardado). Queda «settling» con el plan, así un reintento usa exactamente el mismo. `fresh`:
   * si la reserva es de esta llamada (solo entonces puede deshacerse si el TPV falla).
   */
  claimSettlement(depositId: number, decide: (d: Deposit, session: (id: number) => Promise<CashSessionInfo | null>) => Promise<{ plan: SettlementPlan; sessionId: number | null; reason: string | null; note: string | null } | null>, actor: string) {
    return this.run((db) =>
      db.transaction(async (tx) => {
        const [r] = rowsOf(await tx.execute(sql`SELECT * FROM ski_deposits WHERE id = ${depositId} FOR UPDATE`));
        if (!r) throw Object.assign(new Error("fianza"), { notFound: true });
        const d = toDeposit(r);
        const p = await decide(d, (id) => lockedSession(tx, id));
        if (!p) return { ...d, fresh: false };
        await tx.execute(sql`UPDATE ski_deposits SET status = 'settling', damage_cents = ${p.plan.damageCents}, refunded_cents = ${p.plan.refundCents}, retained_cents = ${p.plan.retainedCents},
          settle_session_id = ${p.sessionId}, settle_reason = ${cut(p.reason, 300)}, settle_note = ${cut(p.note, 1000)}, settled_by = ${actor.slice(0, 100)} WHERE id = ${depositId} AND status = 'held'`);
        return { ...d, status: "settling" as const, damageCents: p.plan.damageCents, refundedCents: p.plan.refundCents, retainedCents: p.plan.retainedCents, settleSessionId: p.sessionId, settleReason: p.reason, settleNote: p.note, fresh: true };
      }),
    );
  }
  /**
   * Sin venta de daños registrada (el TPV falló o no hacía falta y el cierre falló): la fianza vuelve a «cobrada» y no
   * queda nada a medias. Con venta ya registrada no se libera nunca (se termina reasignando la caja).
   */
  releaseSettlement(depositId: number) {
    return this.run(async (db) => {
      await db.execute(sql`UPDATE ski_deposits SET status = 'held', damage_cents = NULL, refunded_cents = NULL, retained_cents = NULL, settle_session_id = NULL,
        settle_reason = NULL, settle_note = NULL, settled_by = NULL WHERE id = ${depositId} AND status = 'settling' AND damage_sale_id IS NULL`);
    });
  }
  /** Venta de daños ya creada en el TPV: se anota en cuanto existe, para no perderla si el cierre falla después. */
  recordSettlementSale(depositId: number, saleId: number) {
    return this.run(async (db) => {
      await db.execute(sql`UPDATE ski_deposits SET damage_sale_id = ${saleId} WHERE id = ${depositId} AND status = 'settling' AND damage_sale_id IS NULL`);
    });
  }
  /** Venta del TPV por su clave de idempotencia (para recuperar una venta creada en un intento anterior). */
  saleByKey(key: string) {
    return this.one(sql`SELECT id, sessionId, status_ts FROM tpv_sales WHERE idempotencyKey = ${key}`, (r) => ({ id: Number(r.id), sessionId: Number(r.sessionId), status: String(r.status_ts) }));
  }
  /**
   * Liquidación a medias cuya caja se cerró: pasa a otra sesión ABIERTA de la misma sede (`check` la valida con la
   * sesión bloqueada) para terminarla. Solo si sigue «settling».
   */
  reassignSettlementSession(depositId: number, sessionId: number, check: (d: Deposit, s: CashSessionInfo | null) => Promise<void>) {
    return this.run((db) =>
      db.transaction(async (tx) => {
        const [r] = rowsOf(await tx.execute(sql`SELECT * FROM ski_deposits WHERE id = ${depositId} FOR UPDATE`));
        const d = toDeposit(r);
        if (d.status !== "settling") return d;
        await check(d, await lockedSession(tx, sessionId));
        await tx.execute(sql`UPDATE ski_deposits SET settle_session_id = ${sessionId} WHERE id = ${depositId}`);
        return { ...d, settleSessionId: sessionId };
      }),
    );
  }
  /**
   * Cierre atómico de la liquidación: movimientos de caja, cargo adicional (una sola vez por liquidación), eventos y
   * estado final. Solo actúa si sigue «settling» (dos cierres a la vez: uno cierra, el otro ve la fianza cerrada).
   */
  finishSettlement(depositId: number, x: { plan: SettlementPlan; movements: CashMove[]; saleId: number | null; cashierName: string; extraReason: string }, actor: string): Promise<Deposit> {
    return this.run((db) =>
      db.transaction(async (tx) => {
        const [r] = rowsOf(await tx.execute(sql`SELECT * FROM ski_deposits WHERE id = ${depositId} FOR UPDATE`));
        const d = toDeposit(r);
        if (d.status !== "settling") return d;
        const now = Date.now();
        const base = { siteId: d.siteId, deliveryId: d.deliveryId, depositId: d.id, method: d.method };
        const moveIds: number[] = [];
        if (x.movements.length) {
          const s = await lockedSession(tx, d.settleSessionId!);
          if (!s?.open) throw Object.assign(new Error("La sesión de caja se ha cerrado mientras se liquidaba la fianza: abre otra y repite la liquidación"), { conflict: true });
          for (const m of x.movements) moveIds.push(await addCashMovement(tx, d.settleSessionId!, m, x.cashierName, now));
        }
        let mi = 0;
        if (x.plan.refundCents > 0) {
          await addEvent(tx, { ...base, kind: "refunded", amountCents: x.plan.refundCents, cashSessionId: d.settleSessionId, cashMovementId: d.method === "cash" ? moveIds[mi++] : null, note: d.settleNote }, actor, now);
        }
        if (x.plan.retainedCents > 0) {
          await addEvent(tx, { ...base, kind: "retained", amountCents: x.plan.retainedCents, cashSessionId: d.settleSessionId, cashMovementId: d.method === "cash" ? moveIds[mi++] : null, tpvSaleId: x.saleId, note: d.settleReason }, actor, now);
        }
        let extraId: number | null = null;
        if (x.plan.extraChargeCents > 0) {
          await tx.execute(sql`INSERT IGNORE INTO ski_deposit_charges (site_id, delivery_id, deposit_id, settlement_key, amount_cents, reason, status, created_by, created_at)
            VALUES (${d.siteId}, ${d.deliveryId}, ${d.id}, ${d.id}, ${x.plan.extraChargeCents}, ${x.extraReason.slice(0, 300)}, 'pending', ${actor.slice(0, 100)}, ${now})`);
          const [c] = rowsOf(await tx.execute(sql`SELECT id FROM ski_deposit_charges WHERE settlement_key = ${d.id}`));
          extraId = Number(c.id);
          await addEvent(tx, { ...base, chargeId: extraId, kind: "charge_created", amountCents: x.plan.extraChargeCents, method: null, note: x.extraReason }, actor, now);
        }
        await tx.execute(sql`UPDATE ski_deposits SET status = ${x.plan.status}, damage_sale_id = COALESCE(damage_sale_id, ${x.saleId}), extra_charge_id = ${extraId}, settled_at = ${now} WHERE id = ${depositId}`);
        const [after] = rowsOf(await tx.execute(sql`SELECT * FROM ski_deposits WHERE id = ${depositId}`));
        return toDeposit(after);
      }),
    );
  }

  // ── Cargos por daños ──

  createCharge(x: { siteId: string; deliveryId: number; amountCents: number; reason: string; requestKey: string }, actor: string): Promise<{ id: number; replayed: boolean }> {
    return this.run((db) =>
      db.transaction(async (tx) => {
        const [dep] = rowsOf(await tx.execute(sql`SELECT id FROM ski_deposits WHERE delivery_id = ${x.deliveryId}`));
        const now = Date.now();
        // Sin SELECT … FOR UPDATE previo: sobre una clave que aún no existe bloquea el hueco del índice y dos altas
        // simultáneas (aunque sean de claves distintas) acaban en interbloqueo. El índice único decide: la misma clave
        // espera a la primera y se ignora; claves distintas no se estorban.
        const ins = await tx.execute(sql`INSERT IGNORE INTO ski_deposit_charges (site_id, delivery_id, deposit_id, request_key, amount_cents, reason, status, created_by, created_at)
            VALUES (${x.siteId}, ${x.deliveryId}, ${dep ? Number(dep.id) : null}, ${x.requestKey}, ${x.amountCents}, ${x.reason.slice(0, 300)}, 'pending', ${actor.slice(0, 100)}, ${now})`);
        if (Number((ins as unknown as [{ affectedRows: number }])[0].affectedRows) === 0) {
          // Lectura con bloqueo: ve la fila ya confirmada por el otro intento (la instantánea de la transacción, no)
          const [prev] = rowsOf(await tx.execute(sql`SELECT id FROM ski_deposit_charges WHERE site_id = ${x.siteId} AND request_key = ${x.requestKey} FOR UPDATE`));
          if (!prev) throw new Error("No se pudo registrar el cargo");
          return { id: Number(prev.id), replayed: true };
        }
        const id = insertIdOf(ins);
        await addEvent(tx, { siteId: x.siteId, deliveryId: x.deliveryId, depositId: dep ? Number(dep.id) : null, chargeId: id, kind: "charge_created", amountCents: x.amountCents, note: x.reason }, actor, now);
        return { id, replayed: false };
      }),
    );
  }
  /**
   * Ventas del TPV de un cargo, por sus claves (`skichg-<id>-pay`, `-pay-2`…; ver chargeSaleKey), con la forma de pago.
   * Las ventas que fallaron al grabarse no aparecen: el TPV les quita la clave.
   */
  chargeSales(chargeId: number) {
    const base = `skichg-${chargeId}-pay`;
    return this.many(
      sql`SELECT s.id, s.sessionId, s.status_ts, s.ticketNumber, s.idempotencyKey,
            (SELECT p.method_tsp FROM tpv_sale_payments p WHERE p.saleId = s.id ORDER BY p.id LIMIT 1) AS method
          FROM tpv_sales s WHERE s.idempotencyKey = ${base} OR s.idempotencyKey LIKE ${`${base}-%`} ORDER BY s.id`,
      (r): ChargeSale => ({ id: Number(r.id), sessionId: Number(r.sessionId), status: String(r.status_ts), ticketNumber: str(r.ticketNumber), key: String(r.idempotencyKey), method: (str(r.method) as PayMethod | null) ?? null }),
    );
  }
  /**
   * Reserva el cobro del cargo («paying») con la caja y la forma de esta petición; `decide` lanza si no procede y
   * devuelve false si ya está cobrado. El servicio lo llama con el bloqueo del cargo: un «paying» que encuentre es de un
   * intento interrumpido y se retoma con la caja nueva.
   */
  claimCharge(chargeId: number, decide: (c: DamageCharge, session: (id: number) => Promise<CashSessionInfo | null>) => Promise<boolean>, x: { sessionId: number; method: PayMethod }) {
    return this.run((db) =>
      db.transaction(async (tx) => {
        const [r] = rowsOf(await tx.execute(sql`SELECT * FROM ski_deposit_charges WHERE id = ${chargeId} FOR UPDATE`));
        if (!r) throw Object.assign(new Error("cargo"), { notFound: true });
        const c = toCharge(r);
        if (!(await decide(c, (id) => lockedSession(tx, id)))) return c;
        await tx.execute(sql`UPDATE ski_deposit_charges SET status = 'paying', pay_method = ${x.method}, pay_session_id = ${x.sessionId} WHERE id = ${chargeId} AND status IN ('pending', 'paying')`);
        return { ...c, status: "paying" as const, payMethod: x.method, paySessionId: x.sessionId };
      }),
    );
  }
  releaseCharge(chargeId: number) {
    return this.run(async (db) => {
      await db.execute(sql`UPDATE ski_deposit_charges SET status = 'pending', pay_method = NULL, pay_session_id = NULL WHERE id = ${chargeId} AND status = 'paying'`);
    });
  }
  /**
   * Cargo cobrado con su venta del TPV: la caja y la forma de pago son las de la venta. Concilia también un cargo que
   * quedó «pendiente» con la venta ya cobrada (intento interrumpido): la venta es la verdad del cobro.
   */
  finishCharge(chargeId: number, sale: { id: number; sessionId: number; method: PayMethod | null }, actor: string): Promise<DamageCharge> {
    return this.run((db) =>
      db.transaction(async (tx) => {
        const [r] = rowsOf(await tx.execute(sql`SELECT * FROM ski_deposit_charges WHERE id = ${chargeId} FOR UPDATE`));
        const c = toCharge(r);
        if (c.status === "paying" || c.status === "pending") {
          const now = Date.now();
          const method = sale.method ?? c.payMethod;
          await tx.execute(sql`UPDATE ski_deposit_charges SET status = 'paid', tpv_sale_id = ${sale.id}, pay_session_id = ${sale.sessionId}, pay_method = ${method},
            paid_by = ${actor.slice(0, 100)}, paid_at = ${now} WHERE id = ${chargeId}`);
          await addEvent(tx, { siteId: c.siteId, deliveryId: c.deliveryId, depositId: c.depositId, chargeId: c.id, kind: "charge_paid", amountCents: c.amountCents, method, cashSessionId: sale.sessionId, tpvSaleId: sale.id }, actor, now);
        }
        const [after] = rowsOf(await tx.execute(sql`SELECT * FROM ski_deposit_charges WHERE id = ${chargeId}`));
        return toCharge(after);
      }),
    );
  }
  cancelCharge(chargeId: number, reason: string, check: (c: DamageCharge) => void, actor: string): Promise<DamageCharge> {
    return this.run((db) =>
      db.transaction(async (tx) => {
        const [r] = rowsOf(await tx.execute(sql`SELECT * FROM ski_deposit_charges WHERE id = ${chargeId} FOR UPDATE`));
        if (!r) throw Object.assign(new Error("cargo"), { notFound: true });
        const c = toCharge(r);
        check(c);
        if (c.status === "pending") {
          const now = Date.now();
          await tx.execute(sql`UPDATE ski_deposit_charges SET status = 'cancelled', cancel_reason = ${reason.slice(0, 300)}, cancelled_by = ${actor.slice(0, 100)}, cancelled_at = ${now} WHERE id = ${chargeId}`);
          await addEvent(tx, { siteId: c.siteId, deliveryId: c.deliveryId, depositId: c.depositId, chargeId: c.id, kind: "charge_cancelled", amountCents: c.amountCents, note: reason }, actor, now);
        }
        const [after] = rowsOf(await tx.execute(sql`SELECT * FROM ski_deposit_charges WHERE id = ${chargeId}`));
        return toCharge(after);
      }),
    );
  }
}
