/**
 * Contabilidad general de cada empresa (extra `accounting-general`): orquesta la BD de la empresa en curso (`getDb()`
 * resuelve la del contexto de la petición: cada empresa solo ve y escribe sus asientos), las reglas puras
 * (./rules.ts, sobre las de server/finance) y la lectura de los documentos del Core (./sources.ts).
 *
 * Los asientos automáticos se generan BAJO DEMANDA (`sync`, el panel lo pide al abrirse y con «Actualizar asientos»):
 * sin tareas programadas. Cada documento se contabiliza una vez por versión: repetir no duplica; si el documento
 * cambia, su asiento se revierte y se contabiliza el nuevo; si se anula, devuelve o borra, se revierte.
 */
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { madridDateKey, madridYear } from "../utils/timezone";
import { expenseCategories } from "../../drizzle/schema";
import type { EntryLine, PostedLine } from "../finance/types";
import { ACC_DEFAULT_MAP, ACC_MAP_KEYS, ACC_MANUAL_JOURNALS, ACC_PGC_SEED, isAccDate, type AccAccountMap, type AccJournal, type AccOrigin } from "../../shared/accountingGeneral";
import {
  AccError,
  autoReversalDate,
  deferLockedDraft,
  isLocked,
  journalCsvOf,
  ledger,
  ledgerCsv,
  planSync,
  pnlCsv,
  profitAndLoss,
  reversalDraft,
  subaccountParent,
  trialBalance,
  trialCsv,
  validateDraft,
  workbookXlsx,
  type AccAccount,
  type AccDraft,
  type SyncAction,
} from "./rules";
import * as store from "./store";
import { keyInGroups, readSources, SOURCE_GROUP_LABELS } from "./sources";

export const ACC_NOT_INSTALLED_MESSAGE =
  "La contabilidad general aún no está preparada en tu empresa: falta aplicar la actualización 0060_extra_contabilidad de su base de datos. Inténtalo de nuevo en unos minutos.";

/** Tope de asientos por generación (lo que quede, en la siguiente: `truncated`). */
export const MAX_ACTIONS_PER_SYNC = 1500;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function database(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return d;
}

const TRPC_CODE: Record<AccError["code"], TRPCError["code"]> = {
  invalid_input: "BAD_REQUEST",
  unbalanced: "BAD_REQUEST",
  invalid_account: "BAD_REQUEST",
  locked: "CONFLICT",
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
  invalid_state: "CONFLICT",
};

async function run<T>(fn: (d: Db) => Promise<T>): Promise<T> {
  try {
    return await fn(await database());
  } catch (e) {
    if (e instanceof AccError) throw new TRPCError({ code: TRPC_CODE[e.code], message: e.message });
    if (store.isMissingAccSchema(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: ACC_NOT_INSTALLED_MESSAGE, cause: e });
    throw e;
  }
}

/**
 * Ajustes de la empresa para una MUTACIÓN; la primera vez siembra el plan de cuentas del PGC de pymes (inicio: 1 de
 * enero). Las consultas usan `current` y `chartMap`, que no escriben (en solo lectura no se crea nada).
 */
async function ready(db: Db): Promise<store.AccSettings> {
  const s = await store.getSettings(db);
  if (s) return s;
  await store.seed(db as unknown as store.TxExec, `${madridYear()}-01-01`);
  return (await store.getSettings(db))!;
}

/** Ajustes para una consulta, sin escribir: si la empresa aún no ha empezado, los de por defecto. */
async function current(db: Db, now = new Date()): Promise<store.AccSettings> {
  return (await store.getSettings(db)) ?? { startDate: `${madridYear(now)}-01-01`, lockedUntil: null, map: { ...ACC_DEFAULT_MAP }, lastSyncAt: null, lastSync: null };
}

/** Plan de cuentas para una consulta, sin escribir: el guardado o, si aún no se sembró, el del PGC de pymes. */
async function chart(db: Db): Promise<Array<AccAccount & { isSeed: boolean }>> {
  const list = await store.listAccounts(db);
  return list.length ? list : ACC_PGC_SEED.map((a) => ({ code: a.code, name: a.name, type: a.type, parentCode: null, isPostable: true, active: true, isSeed: true }));
}
const chartMap = async (db: Db) => new Map((await chart(db)).map((a) => [a.code, a as AccAccount]));

const names = (accounts: ReadonlyMap<string, AccAccount>) => new Map(Array.from(accounts, ([c, a]) => [c, a.name]));

