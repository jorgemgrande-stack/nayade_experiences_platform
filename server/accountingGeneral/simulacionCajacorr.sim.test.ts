/**
 * SIMULACIÓN (solo lectura sobre datos sintéticos): ¿qué pasaría si `"cajacorr:"` se añadiera a `SOURCE_GROUPS.cash`?
 *
 * No toca el código de producción: el «después» se obtiene con el MISMO `readCash`, el MISMO `planSync` y la MISMA
 * lógica de `sync()` (cupo, periodo bloqueado), cambiando únicamente el filtro de `existing` (service.ts:185, `keyInGroups`),
 * que es lo que decide qué claves existentes ve el plan. El «antes» usa `keyInGroups` real, con los grupos reales.
 *
 * Opt-in: SIM_CAJACORR_DATABASE_URL (servidor MySQL desechable; crea y borra su propia base). NO usa
 * REGISTRY_TEST_DATABASE_URL a propósito: no entra en `vitest run mysql` del CI bloqueante (aprovisionar la baseline y
 * las migraciones más 1.600 filas tarda del orden de decenas de segundos). En el job de pruebas normal se salta sola.
 * Con SIM_CAJACORR_REPORT=<ruta.json> vuelca las tablas antes/después para el documento SIMULACION-CAJACORR.md.
 *
 * Nunca se ejecuta `sync()`, ni contra una empresa real: aquí se emula su aplicación (applyAction) sobre filas sintéticas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";
import { ACC_DEFAULT_MAP } from "../../shared/accountingGeneral";
import { MysqlSchemaApplier } from "../_core/provisioning/mysqlAdapters";
import { SOURCE_GROUPS, keyInGroups, readCash, type SourceRead } from "./sources";
import { MAX_ACTIONS_PER_SYNC } from "./service";
import { autoReversalDate, deferLockedDraft, isLocked, planSync, type SyncAction } from "./rules";
import { madridMidnightMs } from "../utils/timezone";

const URL_ = process.env.SIM_CAJACORR_DATABASE_URL;
const REPORT = process.env.SIM_CAJACORR_REPORT;
const START = "2026-01-01";
const TODAY = "2026-11-27";
const ms = (d: string, h = 10) => new Date(`${d}T${String(h).padStart(2, "0")}:00:00Z`).getTime();

type Mode = "antes" | "despues";
interface LineOut { account: string; debitCents: number; creditCents: number }
interface Row { type: string; key: string; outcome: string; entryDate: string | null; lines: LineOut[]; note?: string }
interface Result {
  mode: Mode;
  planned: Record<string, number>;
  summary: { created: number; replaced: number; reversed: number; skipped: number; unchanged: number; deferred: number; blocked: number; truncated: boolean; pendingNextSync: number };
  rows: Row[];
  netByAccount: Record<string, number>;
}

describe.skipIf(!URL_)("Simulación · «cajacorr:» dentro de SOURCE_GROUPS.cash (datos sintéticos, sin sync real)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let db: ReturnType<typeof drizzle>;
  let dbName = "";
  const report: Record<string, { antes: Result; despues: Result; nota?: string }> = {};
  const ctx = { startDate: START, map: ACC_DEFAULT_MAP, categoryAccounts: new Map<number, string>() };
  const q = (s: string, p: unknown[] = []) => pool.query(s, p as any[]);

  beforeAll(async () => {
    const u = new URL(URL_!);
    dbName = `sim_cajacorr_${crypto.randomBytes(3).toString("hex")}`;
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`CREATE DATABASE ${dbName} CHARACTER SET utf8mb4`);
    u.pathname = `/${dbName}`;
    const applier = new MysqlSchemaApplier({ baselinePath: path.resolve(__dirname, "../../db/baseline/0000_baseline.sql"), migrationsDir: process.env.TEST_MIGRATIONS_DIR ?? path.resolve(__dirname, "../../db/migrations") });
    await applier.apply(u.toString());
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 4 });
    db = drizzle(pool);
  }, 300_000);

  afterAll(async () => {
    if (REPORT && Object.keys(report).length) fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    await pool?.end().catch(() => undefined);
    if (admin && dbName) await admin.query(`DROP DATABASE IF EXISTS ${dbName}`).catch(() => undefined);
    await admin?.end().catch(() => undefined);
  });

  // ── Siembra ────────────────────────────────────────────────────────────────────────────────────────────────────
  const reset = async () => {
    await q("SET FOREIGN_KEY_CHECKS = 0");
    for (const t of ["tpv_session_corrections", "cash_movements", "cash_sessions", "cash_registers", "acc_sources", "acc_entry_lines", "acc_entries", "acc_cash_movement_kinds", "expenses"]) await q(`TRUNCATE TABLE ${t}`);
    await q("SET FOREIGN_KEY_CHECKS = 1");
    await q("INSERT INTO cash_registers (name, createdAt) VALUES ('Mostrador', 1)");
    // Sesión 1: cerrada con cuadre exacto (no genera asiento de cierre), fecha anterior a las correcciones
    await q("INSERT INTO cash_sessions (registerId, cashierUserId, cashierName, status_cs, openedAt, closedAt, cashDifference) VALUES (1, 1, 'Sintético', 'closed', ?, ?, '0.00')", [ms("2026-03-01", 8), ms("2026-03-01", 18)]);
  };
  const addCorr = async (kind: string, amount: string, reason: string, date = "2026-03-10", n = 1) => {
    const [r]: any = await q("INSERT INTO tpv_session_corrections (session_id, kind, amount, reason, idempotency_key, created_at) VALUES (1, ?, ?, ?, ?, ?)", [kind, amount, reason, crypto.randomUUID(), ms(date) + n]);
    return Number(r.insertId);
  };
  const addMove = async (type: "in" | "out", amount: string, reason: string, date: string) => {
    const [r]: any = await q("INSERT INTO cash_movements (sessionId, type_cm, amount, reason, createdAt) VALUES (1, ?, ?, ?, ?)", [type, amount, reason, ms(date)]);
    return Number(r.insertId);
  };
  const readDesired = async () => {
    const out: SourceRead = { desired: new Map(), groups: [], failed: [], problems: [], review: [] };
    await readCash(db as any, ctx, out);
    return out.desired;
  };
  /** Deja asentados (con su asiento vigente y su huella) los documentos indicados, tal como los dejaría una generación previa. */
  let nextNumber = 1;
  const settle = async (keys: string[] | "all", only?: (k: string) => boolean) => {
    const desired = await readDesired();
    const entries: any[] = [];
    const lines: any[] = [];
    const srcs: any[] = [];
    let id = Number(((await q("SELECT COALESCE(MAX(id),0) AS m FROM acc_entries"))[0] as any)[0].m);
    desired.forEach((d, key) => {
      if (d.kind !== "entry") return;
      if (keys !== "all" && !keys.includes(key)) return;
      if (only && !only(key)) return;
      id++;
      const dr = d.draft;
      const total = dr.lines.reduce((a, l) => a + l.debitCents, 0);
      entries.push([id, Number(dr.date.slice(0, 4)), nextNumber++, dr.date, dr.journal, dr.description, dr.origin, `${key}#1`, total]);
      dr.lines.forEach((l, i) => lines.push([id, i + 1, l.accountCode, l.debitCents, l.creditCents]));
      srcs.push([key, id, d.hash, 1]);
    });
    for (let i = 0; i < entries.length; i += 400) {
      await q("INSERT INTO acc_entries (id, year, number, entry_date, journal, description, origin, source_key, total_cents) VALUES ?", [entries.slice(i, i + 400)]);
      await q("INSERT INTO acc_entry_lines (entry_id, line_no, account_code, debit_cents, credit_cents) VALUES ?", [lines.filter((l) => l[0] > entries[i][0] - 1 && l[0] <= entries[Math.min(i + 399, entries.length - 1)][0])]);
      await q("INSERT INTO acc_sources (source_key, entry_id, hash, version) VALUES ?", [srcs.slice(i, i + 400)]);
    }
    return srcs.length;
  };

  // ── Emulación de plan + aplicación (copia fiel de sync()/applyAction, sin escribir nada) ───────────────────────────
  const run = async (mode: Mode, lockedUntil: string | null = null): Promise<Result> => {
    const desired = await readDesired();
    // service.ts:185 — única diferencia entre «antes» y «después»: qué claves existentes ve el plan
    const visible = (k: string) => keyInGroups(k, ["cash"]) || (mode === "despues" && k.startsWith("cajacorr:"));
    const all = new Map<string, { entryId: number | null; hash: string | null }>();
    const [sr]: any = await q("SELECT source_key, entry_id, hash FROM acc_sources");
    for (const r of sr) all.set(r.source_key, { entryId: r.entry_id == null ? null : Number(r.entry_id), hash: r.hash });
    const existing = new Map(Array.from(all).filter(([k]) => visible(k)));
    const actions: SyncAction[] = planSync(desired, existing);
    const planned: Record<string, number> = { create: 0, replace: 0, reverse: 0 };
    actions.forEach((a) => planned[a.type]++);
    const pending = new Set(actions.map((a) => a.key));
    const summary = { created: 0, replaced: 0, reversed: 0, skipped: 0, unchanged: Array.from(desired.keys()).filter((k) => !pending.has(k)).length, deferred: 0, blocked: 0, truncated: actions.length > MAX_ACTIONS_PER_SYNC, pendingNextSync: Math.max(0, actions.length - MAX_ACTIONS_PER_SYNC) };
    const rows: Row[] = [];
    const net: Record<string, number> = {};
    const post = (ls: LineOut[]) => ls.forEach((l) => (net[l.account] = (net[l.account] ?? 0) + l.debitCents - l.creditCents));
    const oldLines = async (entryId: number) => {
      const [r]: any = await q("SELECT e.entry_date AS d, l.account_code AS a, l.debit_cents AS dc, l.credit_cents AS cc FROM acc_entries e JOIN acc_entry_lines l ON l.entry_id = e.id WHERE e.id = ? ORDER BY l.line_no", [entryId]);
      return { date: String(r[0] ? (r[0].d instanceof Date ? `${r[0].d.getFullYear()}-${String(r[0].d.getMonth() + 1).padStart(2, "0")}-${String(r[0].d.getDate()).padStart(2, "0")}` : r[0].d) : ""), lines: r.map((x: any) => ({ account: x.a, debitCents: Number(x.dc), creditCents: Number(x.cc) })) as LineOut[] };
    };
    const inv = (ls: LineOut[]): LineOut[] => ls.map((l) => ({ account: l.account, debitCents: l.creditCents, creditCents: l.debitCents }));
    const mine = (ls: SyncAction & { draft?: any }) => ((ls as any).draft?.lines ?? []).map((l: any) => ({ account: l.accountCode, debitCents: l.debitCents, creditCents: l.creditCents })) as LineOut[];
    for (const planned_ of actions.slice(0, MAX_ACTIONS_PER_SYNC)) {
      let a = planned_;
      let deferred = false;
      if (a.type !== "reverse" && isLocked(a.draft.date, lockedUntil)) {
        const d = deferLockedDraft(a.draft, lockedUntil, TODAY);
        if (!d) { summary.blocked++; rows.push({ type: a.type, key: a.key, outcome: "bloqueado", entryDate: a.draft.date, lines: [] }); continue; }
        a = { ...a, draft: d };
        deferred = true;
      }
      const st = all.get(a.key);
      // applyAction
      if (a.type === "create") {
        if (st && st.entryId != null) { summary.skipped++; rows.push({ type: "create", key: a.key, outcome: "skipped", entryDate: null, lines: [] }); continue; }
        const ls = mine(a);
        post(ls); summary.created++; if (deferred) summary.deferred++;
        rows.push({ type: "create", key: a.key, outcome: "created", entryDate: a.draft.date, lines: ls, note: deferred ? "periodo bloqueado: a hoy" : undefined });
        continue;
      }
      if (!st || st.entryId !== (a as any).entryId) { summary.skipped++; rows.push({ type: a.type, key: a.key, outcome: "skipped", entryDate: null, lines: [] }); continue; }
      const old = await oldLines(st.entryId!);
      const rdate = autoReversalDate(old.date, lockedUntil, TODAY);
      if (!rdate) { summary.blocked++; rows.push({ type: a.type, key: a.key, outcome: "error:bloqueado", entryDate: old.date, lines: [] }); continue; }
      const rev = inv(old.lines);
      post(rev);
      if (a.type === "reverse") {
        summary.reversed++;
        rows.push({ type: "reverse", key: a.key, outcome: "reversed", entryDate: rdate, lines: rev, note: lockedUntil && old.date <= lockedUntil ? `revierte asiento del ${old.date} (periodo bloqueado) con fecha ${rdate}` : undefined });
      } else {
        const ls = mine(a);
        post(ls); summary.replaced++; if (deferred) summary.deferred++;
        rows.push({ type: "replace", key: a.key, outcome: "replaced", entryDate: a.draft.date, lines: [...rev, ...ls], note: `reversión (${rdate}) + nuevo asiento (${a.draft.date})${lockedUntil && old.date <= lockedUntil ? " [periodo bloqueado]" : ""}` });
      }
    }
    Object.keys(net).forEach((k) => net[k] === 0 && delete net[k]);
    return { mode, planned, summary, rows, netByAccount: net };
  };
  const both = async (name: string, lockedUntil: string | null = null, nota?: string) => {
    const antes = await run("antes", lockedUntil);
    const despues = await run("despues", lockedUntil);
    report[name] = { antes, despues, nota };
    return { antes, despues };
  };
  const key = (id: number) => `cajacorr:${id}`;

  // ── Escenarios ─────────────────────────────────────────────────────────────────────────────────────────────────
  it("E1 · sin correcciones: antes y después idénticos", async () => {
    await reset();
    const m = await addMove("out", "10.00", "Cambio de monedas", "2026-03-05");
    await settle([`cajamov:${m}`]);
    const { antes, despues } = await both("E1 sin correcciones");
    expect(antes.rows).toEqual([]);
    expect(despues.rows).toEqual([]);
    expect(antes.summary).toEqual(despues.summary);
    expect(despues.summary.unchanged).toBe(2); // cajamov asentado + cierre sin diferencia (sin asiento)
  });

  it("E2 · correcciones nunca contabilizadas: se crean igual antes y después (hoy el primer sync SÍ las asienta)", async () => {
    await reset();
    await addCorr("cash_in", "50.00", "Entrada olvidada", "2026-03-10", 1);
    await addCorr("cash_out", "20.00", "Salida olvidada", "2026-03-10", 2);
    await addCorr("count_adjustment", "5.00", "Sobrante recontado", "2026-03-11", 3);
    await addCorr("count_adjustment", "-3.50", "Faltante recontado", "2026-03-11", 4);
    const { antes, despues } = await both("E2 nunca asentadas");
    expect(antes.summary.created).toBe(4);
    expect(despues.summary.created).toBe(4);
    expect(antes.netByAccount).toEqual(despues.netByAccount);
    expect(despues.netByAccount["570"]).toBe(5000 - 2000 + 500 - 350);
  });

  it("E3 · correcciones ya asentadas sin cambios: hoy 'create' saltado en cada sync; después 'unchanged'", async () => {
    await reset();
    await addCorr("cash_in", "50.00", "Entrada olvidada", "2026-03-10", 1);
    await addCorr("cash_out", "20.00", "Salida olvidada", "2026-03-10", 2);
    await addCorr("count_adjustment", "5.00", "Sobrante recontado", "2026-03-11", 3);
    await addCorr("count_adjustment", "-3.50", "Faltante recontado", "2026-03-11", 4);
    expect(await settle("all")).toBe(4);
    const { antes, despues } = await both("E3 asentadas sin cambios");
    expect(antes.planned).toEqual({ create: 4, replace: 0, reverse: 0 });
    expect(antes.summary).toMatchObject({ created: 0, skipped: 4, unchanged: 1, truncated: false });
    expect(despues.planned).toEqual({ create: 0, replace: 0, reverse: 0 });
    expect(despues.summary).toMatchObject({ created: 0, skipped: 0, unchanged: 5 });
    expect(despues.netByAccount).toEqual({});
  });

  it("E4 · corrección con importe cambiado tras asentarse: hoy se ignora; después se sustituye (reversión + nuevo)", async () => {
    await reset();
    const a = await addCorr("cash_in", "50.00", "Entrada olvidada", "2026-03-10", 1);
    const b = await addCorr("count_adjustment", "5.00", "Sobrante recontado", "2026-03-11", 2);
    await settle("all");
    await q("UPDATE tpv_session_corrections SET amount = '80.00' WHERE id = ?", [a]);
    await q("UPDATE tpv_session_corrections SET amount = '-7.00' WHERE id = ?", [b]);
    const { antes, despues } = await both("E4 importe cambiado");
    expect(antes.summary).toMatchObject({ replaced: 0, skipped: 2 });
    expect(despues.summary).toMatchObject({ replaced: 2, skipped: 0 });
    // Efecto neto en 570: +30,00 (50→80) y -12,00 (+5→-7)
    expect(despues.netByAccount["570"]).toBe(3000 - 1200);
    expect(despues.netByAccount["555"]).toBe(-3000);
  });

  it("E4b · lo mismo con el periodo bloqueado (hasta 30/06): el cambio cae al primer día abierto (hoy), con la fecha original en la descripción", async () => {
    await reset();
    const a = await addCorr("cash_in", "50.00", "Entrada olvidada", "2026-03-10", 1);
    await settle("all");
    await q("UPDATE tpv_session_corrections SET amount = '80.00' WHERE id = ?", [a]);
    const { antes, despues } = await both("E4b importe cambiado con periodo bloqueado", "2026-06-30");
    expect(antes.summary).toMatchObject({ replaced: 0, skipped: 1 });
    expect(despues.summary).toMatchObject({ replaced: 1, deferred: 1 });
    expect(despues.rows[0].entryDate).toBe(TODAY);
  });

  it("E5 · corrección eliminada tras asentarse: hoy el asiento queda vivo para siempre; después se revierte", async () => {
    await reset();
    const a = await addCorr("cash_out", "20.00", "Salida olvidada", "2026-03-10", 1);
    const b = await addCorr("count_adjustment", "-3.50", "Faltante recontado", "2026-03-11", 2);
    await settle("all");
    await q("DELETE FROM tpv_session_corrections WHERE id IN (?, ?)", [a, b]);
    const { antes, despues } = await both("E5 eliminada");
    expect(antes.planned).toEqual({ create: 0, replace: 0, reverse: 0 });
    expect(antes.rows).toEqual([]);
    expect(despues.summary).toMatchObject({ reversed: 2 });
    expect(despues.netByAccount["570"]).toBe(2000 + 350);
  });

  it("E5b · corrección eliminada con asiento en periodo bloqueado: la reversión se fecha hoy", async () => {
    await reset();
    const a = await addCorr("cash_out", "20.00", "Salida olvidada", "2026-03-10", 1);
    await settle("all");
    await q("DELETE FROM tpv_session_corrections WHERE id = ?", [a]);
    const { despues } = await both("E5b eliminada con periodo bloqueado", "2026-06-30");
    expect(despues.rows[0]).toMatchObject({ outcome: "reversed", entryDate: TODAY });
  });

  it("E6 · count_adjustment frente a cash_in / cash_out: cuentas y signos", async () => {
    await reset();
    await addCorr("cash_in", "50.00", "Entrada", "2026-03-10", 1);
    await addCorr("cash_out", "20.00", "Salida", "2026-03-10", 2);
    await addCorr("cash_out", "12.00", "Devolución a cliente", "2026-03-10", 3);
    await addCorr("count_adjustment", "5.00", "Sobrante", "2026-03-11", 4);
    await addCorr("count_adjustment", "-3.50", "Faltante", "2026-03-11", 5);
    await addCorr("count_adjustment", "0.00", "Sin diferencia", "2026-03-11", 6);
    await addCorr("cash_in", "0.00", "Entrada a cero", "2026-03-11", 7);
    await addCorr("otro_tipo", "9.00", "Tipo desconocido", "2026-03-11", 8);
    const { antes, despues } = await both("E6 tipos de corrección");
    const by = (r: Result) => Object.fromEntries(r.rows.map((x) => [x.key, x.lines.map((l) => `${l.account} D${l.debitCents} H${l.creditCents}`).join(" | ")]));
    const rows = by(despues);
    expect(Object.keys(rows).length).toBe(6); // las dos a cero no generan asiento
    expect(rows[key(1)]).toBe("570 D5000 H0 | 555 D0 H5000");
    expect(rows[key(2)]).toBe("570 D0 H2000 | 555 D2000 H0");
    expect(rows[key(3)]).toContain("430"); // el motivo «Devolución…» cambia la contrapartida a clientes
    expect(rows[key(4)]).toBe("570 D500 H0 | 778 D0 H500");
    expect(rows[key(5)]).toBe("678 D350 H0 | 570 D0 H350");
    expect(rows[key(8)]).toBe("570 D900 H0 | 555 D0 H900"); // kind desconocido se trata como entrada
    expect(by(antes)).toEqual(rows); // en la primera generación el resultado es el mismo
  });

  it("E7 · cupo de 1.500: 1.600 correcciones asentadas desplazan a las novedades reales hoy; después no", async () => {
    await reset();
    const rows: any[] = [];
    for (let i = 0; i < 1600; i++) rows.push([1, "cash_in", "1.00", `Histórica ${i}`, crypto.randomUUID(), ms("2026-02-01") + i]);
    for (let i = 0; i < rows.length; i += 400) await q("INSERT INTO tpv_session_corrections (session_id, kind, amount, reason, idempotency_key, created_at) VALUES ?", [rows.slice(i, i + 400)]);
    expect(await settle("all")).toBe(1600);
    // 20 movimientos de caja NUEVOS (fecha posterior): lo que el sync debería asentar
    for (let i = 0; i < 20; i++) await addMove("in", "2.00", `Novedad ${i}`, "2026-11-20");
    const { antes, despues } = await both("E7 cupo con 1600 asentadas");
    expect(antes.planned.create).toBe(1620);
    expect(antes.summary).toMatchObject({ truncated: true, created: 0, skipped: 1500, pendingNextSync: 120 });
    expect(despues.planned).toEqual({ create: 20, replace: 0, reverse: 0 });
    expect(despues.summary).toMatchObject({ truncated: false, created: 20, unchanged: 1601 });
  });

  it("E7b · edición masiva de 1.600 correcciones asentadas: después se aplican 1.500 y quedan 100 para el siguiente sync", async () => {
    await reset();
    const rows: any[] = [];
    for (let i = 0; i < 1600; i++) rows.push([1, "cash_in", "1.00", `Histórica ${i}`, crypto.randomUUID(), ms("2026-02-01") + i]);
    for (let i = 0; i < rows.length; i += 400) await q("INSERT INTO tpv_session_corrections (session_id, kind, amount, reason, idempotency_key, created_at) VALUES ?", [rows.slice(i, i + 400)]);
    await settle("all");
    await q("UPDATE tpv_session_corrections SET amount = '3.00'");
    const { antes, despues } = await both("E7b edición masiva");
    expect(antes.summary).toMatchObject({ replaced: 0, skipped: 1500, truncated: true });
    expect(despues.summary).toMatchObject({ replaced: 1500, truncated: true, pendingNextSync: 100 });
    expect(despues.netByAccount["570"]).toBe(1500 * 200);
  });

  it("E8 · solo lectura: la simulación no modificó asientos ni fuentes (conteos estables)", async () => {
    await reset();
    await addCorr("cash_in", "50.00", "Entrada", "2026-03-10", 1);
    await settle("all");
    const count = async () => JSON.stringify([(await q("SELECT COUNT(*) c FROM acc_entries"))[0], (await q("SELECT COUNT(*) c FROM acc_sources"))[0]]);
    const before = await count();
    await both("E8 solo lectura");
    expect(await count()).toBe(before);
    expect(SOURCE_GROUPS.cash).toEqual(["cierre:", "cajamov:"]); // el código de producción no se tocó
  });

  void sql;
});
