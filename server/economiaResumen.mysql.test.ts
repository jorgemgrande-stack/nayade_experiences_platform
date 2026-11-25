/**
 * Resúmenes del filtro completo de Transacciones y Gastos sobre MySQL real (opt-in: REGISTRY_TEST_DATABASE_URL, una
 * URL con permiso para crear bases de datos; en CI está disponible). Se crean DOS bases temporales con las tablas reales
 * del esquema base (db/baseline/0000_baseline.sql) y se comprueba, con volumen y varios filtros:
 *  1. el total del resumen == suma de los registros que devuelve el listado con el MISMO filtro (páginas incluidas);
 *  2. sin filtro == suma de todo lo sembrado (calculado aparte, en céntimos enteros);
 *  3. aislamiento: cada conexión cuenta solo lo suyo (la otra empresa no suma);
 *  4. decimales: céntimos, importes grandes y negativos exactos (sin coma flotante);
 *  5. filtro sin resultados → ceros.
 * Uso local: REGISTRY_TEST_DATABASE_URL=mysql://root:clave@127.0.0.1:33998/mysql npx vitest run server/economiaResumen.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { buildTxWhere, summarizeTransactions } from "./db";
import { listExpenses, summarizeExpenses, type ExpenseFilters } from "./expensesQuery";
import { transactions } from "../drizzle/schema";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const baseline = fs.readFileSync(path.resolve(__dirname, "../db/baseline/0000_baseline.sql"), "utf8");
const ddl = (table: string) => {
  const m = new RegExp("CREATE TABLE IF NOT EXISTS `" + table + "` \\([\\s\\S]*?\\n\\) ENGINE[^;]*;").exec(baseline);
  if (!m) throw new Error(`tabla ${table} no encontrada en el esquema base`);
  return m[0];
};

/** PRNG determinista (mulberry32). */
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
/** Céntimos → texto decimal exacto («-1234.50»). */
const fmt = (c: bigint) => `${c < 0n ? "-" : ""}${(c < 0n ? -c : c) / 100n}.${String((c < 0n ? -c : c) % 100n).padStart(2, "0")}`;
const sumC = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

type Tx = { n: string; type: string; status: string; amount: string; channel: string; regime: string; client: string; at: Date };
type Ex = { concept: string; amount: string; status: string; op: boolean; source: string; missing: boolean; taxAmount: string | null; taxRate: string; supplier: string; date: string; cat: number; cc: number };

function seedTx(seed: number, n: number): Tx[] {
  const r = rng(seed);
  const types = ["ingreso", "ingreso", "ingreso", "reembolso", "comision", "gasto"];
  const statuses = ["completado", "completado", "pendiente", "fallido", "reembolsado"];
  const out: Tx[] = [];
  for (let i = 0; i < n; i++) {
    const big = i % 37 === 0;
    const cents = big ? 999_999_000 + Math.floor(r() * 999) : Math.floor(r() * 250_000) + 1; // hasta 9.999.999,99 (decimal(10,2))
    out.push({
      n: `T${seed}-${String(i).padStart(4, "0")}`,
      type: types[Math.floor(r() * types.length)],
      status: statuses[Math.floor(r() * statuses.length)],
      amount: fmt(BigInt(cents)),
      channel: ["tpv", "online", "crm", "admin", "delegado"][Math.floor(r() * 5)],
      regime: ["general", "reav", "mixed"][Math.floor(r() * 3)],
      client: ["Ana Pérez", "Bruno 100%_real", "Carla Díaz", "Dídac"][Math.floor(r() * 4)],
      at: new Date(Date.UTC(2026, Math.floor(r() * 11), 1 + Math.floor(r() * 27), 12)),
    });
  }
  return out;
}