/** Líneas de una reversión, sin volver a exigir que las cuentas sigan activas (deshace exactamente lo que había). */
function linesOf(d: AccDraft): EntryLine[] {
  return d.lines.map((l, i) => ({
    lineNo: i + 1,
    accountCode: l.accountCode,
    debitCents: l.debitCents,
    creditCents: l.creditCents,
    description: l.description ?? null,
    costCenterId: null,
    supplierId: null,
    companyId: null,
    taxRateBp: l.taxRateBp ?? null,
    taxBaseCents: l.taxBaseCents ?? null,
  }));
}

function checkPeriod(from: string, to: string) {
  if (!isAccDate(from) || !isAccDate(to)) throw new AccError("invalid_input", "Las fechas del periodo no son válidas (AAAA-MM-DD)");
  if (from > to) throw new AccError("invalid_input", "El periodo empieza después de terminar");
}

// ─── Generación de los asientos automáticos ─────────────────────────────────────

export interface SyncSummary {
  at: string;
  created: number;
  replaced: number;
  reversed: number;
  unchanged: number;
  /** Documentos nuevos o cambiados con fecha bloqueada, contabilizados hoy (primer día abierto). */
  deferred: number;
  /** Con fecha bloqueada y hoy también bloqueado: esperan a que se desbloquee. */
  blocked: number;
  truncated: boolean;
  errors: Array<{ key: string; message: string }>;
  /** Contabilizados, pero para revisar (gastos sin IVA real); hasta 50, y cuántos hay. */
  review: Array<{ key: string; message: string }>;
  reviewCount: number;
  failedGroups: Array<{ group: string; message: string }>;
}

type Outcome = "created" | "replaced" | "reversed" | "skipped";

async function applyAction(db: Db, a: SyncAction, accounts: ReadonlyMap<string, AccAccount>, lockedUntil: string | null, today: string, userId: number | null): Promise<Outcome> {
  const lines = a.type === "reverse" ? null : validateDraft(a.draft, accounts);
  return db.transaction(async (tx) => {
    let st = await store.lockSource(tx, a.key);
    if (!st) {
      if (a.type !== "create") return "skipped";
      await store.insertSource(tx, a.key);
      st = { entryId: null, hash: null, version: 0 };
    }
    if (a.type === "create" && st.entryId != null) return "skipped"; // otra generación lo hizo a la vez
    if (a.type !== "create") {
      if (st.entryId !== a.entryId) return "skipped";
      const old = await store.getEntry(tx, a.entryId, true);
      if (!old || old.reversedByEntryId != null) return "skipped";
      const date = autoReversalDate(old.date, lockedUntil, today);
      if (!date) throw new AccError("locked", `El asiento ${old.year}/${old.number} está en el periodo bloqueado y hoy también: desbloquéalo para corregirlo`);
      const rd = reversalDraft(old, date, a.type === "reverse" ? "el documento ya no lo pide (anulado, devuelto o borrado)" : "el documento cambió");
      await store.insertEntry(tx, rd, linesOf(rd), { sourceKey: `reverse:${old.id}`, reversesEntryId: old.id, userId });
    }
    if (a.type === "reverse") {
      await store.setSource(tx, a.key, null, null, st.version);
      return "reversed";
    }
    const version = st.version + 1;
    const e = await store.insertEntry(tx, a.draft, lines!, { sourceKey: `${a.key}#${version}`, reversesEntryId: null, userId });
    await store.setSource(tx, a.key, e.id, a.hash, version);
    return a.type === "create" ? "created" : "replaced";
  });
}

/** Genera (o corrige) los asientos automáticos de todos los documentos del Core desde la fecha de inicio. */
export async function sync(userId: number | null, now = new Date()): Promise<SyncSummary> {
  return run(async (db) => {
    const s = await ready(db);
    const [accounts, cats] = await Promise.all([store.accountMap(db), store.categoryAccounts(db)]);
    const read = await readSources(db, { startDate: s.startDate, map: s.map, categoryAccounts: cats });
    const existing = new Map(Array.from(await store.listSources(db)).filter(([k]) => keyInGroups(k, read.groups)));
    const actions = planSync(read.desired, existing);
    const today = madridDateKey(now);
    const summary: SyncSummary = {
      at: now.toISOString(),
      created: 0,
      replaced: 0,
      reversed: 0,
      unchanged: 0,
      deferred: 0,
      blocked: 0,
      truncated: actions.length > MAX_ACTIONS_PER_SYNC,
      errors: read.problems.slice(0, 50),
      review: read.review.slice(0, 50),
      reviewCount: read.review.length,
      failedGroups: read.failed.map((f) => ({ group: SOURCE_GROUP_LABELS[f.group], message: f.message })),
    };
    const pending = new Set(actions.map((a) => a.key));
    summary.unchanged = Array.from(read.desired.keys()).filter((k) => !pending.has(k)).length;
    for (const planned of actions.slice(0, MAX_ACTIONS_PER_SYNC)) {
      let a = planned;
      let deferred = false;
      if (a.type !== "reverse" && isLocked(a.draft.date, s.lockedUntil)) {
        // Al primer día abierto (la huella sigue siendo la del documento: no vuelve a pedirse)
        const draft = deferLockedDraft(a.draft, s.lockedUntil, today);
        if (!draft) {
          summary.blocked++;
          continue;
        }
        a = { ...a, draft };
        deferred = true;
      }
      try {
        const o = await applyAction(db, a, accounts, s.lockedUntil, today, userId);
        if (o !== "skipped") summary[o]++;
        if (o !== "skipped" && deferred) summary.deferred++;
      } catch (e) {
        if (store.isConcurrent(e)) continue;
        if (store.isMissingAccSchema(e)) throw e;
        if (summary.errors.length < 50) summary.errors.push({ key: a.key, message: e instanceof AccError ? e.message : "No se pudo contabilizar (error interno)" });
      }
    }
    await store.saveLastSync(db, summary);
    return summary;
  });
}

