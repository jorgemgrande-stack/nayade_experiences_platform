/**
 * Medidas de rendimiento de Essential con la pila completa (opt-in: PERF=1 y REGISTRY_TEST_DATABASE_URL).
 * NO es una prueba de capacidad máxima: mide esta máquina con MySQL en Docker y comprueba, además de
 * los tiempos, la ausencia de duplicados, cruces de empresa, errores no controlados, bloqueos largos y
 * fugas de conexiones. Datos sintéticos (dominios `.example`); ningún cobro ni correo real.
 *
 *   PERF=1 REGISTRY_TEST_DATABASE_URL=mysql://root:ci_only@127.0.0.1:3418/registry_test \
 *     pnpm vitest run server/rendimiento.perf.mysql.test.ts
 *
 * Variables opcionales: PERF_TENANTS (10), PERF_LOGINS (50), PERF_CLIENTS (1000), PERF_DOCS (100).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { startElephantStack, data, DAY, type ElephantStack, type Res } from "./elephantStack.testkit";

vi.mock("./mailer", async (orig) => ({ ...(await orig<typeof import("./mailer")>()), sendEmail: async () => true }));

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const ON = !!URL_ && process.env.PERF === "1";
const N_TENANTS = Number(process.env.PERF_TENANTS ?? 10);
const N_LOGINS = Number(process.env.PERF_LOGINS ?? 50);
const N_CLIENTS = Number(process.env.PERF_CLIENTS ?? 1000);
const N_DOCS = Number(process.env.PERF_DOCS ?? 100);

type Row = { medida: string; n: number; conc: number; p50: number; p95: number; max: number; totalMs: number; errores: number };
const rows: Row[] = [];
const notes: string[] = [];

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
/** Ejecuta `n` tareas con `conc` en vuelo; mide cada una y el total. */
async function measure<T>(medida: string, n: number, conc: number, task: (i: number) => Promise<T>, ok: (v: T) => boolean): Promise<T[]> {
  const times: number[] = [];
  const out: T[] = new Array(n);
  let next = 0;
  let errors = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: Math.min(conc, n) }, async () => {
      while (next < n) {
        const i = next++;
        const s = performance.now();
        try {
          out[i] = await task(i);
          if (!ok(out[i])) errors++;
        } catch {
          errors++;
        }
        times.push(performance.now() - s);
      }
    }),
  );
  const r = { medida, n, conc, p50: Math.round(pct(times, 50)), p95: Math.round(pct(times, 95)), max: Math.round(Math.max(...times)), totalMs: Math.round(performance.now() - t0), errores: errors };
  rows.push(r);
  return out;
}
const is200 = (r: Res) => r.status === 200;

