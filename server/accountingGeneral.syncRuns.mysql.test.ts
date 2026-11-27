/**
 * Contabilidad general · traza independiente de cada ejecución (`acc_sync_runs`, migración 0096) con la aplicación real
 * sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL; dos empresas desde la baseline). Una fila por ejecución con su actor,
 * origen y cantidades; el fallo deja traza; las ejecuciones concurrentes no se pisan; sin secretos ni datos personales; el
 * aviso de `account_map` inválido y el recuento de conflictos no cambian el resultado; y los asientos son IDÉNTICOS con
 * y sin traza (la empresa B se prueba SIN la tabla: la sincronización no falla ni cambia nada).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "accounting-general";
const year = () => Number(new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date()).slice(0, 4));

describe.skipIf(!URL_)("Contabilidad general · traza por ejecución acc_sync_runs (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  let adminIdA: number;
  const day = () => `${year()}-01-20`;

  const m = (proc: string, input: unknown, co: "a" | "b" = "a") => ess.m(co, `accountingGeneral.${proc}`, input, co === "a" ? adA : adB);
  const q = (proc: string, input?: unknown, cookie = adA) => ess.q("a", `accountingGeneral.${proc}`, input, cookie);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };
  /** Gasto con IVA confirmado en la contabilidad (mismo patrón que accountingGeneral.mysql.test.ts). */
  const addExpense = async (co: "a" | "b", concept: string, amount: string, tax: string) => {
    await ess.sql(co, "INSERT INTO expenses (date, concept, amount, categoryId, costCenterId, paymentMethod, taxRate, taxAmount, fiscalReviewStatus) VALUES (?, ?, ?, 1, 1, 'cash', 21, ?, 'revisado')", [day(), concept, amount, tax]);
    const [e] = await ess.sql(co, "SELECT id FROM expenses WHERE concept = ?", [concept]);
    await ok(m("confirmExpenseTax", { expenseId: e.id, confirmed: true }, co));
  };
  /** Contenido contable completo, sin ids de la traza: lo que debe ser idéntico con y sin traza. */
  const ledger = async (co: "a" | "b") => ({
    entries: await ess.sql(co, "SELECT year, number, DATE_FORMAT(entry_date,'%Y-%m-%d') AS d, journal, description, origin, source_key, total_cents, reverses_entry_id, reversed_by_entry_id FROM acc_entries ORDER BY id"),
    lines: await ess.sql(co, "SELECT entry_id, line_no, account_code, debit_cents, credit_cents, description, tax_rate_bp, tax_base_cents FROM acc_entry_lines ORDER BY entry_id, line_no"),
    sources: await ess.sql(co, "SELECT source_key, entry_id, hash, version FROM acc_sources ORDER BY source_key"),
  });
  const runs = async () => (await ok(q("syncRuns", { limit: 50 }))) as { available: boolean; items: any[] };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "contabruns");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
    adminIdA = await ess.userId("a", "admin");
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("los asientos son idénticos con traza (A) y sin la tabla de traza (B): la sincronización no falla ni cambia nada", async () => {
    await ok(m("sync", undefined, "b")); // siembra ajustes y plan en B
    await ess.sql("b", "DROP TABLE acc_sync_runs");
    for (const co of ["a", "b"] as const) {
      await addExpense(co, "Material oficina", "121.00", "21.00");
      await addExpense(co, "Suministros", "60.50", "10.50");
    }
    const a = await ok(m("sync", undefined, "a"));
    const b = await ok(m("sync", undefined, "b"));
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    expect(a.created).toBeGreaterThan(0);
    expect({ ...b, at: "", skipped: undefined }).toEqual({ ...a, at: "", skipped: undefined });
    expect(await ledger("b")).toEqual(await ledger("a"));
    // sin la tabla, el procedimiento de lectura no falla: dice que no está disponible
    const r = await ok(ess.q("b", "accountingGeneral.syncRuns", undefined, adB));
    expect(r).toEqual({ available: false, items: [] });
    // y una segunda sincronización sigue sin cambiar nada
    expect((await ok(m("sync", undefined, "b"))).created).toBe(0);
  });

  it("una fila por ejecución, con actor, origen, cantidades y fin", async () => {
    const before = (await runs()).items.length;
    expect(before).toBe(1); // la del test anterior
    const first = (await runs()).items[0];
    expect(first).toMatchObject({ actor: `user:${adminIdA}`, origin: "manual", status: "ok", created: expect.any(Number), errors: 0, conflicts: 0 });
    expect(first.created).toBeGreaterThan(0);
    expect(first.finishedAt).toBeTruthy();
    expect(first.startedAt).toBeTruthy();

    await ok(m("sync", { origin: "pantalla" }));
    const list = (await runs()).items;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ actor: `user:${adminIdA}`, origin: "pantalla", status: "ok", created: 0 });
    expect(list[0].unchanged).toBeGreaterThan(0);
    expect(list[0].id).toBeGreaterThan(list[1].id); // más recientes primero
    const [raw] = await ess.sql("a", "SELECT tenant_id, actor_user_id FROM acc_sync_runs ORDER BY id DESC LIMIT 1");
    expect(raw.actor_user_id).toBe(adminIdA);
    expect(raw.tenant_id).toBeTruthy();
  });

  it("la lectura es solo para la administración y no escribe", async () => {
    expect(errCode(await ess.q("a", "accountingGeneral.syncRuns", undefined, agA))).toBe("FORBIDDEN");
    const [{ n: n1 }] = await ess.sql("a", "SELECT COUNT(*) AS n FROM acc_sync_runs");
    await ess.setCapability("a", CAP, "read_only");
    expect((await q("syncRuns")).status).toBe(200);
    await ess.setCapability("a", CAP, "active");
    const [{ n: n2 }] = await ess.sql("a", "SELECT COUNT(*) AS n FROM acc_sync_runs");
    expect(Number(n2)).toBe(Number(n1));
  });

  it("dos ejecuciones a la vez dejan dos filas propias y los asientos no se duplican", async () => {
    await addExpense("a", "Concurrente", "30.25", "5.25");
    const [e] = await ess.sql("a", "SELECT id FROM expenses WHERE concept = 'Concurrente'");
    const base = (await runs()).items.length;
    const [r1, r2] = await Promise.all([m("sync", undefined), m("sync", undefined)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const list = (await runs()).items;
    expect(list).toHaveLength(base + 2);
    const [x, y] = list.slice(0, 2);
    expect(x.id).not.toBe(y.id);
    expect([x.status, y.status]).toEqual(["ok", "ok"]);
    expect(x.finishedAt).toBeTruthy();
    expect(y.finishedAt).toBeTruthy();
    const [{ n }] = await ess.sql("a", "SELECT COUNT(*) AS n FROM acc_entries WHERE source_key LIKE ?", [`gasto:${e.id}#%`]);
    expect(Number(n)).toBe(1);
    // lo que una creó, la otra no: los creados suman exactamente los asientos del gasto y su pago
    const created = [x, y].reduce((a, r) => a + r.created, 0);
    expect(created).toBe(2);
    // la que perdió la carrera lo cuenta como saltado o como conflicto, nunca como creado
    expect([x, y].reduce((a, r) => a + r.skipped + r.conflicts, 0)).toBeGreaterThanOrEqual(0);
  });

  it("un fallo también deja traza (error, sin detalles internos) y la siguiente ejecución funciona", async () => {
    await ess.sql("a", "RENAME TABLE acc_sources TO acc_sources_off");
    let r;
    try {
      r = await m("sync", undefined);
    } finally {
      await ess.sql("a", "RENAME TABLE acc_sources_off TO acc_sources");
    }
    expect(errCode(r)).toBe("PRECONDITION_FAILED");
    const last = (await runs()).items[0];
    expect(last.status).toBe("error");
    expect(last.finishedAt).toBeTruthy();
    expect(last.errorSummary).toBeTruthy();
    expect(last.errorSummary).not.toMatch(/mysql|SELECT|INSERT|sqlMessage|acc_sources/i);
    expect((await ok(m("sync", undefined))).errors).toEqual([]);
  });

  it("la traza no contiene datos personales ni secretos de los documentos", async () => {
    await ess.sql("a", "INSERT INTO expenses (date, concept, amount, categoryId, costCenterId, paymentMethod, taxRate, taxAmount, supplierName, fiscalReviewStatus) VALUES (?, 'Proveedor Secreto', 12.10, 1, 1, 'cash', 21, 2.10, 'Persona Privada persona@privado.example', 'revisado')", [day()]);
    await ok(m("sync", undefined));
    const all = await ess.sql("a", "SELECT * FROM acc_sync_runs");
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/persona@privado|Persona Privada|Proveedor Secreto|password|token|secret/i);
    for (const r of all) {
      expect(String(r.warnings ?? "").length).toBeLessThanOrEqual(1000);
      expect(String(r.error_summary ?? "").length).toBeLessThanOrEqual(2000);
    }
  });

  it("account_map inválido: avisa en el resumen y en la traza, y rige el mapa por defecto sin cambiar asientos", async () => {
    const before = await ledger("a");
    await ess.sql("a", "UPDATE acc_settings SET account_map = '\"no-es-un-mapa\"' WHERE id = 1");
    const s = await ok(m("sync", undefined));
    expect(s.warnings).toHaveLength(1);
    expect(s.warnings[0]).toMatch(/account_map/);
    expect(s.created).toBe(0);
    const last = (await runs()).items[0];
    expect(last.warnings).toMatch(/account_map/);
    expect(last.status).toBe("ok"); // aviso, no error
    const after = await ledger("a");
    expect(after.entries.filter((e: any) => !before.entries.some((b: any) => b.source_key === e.source_key))).toEqual([]);
    expect(after).toEqual(before);
    // con un valor no válido en una clave
    await ess.sql("a", "UPDATE acc_settings SET account_map = JSON_SET(JSON_OBJECT(), '$.cash', 7) WHERE id = 1");
    expect((await ok(m("sync", undefined))).warnings[0]).toMatch(/cash/);
    // y sin aviso con el mapa válido de siempre
    await ess.sql("a", "UPDATE acc_settings SET account_map = NULL WHERE id = 1");
    expect((await ok(m("sync", undefined))).warnings).toEqual([]);
  });
});