// ─── Resumen, ajustes y plan de cuentas ─────────────────────────────────────────

export async function overview(now = new Date()) {
  return run(async (db) => {
    const s = await current(db, now);
    const year = madridYear(now);
    const [counts, unbalanced, accounts, totals, yearTotals] = await Promise.all([
      store.counts(db),
      store.unbalancedEntries(db),
      chartMap(db),
      store.accountTotals(db, {}),
      store.accountTotals(db, { from: `${year}-01-01`, to: `${year}-12-31` }),
    ]);
    const balanceOf = (code: string) => totals.filter((t) => t.accountCode === code).reduce((a, t) => a + t.debitCents - t.creditCents, 0);
    const pnl = profitAndLoss(yearTotals, names(accounts));
    return {
      settings: { startDate: s.startDate, lockedUntil: s.lockedUntil, map: s.map },
      lastSyncAt: s.lastSyncAt,
      lastSync: s.lastSync as SyncSummary | null,
      counts,
      balanced: unbalanced.length === 0,
      unbalanced,
      year,
      yearRevenueCents: pnl.items.find((i) => i.key === "p1")?.cents ?? 0,
      yearResultCents: pnl.resultCents,
      balances: {
        customers: balanceOf(s.map.customers),
        suppliers: -balanceOf(s.map.suppliers),
        cash: balanceOf(s.map.cash),
        bank: balanceOf(s.map.bank),
        vatOutput: -balanceOf(s.map.vatOutput),
        vatInput: balanceOf(s.map.vatInput),
      },
    };
  });
}

export async function accountsList() {
  return run(async (db) => {
    const s = await current(db);
    const used = new Set(Object.values(s.map));
    return (await chart(db)).map((a) => ({ ...a, usedByAutomatic: used.has(a.code) }));
  });
}

export async function createAccount(input: { code: string; name: string }) {
  return run(async (db) => {
    await ready(db);
    const name = input.name.trim();
    if (!name) throw new AccError("invalid_input", "La subcuenta necesita un nombre");
    const accounts = await store.accountMap(db);
    const parent = subaccountParent(input.code.trim(), accounts);
    try {
      await store.insertAccount(db, { code: input.code.trim(), name: name.slice(0, 160), type: parent.type, parentCode: parent.code, isPostable: true, active: true });
    } catch (e) {
      if (store.isConcurrent(e)) throw new AccError("conflict", `La cuenta ${input.code} ya existe`);
      throw e;
    }
    return { code: input.code.trim(), parentCode: parent.code, type: parent.type };
  });
}

export async function updateAccount(input: { code: string; name: string; active: boolean }) {
  return run(async (db) => {
    const s = await ready(db);
    const name = input.name.trim();
    if (!name) throw new AccError("invalid_input", "La cuenta necesita un nombre");
    if (!input.active && Object.values(s.map).includes(input.code)) throw new AccError("invalid_state", `La cuenta ${input.code} la usan los asientos automáticos: cámbiala antes en Ajustes`);
    if (!input.active && new Set((await store.categoryAccounts(db)).values()).has(input.code)) {
      throw new AccError("invalid_state", `La cuenta ${input.code} está asignada a una categoría de gasto: cámbiala antes`);
    }
    if ((await store.updateAccount(db, input.code, { name: name.slice(0, 160), active: input.active })) === 0) throw new AccError("not_found", `La cuenta ${input.code} no existe`);
    return { ok: true };
  });
}

