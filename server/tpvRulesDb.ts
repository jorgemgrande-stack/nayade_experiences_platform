/**
 * Caja (TPV) por plan y reglas de funcionamiento (estrategia TPV del 09/11/2026). Lo decide SIEMPRE el servidor:
 *  - Plan de la empresa en curso (sus licencias, como el límite de usuarios: server/planSeats.ts). Sin plan que aplicar
 *    (instalación única de Náyade o empresa sin licencia base) → `full`: todo y sin límite de cajas.
 *  - Límite de cajas activas: solo impide CREAR o ACTIVAR cajas por encima del máximo. Las que ya estén activas se
 *    conservan y siguen funcionando aunque lo superen.
 *  - Hora de corte operativo por empresa (`tpv_cutoff_time`) y por caja (`cash_registers.cutoff_time`), en la zona
 *    horaria de la empresa (`site_timezone`); por defecto, 00:00.
 *  - Cierres: foto inmutable en `tpv_session_closures` (se escribe una vez); las correcciones de una caja cerrada van
 *    aparte, en `tpv_session_corrections` (migración 0063).
 */
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { cashRegisters, type CashSession } from "../drizzle/schema";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { decide } from "./_core/capabilities/model";
import { legacyDb } from "./_core/legacyDb";
import { getSystemSetting } from "./config";
import { licenceSummary } from "./planSeats";
import { withTenantLock } from "./tpvSaleIdempotency";
import { upsertSettings } from "./setupWizardDb";
import { getDefaultCashAccountId } from "./routers/cashRegisterHelper";
import {
  CUTOFF_RE,
  DEFAULT_CUTOFF,
  TPV_ADVANCED_CAPABILITY,
  featureNotIncludedMessage,
  operationalDay,
  registerLimitDecision,
  safeTimeZone,
  tpvPlanInfo,
  type TpvFeature,
  TPV_ACQUIRED_RIGHTS_CUTOFF,
  TPV_GRANDFATHERED_FEATURES,
  withAcquiredRights,
  type TpvPlanInfo,
  type TpvTier,
} from "../shared/tpvPlan";

const db = legacyDb();

/** Plan de caja de la empresa en curso. Lanza si las licencias no pueden leerse (quien llama decide). */
export async function currentTpvTier(): Promise<TpvTier> {
  const access = getCapabilityAccess();
  const summary = licenceSummary(await access.grants(), access.currentTime());
  return summary.plan ?? "full";
}

export async function currentTpvPlan(): Promise<TpvPlanInfo> {
  const info = tpvPlanInfo(await currentTpvTier());
  if (info.tier !== "essential") return info;
  return withAcquiredRights(info, (await acquiredRights()).features);
}

// ─── Derecho adquirido (empresas que ya tenían estas funciones) ──────────────

export interface AcquiredRights {
  features: TpvFeature[];
  cutoff: string;
  /** Filas del registro por función: origen, fecha y estado (trazabilidad). */
  records: Array<{ feature: string; origin: string; grantedAt: number; status: string; confirmedAt: number | null }>;
}

/**
 * Derechos adquiridos de la empresa en curso (tabla `tpv_acquired_rights`, sembrada por la migración 0064 en cada
 * empresa que ya existía; las nuevas no la tienen). La primera vez se CONFIRMA con sus licencias de ese momento: si
 * tenía la caja del plan (`bill-cash`, en cualquier estado salvo cancelada), queda `granted`; si no, `not_eligible`.
 * Desde entonces manda lo guardado: no depende de las licencias, así que se mantiene al renovar o al cambiar de
 * periodicidad, y nunca se retira solo. Ante un fallo, ninguno (el plan no cambia y nada se guarda).
 */
export async function acquiredRights(): Promise<AcquiredRights> {
  const none: AcquiredRights = { features: [], cutoff: TPV_ACQUIRED_RIGHTS_CUTOFF, records: [] };
  try {
    let list = await rows(sql`SELECT feature, origin, granted_at, status, confirmed_at FROM tpv_acquired_rights`);
    if (list.some((r) => r.status === "seeded")) {
      const grants = await getCapabilityAccess().grants();
      const had = !grants || grants.some((g) => g.capabilityId === "bill-cash" && g.siteId === "" && g.status !== "cancelled");
      await db.execute(sql`UPDATE tpv_acquired_rights SET status = ${had ? "granted" : "not_eligible"}, confirmed_at = ${Date.now()} WHERE status = 'seeded'`);
      list = await rows(sql`SELECT feature, origin, granted_at, status, confirmed_at FROM tpv_acquired_rights`);
    }
    const records = list.map((r) => ({ feature: String(r.feature), origin: String(r.origin), grantedAt: Number(r.granted_at), status: String(r.status), confirmedAt: r.confirmed_at == null ? null : Number(r.confirmed_at) }));
    const features = records.filter((r) => r.status === "granted" && (TPV_GRANDFATHERED_FEATURES as readonly string[]).includes(r.feature)).map((r) => r.feature as TpvFeature);
    return { features, cutoff: TPV_ACQUIRED_RIGHTS_CUTOFF, records };
  } catch {
    return none;
  }
}