function seedEx(seed: number, n: number): Ex[] {
  const r = rng(seed);
  const statuses = ["pending", "justified", "accounted", "conciliado"];
  const sources = ["manual", "manual", "email", "hr_payroll", "tpv"];
  const rates = ["21.00", "10.00", "4.00", "0.00"];
  const out: Ex[] = [];
  for (let i = 0; i < n; i++) {
    const big = i % 41 === 0;
    const cents = big ? 9_999_999_000 + Math.floor(r() * 99) : Math.floor(r() * 400_000) + 1; // hasta 99.999.999,99 (decimal(12,2))
    const rate = rates[Math.floor(r() * rates.length)];
    const amount = fmt(BigInt(cents));
    // Cuota guardada en la mayoría; en 1 de cada 5 se deriva del tipo (gastos antiguos sin desglose).
    const derived = i % 5 === 3;
    const stored = derived ? null : fmt(BigInt(Math.round(cents - cents / (1 + Number(rate) / 100))));
    out.push({
      concept: `${["Luz", "Agua", "Combustible 50%", "Oficina_nueva", "Seguro"][Math.floor(r() * 5)]} ${i}`,
      amount,
      status: statuses[Math.floor(r() * 4)],
      op: r() > 0.2,
      source: sources[Math.floor(r() * sources.length)],
      missing: r() > 0.7,
      taxAmount: stored,
      taxRate: rate,
      supplier: ["Endesa", "Iberdrola", "Ferretería López", ""][Math.floor(r() * 4)],
      date: `2026-${String(1 + Math.floor(r() * 11)).padStart(2, "0")}-${String(1 + Math.floor(r() * 27)).padStart(2, "0")}`,
      cat: 1 + Math.floor(r() * 3),
      cc: 1 + Math.floor(r() * 2),
    });
  }
  return out;
}

