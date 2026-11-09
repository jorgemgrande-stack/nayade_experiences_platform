/**
 * Correcciones de una caja cerrada con la contabilidad general en uso (opt-in, REGISTRY_TEST_DATABASE_URL): cada
 * corrección se contabiliza UNA vez (clave `cajacorr:<id>`), aparte del cierre, y se refleja también como ajuste en la
 * caja contable (fin_cash_movements) sin que eso genere un segundo asiento. Empresa sintética; ningún cobro real.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, type EssentialApp, type Res } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "accounting-general";
const today = () => new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());
const key = (s: string) => `k-${s}-${Math.random().toString(36).slice(2, 10)}`;

describe.skipIf(!URL_)("Corrección de caja cerrada con la contabilidad general: una sola vez", () => {
  let ess: EssentialApp;
  let adA = "";
  let sessionId = 0;
  const ok = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 500)}`);
    return data(r);
  };
  const sync = async () => {
    const s = ok(await ess.m("a", "accountingGeneral.sync", undefined, adA), "generar asientos");
    expect(s.errors).toEqual([]);
  };
  const period = () => ({ from: `${today().slice(0, 4)}-01-01`, to: `${today().slice(0, 4)}-12-31` });
  const balance = async (code: string) => {
    const tb = ok(await ess.q("a", "accountingGeneral.trialBalance", period(), adA), "sumas y saldos");
    return tb.items.filter((r: any) => r.code === code).reduce((a: number, r: any) => a + r.balanceCents, 0);
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "tpvcorrcont");
    adA = await ess.login("a", "admin");
    await ess.markPaid("a");
    await ess.setCapability("a", CAP, "active");
    await ess.sql("a", "INSERT INTO fin_cash_accounts (name, type, current_balance, initial_balance) VALUES ('Caja', 'principal', 0, 0)");
    const registerId = ok(await ess.m("a", "tpv.createRegister", { name: "Mostrador" }, adA), "caja").id;
    sessionId = ok(await ess.m("a", "tpv.openSession", { registerId, openingAmount: 0 }, adA), "abrir caja").id;
    ok(await ess.m("a", "tpv.closeSession", { sessionId, countedCash: 0 }, adA), "cerrar caja");
    await sync(); // contabilidad iniciada y todo lo anterior contabilizado
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("salida y ajuste del recuento tras el cierre: un asiento cada uno, la caja contable con su ajuste y nada duplicado al repetir", async () => {
    const before = await balance("570");
    const out = ok(await ess.m("a", "tpv.addClosedSessionCorrection", { sessionId, kind: "cash_out", amount: 4.5, reason: "Cambio entregado sin anotar", idempotencyKey: key("s") }, adA), "salida");
    const adj = ok(await ess.m("a", "tpv.addClosedSessionCorrection", { sessionId, kind: "count_adjustment", amount: 2, reason: "Moneda encontrada en el cajón", idempotencyKey: key("a") }, adA), "ajuste");
    await sync();
    expect((await balance("570")) - before).toBe(-250);
    const entries = await ess.sql("a", "SELECT source_key FROM acc_entries WHERE source_key LIKE 'cajacorr:%' ORDER BY source_key");
    expect(entries.map((e: any) => String(e.source_key).split("#")[0])).toEqual([`cajacorr:${out.id}`, `cajacorr:${adj.id}`].sort());
    // Caja contable: dos ajustes enlazados a sus correcciones
    const fin = await ess.sql("a", "SELECT related_entity_id AS c, type_fcm AS t, amount FROM fin_cash_movements WHERE category = 'cash_adjustment' ORDER BY id");
    expect(fin.map((f: any) => [f.c, f.t, Number(f.amount)])).toEqual([[out.id, "expense", 4.5], [adj.id, "income", 2]]);
    // Repetir la generación no contabiliza nada más
    await sync();
    expect((await balance("570")) - before).toBe(-250);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM acc_entries WHERE source_key LIKE 'cajacorr:%'"))[0].n).toBe(2);
    // El cierre no cambia
    expect(Number((await ess.sql("a", "SELECT cashDifference AS d FROM cash_sessions WHERE id = ?", [sessionId]))[0].d)).toBe(0);
  });
});