export async function settingsView() {
  return run(async (db) => {
    const s = await current(db);
    const [cats, catAccounts, counts] = await Promise.all([
      db.select({ id: expenseCategories.id, name: expenseCategories.name, active: expenseCategories.active }).from(expenseCategories),
      store.categoryAccounts(db),
      store.counts(db),
    ]);
    return {
      startDate: s.startDate,
      lockedUntil: s.lockedUntil,
      map: s.map,
      startDateEditable: counts.automatic === 0,
      categories: cats.map((c) => ({ id: c.id, name: c.name, active: !!c.active, accountCode: catAccounts.get(c.id) ?? null })),
    };
  });
}

function checkPostable(accounts: ReadonlyMap<string, AccAccount>, code: string, what: string) {
  const a = accounts.get(code);
  if (!a) throw new AccError("invalid_account", `${what}: la cuenta ${code} no existe`);
  if (!a.active) throw new AccError("invalid_account", `${what}: la cuenta ${code} está inactiva`);
  if (!a.isPostable) throw new AccError("invalid_account", `${what}: la cuenta ${code} no es imputable`);
}

export async function saveSettings(input: { startDate: string; lockedUntil: string | null; map: AccAccountMap }, userId: number | null) {
  return run(async (db) => {
    const s = await ready(db);
    if (!isAccDate(input.startDate)) throw new AccError("invalid_input", "La fecha de inicio no es válida");
    if (input.lockedUntil != null && !isAccDate(input.lockedUntil)) throw new AccError("invalid_input", "La fecha de bloqueo no es válida");
    if (input.startDate !== s.startDate && (await store.counts(db)).automatic > 0) {
      throw new AccError("invalid_state", "Ya hay asientos automáticos: la fecha de inicio no puede cambiarse (los documentos anteriores van en el asiento de apertura)");
    }
    const accounts = await store.accountMap(db);
    for (const k of ACC_MAP_KEYS) checkPostable(accounts, input.map[k], `Cuenta «${k}»`);
    if (input.map.cash === input.map.cashBridge) throw new AccError("invalid_input", "La caja y el puente de caja deben ser cuentas distintas");
    if (input.map.cash === input.map.bank) throw new AccError("invalid_input", "La caja y el banco deben ser cuentas distintas");
    await store.saveSettings(db, input, userId);
    return { ok: true };
  });
}

export async function saveCategoryAccount(input: { categoryId: number; accountCode: string | null }, userId: number | null) {
  return run(async (db) => {
    await ready(db);
    if (input.accountCode != null) {
      if (!input.accountCode.startsWith("6")) throw new AccError("invalid_input", "La cuenta de una categoría de gasto es del grupo 6");
      checkPostable(await store.accountMap(db), input.accountCode, "Categoría");
    }
    await store.setCategoryAccount(db, input.categoryId, input.accountCode, userId);
    return { ok: true };
  });
}

// ─── Asientos manuales ──────────────────────────────────────────────────────────

export async function createManualEntry(
  input: { date: string; journal: AccJournal; description: string; lines: Array<{ accountCode: string; debitCents: number; creditCents: number; description?: string | null }> },
  userId: number | null,
) {
  return run(async (db) => {
    const s = await ready(db);
    if (!(ACC_MANUAL_JOURNALS as readonly string[]).includes(input.journal)) throw new AccError("invalid_input", "Un asiento manual va en el diario general o en el de apertura");
    const draft: AccDraft = { journal: input.journal, date: input.date, description: input.description, origin: "manual", lines: input.lines };
    const lines = validateDraft(draft, await store.accountMap(db));
    if (isLocked(input.date, s.lockedUntil)) throw new AccError("locked", `El periodo hasta el ${s.lockedUntil} está bloqueado`);
    const e = await db.transaction((tx) => store.insertEntry(tx, { ...draft, description: draft.description.trim() }, lines, { sourceKey: null, reversesEntryId: null, userId }));
    return e;
  });
}