describe.skipIf(!URL_)("Resúmenes del filtro completo (Transacciones y Gastos) sobre MySQL", () => {
  const stamp = Date.now().toString(36);
  const names = { a: `e2res_a_${stamp}`, b: `e2res_b_${stamp}` };
  let admin: mysql.Pool;
  const pools = {} as Record<"a" | "b", mysql.Pool>;
  const dbs = {} as Record<"a" | "b", ReturnType<typeof drizzle>>;
  const txA = seedTx(11, 260);
  const txB = seedTx(22, 90);
  const exA = seedEx(33, 240);
  // Casos de IVA: antiguo sin desglose, de RRHH, exento y con cuota guardada (se siembran con el resto de la empresa B)
  const mk = (concept: string, amount: string, source: string, taxRate: string, taxAmount: string | null): Ex => ({ concept, amount, status: "pending", op: true, source, missing: false, taxAmount, taxRate, supplier: "", date: "2026-01-05", cat: 1, cc: 1 });
  const exB = [...seedEx(44, 70), mk("caso antiguo 21", "121.00", "manual", "21.00", null), mk("caso nomina", "1000.00", "hr_payroll", "21.00", null), mk("caso exento", "50.00", "manual", "0.00", null), mk("caso guardado", "60.50", "manual", "21.00", "10.50")];

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    for (const k of ["a", "b"] as const) {
      await admin.query(`CREATE DATABASE \`${names[k]}\` CHARACTER SET utf8mb4`);
      const u = new URL(URL_!);
      u.pathname = `/${names[k]}`;
      pools[k] = mysql.createPool({ uri: u.toString(), connectionLimit: 4 });
      for (const t of ["transactions", "expenses", "expense_files"]) await pools[k].query(ddl(t));
      dbs[k] = drizzle(pools[k]);
    }
    const put = async (k: "a" | "b", tx: Tx[], ex: Ex[]) => {
      for (const t of tx) {
        await pools[k].query(
          "INSERT INTO transactions (transactionNumber, type, amount, status, saleChannel, fiscalRegime_tx, clientName, description, createdAt) VALUES (?,?,?,?,?,?,?,?,?)",
          [t.n, t.type, t.amount, t.status, t.channel, t.regime, t.client, "venta", t.at],
        );
      }
      for (const e of ex) {
        await pools[k].query(
          "INSERT INTO expenses (date, concept, amount, categoryId, costCenterId, status, source, missingAttachment, taxRate, taxAmount, supplierName, isOperational) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          [e.date, e.concept, e.amount, e.cat, e.cc, e.status, e.source, e.missing ? 1 : 0, e.taxRate, e.taxAmount, e.supplier, e.op ? 1 : 0],
        );
      }
    };
    await put("a", txA, exA);
    await put("b", txB, exB);
  }, 180_000);

  afterAll(async () => {
    // Las bases temporales (e2res_*) llevan el sello de la ejecución y no se borran aquí: en CI el MySQL es efímero y en
    // local quedan unas pocas tablas pequeñas que se pueden retirar a mano.
    for (const k of ["a", "b"] as const) await pools[k]?.end().catch(() => {});
    await admin?.end().catch(() => {});
  });

  // ── Transacciones ───────────────────────────────────────────────────────────────────────────────────────────────
  const txFilters: Array<[string, Parameters<typeof summarizeTransactions>[1]]> = [
    ["sin filtro", {}],
    ["tipo ingreso", { type: "ingreso" }],
    ["estado completado", { status: "completado" }],
    ["tipo gasto + estado pendiente", { type: "gasto", status: "pendiente" }],
    ["canal tpv", { saleChannel: "tpv" }],
    ["régimen reav", { fiscalRegime: "reav" }],
    ["rango de fechas", { from: "2026-03-01", to: "2026-06-30" }],
    ["búsqueda por nº", { search: "T11-01" }],
    ["búsqueda de cliente", { search: "Carla" }],
    ["todo combinado", { type: "ingreso", status: "completado", saleChannel: "online", from: "2026-02-01", to: "2026-10-31" }],
  ];

  it.each(txFilters)("Transacciones · %s: el resumen == suma del listado con el mismo filtro", async (_n, f) => {
    const db = dbs.a as any;
    const where = buildTxWhere(db, f);
    // El listado, recorrido por páginas de 50 como la pantalla
    const rows: any[] = [];
    for (let off = 0; ; off += 50) {
      const q = db.select().from(transactions).orderBy(transactions.id).limit(50).offset(off);
      const page = await (where ? q.where(where) : q);
      rows.push(...page);
      if (page.length < 50) break;
    }
    const income = sumC(rows.filter((t) => t.type === "ingreso" && t.status === "completado").map((t) => toCents(t.amount)));
    const outflow = sumC(rows.filter((t) => (t.type === "gasto" || t.type === "reembolso") && t.status === "completado").map((t) => toCents(t.amount)));
    const s = await summarizeTransactions(db, f);
    expect(s.count).toBe(rows.length);
    expect(s.pending).toBe(rows.filter((t) => t.status === "pendiente").length);
    expect(s.income).toBe(fmt(income));
    expect(s.outflow).toBe(fmt(outflow));
    expect(s.net).toBe(fmt(income - outflow));
  });

  it("Transacciones · sin filtro == suma de todo lo sembrado (céntimos enteros, importes grandes incluidos)", async () => {
    const income = sumC(txA.filter((t) => t.type === "ingreso" && t.status === "completado").map((t) => toCents(t.amount)));
    const outflow = sumC(txA.filter((t) => (t.type === "gasto" || t.type === "reembolso") && t.status === "completado").map((t) => toCents(t.amount)));
    const s = await summarizeTransactions(dbs.a, {});
    expect(s.count).toBe(txA.length);
    expect(s.income).toBe(fmt(income));
    expect(s.outflow).toBe(fmt(outflow));
    expect(s.net).toBe(fmt(income - outflow));
    expect(txA.some((t) => Number(t.amount) > 9_000_000)).toBe(true); // hay importes de siete cifras
  });

  it("Transacciones · el neto puede ser negativo y sigue siendo exacto", async () => {
    const s = await summarizeTransactions(dbs.a, { type: "reembolso", status: "completado" });
    const expected = sumC(txA.filter((t) => t.type === "reembolso" && t.status === "completado").map((t) => toCents(t.amount)));
    expect(s.income).toBe("0.00");
    expect(s.outflow).toBe(fmt(expected));
    expect(s.net).toBe(fmt(-expected));
    expect(s.net.startsWith("-")).toBe(true);
  });

  it("Transacciones · aislamiento: cada empresa suma solo lo suyo", async () => {
    const a = await summarizeTransactions(dbs.a, {});
    const b = await summarizeTransactions(dbs.b, {});
    expect(a.count).toBe(txA.length);
    expect(b.count).toBe(txB.length);
    expect(b.income).toBe(fmt(sumC(txB.filter((t) => t.type === "ingreso" && t.status === "completado").map((t) => toCents(t.amount)))));
    expect(await summarizeTransactions(dbs.a, { search: "T22-" })).toMatchObject({ count: 0, income: "0.00", outflow: "0.00", net: "0.00" });
    expect((await summarizeTransactions(dbs.b, { search: "T11-" })).count).toBe(0);
  });

  it("Transacciones · filtro sin resultados → ceros", async () => {
    expect(await summarizeTransactions(dbs.a, { search: "no-existe-xyz" })).toEqual({ count: 0, pending: 0, income: "0.00", outflow: "0.00", net: "0.00" });
    expect((await summarizeTransactions(dbs.a, { from: "2030-01-01" })).count).toBe(0);
  });

  it("Transacciones · una búsqueda con % y _ da el mismo conjunto en el listado y en el resumen", async () => {
    const f = { search: "100%_real" };
    const where = buildTxWhere(dbs.a as any, f);
    const rows = await (dbs.a as any).select().from(transactions).where(where);
    expect((await summarizeTransactions(dbs.a, f)).count).toBe(rows.length);
  });

  // ── Gastos ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const exFilters: Array<[string, ExpenseFilters]> = [
    ["sin filtro", {}],
    ["estado pendiente", { status: "pending" }],
    ["estado conciliado", { status: "conciliado" }],
    ["categoría 2", { categoryId: 2 }],
    ["centro 1", { costCenterId: 1 }],
    ["solo fiscales", { treatment: "tax_only" }],
    ["solo operativos", { treatment: "operational" }],
    ["rango de fechas", { dateFrom: "2026-03-01", dateTo: "2026-08-31" }],
    ["origen email", { source: "email" }],
    ["sin adjunto", { attachment: "missing" }],
    ["búsqueda por concepto", { search: "Luz" }],
    ["búsqueda con % literal", { search: "50%" }],
    ["búsqueda con _ literal", { search: "Oficina_nueva" }],
    ["búsqueda por proveedor", { search: "endesa" }],
    ["todo combinado", { status: "justified", treatment: "operational", dateFrom: "2026-02-01", dateTo: "2026-10-31", search: "a" }],
  ];

  it.each(exFilters)("Gastos · %s: el resumen == suma del listado con el mismo filtro", async (_n, f) => {
    const db = dbs.a;
    const rows: any[] = [];
    let total = -1;
    for (let off = 0; ; off += 50) {
      const page = await listExpenses(db, { ...f, limit: 50, offset: off });
      total = page.total;
      rows.push(...page.items);
      if (page.items.length < 50) break;
    }
    const s = await summarizeExpenses(db, f);
    expect(s.count).toBe(total);
    expect(s.count).toBe(rows.length);
    expect(s.total).toBe(fmt(sumC(rows.map((e) => toCents(e.amount)))));
    for (const st of ["pending", "justified", "accounted", "conciliado"] as const) {
      const of = rows.filter((e) => e.status === st);
      expect(s.byStatus[st].count, st).toBe(of.length);
      expect(s.byStatus[st].amount, st).toBe(fmt(sumC(of.map((e) => toCents(e.amount)))));
    }
    expect(s.byStatus.pending.count + s.byStatus.justified.count + s.byStatus.accounted.count + s.byStatus.conciliado.count).toBe(s.count);
    expect(s.taxOnlyCount).toBe(rows.filter((e) => !e.isOperational).length);
    expect(s.missingAttachmentCount).toBe(rows.filter((e) => e.missingAttachment).length);
    expect(s.emailCount).toBe(rows.filter((e) => e.source === "email").length);
    // IVA soportado: exacto con la cuota guardada (suma de cuotas, RRHH = 0); con la derivada, ±1 céntimo por fila
    const stored = (e: any) => (String(e.source).startsWith("hr_") ? 0n : e.taxAmount != null ? toCents(e.taxAmount) : null);
    const known = rows.map(stored).filter((x): x is bigint => x !== null);
    const derived = rows.filter((e) => stored(e) === null);
    const derivedApprox = sumC(derived.map((e) => BigInt(Math.round((Number(e.amount) - Number(e.amount) / (1 + Number(e.taxRate) / 100)) * 100))));
    const gap = toCents(s.ivaSoportado) - (sumC(known) + derivedApprox);
    expect((gap < 0n ? -gap : gap) <= BigInt(derived.length + 1)).toBe(true);
    if (derived.length === 0) expect(s.ivaSoportado).toBe(fmt(sumC(known)));
  });

  it("Gastos · sin filtro == suma de todo lo sembrado (importes de ocho cifras con céntimos)", async () => {
    const total = fmt(sumC(exA.map((e) => toCents(e.amount))));
    const s = await summarizeExpenses(dbs.a, {});
    expect(s.count).toBe(exA.length);
    expect(s.total).toBe(total);
    expect(exA.some((e) => Number(e.amount) > 90_000_000)).toBe(true);
    // La cuota guardada se suma tal cual (sin pasar por coma flotante): solo gastos con cuota guardada, sin RRHH
    const only = await summarizeExpenses(dbs.a, { source: "manual" });
    const rows = exA.filter((e) => e.source === "manual");
    const derived = rows.filter((e) => e.taxAmount === null);
    if (derived.length === 0) expect(only.ivaSoportado).toBe(fmt(sumC(rows.map((e) => toCents(e.taxAmount!)))));
    expect(only.count).toBe(rows.length);
  });

  it("Gastos · la cuota derivada de los gastos antiguos sin desglose usa el tipo (21 % si falta) y los de RRHH no llevan IVA", async () => {
    const s = await summarizeExpenses(dbs.b, { search: "caso antiguo" });
    expect(s.ivaSoportado).toBe("21.00");
    expect((await summarizeExpenses(dbs.b, { search: "caso nomina" })).ivaSoportado).toBe("0.00");
    expect((await summarizeExpenses(dbs.b, { search: "caso exento" })).ivaSoportado).toBe("0.00");
    expect((await summarizeExpenses(dbs.b, { search: "caso guardado" })).ivaSoportado).toBe("10.50");
  });

  it("Gastos · aislamiento: cada empresa suma solo lo suyo", async () => {
    const a = await summarizeExpenses(dbs.a, {});
    const b = await summarizeExpenses(dbs.b, {});
    expect(a.count).toBe(exA.length);
    expect(b.count).toBe(exB.length);
    expect(b.total).toBe(fmt(sumC(exB.map((e) => toCents(e.amount)))));
    expect(a.total).not.toBe(b.total);
    const la = await listExpenses(dbs.a, { limit: 1000, offset: 0 });
    expect(la.total).toBe(exA.length);
  });

  it("Gastos · filtro sin resultados → ceros", async () => {
    const s = await summarizeExpenses(dbs.a, { search: "no-existe-xyz" });
    expect(s).toEqual({
      count: 0,
      total: "0.00",
      ivaSoportado: "0.00",
      byStatus: {
        pending: { count: 0, amount: "0.00" },
        justified: { count: 0, amount: "0.00" },
        accounted: { count: 0, amount: "0.00" },
        conciliado: { count: 0, amount: "0.00" },
      },
      taxOnlyCount: 0,
      missingAttachmentCount: 0,
      emailCount: 0,
    });
  });

  it("Gastos · % y _ de la búsqueda se toman literalmente (no como comodines)", async () => {
    const lit = exA.filter((e) => e.concept.includes("50%")).length;
    const und = exA.filter((e) => e.concept.includes("Oficina_nueva")).length;
    expect(lit).toBeGreaterThan(0);
    expect((await summarizeExpenses(dbs.a, { search: "50%" })).count).toBe(lit);
    expect((await summarizeExpenses(dbs.a, { search: "Oficina_nueva" })).count).toBe(und);
    expect((await summarizeExpenses(dbs.a, { search: "Oficina%nueva" })).count).toBe(0);
    expect((await summarizeExpenses(dbs.a, { search: "Oficina-nueva" })).count).toBe(0);
  });

  it("Gastos · la búsqueda en servidor encuentra gastos de cualquier página (no solo de la cargada)", async () => {
    const f = { search: "Seguro 2" };
    const expected = exA.filter((e) => e.concept.toLowerCase().includes("seguro 2") || e.supplier.toLowerCase().includes("seguro 2"));
    const page1 = await listExpenses(dbs.a, { ...f, limit: 5, offset: 0 });
    expect(page1.total).toBe(expected.length);
    expect(expected.length).toBeGreaterThan(5);
    expect(page1.items.length).toBe(5);
  });
});