/** Plan para comprobar una operación: si no puede leerse, falla cerrado con un error recuperable. */
async function planForCheck(): Promise<TpvPlanInfo> {
  try {
    return await currentTpvPlan();
  } catch {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "No se pudo comprobar tu plan; inténtalo en unos minutos" });
  }
}

/** Exige que el plan incluya la función (en el servidor). */
export async function assertTpvFeature(f: TpvFeature): Promise<void> {
  const plan = await planForCheck();
  if (!plan.features[f]) throw new TRPCError({ code: "FORBIDDEN", message: featureNotIncludedMessage(f) });
}

export async function tpvFeatureEnabled(f: TpvFeature): Promise<boolean> {
  return (await planForCheck()).features[f];
}

/** ¿TPV Advanced (pos-advanced) permite la operación? En la instalación única, siempre. */
export async function tpvAdvancedAllowed(write: boolean): Promise<boolean> {
  try {
    return (await getCapabilityAccess().check(TPV_ADVANCED_CAPABILITY, { write })).allowed;
  } catch {
    return false;
  }
}

export async function countActiveRegisters(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`COUNT(*)` }).from(cashRegisters).where(eq(cashRegisters.isActive, true));
  return Number(row?.n ?? 0);
}

/**
 * Crea o activa una caja dentro del límite del plan, con el bloqueo de cajas de la empresa: dos altas a la vez no
 * superan el máximo. `fn` hace la escritura.
 */
export async function withRegisterSlot<T>(fn: () => Promise<T>): Promise<T> {
  return withTenantLock("tpv_registers", "activas", 10, "Se está dando de alta otra caja. Inténtalo de nuevo en unos segundos.", async () => {
    const plan = await planForCheck();
    const d = registerLimitDecision(plan, await countActiveRegisters());
    if (!d.allowed) throw new TRPCError({ code: "FORBIDDEN", message: d.reason });
    return fn();
  });
}

// ─── Hora de corte ────────────────────────────────────────────────────────────

export const CUTOFF_SETTING = "tpv_cutoff_time";
export const TIMEZONE_SETTING = "site_timezone";

export async function companyCutoff(): Promise<{ cutoff: string; timeZone: string }> {
  const [c, tz] = await Promise.all([getSystemSetting(CUTOFF_SETTING, DEFAULT_CUTOFF), getSystemSetting(TIMEZONE_SETTING, "Europe/Madrid")]);
  return { cutoff: CUTOFF_RE.test(c) ? c : DEFAULT_CUTOFF, timeZone: safeTimeZone(tz) };
}

/** Día operativo de un instante para una caja (su corte, o el de la empresa; se puede pasar ya leído). */
export async function registerOperationalDay(ms: number, registerCutoff: string | null | undefined, companyCfg?: { cutoff: string; timeZone: string }): Promise<string> {
  const company = companyCfg ?? (await companyCutoff());
  const cutoff = registerCutoff && CUTOFF_RE.test(registerCutoff) ? registerCutoff : company.cutoff;
  return operationalDay(ms, cutoff, company.timeZone);
}

// ─── Cierres inmutables y correcciones ───────────────────────────────────────

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const [r] = (await db.execute(q)) as unknown as [Row[]];
  return Array.isArray(r) ? r : [];
}

export interface ClosureSnapshot {
  sessionId: number;
  registerId: number;
  siteId: string | null;
  operationalDay: string;
  openingAmount: number;
  totalCash: number;
  totalCard: number;
  totalBizum: number;
  totalMixed: number;
  manualIn: number;
  manualOut: number;
  expectedCash: number;
  countedCash: number;
  difference: number;
  closedBy: number | null;
  closedByName: string | null;
  openedAt: number;
  closedAt: number;
}

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** Foto del cierre: se escribe UNA vez (INSERT IGNORE). Nunca se actualiza ni se borra. */
export async function recordClosureSnapshot(s: ClosureSnapshot, exec: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> } = db): Promise<void> {
  await exec.execute(sql`INSERT IGNORE INTO tpv_session_closures
    (session_id, register_id, site_id, operational_day, opening_amount, total_cash, total_card, total_bizum, total_mixed, manual_in, manual_out, expected_cash, counted_cash, difference, closed_by, closed_by_name, opened_at, closed_at)
    VALUES (${s.sessionId}, ${s.registerId}, ${s.siteId}, ${s.operationalDay}, ${money(s.openingAmount)}, ${money(s.totalCash)}, ${money(s.totalCard)}, ${money(s.totalBizum)}, ${money(s.totalMixed)}, ${money(s.manualIn)}, ${money(s.manualOut)}, ${money(s.expectedCash)}, ${money(s.countedCash)}, ${money(s.difference)}, ${s.closedBy}, ${s.closedByName}, ${s.openedAt}, ${s.closedAt})`);
}

