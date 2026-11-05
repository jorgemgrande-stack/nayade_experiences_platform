/**
 * Social Token Net · Tokens internos — recompensas y canjes (STN-2) con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL): dos empresas nuevas desde la baseline y las migraciones de empresa (0026 y 0029).
 * Sin la extensión no hay recompensas ni área de puntos; con ella, el canje descuenta los puntos y da un código de un
 * solo uso (idempotente), las últimas unidades y el saldo nunca se canjean dos veces (canjes simultáneos), el código
 * no se usa dos veces (validaciones simultáneas), la anulación y la caducidad devuelven los puntos una sola vez, y el
 * área del cliente funciona con su enlace firmado (y no con el de otra empresa).
 */
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "social-token-net-tokens";

const baseReward = { description: null, stock: null, perClientLimit: null, limitPeriod: null, codeValidDays: 30, active: true, startsAt: null, endsAt: null };

describe.skipIf(!URL_)("Recompensas y canjes (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  const client: Record<string, number> = {};
  let cafe = 0;

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "recompensas");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
    for (const [co, name] of [["a", "Ana"], ["a", "Bea"], ["a", "Ciro"], ["b", "Carla"]] as const) {
      await ess.sql(co, "INSERT INTO clients (name, email, source) VALUES (?, ?, 'manual')", [name, `${name.toLowerCase()}@cliente-${co}.example`]);
      client[name] = (await ess.sql(co, "SELECT id FROM clients WHERE email = ?", [`${name.toLowerCase()}@cliente-${co}.example`]))[0].id;
    }
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  const key = () => crypto.randomBytes(12).toString("hex");
  const balance = async (name: string) => Number((await ess.sql("a", "SELECT balance FROM loyalty_wallets WHERE client_id = ?", [client[name]]))[0]?.balance ?? 0);
  const credit = (name: string, amount: number) => ess.m("a", "loyalty.adjust", { clientId: client[name], direction: "credit", amount, reason: "saldo de prueba", key: key() }, adA);
  const redeem = (name: string, rewardId: number, k = key(), cookie = adA) => ess.m("a", "loyalty.redeemForClient", { clientId: client[name], rewardId, key: k }, cookie);
  const newReward = async (name: string, costPoints: number, extra: Record<string, unknown> = {}) => data(await ess.m("a", "loyalty.saveReward", { id: null, reward: { ...baseReward, name, costPoints, ...extra } }, adA)).id as number;
  const form = (co: "a" | "b", p: string, body: Record<string, string>) => ess.call(co, "POST", p, { raw: new URLSearchParams(body).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
  const portalPath = async (name: string) => {
    const url: string = data(await ess.q("a", "loyalty.portalLink", { clientId: client[name] }, adA)).url;
    return url.slice(url.indexOf("/mis-puntos"));
  };

  it("sin la extensión: ni recompensas, ni canjes, ni área de puntos", async () => {
    expect(isLicenseDenied(await ess.q("b", "loyalty.rewards", undefined, adB), CAP)).toBe(true);
    expect(isLicenseDenied(await ess.m("b", "loyalty.consumeCode", { code: "ABCDE-FGHJK" }, adB), CAP)).toBe(true);
    const area = await ess.call("b", "GET", "/mis-puntos");
    expect(area.status).toBe(404);
    expect(area.text).toContain("no está disponible");
  });

  it("canje en el mostrador: descuenta los puntos, da un código y es idempotente; solo administración", async () => {
    await ess.setCapability("a", CAP, "active");
    expect((await ess.m("a", "loyalty.saveProgram", { enabled: true, pointsName: "puntos", eqPoints: null, eqEuros: null, expiryMonths: null }, adA)).status).toBe(200);
    expect(errCode(await ess.m("a", "loyalty.saveReward", { id: null, reward: { ...baseReward, name: "Café", costPoints: 100 } }, agA))).toBe("FORBIDDEN");
    cafe = await newReward("Café", 100);
    expect((await credit("Ana", 500)).status).toBe(200);
    expect(errCode(await redeem("Ana", cafe, key(), agA))).toBe("FORBIDDEN");
    const k = key();
    const r = data(await redeem("Ana", cafe, k));
    expect(r).toMatchObject({ applied: true, points: 100, balance: 400, rewardName: "Café" });
    expect(r.code).toMatch(/^[A-Z2-9]{10}$/);
    const again = data(await redeem("Ana", cafe, k));
    expect(again).toMatchObject({ applied: false, code: r.code });
    expect(await balance("Ana")).toBe(400);
    expect((await ess.sql("a", "SELECT kind, direction, amount FROM loyalty_ledger WHERE client_id = ? AND kind = 'canje'", [client.Ana]))).toEqual([{ kind: "canje", direction: "debit", amount: 100 }]);
    // Sin saldo suficiente no se canjea
    expect(errCode(await redeem("Ciro", cafe))).toBe("BAD_REQUEST");
    // Un canje no se anula desde el libro (el código seguiría valiendo): se anula desde el canje
    const [mv] = await ess.sql("a", "SELECT id FROM loyalty_ledger WHERE client_id = ? AND kind = 'canje'", [client.Ana]);
    expect(errCode(await ess.m("a", "loyalty.reverse", { ledgerId: mv.id, reason: "prueba" }, adA))).toBe("BAD_REQUEST");
  });

  it("canjes simultáneos: las últimas unidades y el saldo nunca se canjean dos veces", async () => {
    const limited = await newReward("Camiseta", 50, { stock: 2 });
    const res = await Promise.all(Array.from({ length: 5 }, () => redeem("Ana", limited)));
    expect(res.filter((x) => x.status === 200)).toHaveLength(2);
    for (const x of res.filter((y) => y.status !== 200)) expect(errCode(x)).toBe("CONFLICT");
    expect(await balance("Ana")).toBe(300);

    await credit("Bea", 100);
    const cheap = await newReward("Galleta", 40);
    const res2 = await Promise.all(Array.from({ length: 5 }, () => redeem("Bea", cheap)));
    expect(res2.filter((x) => x.status === 200)).toHaveLength(2);
    expect(await balance("Bea")).toBe(20);
    expect((await ess.sql("a", "SELECT MIN(balance_after) AS m FROM loyalty_ledger WHERE client_id = ?", [client.Bea]))[0].m).toBeGreaterThanOrEqual(0);

    // Límite por cliente: una vez al mes
    const monthly = await newReward("Regalo mensual", 10, { perClientLimit: 1, limitPeriod: "month" });
    expect((await redeem("Ana", monthly)).status).toBe(200);
    expect(errCode(await redeem("Ana", monthly))).toBe("BAD_REQUEST");
  });

  it("validación en mostrador: un solo uso también con lecturas simultáneas, y cada intento queda registrado", async () => {
    const r = data(await redeem("Ana", cafe));
    const pretty = `${r.code.slice(0, 5)}-${r.code.slice(5).toLowerCase()}`;
    expect(data(await ess.m("a", "loyalty.checkCode", { code: pretty }, agA))).toMatchObject({ result: "consulta", rewardName: "Café", clientName: "Ana", status: "emitido" });
    const uses = await Promise.all(Array.from({ length: 3 }, () => ess.m("a", "loyalty.consumeCode", { code: r.code }, agA)));
    const results = uses.map((u) => data(u).result).sort();
    expect(results).toEqual(["valido", "ya_usado", "ya_usado"]);
    expect((await ess.sql("a", "SELECT status, used_by_name FROM loyalty_redemptions WHERE code = ?", [r.code]))[0]).toMatchObject({ status: "usado" });
    expect(data(await ess.m("a", "loyalty.consumeCode", { code: "ZZZZZ-ZZZZZ" }, agA)).result).toBe("no_existe");
    const [checks] = await ess.sql("a", "SELECT COUNT(*) AS n, SUM(result = 'valido') AS ok FROM loyalty_redemption_checks");
    expect(Number(checks.n)).toBeGreaterThanOrEqual(5);
    expect(Number(checks.ok)).toBe(1);
    // El registro no guarda el código completo
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM loyalty_redemption_checks WHERE code_hint LIKE ?", [`%${r.code}%`]))[0].n).toBe(0);
  });

  it("anular un canje devuelve los puntos una sola vez y el código deja de valer", async () => {
    const before = await balance("Ana");
    const r = data(await redeem("Ana", cafe));
    expect(await balance("Ana")).toBe(before - 100);
    expect(errCode(await ess.m("a", "loyalty.cancelRedemption", { redemptionId: r.redemptionId, reason: "error" }, agA))).toBe("FORBIDDEN");
    expect((await ess.m("a", "loyalty.cancelRedemption", { redemptionId: r.redemptionId, reason: "error del cajero" }, adA)).status).toBe(200);
    expect(errCode(await ess.m("a", "loyalty.cancelRedemption", { redemptionId: r.redemptionId, reason: "error del cajero" }, adA))).toBe("CONFLICT");
    expect(await balance("Ana")).toBe(before);
    expect(data(await ess.m("a", "loyalty.consumeCode", { code: r.code }, agA)).result).toBe("anulado");
  });

  it("caducidad: el código no usado a tiempo caduca y devuelve los puntos una sola vez", async () => {
    const before = await balance("Ana");
    const r = data(await redeem("Ana", cafe));
    await ess.sql("a", "UPDATE loyalty_redemptions SET expires_at = ? WHERE id = ?", [Date.now() - 1000, r.redemptionId]);
    const results = await Promise.all([ess.m("a", "loyalty.consumeCode", { code: r.code }, agA), ess.m("a", "loyalty.checkCode", { code: r.code }, agA)]);
    for (const x of results) expect(data(x).result).toBe("caducado");
    await ess.q("a", "loyalty.redemptions", {}, adA);
    expect(await balance("Ana")).toBe(before);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM loyalty_ledger WHERE client_id = ? AND kind = 'anulacion' AND reverses_id = (SELECT ledger_id FROM loyalty_redemptions WHERE id = ?)", [client.Ana, r.redemptionId]))[0].n).toBe(1);
  });

  it("área del cliente con enlace firmado: saldo, canje con reenvío del formulario sin descontar dos veces", async () => {
    const p = await portalPath("Ana");
    const view = await ess.call("a", "GET", p);
    expect(view.status).toBe(200);
    expect(view.text).toContain("Hola, Ana");
    expect(view.text).toContain("Café");
    const before = await balance("Ana");
    const t = new URL(`http://x${p}`).searchParams.get("t")!;
    const k = key();
    const first = await form("a", `/mis-puntos/canjear?t=${encodeURIComponent(t)}`, { reward: String(cafe), key: k });
    expect(first.status).toBe(200);
    expect(first.text).toContain("Canje hecho");
    const second = await form("a", `/mis-puntos/canjear?t=${encodeURIComponent(t)}`, { reward: String(cafe), key: k });
    expect(second.status).toBe(200);
    expect(await balance("Ana")).toBe(before - 100);
    const [last] = await ess.sql("a", "SELECT code, channel FROM loyalty_redemptions WHERE client_id = ? ORDER BY id DESC LIMIT 1", [client.Ana]);
    expect(last.channel).toBe("cliente");
    expect(first.text).toContain(`${last.code.slice(0, 5)}-${last.code.slice(5)}`);
    // Enlace manipulado o de otra empresa: no abre nada
    expect((await ess.call("a", "GET", `/mis-puntos?t=${encodeURIComponent(t.replace(/^\d+/, String(client.Bea)))}`)).status).toBe(404);
    await ess.setCapability("b", CAP, "active");
    await ess.sql("b", "INSERT INTO loyalty_program (id, enabled, points_name, updated_at) VALUES (1, 1, 'puntos', 0)");
    const cross = await ess.call("b", "GET", p);
    expect(cross.status).toBe(404);
    expect(cross.text).not.toContain("Ana");
    // Pedir un enlace: misma respuesta exista o no el correo
    for (const email of ["ana@cliente-a.example", "nadie@ejemplo.example"]) {
      const res = await form("a", "/mis-puntos/enlace", { email });
      expect(res.status).toBe(200);
      expect(res.text).toContain("Revisa tu correo");
    }
  });

  it("aislamiento: la empresa B no ve los canjes ni los códigos de A", async () => {
    const [anyCode] = await ess.sql("a", "SELECT code FROM loyalty_redemptions LIMIT 1");
    expect(data(await ess.m("b", "loyalty.checkCode", { code: anyCode.code }, adB)).result).toBe("no_existe");
    expect(data(await ess.q("b", "loyalty.redemptions", {}, adB)).total).toBe(0);
    expect(data(await ess.q("b", "loyalty.rewards", undefined, adB))).toEqual([]);
  });
});
