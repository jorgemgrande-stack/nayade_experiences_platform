/**
 * TPV · ventas simultáneas con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL), dos empresas.
 * Bloqueo de la clave de la venta (server/tpvSaleIdempotency.ts):
 *  - Antes, con tantas ventas simultáneas de claves distintas como conexiones tiene el pool de la empresa (4 en
 *    multiempresa), cada una retenía una conexión con su bloqueo y esperaba otra: interbloqueo, la caja se quedaba
 *    colgada. Ahora terminan todas (aquí, más ventas que conexiones) y se mide la latencia (p50, p95, máximo).
 *  - Misma clave a la vez: una sola venta. Tiempo agotado (el bloqueo lo tiene otro proceso): error recuperable, sin
 *    venta, y el reintento cobra una vez.
 *  - Aislamiento: el bloqueo y el límite en memoria son de cada empresa; una no espera por la otra.
 * Solo empresas sintéticas nuevas; ningún cobro real.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { startEssentialApp, data, errCode, type EssentialApp, type Co } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const N = Number(process.env.TPV_CONCURRENCIA_N ?? 10);

describe.skipIf(!URL_)("TPV — ventas simultáneas sin interbloqueo, idempotentes y aisladas por empresa (aplicación real)", () => {
  let ess: EssentialApp;
  const adm: Record<Co, string> = { a: "", b: "" };
  const session: Record<Co, number> = { a: 0, b: 0 };
  const dbName: Record<Co, string> = { a: "", b: "" };

  const sale = (co: Co, key: string, euros = 5) =>
    ess.m(
      co,
      "tpv.createSale",
      {
        sessionId: session[co],
        idempotencyKey: key,
        discountAmount: 0,
        items: [{ productType: "extra", productId: 0, productName: "Venta de prueba", quantity: 1, unitPrice: euros, discountPercent: 0, participants: 1, isManual: true, conceptText: "Venta de prueba" }],
        payments: [{ method: "cash", amount: euros }],
      },
      adm[co],
    );
  const timed = async <T>(p: () => Promise<T>) => {
    const t0 = performance.now();
    const r = await p();
    return { r, ms: performance.now() - t0 };
  };
  const stats = (ms: number[]) => {
    const s = [...ms].sort((x, y) => x - y);
    const at = (q: number) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
    return { p50: Math.round(at(0.5)), p95: Math.round(at(0.95)), max: Math.round(s[s.length - 1]) };
  };
  const count = async (co: Co, q: string, p: unknown[] = []) => Number((await ess.sql(co, q, p))[0].n);
  /** Conexión propia a la BD de la empresa: hace de «otro proceso» que tiene el bloqueo de una clave. */
  const otherProcess = async (co: Co) => {
    const u = new URL(URL_!);
    u.pathname = `/${dbName[co]}`;
    return mysql.createConnection({ uri: u.toString() });
  };
  const lockSql = "MD5(CONCAT('es_tpv_sale:', DATABASE(), ':', ?))";

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "tpvconc");
    for (const co of ["a", "b"] as const) {
      adm[co] = await ess.login(co, "admin");
      const reg = data(await ess.m(co, "tpv.createRegister", { name: `Caja ${co}` }, adm[co])).id;
      session[co] = data(await ess.m(co, "tpv.openSession", { registerId: reg, openingAmount: 0 }, adm[co])).id;
      dbName[co] = String((await ess.sql(co, "SELECT DATABASE() AS d"))[0].d);
    }
    // Calienta el pool y la numeración
    expect((await sale("a", "calentar-a-0001")).status).toBe(200);
    expect((await sale("b", "calentar-b-0001")).status).toBe(200);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it(`${N} ventas simultáneas con claves distintas (más que conexiones del pool): todas cobradas, sin interbloqueo`, async () => {
    const before = await count("a", "SELECT COUNT(*) AS n FROM tpv_sales WHERE status_ts = 'paid'");
    const t0 = performance.now();
    const runs = await Promise.all(Array.from({ length: N }, (_, i) => timed(() => sale("a", `simultanea-${i}-0001`))));
    const wall = Math.round(performance.now() - t0);
    expect(runs.map((x) => x.r.status)).toEqual(runs.map(() => 200));
    expect(new Set(runs.map((x) => data(x.r).sale.ticketNumber)).size).toBe(N);
    expect(await count("a", "SELECT COUNT(*) AS n FROM tpv_sales WHERE status_ts = 'paid'")).toBe(before + N);
    const s = stats(runs.map((x) => x.ms));
    console.log(`[tpv-concurrencia] ${N} ventas simultáneas, claves distintas: p50 ${s.p50} ms · p95 ${s.p95} ms · máx ${s.max} ms · total ${wall} ms`);
    // Una venta suelta, como referencia
    const one = await timed(() => sale("a", "suelta-0001"));
    console.log(`[tpv-concurrencia] una venta sola: ${Math.round(one.ms)} ms`);
  }, 120_000);

  it("misma clave a la vez (doble clic múltiple): una sola venta y todos reciben esa venta", async () => {
    const before = await count("a", "SELECT COUNT(*) AS n FROM tpv_sales");
    const rs = await Promise.all(Array.from({ length: 6 }, () => sale("a", "misma-clave-0001")));
    expect(rs.map((r) => r.status)).toEqual(rs.map(() => 200));
    expect(new Set(rs.map((r) => data(r).sale.id)).size).toBe(1);
    expect(rs.filter((r) => data(r).replayed === false)).toHaveLength(1);
    expect(await count("a", "SELECT COUNT(*) AS n FROM tpv_sales")).toBe(before + 1);
  }, 120_000);

  it("tiempo agotado (otro proceso tiene la clave): error recuperable sin venta; el reintento cobra una sola vez", async () => {
    const key = "otro-proceso-0001";
    const other = await otherProcess("a");
    try {
      const [[g]] = (await other.query(`SELECT GET_LOCK(${lockSql}, 0) AS got`, [key])) as unknown as [[{ got: number }]];
      expect(Number(g.got)).toBe(1);
      const before = await count("a", "SELECT COUNT(*) AS n FROM tpv_sales");
      const r = await sale("a", key);
      expect(errCode(r)).toBe("CONFLICT");
      expect(String(r.json?.error?.json?.message)).toMatch(/ya se está registrando/);
      expect(await count("a", "SELECT COUNT(*) AS n FROM tpv_sales")).toBe(before);
      // Mientras, las ventas con otras claves siguen funcionando
      expect((await sale("a", "otra-clave-0001")).status).toBe(200);
      await other.query(`SELECT RELEASE_LOCK(${lockSql})`, [key]);
      const [a, b] = await Promise.all([sale("a", key), sale("a", key)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(data(a).sale.id).toBe(data(b).sale.id);
      expect(await count("a", "SELECT COUNT(*) AS n FROM tpv_sales WHERE idempotencyKey = ?", [key])).toBe(1);
    } finally {
      await other.end();
    }
  }, 120_000);

  it("aislamiento: el bloqueo de una clave en A no afecta a B con la misma clave, y una ráfaga en A no frena a B", async () => {
    const key = "compartida-0001";
    const other = await otherProcess("a");
    try {
      await other.query(`SELECT GET_LOCK(${lockSql}, 0) AS got`, [key]);
      const rb = await timed(() => sale("b", key));
      expect(rb.r.status).toBe(200);
      expect(rb.ms).toBeLessThan(5_000);
    } finally {
      await other.end();
    }
    // Ráfaga en A y una venta en B a la vez: B no hace cola tras A
    const solo = await timed(() => sale("b", "b-sola-0001"));
    const burst = Array.from({ length: N }, (_, i) => sale("a", `rafaga-${i}-0001`));
    const during = await timed(() => sale("b", "b-durante-0001"));
    const rs = await Promise.all(burst);
    expect(rs.map((r) => r.status)).toEqual(rs.map(() => 200));
    expect(during.r.status).toBe(200);
    console.log(`[tpv-concurrencia] B sola ${Math.round(solo.ms)} ms · B durante ${N} ventas de A ${Math.round(during.ms)} ms`);
    expect(await count("b", "SELECT COUNT(*) AS n FROM tpv_sales WHERE idempotencyKey LIKE 'rafaga-%'")).toBe(0);
  }, 120_000);
});