/**
 * Repara la foto de un cierre que no la tenga (p. ej. si el proceso cayó justo después de cerrar): la rehace con los
 * totales que guardó la sesión. Idempotente (INSERT IGNORE); nunca cambia una foto existente.
 */
export async function ensureClosureSnapshot(row: CashSession): Promise<void> {
  if (row.status !== "closed" || row.closingAmount == null || row.countedCash == null) return;
  if (await getClosureSnapshot(row.id)) return;
  const [reg] = await db.select({ cutoffTime: cashRegisters.cutoffTime }).from(cashRegisters).where(eq(cashRegisters.id, row.registerId));
  const n = (v: unknown) => Number(v ?? 0) || 0;
  await recordClosureSnapshot({
    sessionId: row.id,
    registerId: row.registerId,
    siteId: row.siteId ?? null,
    operationalDay: await registerOperationalDay(Number(row.openedAt), reg?.cutoffTime ?? null),
    openingAmount: n(row.openingAmount),
    totalCash: n(row.totalCash),
    totalCard: n(row.totalCard),
    totalBizum: n(row.totalBizum),
    totalMixed: n(row.totalMixed),
    manualIn: n(row.totalManualIn),
    manualOut: n(row.totalManualOut),
    expectedCash: n(row.closingAmount),
    countedCash: n(row.countedCash),
    difference: n(row.cashDifference),
    closedBy: null,
    closedByName: null,
    openedAt: Number(row.openedAt),
    closedAt: Number(row.closedAt ?? Date.now()),
  });
}

export async function getClosureSnapshot(sessionId: number): Promise<Row | null> {
  const [r] = await rows(sql`SELECT * FROM tpv_session_closures WHERE session_id = ${sessionId}`);
  return r ?? null;
}

export const CORRECTION_KINDS = ["cash_in", "cash_out", "count_adjustment"] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export interface CorrectionRow {
  id: number;
  sessionId: number;
  kind: CorrectionKind;
  amount: number;
  reason: string;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: number;
}
const toCorrection = (r: Row): CorrectionRow => ({
  id: Number(r.id),
  sessionId: Number(r.session_id),
  kind: String(r.kind) as CorrectionKind,
  amount: Number(r.amount),
  reason: String(r.reason),
  createdBy: r.created_by == null ? null : Number(r.created_by),
  createdByName: r.created_by_name == null ? null : String(r.created_by_name),
  createdAt: Number(r.created_at),
});

export async function listCorrections(sessionId: number): Promise<CorrectionRow[]> {
  return (await rows(sql`SELECT * FROM tpv_session_corrections WHERE session_id = ${sessionId} ORDER BY id`)).map(toCorrection);
}

/**
 * Corrección trazable de una caja YA cerrada. Idempotente por `key`: repetir con la misma clave devuelve la misma
 * corrección (y si la clave es de otra sesión o con otros datos, CONFLICT). No modifica el cierre.
 */
export async function addCorrection(input: { sessionId: number; kind: CorrectionKind; amount: number; reason: string; key: string; userId: number | null; userName: string | null }): Promise<CorrectionRow> {
  const find = async () => {
    const [r] = await rows(sql`SELECT * FROM tpv_session_corrections WHERE idempotency_key = ${input.key}`);
    return r ? toCorrection(r) : null;
  };
  const cents = Math.round(input.amount * 100);
  const same = (c: CorrectionRow) => c.sessionId === input.sessionId && c.kind === input.kind && Math.round(c.amount * 100) === cents;
  const existing = await find();
  if (existing) {
    if (!same(existing)) throw new TRPCError({ code: "CONFLICT", message: "Esa clave ya se usó para otra corrección" });
    return existing;
  }
  try {
    await db.execute(sql`INSERT INTO tpv_session_corrections (session_id, kind, amount, reason, created_by, created_by_name, idempotency_key, created_at)
      VALUES (${input.sessionId}, ${input.kind}, ${(cents / 100).toFixed(2)}, ${input.reason}, ${input.userId}, ${input.userName}, ${input.key}, ${Date.now()})`);
  } catch (e) {
    // Dos intentos a la vez con la misma clave: el segundo devuelve la del primero
    const again = await find();
    if (again && same(again)) return again;
    if (again) throw new TRPCError({ code: "CONFLICT", message: "Esa clave ya se usó para otra corrección" });
    throw e;
  }
  return (await find())!;
}

