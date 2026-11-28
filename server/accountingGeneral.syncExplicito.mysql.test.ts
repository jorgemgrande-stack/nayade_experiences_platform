/**
 * Contabilidad general · sincronización EXPLÍCITA (aplicación real sobre MySQL, opt-in con REGISTRY_TEST_DATABASE_URL):
 * abrir la pantalla (todas sus consultas) no escribe nada ni crea `acc_settings`, y por tanto el modo de caja del TPV
 * (`cashKindsInUse`) no cambia; la primera sincronización exige confirmar la fecha de inicio; el botón sincroniza y deja
 * traza con el nombre de quien la lanzó; las siguientes no cambian la fecha de inicio.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "accounting-general";
const year = () => Number(new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date()).slice(0, 4));

describe.skipIf(!URL_)("Contabilidad general · sincronización explícita (aplicación real)", () => {
  let ess: EssentialApp;
  let adA: string;
  const m = (proc: string, input?: unknown) => ess.m("a", `accountingGeneral.${proc}`, input, adA);
  const q = (proc: string, input?: unknown) => ess.q("a", `accountingGeneral.${proc}`, input, adA);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };
  const count = async (table: string) => Number((await ess.sql("a", `SELECT COUNT(*) AS n FROM ${table}`))[0].n);
  const period = () => ({ from: `${year()}-01-01`, to: `${year()}-12-31` });
  const cashTyped = async () => (await ok(ess.q("a", "tpv.cashMovementMode", undefined, adA))).typed as boolean;

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "contabexp");
    adA = await ess.login("a", "admin");
    await ess.setCapability("a", CAP, "active");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("abrir la pantalla (todas sus consultas) no escribe: sin acc_settings, sin asientos, sin traza y el TPV conserva su modo", async () => {
    expect(await cashTyped()).toBe(false);
    const o = await ok(q("overview"));
    expect(o.started).toBe(false);
    expect(o.defaultStartDate).toBe(`${year()}-01-01`);
    expect(o.counts.entries).toBe(0);
    await ok(q("accounts"));
    await ok(q("settings"));
    await ok(q("journal", { ...period(), page: 1, pageSize: 50 }));
    await ok(q("trialBalance", period()));
    await ok(q("profitAndLoss", period()));
    expect(await ok(q("syncRuns", { limit: 5 }))).toMatchObject({ available: true, items: [] });
    expect(await count("acc_settings")).toBe(0);
    expect(await count("acc_entries")).toBe(0);
    expect(await count("acc_accounts")).toBe(0);
    expect(await count("acc_sync_runs")).toBe(0);
    expect(await cashTyped()).toBe(false);
  });

  it("la primera sincronización exige confirmar la fecha de inicio: sin ella no escribe nada ni cambia el TPV", async () => {
    const r = await m("sync", { origin: "manual", startDate: null });
    expect(errCode(r)).toBe("CONFLICT");
    expect((await m("sync", undefined)).status).toBe(409);
    expect(errCode(await m("sync", { origin: "manual", startDate: "2026-13-45" }))).toBe("BAD_REQUEST");
    expect(await count("acc_settings")).toBe(0);
    expect(await count("acc_accounts")).toBe(0);
    expect(await count("acc_sync_runs")).toBe(0);
    expect(await cashTyped()).toBe(false);
  });

  it("el botón sincroniza con la fecha confirmada, deja traza con quien la lanzó, y las siguientes no cambian la fecha", async () => {
    const start = `${year()}-03-01`;
    const s = await ok(m("sync", { origin: "manual", startDate: start }));
    expect(s.errors).toEqual([]);
    const [row] = await ess.sql("a", "SELECT DATE_FORMAT(start_date, '%Y-%m-%d') AS d FROM acc_settings WHERE id = 1");
    expect(row.d).toBe(start);
    const o = await ok(q("overview"));
    expect(o.started).toBe(true);
    expect(o.settings.startDate).toBe(start);
    const runs = await ok(q("syncRuns", { limit: 5 }));
    expect(runs.items).toHaveLength(1);
    expect(runs.items[0]).toMatchObject({ origin: "manual", status: "ok" });
    expect(runs.items[0].actorName).toBeTruthy();
    // con la contabilidad iniciada el TPV pasa a tipos de movimiento de caja (comportamiento de siempre, ahora tras confirmar)
    expect(await cashTyped()).toBe(true);
    // otra sincronización con otra fecha: la de inicio no cambia y no hace falta indicarla
    await ok(m("sync", { origin: "manual", startDate: `${year()}-06-01` }));
    await ok(m("sync", { origin: "manual", startDate: null }));
    const [row2] = await ess.sql("a", "SELECT DATE_FORMAT(start_date, '%Y-%m-%d') AS d FROM acc_settings WHERE id = 1");
    expect(row2.d).toBe(start);
    expect(await count("acc_sync_runs")).toBe(3);
  });
});