describe.skipIf(!ON)("rendimiento de Essential (opt-in PERF=1, MySQL en Docker)", () => {
  let s: ElephantStack;
  let probe: mysql.Connection;
  let baselineConns = 0;
  let maxConns = 0;
  let sampler: ReturnType<typeof setInterval> | null = null;
  const fivexx: string[] = [];
  const unhandled: string[] = [];
  const onUnhandled = (e: unknown) => void unhandled.push(String((e as Error)?.message ?? e));
  const lockStatus = async () => {
    const [r] = await probe.query<mysql.RowDataPacket[]>("SHOW GLOBAL STATUS WHERE Variable_name IN ('Innodb_row_lock_waits','Innodb_row_lock_time_max','Questions')");
    return Object.fromEntries(r.map((x) => [x.Variable_name, Number(x.Value)]));
  };
  const conns = async () => Number((await probe.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST"))[0][0].n);
  let locks0: Record<string, number> = {};
  const tenants: Array<{ id: string; trialId: number; email: string; pass: string; cookie: string }> = [];
  const track = (r: Res, what: string) => {
    if (r.status >= 500) fivexx.push(`${what}: ${r.status}`);
    return r;
  };

  beforeAll(async () => {
    probe = await mysql.createConnection({ uri: URL_! });
    baselineConns = await conns();
    // Consultas lentas (> 200 ms) a la tabla del registro lento (solo en el contenedor desechable)
    await probe.query("SET GLOBAL log_output = 'TABLE'");
    await probe.query("SET GLOBAL long_query_time = 0.2");
    await probe.query("SET GLOBAL slow_query_log = 'ON'");
    await probe.query("TRUNCATE TABLE mysql.slow_log");
    process.on("unhandledRejection", onUnhandled);
    s = await startElephantStack(URL_!, { label: "perf", perMinute: 1_000_000 });
    locks0 = await lockStatus();
    sampler = setInterval(() => void conns().then((n) => (maxConns = Math.max(maxConns, n)), () => undefined), 250);
  }, 180_000);

  afterAll(async () => {
    if (sampler) clearInterval(sampler);
    process.off("unhandledRejection", onUnhandled);
    if (s) await s.close();
    // Fugas: tras cerrar la pila, las conexiones vuelven a la línea base
    let after = await conns();
    for (let i = 0; i < 40 && after > baselineConns; i++) {
      await new Promise((r) => setTimeout(r, 250));
      after = await conns();
    }
    notes.push(`Conexiones MySQL: base ${baselineConns}, máximo observado ${maxConns}, tras cerrar ${after}`);
    const [slow] = await probe.query<mysql.RowDataPacket[]>("SELECT query_time, LEFT(sql_text, 160) AS q FROM mysql.slow_log WHERE sql_text NOT LIKE 'SET GLOBAL%' AND sql_text NOT LIKE 'DROP DATABASE%' ORDER BY query_time DESC LIMIT 10");
    notes.push(`Consultas > 200 ms (sin contar el borrado final de las BD de prueba): ${slow.length}${slow.length ? "\n    " + slow.map((x) => `${x.query_time} ${String(x.q).replace(/\s+/g, " ")}`).join("\n    ") : ""}`);
    await probe.query("SET GLOBAL slow_query_log = 'OFF'");
    await probe.end();
    // eslint-disable-next-line no-console
    console.log(
      [
        "",
        "RENDIMIENTO (ms) — esta máquina, MySQL 8.4 en Docker",
        "| Medida | N | Concurrencia | p50 | p95 | máx | total | errores |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
        ...rows.map((r) => `| ${r.medida} | ${r.n} | ${r.conc} | ${r.p50} | ${r.p95} | ${r.max} | ${r.totalMs} | ${r.errores} |`),
        "",
        ...notes.map((n) => `- ${n}`),
      ].join("\n"),
    );
    expect(after).toBeLessThanOrEqual(baselineConns);
  }, 60_000);

  it(`registros simultáneos y creación de ${N_TENANTS} empresas`, async () => {
    const reg = await measure(`registro público (POST /public/trial)`, N_TENANTS, N_TENANTS, (i) =>
      s.cp("POST", "/public/trial", { body: { email: `perf${i}-${s.run}@perf${i}.example`, companyName: `Perf Empresa ${i} ${s.run}`, idempotencyKey: crypto.randomBytes(12).toString("hex") } }).then((r) => track(r, "registro")),
    (r) => r.status === 202);
    expect(reg.every((r) => r.status === 202)).toBe(true);
    const ver = await measure(`verificación + aprovisionamiento real de la BD`, N_TENANTS, N_TENANTS, (i) => s.cp("POST", "/public/trial/verify", { body: s.verificationLink(`perf${i}-${s.run}@perf${i}.example`) }).then((r) => track(r, "verificación")), is200);
    expect(ver.map((r) => r.status)).toEqual(Array(N_TENANTS).fill(200));
    for (let i = 0; i < N_TENANTS; i++) {
      const id = String(ver[i].json.domain).split(".")[0];
      s.tenants.push(id);
      tenants.push({ id, trialId: s.verificationLink(`perf${i}-${s.run}@perf${i}.example`).id, email: `perf${i}-${s.run}@perf${i}.example`, pass: `clave-${s.run}-perf-${i}`, cookie: "" });
    }
    // Sin duplicados: una prueba, una empresa del CRM, una BD y una suscripción por alta
    expect(new Set(tenants.map((t) => t.id)).size).toBe(N_TENANTS);
    const [dbs] = await s.regPool.query<mysql.RowDataPacket[]>("SELECT tenant_id, COUNT(*) AS n FROM tenant_databases GROUP BY tenant_id HAVING n > 1");
    expect(dbs).toEqual([]);
    const [cos] = await s.crmPool.query<mysql.RowDataPacket[]>("SELECT tenant_id, COUNT(*) AS n FROM crm_companies WHERE tenant_id IS NOT NULL GROUP BY tenant_id HAVING n > 1");
    expect(cos).toEqual([]);
    const [subs] = await s.crmPool.query<mysql.RowDataPacket[]>("SELECT company_id, COUNT(*) AS n FROM subscriptions GROUP BY company_id HAVING n > 1");
    expect(subs).toEqual([]);
    const [tr] = await s.crmPool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM trial_requests WHERE state = 'active'");
    expect(Number(tr[0].n)).toBe(N_TENANTS);
    notes.push(`Registro público: límite de 20 peticiones/hora por IP en /public/trial (registro + verificación); esta medida usa ${2 * N_TENANTS} desde una sola IP.`);
  }, 600_000);

  it(`inicio de sesión: ${N_LOGINS} simultáneos repartidos entre las empresas`, async () => {
    for (const t of tenants) {
      const r = await s.m(t.id, "public.setPassword", { token: s.welcomeLink(t.email)!.token, password: t.pass });
      expect(r.status).toBe(200);
    }
    const out = await measure(`login (POST /api/auth/login, bcrypt coste 12)`, N_LOGINS, N_LOGINS, (i) => {
      const t = tenants[i % tenants.length];
      return s.app(t.id, "POST", "/api/auth/login", { body: { email: t.email, password: t.pass } }).then((r) => track(r, "login"));
    }, (r) => r.status === 200 && !!r.cookie);
    expect(out.every((r) => r.status === 200)).toBe(true);
    tenants.forEach((t, i) => (t.cookie = out[i].cookie!));
    // Cada sesión es de su empresa
    for (const t of tenants) expect(data(await s.q(t.id, "auth.me", undefined, t.cookie)).email).toBe(t.email);
  }, 300_000);

  it(`CRM con ${N_CLIENTS} clientes: altas por la API y listados`, async () => {
    const t = tenants[0];
    await measure(`alta de cliente (crm.clients.create)`, N_CLIENTS, 10, (i) => s.m(t.id, "crm.clients.create", { name: `Cliente Perf ${i}`, email: `c${i}@clientes-perf.example`, company: i % 7 === 0 ? "Grupo Siete" : undefined }, t.cookie).then((r) => track(r, "clients.create")), is200);
    const [n] = await s.tenantConn(t.id).then(async (c) => {
      try {
        return await c.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n, COUNT(DISTINCT email) AS d FROM clients");
      } finally {
        await c.end();
      }
    });
    expect({ n: Number(n[0].n), d: Number(n[0].d) }).toEqual({ n: N_CLIENTS, d: N_CLIENTS });
    await measure(`listado de clientes (50 por página, secuencial)`, 40, 1, (i) => s.q(t.id, "crm.clients.list", { limit: 50, offset: (i * 50) % N_CLIENTS }, t.cookie), (r) => is200(r) && data(r).total === N_CLIENTS);
    await measure(`listado de clientes (20 simultáneos)`, 100, 20, (i) => s.q(t.id, "crm.clients.list", { limit: 50, offset: (i * 50) % N_CLIENTS }, t.cookie), is200);
    await measure(`búsqueda de clientes (LIKE %texto%)`, 40, 10, () => s.q(t.id, "crm.clients.list", { search: "Siete", limit: 50, offset: 0 }, t.cookie), (r) => is200(r) && data(r).total === Math.ceil(N_CLIENTS / 7));
    // Consultas SQL por petición (detección de N+1): delta del contador global con la pila en reposo
    const per = async (fn: () => Promise<Res>) => {
      const a = (await lockStatus()).Questions;
      const r = await fn();
      expect(r.status).toBe(200);
      return (await lockStatus()).Questions - a - 1;
    };
    const qList = await per(() => s.q(t.id, "crm.clients.list", { limit: 50, offset: 0 }, t.cookie));
    const qStatus = await per(() => s.q(t.id, "setupWizard.status", undefined, t.cookie));
    const qOverview = await per(() => s.q(t.id, "subscription.overview", undefined, t.cookie));
    notes.push(`Consultas SQL por petición (aprox., incluye sesión y ajustes): clients.list(50) ${qList}, setupWizard.status ${qStatus}, subscription.overview ${qOverview}`);
    expect(qList).toBeLessThan(50); // un N+1 sobre 50 filas daría > 50
  }, 600_000);

  it(`presupuestos y facturas en paralelo (${N_DOCS} de cada) sin numeración duplicada`, async () => {
    const t = tenants[1];
    const cat = data(await s.m(t.id, "products.createCategory", { slug: "perf", name: "Perf" }, t.cookie));
    const loc = data(await s.m(t.id, "products.createLocation", { slug: "perf", name: "Perf" }, t.cookie));
    expect((await s.m(t.id, "products.create", { slug: "servicio-perf", title: "Servicio Perf", categoryId: cat.id, locationId: loc.id, basePrice: "100.00", taxRate: "21" }, t.cookie)).status).toBe(200);
    const c = await s.tenantConn(t.id);
    try {
      const productId = Number((await c.query<mysql.RowDataPacket[]>("SELECT id FROM experiences WHERE slug = 'servicio-perf'"))[0][0].id);
      await measure(`presupuesto (crm.quotes.createDirect)`, N_DOCS, 10, (i) => s.m(t.id, "crm.quotes.createDirect", { clientName: `Cliente Q${i}`, clientEmail: `q${i}@perf.example`, title: `Presupuesto ${i}`, items: [{ description: "Servicio Perf", quantity: 1, unitPrice: 100, total: 100, taxRate: 21 }], subtotal: 100, taxRate: 21, total: 121, pricesIncludeTax: false, sendNow: false }, t.cookie).then((r) => track(r, "quotes")), is200);
      await measure(`venta con factura (crm.reservations.createManual)`, N_DOCS, 10, (i) => s.m(t.id, "crm.reservations.createManual", { customerName: `Cliente F${i}`, customerEmail: `f${i}@perf.example`, productId, productName: "Servicio Perf", bookingDate: "2030-05-01", people: 1, amountTotal: 121, amountPaid: 121, sendConfirmationEmail: false }, t.cookie).then((r) => track(r, "createManual")), is200);
      const [q] = await c.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n, COUNT(DISTINCT quoteNumber) AS d FROM quotes");
      expect({ n: Number(q[0].n), d: Number(q[0].d) }).toEqual({ n: N_DOCS, d: N_DOCS });
      const [inv] = await c.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n, COUNT(DISTINCT invoiceNumber) AS d FROM invoices");
      expect({ n: Number(inv[0].n), d: Number(inv[0].d) }).toEqual({ n: N_DOCS, d: N_DOCS });
      const [nums] = await c.query<mysql.RowDataPacket[]>("SELECT invoiceNumber FROM invoices ORDER BY invoiceNumber");
      const seq = nums.map((x) => Number(String(x.invoiceNumber).split("-").at(-1)));
      expect(seq).toEqual(Array.from({ length: N_DOCS }, (_, i) => i + 1)); // correlativa y sin huecos
    } finally {
      await c.end();
    }
  }, 600_000);

  it(`aplicación de licencias y renovaciones (${N_TENANTS} empresas en paralelo, pagos de PRUEBA firmados)`, async () => {
    const hook = (p: any) => {
      const body = JSON.stringify({ id: `evt_perf_${crypto.randomBytes(6).toString("hex")}`, type: "payment.succeeded", paymentKey: p.idempotencyKey, providerRef: p.providerRef, amountCents: p.amountCents, currency: p.currency, livemode: false });
      return s.request(s.cpPort, "POST", "/cp/v1/payments/test/webhook", { raw: body, headers: { "content-type": "application/json", "x-test-signature": s.signPayment(body) } });
    };
    const tok = { token: s.adminToken };
    const orders = await measure(`contratación completa (pedido → firma → pago → licencias)`, tenants.length, tenants.length, async (i) => {
      const o = await s.cp("POST", "/orders", { ...tok, body: { idempotencyKey: crypto.randomBytes(12).toString("hex"), trialId: tenants[i].trialId, request: { plan: "essential", interval: "month", items: [] } } });
      if (o.status !== 201) throw new Error(`pedido ${o.status} ${o.raw}`);
      const a = await s.cp("POST", `/orders/${o.json.order.id}/accept`, { ...tok, body: { signatureRef: `perf-${i}`, approvalReason: "Medida de rendimiento" } });
      if (a.status !== 202) throw new Error(`firma ${a.status}`);
      const p = await s.cp("POST", `/orders/${o.json.order.id}/payments`, tok);
      const h = await hook(p.json.payment);
      if (h.json?.outcome !== "applied") throw new Error(`pago ${h.status} ${h.raw}`);
      return o.json.order.id as number;
    }, (id) => typeof id === "number");
    const [g] = await s.regPool.query<mysql.RowDataPacket[]>("SELECT tenant_id, COUNT(*) AS n, SUM(status = 'active' AND valid_until IS NULL) AS live FROM tenant_capabilities GROUP BY tenant_id");
    expect(g).toHaveLength(tenants.length);
    expect(g.every((x) => Number(x.n) === Number(x.live) && Number(x.n) >= 29)).toBe(true);
    // Renovación de todas a la vez al fin de periodo
    const [pe] = await s.crmPool.query<mysql.RowDataPacket[]>("SELECT MAX(current_period_end) AS m FROM subscriptions");
    s.clock.now = Number(pe[0].m) + 1000;
    const before = Object.fromEntries((await s.crmPool.query<mysql.RowDataPacket[]>("SELECT id, current_period_end FROM subscriptions"))[0].map((x) => [x.id, Number(x.current_period_end)]));
    await measure(`renovación (orders/:id/renew + pago firmado)`, orders.length, orders.length, async (i) => {
      const r = await s.cp("POST", `/orders/${orders[i]}/renew`, tok);
      if (r.status !== 200) throw new Error(`renovación ${r.status} ${r.raw}`);
      if (r.json.payment) {
        const h = await hook(r.json.payment);
        if (h.status !== 200) throw new Error(`pago renovación ${h.status}`);
      }
      return r;
    }, is200);
    const [after] = await s.crmPool.query<mysql.RowDataPacket[]>("SELECT id, status, current_period_end FROM subscriptions");
    expect(after.every((x) => x.status === "active" && Number(x.current_period_end) > before[x.id])).toBe(true);
    const [dup] = await s.crmPool.query<mysql.RowDataPacket[]>("SELECT order_id, purpose, COUNT(*) AS n FROM commercial_payments WHERE status = 'succeeded' GROUP BY order_id, purpose HAVING n > 1");
    expect(dup).toEqual([]);
    // Revisión periódica con todo al corriente: rápida y sin errores
    const t0 = performance.now();
    const rev = await s.cp("POST", "/orders/review", tok);
    expect(rev.json.errors).toEqual([]);
    notes.push(`Revisión /orders/review con ${orders.length} pedidos: ${Math.round(performance.now() - t0)} ms`);
    s.clock.now = Date.now();
  }, 600_000);

  it("sin cruces de empresa, sin errores no controlados ni bloqueos largos", async () => {
    // Cada empresa ve solo lo suyo
    const totals = await Promise.all(tenants.map((t) => s.q(t.id, "crm.clients.list", { limit: 1, offset: 0 }, t.cookie).then((r) => data(r)?.total)));
    // La 1 tiene los clientes que crean sus presupuestos y ventas (uno por correo distinto)
    expect(totals).toEqual(tenants.map((_, i) => (i === 0 ? N_CLIENTS : i === 1 ? 2 * N_DOCS : 0)));
    const quotes = await Promise.all(tenants.map((t) => s.q(t.id, "crm.invoices.listAll", {}, t.cookie).then((r) => data(r)?.total)));
    expect(quotes).toEqual(tenants.map((_, i) => (i === 1 ? N_DOCS : 0)));
    // La sesión de una empresa no sirve en otra
    expect((await s.q(tenants[0].id, "crm.clients.list", { limit: 1, offset: 0 }, tenants[1].cookie)).status).toBe(401);
    const l = await lockStatus();
    notes.push(`InnoDB durante la medida: esperas de bloqueo de fila ${l.Innodb_row_lock_waits - locks0.Innodb_row_lock_waits}, espera máxima ${l.Innodb_row_lock_time_max} ms (global)`);
    notes.push(`Respuestas 5xx: ${fivexx.length}; promesas rechazadas sin controlar: ${unhandled.length}`);
    expect(fivexx).toEqual([]);
    expect(unhandled).toEqual([]);
    expect(l.Innodb_row_lock_time_max).toBeLessThan(5000);
  });
});
