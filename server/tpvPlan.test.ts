import { describe, it, expect } from "vitest";
import { ENTERPRISE_REGISTER_RESOURCE_CAP, featureNotIncludedMessage, operationalDay, registerLimitDecision, safeTimeZone, tpvPlanInfo } from "../shared/tpvPlan";

describe("Caja por plan (estrategia TPV 09/11/2026)", () => {
  it("cajas activas: Essential 1, Business 3, Enterprise uso razonable, sin plan sin límite", () => {
    expect(tpvPlanInfo("essential").maxActiveRegisters).toBe(1);
    expect(tpvPlanInfo("business").maxActiveRegisters).toBe(3);
    expect(tpvPlanInfo("enterprise").maxActiveRegisters).toBe(ENTERPRISE_REGISTER_RESOURCE_CAP);
    expect(tpvPlanInfo("full").maxActiveRegisters).toBeNull();
  });

  it("funciones: Essential ninguna de las superiores; Business las suyas; Enterprise y sin plan, todas", () => {
    const e = tpvPlanInfo("essential").features;
    expect(Object.values(e).every((v) => v === false)).toBe(true);
    const b = tpvPlanInfo("business").features;
    expect([b.registerOperators, b.authorizedReturns, b.closureSupervision, b.detailedReports, b.cashDifferences]).toEqual([true, true, true, true, true]);
    expect([b.multiSite, b.centralSupervision, b.consolidatedReports, b.advancedPermissions]).toEqual([false, false, false, false]);
    expect(Object.values(tpvPlanInfo("enterprise").features).every(Boolean)).toBe(true);
    expect(Object.values(tpvPlanInfo("full").features).every(Boolean)).toBe(true);
  });

  it("el límite solo frena añadir: con más cajas de las del plan, no deja añadir otra (y lo explica)", () => {
    expect(registerLimitDecision(tpvPlanInfo("essential"), 0).allowed).toBe(true);
    const d = registerLimitDecision(tpvPlanInfo("essential"), 1);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(/Tus cajas actuales siguen funcionando/);
    expect(registerLimitDecision(tpvPlanInfo("business"), 2).allowed).toBe(true);
    expect(registerLimitDecision(tpvPlanInfo("business"), 5).allowed).toBe(false);
    expect(registerLimitDecision(tpvPlanInfo("full"), 500).allowed).toBe(true);
  });

  it("mensaje de una función superior: qué es y dónde ampliar", () => {
    expect(featureNotIncludedMessage("registerOperators")).toBe("«Operadores y permisos por caja» se incluye en el plan Business. Puedes ampliar tu plan desde «Suscripción».");
    expect(featureNotIncludedMessage("consolidatedReports")).toMatch(/Enterprise/);
  });

  it("día operativo: 00:00 = fecha de la zona; con corte 04:00, la madrugada cuenta para el día anterior", () => {
    const t = Date.parse("2026-11-09T23:30:00Z"); // 00:30 del 10/11 en Madrid
    expect(operationalDay(t, "00:00", "Europe/Madrid")).toBe("2026-11-10");
    expect(operationalDay(t, "04:00", "Europe/Madrid")).toBe("2026-11-09");
    expect(operationalDay(Date.parse("2026-11-10T03:30:00Z"), "04:00", "Europe/Madrid")).toBe("2026-11-10");
    // Cambio de mes y de año
    expect(operationalDay(Date.parse("2027-01-01T01:00:00Z"), "03:00", "Europe/Madrid")).toBe("2026-12-31");
    // Otra zona horaria
    expect(operationalDay(t, "00:00", "Atlantic/Canary")).toBe("2026-11-09");
    // Corte no válido: el de por defecto
    expect(operationalDay(t, "25:00", "Europe/Madrid")).toBe("2026-11-10");
    expect(safeTimeZone("No/Existe")).toBe("Europe/Madrid");
  });
});

describe("Instalación única (Náyade): sin límites de caja", () => {
  it("fuera de multiempresa no hay plan que aplicar: todo y sin límite de cajas", async () => {
    const prev = process.env.TENANT_MODE;
    process.env.TENANT_MODE = "single";
    try {
      const { currentTpvPlan, tpvAdvancedAllowed } = await import("./tpvRulesDb");
      const plan = await currentTpvPlan();
      expect([plan.tier, plan.maxActiveRegisters]).toEqual(["full", null]);
      expect(Object.values(plan.features).every(Boolean)).toBe(true);
      expect(registerLimitDecision(plan, 40).allowed).toBe(true);
      expect(await tpvAdvancedAllowed(true)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.TENANT_MODE;
      else process.env.TENANT_MODE = prev;
    }
  }, 60_000);
});
