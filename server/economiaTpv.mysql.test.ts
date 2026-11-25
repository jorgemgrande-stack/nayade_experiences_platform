/**
 * Resúmenes del filtro completo del TPV (Operaciones, Remesas y estado de la conciliación) sobre MySQL real (opt-in:
 * REGISTRY_TEST_DATABASE_URL, una URL con permiso para crear bases de datos; en CI está disponible). Se crean DOS bases
 * temporales con las tablas reales del esquema base (db/baseline/0000_baseline.sql) y se comprueba, con volumen y varios filtros:
 *  1. el resumen == suma de los registros que devuelve el listado con el MISMO filtro (páginas incluidas);
 *  2. sin filtro == suma de todo lo sembrado (calculado aparte, en céntimos enteros);
 *  3. aislamiento: cada conexión cuenta solo lo suyo (la otra empresa no suma);
 *  4. decimales: céntimos, importes de siete cifras y negativos exactos (sin coma flotante);
 *  5. filtro sin resultados → ceros; % y _ de la búsqueda se toman literalmente.
 * Uso local: REGISTRY_TEST_DATABASE_URL=mysql://root:clave@127.0.0.1:33981/mysql npx vitest run server/economiaTpv.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { listBatchesPage, listOperationsPage, summarizeBatches, summarizeOperations, BATCH_STATUSES, type BatchFilters, type BatchStatus, type OperationFilters } from "./cardTerminalQuery";
import { madridEndOfDayUtc, madridStartOfDayUtc } from "./utils/timezone";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const baseline = fs.readFileSync(path.resolve(__dirname, "../db/baseline/0000_baseline.sql"), "utf8");
const ddl = (table: string) => {
  const m = new RegExp("CREATE TABLE IF NOT EXISTS `" + table + "` \\([\\s\\S]*?\\n\\) ENGINE[^;]*;").exec(baseline);
  if (!m) throw new Error(`tabla ${table} no encontrada en el esquema base`);
  return m[0];
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const toCents = (v: string | number) => BigInt(Math.round(Number(v) * 100));
const fmt = (c: bigint) => `${c < 0n ? "-" : ""}${(c < 0n ? -c : c) / 100n}.${String((c < 0n ? -c : c) % 100n).padStart(2, "0")}`;
const sumC = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);
const pad = (n: number) => String(n).padStart(2, "0");

type OpStatus = "pendiente" | "conciliado" | "incidencia" | "ignorado" | "included_in_batch" | "settled";
type Op = { dt: string; num: string; terminal: string; type: "VENTA" | "DEVOLUCION" | "ANULACION" | "OTRO"; amount: string; card: string; auth: string; status: OpStatus; imp: number; key: string };

function seedOps(tag: string, seed: number, n: number): Op[] {
  const r = rng(seed);
  const types = ["VENTA", "VENTA", "VENTA", "DEVOLUCION", "ANULACION", "OTRO"] as const;
  const sts: OpStatus[] = ["pendiente", "pendiente", "conciliado", "conciliado", "conciliado", "incidencia", "ignorado", "included_in_batch", "settled"];
  const out: Op[] = [];
  for (let i = 0; i < n; i++) {
    const big = i % 41 === 0;
    const cents = big ? 999_999_000 + Math.floor(r() * 999) : Math.floor(r() * 250_000) + 1; // hasta 9.999.999,99
    out.push({
      dt: `2026-${pad(1 + Math.floor(r() * 11))}-${pad(1 + Math.floor(r() * 27))} ${pad(Math.floor(r() * 24))}:${pad(Math.floor(r() * 60))}:00`,
      num: `${tag}${100000 + i}`,
      terminal: ["T01", "T02", "T_03"][Math.floor(r() * 3)],
      type: types[Math.floor(r() * types.length)],
      amount: fmt(BigInt(cents)),
      card: `****${1000 + Math.floor(r() * 8999)}`,
      auth: r() < 0.3 ? "" : `AUT${Math.floor(r() * 99999)}`,
      status: sts[Math.floor(r() * sts.length)],
      imp: 1 + Math.floor(r() * 3),
      key: `${tag}-${i}`,
    });
  }
  return out;
}
const dtMs = (s: string) => Date.parse(s.replace(" ", "T") + "Z");
const opExpected = (rows: Op[], status?: OpStatus | "todos") => {
  const chosen = rows.filter((x) => !status || status === "todos" || x.status === status);
  const live = chosen.filter((x) => x.status !== "ignorado");
  const ventas = sumC(live.filter((x) => x.type === "VENTA").map((x) => toCents(x.amount)));
  const dev = sumC(live.filter((x) => x.type === "DEVOLUCION").map((x) => toCents(x.amount)));
  const c = (s: OpStatus) => rows.filter((x) => x.status === s).length;
  const otros = rows.filter((x) => x.status === "included_in_batch" || x.status === "settled").length;
  return {
    count: chosen.length,
    ventas: fmt(ventas),
    devoluciones: fmt(dev),
    neto: fmt(ventas - dev),
    byStatus: { pendiente: c("pendiente"), conciliado: c("conciliado"), incidencia: c("incidencia"), ignorado: c("ignorado"), otros, total: rows.length },
  };
};

type Bt = { date: string; terminal: string; net: string; status: BatchStatus; diff: string | null; created: string };
function seedBatches(seed: number, n: number): Bt[] {
  const r = rng(seed);
  const sts: BatchStatus[] = ["pending", "suggested", "auto_ready", "reconciled", "reconciled", "difference", "ignored", "review_required"];
  const out: Bt[] = [];
  for (let i = 0; i < n; i++) {
    const big = i % 37 === 0;
    const neg = r() < 0.1;
    const cents = big ? 999_999_000 + Math.floor(r() * 999) : Math.floor(r() * 400_000) + 1;
    const status = sts[Math.floor(r() * sts.length)];
    out.push({
      date: `2026-${pad(1 + Math.floor(r() * 11))}-${pad(1 + Math.floor(r() * 27))}`,
      terminal: ["T01", "T02"][Math.floor(r() * 2)],
      net: fmt(neg ? -BigInt(cents) : BigInt(cents)),
      status,
      diff: status === "difference" || (status === "reconciled" && r() < 0.2) ? fmt(BigInt(Math.floor(r() * 9000) - 4500)) : null,
      created: `2026-12-01 10:${pad(i % 60)}:${pad(Math.floor(i / 60))}`,
    });
  }
  return out;
}
const bucket = (rows: Bt[]) => ({ count: rows.length, amount: fmt(sumC(rows.map((x) => toCents(x.net)))) });
const batchExpected = (all: Bt[], status?: BatchStatus) => {
  const chosen = all.filter((x) => !status || x.status === status);
  const by = {} as Record<BatchStatus, { count: number; amount: string; difference: string }>;
  for (const s of BATCH_STATUSES) {
    const rows = all.filter((x) => x.status === s);
    by[s] = { ...bucket(rows), difference: fmt(sumC(rows.map((x) => toCents(x.diff ?? "0")))) };
  }
  const grp = (...ss: BatchStatus[]) => bucket(all.filter((x) => ss.includes(x.status)));
  const rec = grp("reconciled", "difference");
  return {
    count: chosen.length,
    net: fmt(sumC(chosen.map((x) => toCents(x.net)))),
    byStatus: by,
    conciliation: {
      total: bucket(all),
      reconciled: rec,
      pending: grp("pending", "suggested", "auto_ready", "review_required"),
      difference: { count: by.difference.count, amount: by.difference.difference },
      attention: { autoReady: grp("auto_ready"), suggested: grp("suggested"), reviewRequired: grp("review_required") },
      pctReconciled: all.length ? Math.round((rec.count / all.length) * 100) : 0,
    },
  };
};

describe.skipIf(!URL_)("Resúmenes del filtro completo del TPV sobre MySQL", () => {
  const stamp = Date.now().toString(36);
  const names = { a: `e4tpv_a_${stamp}`, b: `e4tpv_b_${stamp}` };
  let admin: mysql.Pool;
  const pools = {} as Record<"a" | "b", mysql.Pool>;
  const dbs = {} as Record<"a" | "b", ReturnType<typeof drizzle>>;
  const opsA = seedOps("A", 11, 300);
  const opsB = seedOps("B", 22, 90);
  const btA = seedBatches(33, 130);
  const btB = seedBatches(44, 40);

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    for (const k of ["a", "b"] as const) {
      await admin.query(`CREATE DATABASE \`${names[k]}\` CHARACTER SET utf8mb4`);
      const u = new URL(URL_!);
      u.pathname = `/${names[k]}`;
      pools[k] = mysql.createPool({ uri: u.toString(), connectionLimit: 4, timezone: "Z" });
      for (const t of ["card_terminal_operations", "card_terminal_batches"]) await pools[k].query(ddl(t));
      dbs[k] = drizzle(pools[k]);
    }
    const putOps = async (k: "a" | "b", rows: Op[]) => {
      const c = await pools[k].getConnection();
      try {
        await c.query("SET time_zone = '+00:00'");
        for (const o of rows) {
          await c.query(
            "INSERT INTO card_terminal_operations (operation_datetime, operation_number, terminal_code, operation_type, amount, card, authorization_code, status, import_id, duplicate_key) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [o.dt, o.num, o.terminal, o.type, o.amount, o.card, o.auth || null, o.status, o.imp, o.key],
          );
        }
      } finally {
        c.release();
      }
    };
    const putBatches = async (k: "a" | "b", rows: Bt[]) => {
      for (const b of rows) {
        await pools[k].query(
          "INSERT INTO card_terminal_batches (batch_date, terminal_code, total_net, status, difference_amount, created_at) VALUES (?,?,?,?,?,?)",
          [b.date, b.terminal, b.net, b.status, b.diff, new Date(b.created.replace(" ", "T") + "Z")],
        );
      }
    };
    await putOps("a", opsA);
    await putOps("b", opsB);
    await putBatches("a", btA);
    await putBatches("b", btB);
  }, 300_000);

  afterAll(async () => {
    for (const k of ["a", "b"] as const) await pools[k]?.end().catch(() => {});
    await admin?.end().catch(() => {});
  });

  // ── Operaciones ─────────────────────────────────────────────────────────────────────────────────────────────────
  // Las fechas se sembraron en UTC con la conexión en UTC; el filtro usa el día de Madrid, igual que el listado de siempre.
  const inRange = (o: Op, from?: string, to?: string) => (!from || dtMs(o.dt) >= madridStartOfDayUtc(from).getTime()) && (!to || dtMs(o.dt) <= madridEndOfDayUtc(to).getTime());
  const opFilters: Array<[string, OperationFilters, (o: Op) => boolean]> = [
    ["sin filtro", {}, () => true],
    ["pendientes", { status: "pendiente" }, (o) => o.status === "pendiente"],
    ["incidencias", { status: "incidencia" }, (o) => o.status === "incidencia"],
    ["devoluciones", { operationType: "DEVOLUCION" }, (o) => o.type === "DEVOLUCION"],
    ["importación 2", { importId: 2 }, (o) => o.imp === 2],
    ["rango de fechas", { dateFrom: "2026-03-01", dateTo: "2026-08-31" }, (o) => inRange(o, "2026-03-01", "2026-08-31")],
    ["búsqueda por nº", { search: "a1000" }, (o) => o.num.toLowerCase().includes("a1000")],
    ["búsqueda por tarjeta", { search: "****12" }, (o) => o.card.includes("****12")],
    ["búsqueda por autorización", { search: "aut9" }, (o) => o.auth.toLowerCase().includes("aut9")],
    ["_ literal", { search: "T_03" }, (o) => o.terminal === "T_03"],
    ["todo combinado", { status: "conciliado", operationType: "VENTA", importId: 1, dateFrom: "2026-02-01", dateTo: "2026-10-31", search: "t0" }, (o) => o.status === "conciliado" && o.type === "VENTA" && o.imp === 1 && inRange(o, "2026-02-01", "2026-10-31") && o.terminal.toLowerCase().includes("t0")],
  ];

  it.each(opFilters)("Operaciones · %s: el resumen == suma del listado con el mismo filtro", async (_n, f, ref) => {
    const rows: any[] = [];
    let total = -1;
    for (let page = 1; ; page++) {
      const r = await listOperationsPage(dbs.a, { ...f, page, pageSize: 50 });
      total = r.total;
      rows.push(...r.rows);
      if (r.rows.length < 50) break;
    }
    const s = await summarizeOperations(dbs.a, f);
    expect(s.count).toBe(total);
    expect(s.count).toBe(rows.length);
    // Contra el listado devuelto por el servidor (ventas/devoluciones/neto, sin ignoradas)
    const fromList = opExpected(rows.map((x) => ({ dt: "", num: x.operationNumber, terminal: x.terminalCode, type: x.operationType, amount: x.amount, card: x.card, auth: x.authorizationCode ?? "", status: x.status, imp: x.importId, key: "" })));
    expect({ ventas: s.ventas, devoluciones: s.devoluciones, neto: s.neto }).toEqual({ ventas: fromList.ventas, devoluciones: fromList.devoluciones, neto: fromList.neto });
    // y contra lo sembrado, con el mismo predicado
    const exp = opExpected(opsA.filter(ref));
    expect({ count: s.count, ventas: s.ventas, devoluciones: s.devoluciones, neto: s.neto }).toEqual({ count: exp.count, ventas: exp.ventas, devoluciones: exp.devoluciones, neto: exp.neto });
  });

  it("Operaciones · los contadores por estado son los del filtro sin el estado elegido (y suman el total)", async () => {
    const f: OperationFilters = { operationType: "VENTA", dateFrom: "2026-02-01" };
    const base = opsA.filter((o) => o.type === "VENTA" && inRange(o, "2026-02-01"));
    const all = await summarizeOperations(dbs.a, f);
    const pend = await summarizeOperations(dbs.a, { ...f, status: "pendiente" });
    expect(pend.byStatus).toEqual(all.byStatus);
    expect(all.byStatus).toEqual(opExpected(base).byStatus);
    expect(pend.count).toBe(all.byStatus.pendiente);
    const b = all.byStatus;
    expect(b.pendiente + b.conciliado + b.incidencia + b.ignorado + b.otros).toBe(b.total);
    expect(b.pendiente).toBeGreaterThan(0);
    expect(b.incidencia).toBeGreaterThan(0);
    // Cada filtro rápido muestra exactamente lo que cuenta
    for (const st of ["pendiente", "incidencia"] as const) {
      const l = await listOperationsPage(dbs.a, { ...f, status: st, page: 1, pageSize: 1000 });
      expect(l.total).toBe(b[st]);
      expect(l.rows.length).toBe(b[st]);
    }
  });

  it("Operaciones · sin filtro == suma de todo lo sembrado; las ignoradas no suman importes; neto = ventas − devoluciones", async () => {
    const s = await summarizeOperations(dbs.a, {});
    expect(s).toEqual(opExpected(opsA));
    expect(opsA.some((o) => Math.abs(Number(o.amount)) > 9_000_000)).toBe(true);
    expect(opsA.some((o) => o.status === "ignorado")).toBe(true);
    expect(toCents(s.neto)).toBe(toCents(s.ventas) - toCents(s.devoluciones));
  });

  it("Operaciones · neto negativo exacto cuando solo hay devoluciones", async () => {
    const s = await summarizeOperations(dbs.a, { operationType: "DEVOLUCION" });
    expect(s.ventas).toBe("0.00");
    expect(s.neto).toBe(`-${s.devoluciones}`);
  });

  it("Operaciones · el total «pendientes» es el del filtro completo, no el de la página", async () => {
    const p = await listOperationsPage(dbs.a, { status: "pendiente", page: 1, pageSize: 10 });
    expect(p.rows.length).toBe(10);
    expect(p.total).toBeGreaterThan(10);
    expect(p.summary.byStatus.pendiente).toBe(p.total);
  });

  it("Operaciones · aislamiento: cada empresa suma solo lo suyo", async () => {
    expect(await summarizeOperations(dbs.a, {})).toEqual(opExpected(opsA));
    expect(await summarizeOperations(dbs.b, {})).toEqual(opExpected(opsB));
    expect((await summarizeOperations(dbs.a, { search: "B100" })).count).toBe(0);
    const b = await listOperationsPage(dbs.b, { page: 1, pageSize: 1000 });
    expect(b.total).toBe(opsB.length);
    expect(b.rows.every((x: any) => String(x.duplicateKey).startsWith("B-"))).toBe(true);
  });

  it("Operaciones · filtro sin resultados → ceros", async () => {
    expect(await summarizeOperations(dbs.a, { search: "no-existe-xyz" })).toEqual({ count: 0, ventas: "0.00", devoluciones: "0.00", neto: "0.00", byStatus: { pendiente: 0, conciliado: 0, incidencia: 0, ignorado: 0, otros: 0, total: 0 } });
  });

  it("Operaciones · % y _ de la búsqueda se toman literalmente (no como comodines)", async () => {
    const lit = opsA.filter((o) => o.terminal === "T_03").length;
    expect(lit).toBeGreaterThan(0);
    expect((await summarizeOperations(dbs.a, { search: "T_03" })).count).toBe(lit);
    expect((await summarizeOperations(dbs.a, { search: "T%3" })).count).toBe(0);
    expect((await summarizeOperations(dbs.a, { search: "T-03" })).count).toBe(0);
  });

  it("Operaciones · la búsqueda en servidor encuentra operaciones de cualquier página", async () => {
    const exp = opsA.filter((o) => o.num.toLowerCase().includes("a1001"));
    const p = await listOperationsPage(dbs.a, { search: "A1001", page: 1, pageSize: 3 });
    expect(p.total).toBe(exp.length);
    expect(exp.length).toBeGreaterThan(3);
    expect(p.rows.length).toBe(3);
  });

  // ── Remesas y estado de la conciliación ─────────────────────────────────────────────────────────────────────────
  const btFilters: Array<[string, BatchFilters, (b: Bt) => boolean]> = [
    ["sin filtro", {}, () => true],
    ["con diferencia", { status: "difference" }, (b) => b.status === "difference"],
    ["pendientes", { status: "pending" }, (b) => b.status === "pending"],
    ["rango de fechas", { fromDate: "2026-03-01", toDate: "2026-08-31" }, (b) => b.date >= "2026-03-01" && b.date <= "2026-08-31"],
    ["terminal", { terminalCode: "T02" }, (b) => b.terminal === "T02"],
    ["todo combinado", { status: "reconciled", fromDate: "2026-02-01", toDate: "2026-10-31", terminalCode: "T01" }, (b) => b.status === "reconciled" && b.date >= "2026-02-01" && b.date <= "2026-10-31" && b.terminal === "T01"],
  ];

  it.each(btFilters)("Remesas · %s: el resumen == suma del listado con el mismo filtro", async (_n, f, ref) => {
    const rows: any[] = [];
    let total = -1;
    for (let page = 1; ; page++) {
      const r = await listBatchesPage(dbs.a, { ...f, page, pageSize: 50 });
      total = r.total;
      rows.push(...r.rows);
      if (r.rows.length < 50) break;
    }
    const s = await summarizeBatches(dbs.a, f);
    expect(s.count).toBe(total);
    expect(s.count).toBe(rows.length);
    expect(s.net).toBe(fmt(sumC(rows.map((x) => toCents(x.totalNet)))));
    // El estado de la conciliación es el del periodo, no el del estado elegido en la lista
    const periodOnly = btA.filter((b) => (!f.fromDate || b.date >= f.fromDate) && (!f.toDate || b.date <= f.toDate) && (!f.terminalCode || b.terminal === f.terminalCode));
    expect(s).toEqual(batchExpected(periodOnly, f.status));
    const exp = batchExpected(btA.filter(ref));
    expect({ count: s.count, net: s.net }).toEqual({ count: exp.count, net: exp.net });
  });

  it("Remesas · UN criterio de pendiente: pendiente+sugerida+lista+por revisar; conciliadas = conciliada+con diferencia", async () => {
    const s = await summarizeBatches(dbs.a, {});
    const c = s.conciliation;
    expect(c.pending.count).toBe(btA.filter((b) => ["pending", "suggested", "auto_ready", "review_required"].includes(b.status)).length);
    expect(c.reconciled.count).toBe(btA.filter((b) => ["reconciled", "difference"].includes(b.status)).length);
    expect(c.pending.count + c.reconciled.count + s.byStatus.ignored.count).toBe(c.total.count);
    expect(c.pctReconciled).toBe(Math.round((c.reconciled.count / c.total.count) * 100));
    expect(c.attention.autoReady.count + c.attention.suggested.count + c.attention.reviewRequired.count).toBeLessThanOrEqual(c.pending.count);
    // Los importes del estado de la conciliación suman el neto de las remesas del periodo, en céntimos exactos
    expect(toCents(c.pending.amount) + toCents(c.reconciled.amount) + toCents(s.byStatus.ignored.amount)).toBe(toCents(c.total.amount));
    expect(btA.some((b) => Math.abs(Number(b.net)) > 9_000_000)).toBe(true);
    expect(btA.some((b) => Number(b.net) < 0)).toBe(true);
  });

  it("Remesas · las diferencias suman la diferencia con el banco (con signo, exacta)", async () => {
    const s = await summarizeBatches(dbs.a, {});
    expect(s.conciliation.difference.count).toBe(btA.filter((b) => b.status === "difference").length);
    expect(s.conciliation.difference.amount).toBe(fmt(sumC(btA.filter((b) => b.status === "difference").map((b) => toCents(b.diff ?? "0")))));
  });

  it("Remesas · cada línea de atención del estado de la conciliación == su filtro en la lista (mismo periodo)", async () => {
    const f: BatchFilters = { fromDate: "2026-02-01", toDate: "2026-10-31" };
    const s = await summarizeBatches(dbs.a, f);
    for (const [st, bk] of [["auto_ready", s.conciliation.attention.autoReady], ["suggested", s.conciliation.attention.suggested], ["review_required", s.conciliation.attention.reviewRequired]] as const) {
      const l = await listBatchesPage(dbs.a, { ...f, status: st, page: 1, pageSize: 200 });
      expect(l.total).toBe(bk.count);
      expect(fmt(sumC(l.rows.map((x: any) => toCents(x.totalNet))))).toBe(bk.amount);
    }
  });

  it("Remesas · aislamiento: cada empresa suma solo lo suyo", async () => {
    expect(await summarizeBatches(dbs.a, {})).toEqual(batchExpected(btA));
    expect(await summarizeBatches(dbs.b, {})).toEqual(batchExpected(btB));
    expect((await listBatchesPage(dbs.b, { page: 1, pageSize: 200 })).total).toBe(btB.length);
  });

  it("Remesas · filtro sin resultados → ceros", async () => {
    const z = { count: 0, amount: "0.00" };
    const s = await summarizeBatches(dbs.a, { fromDate: "2030-01-01" });
    expect(s.count).toBe(0);
    expect(s.net).toBe("0.00");
    expect(s.conciliation).toEqual({ total: z, reconciled: z, pending: z, difference: { count: 0, amount: "0.00" }, attention: { autoReady: z, suggested: z, reviewRequired: z }, pctReconciled: 0 });
  });

  it("Remesas · la paginación en servidor: páginas disjuntas, orden estable y total del filtro", async () => {
    const p1 = await listBatchesPage(dbs.a, { page: 1, pageSize: 25 });
    const p2 = await listBatchesPage(dbs.a, { page: 2, pageSize: 25 });
    expect(p1.total).toBe(btA.length);
    const ids = new Set([...p1.rows, ...p2.rows].map((x: any) => x.id));
    expect(ids.size).toBe(50);
    const dates = p1.rows.map((x: any) => x.batchDate);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});