export async function reverseManualEntry(input: { id: number; date?: string | null; reason: string }, userId: number | null, now = new Date()) {
  return run(async (db) => {
    const s = await ready(db);
    const reason = input.reason.trim();
    if (!reason) throw new AccError("invalid_input", "Indica el motivo de la anulación");
    return db.transaction(async (tx) => {
      const e = await store.getEntry(tx, input.id, true);
      if (!e) throw new AccError("not_found", "El asiento no existe");
      if (e.origin !== "manual") throw new AccError("invalid_state", e.origin === "reversal" ? "Una reversión no se revierte" : "Un asiento automático se corrige desde su documento (factura, gasto, caja…) y se actualiza solo");
      if (e.reversedByEntryId != null) throw new AccError("conflict", "El asiento ya está revertido");
      const date = input.date ?? madridDateKey(now);
      if (!isAccDate(date)) throw new AccError("invalid_input", "La fecha no es válida");
      if (date < e.date) throw new AccError("invalid_input", "La reversión no puede ser anterior al asiento");
      if (isLocked(date, s.lockedUntil)) throw new AccError("locked", `El periodo hasta el ${s.lockedUntil} está bloqueado`);
      const rd = reversalDraft(e, date, reason);
      try {
        return await store.insertEntry(tx, rd, linesOf(rd), { sourceKey: `reverse:${e.id}`, reversesEntryId: e.id, userId });
      } catch (err) {
        if (store.isConcurrent(err)) throw new AccError("conflict", "El asiento ya está revertido");
        throw err;
      }
    });
  });
}

// ─── Libros e informes ──────────────────────────────────────────────────────────

export async function journal(input: { from: string; to: string; origin?: AccOrigin | null; page: number; pageSize: number }) {
  return run(async (db) => {
    checkPeriod(input.from, input.to);
    const [r, accounts] = await Promise.all([
      store.listEntries(db, { from: input.from, to: input.to, origin: input.origin ?? null, limit: input.pageSize, offset: (input.page - 1) * input.pageSize }),
      chartMap(db),
    ]);
    return { total: r.total, items: r.items.map((e) => ({ ...e, lines: e.lines.map((l) => ({ ...l, accountName: accounts.get(l.accountCode)?.name ?? "" })) })) };
  });
}

async function ledgerData(db: Db, input: { account: string; from: string; to: string }) {
  checkPeriod(input.from, input.to);
  const accounts = await chartMap(db);
  const a = accounts.get(input.account);
  if (!a) throw new AccError("not_found", `La cuenta ${input.account} no existe`);
  const [before, lines] = await Promise.all([store.postedLines(db, { before: input.from, accountPrefix: a.code }), store.postedLines(db, { from: input.from, to: input.to, accountPrefix: a.code })]);
  return { account: { code: a.code, name: a.name, type: a.type }, ...ledger(before, lines) };
}

export async function ledgerView(input: { account: string; from: string; to: string }) {
  return run(async (db) => {
    return ledgerData(db, input);
  });
}

async function trialData(db: Db, from: string, to: string) {
  checkPeriod(from, to);
  const [totals, accounts] = await Promise.all([store.accountTotals(db, { from, to }), chartMap(db)]);
  return { accounts, totals, trial: trialBalance(totals, accounts) };
}

export async function trialBalanceView(input: { from: string; to: string }) {
  return run(async (db) => {
    return (await trialData(db, input.from, input.to)).trial;
  });
}

export async function profitAndLossView(input: { from: string; to: string }) {
  return run(async (db) => {
    const d = await trialData(db, input.from, input.to);
    return profitAndLoss(d.totals, names(d.accounts));
  });
}

// ─── Exportación para la gestoría ───────────────────────────────────────────────

export type ExportKind = "journal" | "ledger" | "trial" | "pnl" | "workbook";

export async function exportFile(input: { kind: ExportKind; from: string; to: string; account?: string | null }): Promise<{ fileName: string; mime: string; base64: string }> {
  return run(async (db) => {
    checkPeriod(input.from, input.to);
    const suffix = `${input.from}_${input.to}`;
    const csv = (name: string, body: string) => ({ fileName: `${name}_${suffix}.csv`, mime: "text/csv;charset=utf-8", base64: Buffer.from(body, "utf8").toString("base64") });
    if (input.kind === "ledger") {
      if (!input.account) throw new AccError("invalid_input", "Elige la cuenta del mayor");
      const l = await ledgerData(db, { account: input.account, from: input.from, to: input.to });
      return csv(`mayor_${l.account.code}`, ledgerCsv(l.account, l));
    }
    const d = await trialData(db, input.from, input.to);
    if (input.kind === "trial") return csv("sumas_y_saldos", trialCsv(d.trial));
    const pnl = profitAndLoss(d.totals, names(d.accounts));
    if (input.kind === "pnl") return csv("perdidas_y_ganancias", pnlCsv(pnl));
    const lines: PostedLine[] = await store.postedLines(db, { from: input.from, to: input.to });
    if (input.kind === "journal") return csv("libro_diario", journalCsvOf(lines, names(d.accounts)));
    const buf = workbookXlsx({ title: "Contabilidad general", from: input.from, to: input.to, journal: lines, names: names(d.accounts), trial: d.trial, pnl });
    return { fileName: `contabilidad_${suffix}.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: buf.toString("base64") };
  });
}
