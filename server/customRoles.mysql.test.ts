/**
 * Roles personalizados (Business, roles-custom) con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL):
 * dos empresas nuevas desde la baseline y las migraciones de empresa (incluida la 0022).
 * Essential no puede crear roles y nadie cambia; con Business, administración crea y asigna, el rol propio se aplica
 * a quien lo tiene y a nadie más; cada empresa solo ve sus roles; sin la capacidad, el rol propio deja de aplicarse.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";
import { basePermissions } from "../shared/customRoles";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "roles-custom";
const TODAY = new Date().toISOString().slice(0, 10);

describe.skipIf(!URL_)("Roles personalizados (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let agA: string;
  let adA: string;
  let ctA: string;
  let adB: string;
  let agB: string;
  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "rolespropios");
    agA = await ess.login("a", "agente");
    adA = await ess.login("a", "admin");
    ctA = await ess.login("a", "controler");
    adB = await ess.login("b", "admin");
    agB = await ess.login("b", "agente");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  const discounts = (co: "a" | "b", cookie: string) => ess.q(co, "discounts.list", {}, cookie);
  const daily = (cookie: string) => ess.q("a", "dailyControl.get", { date: TODAY }, cookie);

  it("Essential: sin roles propios; los permisos de siempre intactos", async () => {
    expect((await discounts("a", agA)).status).toBe(200);
    expect(errCode(await daily(agA))).toBe("FORBIDDEN");
    expect((await daily(ctA)).status).not.toBe(403);
    expect(isLicenseDenied(await ess.q("a", "customRoles.list", undefined, adA), CAP)).toBe(true);
    expect(isLicenseDenied(await ess.m("a", "customRoles.create", { name: "X", baseRole: "agente", permissions: [] }, adA), CAP)).toBe(true);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM custom_roles"))[0].n).toBe(0);
  });

  it("Business: administración crea y asigna; el rol propio se aplica solo a quien lo tiene", async () => {
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
    // Solo administración
    expect(errCode(await ess.q("a", "customRoles.list", undefined, agA))).toBe("FORBIDDEN");
    expect(errCode(await ess.m("a", "customRoles.create", { name: "X", baseRole: "agente", permissions: [] }, agA))).toBe("FORBIDDEN");
    // Nunca a partir de administración
    expect(errCode(await ess.m("a", "customRoles.create", { name: "Casi admin", baseRole: "admin", permissions: [] }, adA))).toBe("BAD_REQUEST");

    const permissions = [...basePermissions("agente").filter((k) => k !== "discounts.view"), "accounting.daily_control"];
    const created = await ess.m("a", "customRoles.create", { name: "Comercial con control", baseRole: "agente", permissions }, adA);
    expect(created.status).toBe(200);
    const roleId = data(created).id as number;
    expect(errCode(await ess.m("a", "customRoles.create", { name: "Comercial con control", baseRole: "agente", permissions }, adA))).toBe("CONFLICT");

    const list = data(await ess.q("a", "customRoles.list", undefined, adA));
    expect(list.roles).toHaveLength(1);
    expect(list.roles[0]).toMatchObject({ name: "Comercial con control", baseRole: "agente", grants: ["accounting.daily_control"], revokes: ["discounts.view"] });

    // Creado pero sin asignar: nadie cambia
    expect((await discounts("a", agA)).status).toBe(200);
    expect(errCode(await daily(agA))).toBe("FORBIDDEN");

    // Solo a usuarios de su mismo rol base: ni administración ni otro rol
    expect(errCode(await ess.m("a", "customRoles.assign", { userId: await ess.userId("a", "admin"), roleId }, adA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "customRoles.assign", { userId: await ess.userId("a", "controler"), roleId }, adA))).toBe("BAD_REQUEST");
    expect((await ess.m("a", "customRoles.assign", { userId: await ess.userId("a", "agente"), roleId }, adA)).status).toBe(200);

    // Asignado: se aplican sus diferencias
    expect(errCode(await discounts("a", agA))).toBe("FORBIDDEN");
    expect((await daily(agA)).status).not.toBe(403);
    // El resto del equipo, igual que siempre
    expect((await discounts("a", adA)).status).toBe(200);
    expect((await daily(ctA)).status).not.toBe(403);
    // Lo de siempre del rol base que el rol no toca, intacto
    expect((await ess.q("a", "crm.leads.list", {}, agA)).status).toBe(200);
    // users.role nunca cambia
    expect((await ess.sql("a", "SELECT role FROM users WHERE id = ?", [await ess.userId("a", "agente")]))[0].role).toBe("agente");

    // Otra empresa: no ve los roles de A ni puede asignarlos; su comercial sigue igual
    expect(data(await ess.q("b", "customRoles.list", undefined, adB)).roles).toEqual([]);
    expect(errCode(await ess.m("b", "customRoles.assign", { userId: await ess.userId("b", "agente"), roleId }, adB))).toBe("NOT_FOUND");
    expect((await discounts("b", agB)).status).toBe(200);

    // No se elimina un rol asignado; quitado, se elimina y todo vuelve a ser como siempre
    expect(errCode(await ess.m("a", "customRoles.remove", { id: roleId }, adA))).toBe("CONFLICT");
    expect((await ess.m("a", "customRoles.assign", { userId: await ess.userId("a", "agente"), roleId: null }, adA)).status).toBe(200);
    expect((await discounts("a", agA)).status).toBe(200);
    expect((await ess.m("a", "customRoles.remove", { id: roleId }, adA)).status).toBe(200);
    expect(data(await ess.q("a", "customRoles.list", undefined, adA)).roles).toEqual([]);
  });

  it("sin la capacidad (vuelta a Essential), un rol propio asignado deja de aplicarse", async () => {
    const created = await ess.m("a", "customRoles.create", { name: "Comercial sin descuentos", baseRole: "agente", permissions: basePermissions("agente").filter((k) => k !== "discounts.view") }, adA);
    const roleId = data(created).id as number;
    expect((await ess.m("a", "customRoles.assign", { userId: await ess.userId("a", "agente"), roleId }, adA)).status).toBe(200);
    expect(errCode(await discounts("a", agA))).toBe("FORBIDDEN");
    await ess.setCapability("a", CAP, null);
    expect((await discounts("a", agA)).status).toBe(200);
    expect(isLicenseDenied(await ess.m("a", "customRoles.assign", { userId: await ess.userId("a", "agente"), roleId: null }, adA), CAP)).toBe(true);
  });
});
