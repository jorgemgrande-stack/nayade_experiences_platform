/**
 * Resúmenes del filtro completo de Movimientos bancarios y de Caja sobre MySQL real (opt-in: REGISTRY_TEST_DATABASE_URL,
 * una URL con permiso para crear bases de datos; en CI está disponible). Se crean DOS bases temporales con las tablas
 * reales del esquema base (db/baseline/0000_baseline.sql) y se comprueba, con volumen y varios filtros:
 *  1. el total del resumen == suma de los registros que devuelve el listado con el MISMO filtro (páginas incluidas);
 *  2. sin filtro == suma de todo lo sembrado (calculado aparte, en céntimos enteros);
 *  3. aislamiento: cada conexión cuenta solo lo suyo (la otra empresa no suma);
 *  4. decimales: céntimos, importes de siete cifras y negativos exactos (sin coma flotante);
 *  5. filtro sin resultados → ceros; % y _ de la búsqueda se toman literalmente.
 * Uso local: REGISTRY_TEST_DATABASE_URL=mysql://root:clave@127.0.0.1:33981/mysql npx vitest run server/economiaCajaBancos.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { listBankMovements, summarizeBankMovements, type BankFilters } from "./bankQuery";
import { cashOverview, listCashMovementsPage, summarizeCashMovements, type CashMovementFilters } from "./cashQuery";

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
const abs = (c: bigint) => (c < 0n ? -c : c);

type Bk = { fecha: string; mov: string; mas: string | null; importe: string; status: "pendiente" | "ignorado"; conc: "pendiente" | "conciliado"; imp: number; key: string };
type Cm = { accountId: number; date: string; type: string; amount: string; concept: string; counterparty: string | null; notes: string | null };

function seedBank(tag: string, seed: number, n: number): Bk[] {
  const r = rng(seed);
  const out: Bk[] = [];
  for (let i = 0; i < n; i++) {
    const big = i % 53 === 0;
    const neg = r() < 0.55;
    const cents = big ? 999_999_000 + Math.floor(r() * 999) : Math.floor(r() * 300_000) + 1; // hasta 9.999.999,99
    const ign = r() < 0.12;
    out.push({
      fecha: `2026-${String(1 + Math.floor(r() * 11)).padStart(2, "0")}-${String(1 + Math.floor(r() * 27)).padStart(2, "0")}`,
      mov: ["TRANSFERENCIA", "RECIBO LUZ", "COMISION 2%_mant", "Compra tarjeta", "Bizum"][Math.floor(r() * 5)] + ` ${i}`,
      mas: r() < 0.3 ? null : ["Ref ABC", "Pago 100% real", "Cliente Perez", "Nomina"][Math.floor(r() * 4)],
      importe: fmt(neg ? -BigInt(cents) : BigInt(cents)),
      status: ign ? "ignorado" : "pendiente",
      conc: !ign && r() < 0.4 ? "conciliado" : "pendiente",
      imp: 1 + Math.floor(r() * 3),
      key: `${tag}-${i}`,
    });
  }
  return out;
}
const bankBucket = (rows: Bk[]) => ({
  count: rows.length,
  amount: fmt(sumC(rows.map((x) => toCents(x.importe)))),
  amountAbs: fmt(sumC(rows.map((x) => abs(toCents(x.importe))))),
});
const bankExpected = (rows: Bk[]) => {
  const act = rows.filter((x) => x.status !== "ignorado");
  return {
    count: rows.length,
    ingresado: fmt(sumC(act.filter((x) => toCents(x.importe) > 0n).map((x) => toCents(x.importe)))),
    cargado: fmt(sumC(act.filter((x) => toCents(x.importe) < 0n).map((x) => toCents(x.importe)))),
    sinConciliar: bankBucket(rows.filter((x) => x.status === "pendiente" && x.conc === "pendiente")),
    conciliados: bankBucket(rows.filter((x) => x.status === "pendiente" && x.conc === "conciliado" && toCents(x.importe) >= 0n)),
    gastoVinculado: bankBucket(rows.filter((x) => x.status === "pendiente" && x.conc === "conciliado" && toCents(x.importe) < 0n)),
    ignorados: bankBucket(rows.filter((x) => x.status === "ignorado")),
  };
};

function seedCash(seed: number, n: number, accounts: number): Cm[] {
  const r = rng(seed);
  const types = ["income", "income", "expense", "expense", "transfer_in", "transfer_out", "opening_balance", "adjustment"];
  const out: Cm[] = [];
  for (let i = 0; i < n; i++) {
    const big = i % 47 === 0;
    const cents = big ? 999_999_000 + Math.floor(r() * 999) : Math.floor(r() * 90_000) + 1;
    out.push({
      accountId: 1 + Math.floor(r() * accounts),
      date: `2026-${String(1 + Math.floor(r() * 11)).padStart(2, "0")}-${String(1 + Math.floor(r() * 27)).padStart(2, "0")}`,
      type: types[Math.floor(r() * types.length)],
      amount: fmt(BigInt(cents)),
      concept: ["Venta mostrador", "Compra material 50%", "Caja_chica", "Cambio monedas", "Propina"][Math.floor(r() * 5)] + ` ${i}`,
      counterparty: r() < 0.5 ? null : ["Perez", "Lopez SL"][Math.floor(r() * 2)],
      notes: r() < 0.7 ? null : "revisar nota",
    });
  }
  return out;
}
const IN = ["income", "transfer_in", "opening_balance"];
const OUT = ["expense", "transfer_out"];
const cashExpected = (rows: Cm[]) => {
  const inflow = sumC(rows.filter((x) => IN.includes(x.type)).map((x) => toCents(x.amount)));
  const outflow = sumC(rows.filter((x) => OUT.includes(x.type)).map((x) => toCents(x.amount)));
  const adj = rows.filter((x) => x.type === "adjustment");
  return { count: rows.length, inflow: fmt(inflow), outflow: fmt(outflow), net: fmt(inflow - outflow), adjustmentCount: adj.length, adjustmentAmount: fmt(sumC(adj.map((x) => toCents(x.amount)))) };
};

describe.skipIf(!URL_)("Resúmenes del filtro completo (Banco y Caja) sobre MySQL", () => {
  const stamp = Date.now().toString(36);
  const names = { a: `e3cb_a_${stamp}`, b: `e3cb_b_${stamp}` };
  let admin: mysql.Pool;
  const pools = {} as Record<"a" | "b", mysql.Pool>;
  const dbs = {} as Record<"a" | "b", ReturnType<typeof drizzle>>;
  const bankA = seedBank("A", 101, 260);
  const bankB = seedBank("B", 202, 80);
  const cashA = seedCash(303, 190, 3);
  const cashB = seedCash(404, 60, 2);
  const TODAY = "2026-06-15";
  // Movimientos del día: neto de hoy = (ingresos + saldo inicial) - gastos; traspasos y ajustes no cuentan
  const todayA: Cm[] = [
    { accountId: 1, date: TODAY, type: "income", amount: "100.10", concept: "hoy ing", counterparty: null, notes: null },
    { accountId: 1, date: TODAY, type: "opening_balance", amount: "50.00", concept: "hoy ini", counterparty: null, notes: null },
    { accountId: 2, date: TODAY, type: "expense", amount: "30.05", concept: "hoy gas", counterparty: null, notes: null },
    { accountId: 2, date: TODAY, type: "transfer_out", amount: "999.00", concept: "hoy tra", counterparty: null, notes: null },
    { accountId: 2, date: TODAY, type: "adjustment", amount: "7.00", concept: "hoy aju", counterparty: null, notes: null },
  ];
  // Los movimientos sembrados al azar no caen en TODAY (junio 15 podría coincidir): se excluye al calcular el neto de hoy
  const todayRandom = cashA.filter((c) => c.date === TODAY);

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    for (const k of ["a", "b"] as const) {
      await admin.query(`CREATE DATABASE \`${names[k]}\` CHARACTER SET utf8mb4`);
      const u = new URL(URL_!);
      u.pathname = `/${names[k]}`;
      pools[k] = mysql.createPool({ uri: u.toString(), connectionLimit: 4 });
      for (const t of ["bank_file_imports", "bank_movements", "fin_cash_accounts", "fin_cash_movements", "fin_cash_closures", "fin_cash_alerts"]) await pools[k].query(ddl(t));
      dbs[k] = drizzle(pools[k]);
    }
    const putBank = async (k: "a" | "b", rows: Bk[]) => {
      for (const b of rows) {
        await pools[k].query(
          "INSERT INTO bank_movements (import_id, fecha, movimiento, mas_datos, importe, duplicate_key, status, conciliation_status) VALUES (?,?,?,?,?,?,?,?)",
          [b.imp, b.fecha, b.mov, b.mas, b.importe, b.key, b.status, b.conc],
        );
      }
    };
    const putCash = async (k: "a" | "b", rows: Cm[], accounts: number, balances: string[]) => {
      for (let i = 0; i < accounts; i++) {
        await pools[k].query("INSERT INTO fin_cash_accounts (name, current_balance, initial_balance, is_active) VALUES (?,?,?,?)", [`Caja ${i + 1}`, balances[i], "0.00", i === accounts - 1 && accounts > 2 ? 0 : 1]);
      }
      for (const c of rows) {
        await pools[k].query(
          "INSERT INTO fin_cash_movements (account_id, date, type_fcm, amount, concept, counterparty, notes) VALUES (?,?,?,?,?,?,?)",
          [c.accountId, c.date, c.type, c.amount, c.concept, c.counterparty, c.notes],
        );
      }
    };
    await putBank("a", bankA);
    await putBank("b", bankB);
    await putCash("a", [...cashA, ...todayA], 3, ["1234567.89", "-250.35", "99999.99"]); // la 3.ª está inactiva
    await putCash("b", cashB, 2, ["10.00", "5.50"]);
    // Cierres (A): 2 con descuadre, 1 revisado, 1 cuadrado, 1 ajustado (+1 de otra cuenta)
    for (const [st, diff] of [["difference", "-12.34"], ["difference", "5.01"], ["reviewed", "-0.99"], ["balanced", "0.00"], ["adjusted", "-3.00"]] as const) {
      await pools.a.query("INSERT INTO fin_cash_closures (account_id, date, status_fcc, difference) VALUES (1,'2026-06-01',?,?)", [st, diff]);
    }
    await pools.a.query("INSERT INTO fin_cash_closures (account_id, date, status_fcc, difference) VALUES (2,'2026-06-02','difference','-100.00')");
    await pools.b.query("INSERT INTO fin_cash_closures (account_id, date, status_fcc, difference) VALUES (1,'2026-06-01','difference','-77.00')");
    await pools.a.query("INSERT INTO fin_cash_alerts (severity_fca, amount) VALUES ('critical','12.34'),('warning','5.01'),('warning','1.00')");
    await pools.a.query("INSERT INTO fin_cash_alerts (severity_fca, amount, resolved_at) VALUES ('critical','9.00', now())");
  }, 240_000);

  afterAll(async () => {
    for (const k of ["a", "b"] as const) await pools[k]?.end().catch(() => {});
    await admin?.end().catch(() => {});
  });

  // ── Movimientos bancarios ───────────────────────────────────────────────────────────────────────────────────────
  const bankFilters: Array<[string, BankFilters, (b: Bk) => boolean]> = [
    ["sin filtro", {}, () => true],
    ["sin conciliar", { conciliation: "sin_conciliar" }, (b) => b.status === "pendiente" && b.conc === "pendiente"],
    ["conciliados (abonos)", { conciliation: "conciliado" }, (b) => b.status === "pendiente" && b.conc === "conciliado" && Number(b.importe) >= 0],
    ["gasto vinculado", { conciliation: "gasto_vinculado" }, (b) => b.status === "pendiente" && b.conc === "conciliado" && Number(b.importe) < 0],
    ["ignorados", { conciliation: "ignorado" }, (b) => b.status === "ignorado"],
    ["estado histórico pendiente", { status: "pendiente" }, (b) => b.status === "pendiente"],
    ["importación 2", { importId: 2 }, (b) => b.imp === 2],
    ["rango de fechas", { fechaFrom: "2026-03-01", fechaTo: "2026-08-31" }, (b) => b.fecha >= "2026-03-01" && b.fecha <= "2026-08-31"],
    ["búsqueda por movimiento", { search: "recibo luz" }, (b) => b.mov.toLowerCase().includes("recibo luz")],
    ["búsqueda en más datos", { search: "perez" }, (b) => (b.mas ?? "").toLowerCase().includes("perez")],
    ["% literal", { search: "100%" }, (b) => (b.mas ?? "").includes("100%") || b.mov.includes("100%")],
    ["_ literal", { search: "2%_mant" }, (b) => b.mov.includes("2%_mant")],
    ["todo combinado", { conciliation: "sin_conciliar", importId: 1, fechaFrom: "2026-02-01", fechaTo: "2026-10-31", search: "a" }, (b) => b.status === "pendiente" && b.conc === "pendiente" && b.imp === 1 && b.fecha >= "2026-02-01" && b.fecha <= "2026-10-31" && (b.mov + " " + (b.mas ?? "")).toLowerCase().includes("a")],
  ];

  it.each(bankFilters)("Banco · %s: el resumen == suma del listado con el mismo filtro", async (_n, f, ref) => {
    const rows: any[] = [];
    let total = -1;
    for (let page = 1; ; page++) {
      const r = await listBankMovements(dbs.a, { ...f, page, pageSize: 50 });
      total = r.total;
      rows.push(...r.data);
      if (r.data.length < 50) break;
    }
    const s = await summarizeBankMovements(dbs.a, f);
    expect(s.count).toBe(total);
    expect(s.count).toBe(rows.length);
    // Contra el listado devuelto por el servidor
    const fromList = bankExpected(rows.map((x) => ({ fecha: x.fecha, mov: x.movimiento, mas: x.masDatos, importe: x.importe, status: x.status, conc: x.conciliationStatus, imp: x.importId, key: "" })));
    expect(s).toEqual(fromList);
    // y contra lo sembrado, calculado aparte con el mismo predicado
    expect(s).toEqual(bankExpected(bankA.filter(ref)));
  });

  it("Banco · los cuatro estados suman el total y se reparten sin solaparse", async () => {
    const s = await summarizeBankMovements(dbs.a, {});
    expect(s.sinConciliar.count + s.conciliados.count + s.gastoVinculado.count + s.ignorados.count).toBe(s.count);
    expect(s.count).toBe(bankA.length);
    expect(s.sinConciliar.count).toBeGreaterThan(0);
    expect(s.ignorados.count).toBeGreaterThan(0);
    expect(s.gastoVinculado.count).toBeGreaterThan(0);
  });

  it("Banco · importes de siete cifras y negativos exactos (sin coma flotante)", async () => {
    const s = await summarizeBankMovements(dbs.a, {});
    expect(bankA.some((b) => Math.abs(Number(b.importe)) > 9_000_000)).toBe(true);
    expect(s.cargado.startsWith("-")).toBe(true);
    expect(s.cargado).toBe(bankExpected(bankA).cargado);
    expect(s.sinConciliar.amount).toBe(bankExpected(bankA).sinConciliar.amount);
  });

  it("Banco · el total «sin conciliar» es el del filtro completo, no el de la página", async () => {
    const page1 = await listBankMovements(dbs.a, { conciliation: "sin_conciliar", page: 1, pageSize: 10 });
    expect(page1.data.length).toBe(10);
    expect(page1.total).toBeGreaterThan(10);
    expect(page1.totals.sinConciliar.count).toBe(page1.total);
  });

  it("Banco · aislamiento: cada empresa suma solo lo suyo", async () => {
    expect(await summarizeBankMovements(dbs.a, {})).toEqual(bankExpected(bankA));
    expect(await summarizeBankMovements(dbs.b, {})).toEqual(bankExpected(bankB));
    expect((await summarizeBankMovements(dbs.a, { search: "xyzzy" })).count).toBe(0);
    const b = await listBankMovements(dbs.b, { page: 1, pageSize: 1000 });
    expect(b.data.every((x: any) => String(x.duplicateKey).startsWith("B-"))).toBe(true);
    expect(b.total).toBe(bankB.length);
  });

  it("Banco · filtro sin resultados → ceros", async () => {
    const z = { count: 0, amount: "0.00", amountAbs: "0.00" };
    expect(await summarizeBankMovements(dbs.a, { search: "no-existe-xyz" })).toEqual({ count: 0, ingresado: "0.00", cargado: "0.00", sinConciliar: z, conciliados: z, gastoVinculado: z, ignorados: z });
    expect((await summarizeBankMovements(dbs.a, { fechaFrom: "2030-01-01" })).count).toBe(0);
  });

  it("Banco · % y _ de la búsqueda se toman literalmente (no como comodines)", async () => {
    const lit = bankA.filter((b) => b.mov.includes("2%_mant")).length;
    expect(lit).toBeGreaterThan(0);
    expect((await summarizeBankMovements(dbs.a, { search: "2%_mant" })).count).toBe(lit);
    expect((await summarizeBankMovements(dbs.a, { search: "2%xmant" })).count).toBe(0);
    expect((await summarizeBankMovements(dbs.a, { search: "COMISION 2%" })).count).toBe(lit);
  });

  it("Banco · la búsqueda en servidor encuentra movimientos de cualquier página", async () => {
    const expected = bankA.filter((b) => b.mov.toLowerCase().includes("transferencia 1"));
    const p = await listBankMovements(dbs.a, { search: "transferencia 1", page: 1, pageSize: 3 });
    expect(p.total).toBe(expected.length);
    expect(expected.length).toBeGreaterThan(3);
    expect(p.data.length).toBe(3);
  });

  // ── Caja ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const cashAll = [...cashA, ...todayA];
  const cashFilters: Array<[string, CashMovementFilters, (c: Cm) => boolean]> = [
    ["sin filtro", {}, () => true],
    ["cuenta 2", { accountId: 2 }, (c) => c.accountId === 2],
    ["rango de fechas", { dateFrom: "2026-03-01", dateTo: "2026-08-31" }, (c) => c.date >= "2026-03-01" && c.date <= "2026-08-31"],
    ["búsqueda por concepto", { search: "venta" }, (c) => c.concept.toLowerCase().includes("venta")],
    ["búsqueda por contraparte", { search: "lopez" }, (c) => (c.counterparty ?? "").toLowerCase().includes("lopez")],
    ["búsqueda por nota", { search: "revisar" }, (c) => (c.notes ?? "").includes("revisar")],
    ["% literal", { search: "50%" }, (c) => c.concept.includes("50%")],
    ["_ literal", { search: "Caja_chica" }, (c) => c.concept.includes("Caja_chica")],
    ["todo combinado", { accountId: 1, dateFrom: "2026-02-01", dateTo: "2026-10-31", search: "a" }, (c) => c.accountId === 1 && c.date >= "2026-02-01" && c.date <= "2026-10-31" && [c.concept, c.counterparty ?? "", c.notes ?? ""].join(" ").toLowerCase().includes("a")],
  ];

  it.each(cashFilters)("Caja · %s: el resumen == suma del listado con el mismo filtro", async (_n, f, ref) => {
    const rows: any[] = [];
    let total = -1;
    for (let off = 0; ; off += 50) {
      const r = await listCashMovementsPage(dbs.a, { ...f, limit: 50, offset: off });
      total = r.total;
      rows.push(...r.items);
      if (r.items.length < 50) break;
    }
    const s = await summarizeCashMovements(dbs.a, f);
    expect(s.count).toBe(total);
    expect(s.count).toBe(rows.length);
    const fromList = cashExpected(rows.map((x) => ({ accountId: x.accountId, date: x.date, type: x.type, amount: x.amount, concept: x.concept, counterparty: x.counterparty, notes: x.notes })));
    expect(s).toEqual(fromList);
    expect(s).toEqual(cashExpected(cashAll.filter(ref)));
  });

  it("Caja · sin filtro == suma de todo lo sembrado; el neto = entradas - salidas y el ajuste no mueve saldo", async () => {
    const s = await summarizeCashMovements(dbs.a, {});
    expect(s).toEqual(cashExpected(cashAll));
    expect(cashAll.some((c) => Number(c.amount) > 9_000_000)).toBe(true);
    expect(toCents(s.net)).toBe(toCents(s.inflow) - toCents(s.outflow));
    expect(s.adjustmentCount).toBeGreaterThan(0);
  });

  it("Caja · la paginación en servidor: páginas disjuntas, orden estable y total del filtro", async () => {
    const p1 = await listCashMovementsPage(dbs.a, { limit: 25, offset: 0 });
    const p2 = await listCashMovementsPage(dbs.a, { limit: 25, offset: 25 });
    expect(p1.total).toBe(cashAll.length);
    expect(p1.items.length).toBe(25);
    const ids = new Set([...p1.items, ...p2.items].map((x: any) => x.id));
    expect(ids.size).toBe(50);
    const dates = p1.items.map((x: any) => x.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("Caja · aislamiento: cada empresa suma solo lo suyo", async () => {
    expect(await summarizeCashMovements(dbs.b, {})).toEqual(cashExpected(cashB));
    expect((await listCashMovementsPage(dbs.b, { limit: 1000, offset: 0 })).total).toBe(cashB.length);
    expect((await summarizeCashMovements(dbs.b, { search: "hoy ing" })).count).toBe(0);
  });

  it("Caja · filtro sin resultados → ceros", async () => {
    expect(await summarizeCashMovements(dbs.a, { search: "no-existe-xyz" })).toEqual({ count: 0, inflow: "0.00", outflow: "0.00", net: "0.00", adjustmentCount: 0, adjustmentAmount: "0.00" });
  });

  it("Caja · resumen general: saldo de cuentas activas, neto de hoy, cierres con descuadre e incidencias", async () => {
    const o = await cashOverview(dbs.a, { today: TODAY });
    // 1.234.567,89 + (-250,35); la 3.ª cuenta está inactiva y no suma
    expect(o.totalBalance).toBe("1234317.54");
    expect(o.activeAccounts).toBe(2);
    // (100,10 + 50,00) - 30,05; ni el traspaso (999,00) ni el ajuste (7,00) cuentan; más lo sembrado al azar ese mismo día
    const random = sumC(todayRandom.filter((c) => ["income", "opening_balance"].includes(c.type)).map((c) => toCents(c.amount))) - sumC(todayRandom.filter((c) => c.type === "expense").map((c) => toCents(c.amount)));
    expect(o.todayNet).toBe(fmt(12005n + random));
    expect(o.closures).toEqual({ total: 6, pending: 4, pendingAbs: "118.34" }); // |-12,34| + 5,01 + |-0,99| + |-100,00|
    expect(o.alerts).toEqual({ open: 3, critical: 1 }); // la resuelta no cuenta
  });

  it("Caja · el resumen de cierres respeta el filtro por cuenta y no mezcla empresas", async () => {
    const acc1 = await cashOverview(dbs.a, { today: TODAY, accountId: 1 });
    expect(acc1.closures).toEqual({ total: 5, pending: 3, pendingAbs: "18.34" });
    const b = await cashOverview(dbs.b, { today: "2020-01-01" });
    expect(b.totalBalance).toBe("15.50");
    expect(b.closures).toEqual({ total: 1, pending: 1, pendingAbs: "77.00" });
    expect(b.alerts).toEqual({ open: 0, critical: 0 });
    expect(b.todayNet).toBe("0.00");
  });

  it("Caja · sin datos → ceros", async () => {
    const o = await cashOverview(dbs.a, { today: "2020-01-01", accountId: 99 });
    expect(o.todayNet).toBe("0.00");
    expect(o.closures).toEqual({ total: 0, pending: 0, pendingAbs: "0.00" });
  });
});