/**
 * Refleja una corrección en la caja contable (fin_cash_movements): un movimiento de ajuste aparte, enlazado a la
 * corrección (`fin_movement_id`, y `related_entity_id` = id de la corrección), con su motivo y autor, en el día operativo
 * del cierre y con el saldo de la cuenta actualizado. Nunca toca el cierre. Una sola vez: se reclama la corrección en la
 * misma transacción (dos intentos a la vez no la reflejan dos veces). Sin cuenta de caja principal, queda pendiente
 * (NULL) y se refleja al repetir la corrección cuando la haya. La contabilidad general la lee de
 * tpv_session_corrections (clave `cajacorr:<id>`), no de aquí: se contabiliza una sola vez.
 */
export async function postCorrectionToTreasury(c: CorrectionRow): Promise<number | null> {
  const accountId = await getDefaultCashAccountId();
  if (!accountId) return null;
  const snap = await getClosureSnapshot(c.sessionId);
  const day = snap?.operational_day ? String(snap.operational_day) : await registerOperationalDay(c.createdAt, null);
  const income = c.kind === "cash_in" || (c.kind === "count_adjustment" && c.amount > 0);
  const abs = Math.abs(c.amount);
  const label = c.kind === "cash_in" ? "Entrada" : c.kind === "cash_out" ? "Salida" : "Ajuste del recuento";
  return db.transaction(async (tx) => {
    const [claim] = (await tx.execute(sql`UPDATE tpv_session_corrections SET fin_movement_id = 0 WHERE id = ${c.id} AND fin_movement_id IS NULL`)) as unknown as [{ affectedRows?: number }];
    if (Number(claim?.affectedRows ?? 0) !== 1) return null;
    const [res] = (await tx.execute(sql`INSERT INTO fin_cash_movements (account_id, date, type_fcm, amount, concept, category, related_entity_type, related_entity_id, notes, created_by)
      VALUES (${accountId}, ${day}, ${income ? "income" : "expense"}, ${abs.toFixed(2)}, ${`${label} tras el cierre de caja TPV #${c.sessionId}`.slice(0, 512)}, 'cash_adjustment', 'manual', ${c.id},
        ${`Corrección #${c.id} de la caja cerrada (sesión TPV #${c.sessionId}) por ${c.createdByName ?? "—"}. Motivo: ${c.reason}`}, ${c.createdBy})`)) as unknown as [{ insertId: number }];
    const movementId = Number(res.insertId);
    await tx.execute(sql`UPDATE fin_cash_accounts SET current_balance = current_balance + ${income ? abs : -abs} WHERE id = ${accountId}`);
    await tx.execute(sql`UPDATE tpv_session_corrections SET fin_movement_id = ${movementId} WHERE id = ${c.id}`);
    return movementId;
  });
}

/** Efecto de las correcciones en el efectivo de la sesión (entradas suman, salidas y ajustes negativos restan). */
export function correctionsCashDelta(list: Pick<CorrectionRow, "kind" | "amount">[]): number {
  return list.reduce((acc, c) => acc + (c.kind === "cash_out" ? -c.amount : c.amount), 0);
}


/** Hora de corte de la empresa (ajuste del sistema). */
export async function setCompanyCutoff(cutoff: string): Promise<void> {
  if (!CUTOFF_RE.test(cutoff)) throw new TRPCError({ code: "BAD_REQUEST", message: "Hora de corte no válida (HH:MM)" });
  await upsertSettings([{ key: CUTOFF_SETTING, value: cutoff, label: "Hora de corte operativo del TPV", category: "general" }]);
}

/** ¿Error de clave única duplicada de MySQL (también envuelto por drizzle)? */
export function isDuplicateKeyError(e: unknown): boolean {
  const err = e as { message?: string; code?: string; cause?: { message?: string; code?: string } } | null;
  return /Duplicate entry|ER_DUP_ENTRY/.test(`${err?.code ?? ""} ${err?.message ?? ""} ${err?.cause?.code ?? ""} ${err?.cause?.message ?? ""}`);
}

/** ¿Tiene la empresa TPV Advanced contratado (para mostrarlo)? En la instalación única, sí. */
export async function tpvAdvancedContracted(): Promise<boolean> {
  try {
    const access = getCapabilityAccess();
    const grants = await access.grants();
    if (!grants) return true;
    return decide(grants, TPV_ADVANCED_CAPABILITY, { write: false, now: access.currentTime() }).allowed;
  } catch {
    return false;
  }
}
