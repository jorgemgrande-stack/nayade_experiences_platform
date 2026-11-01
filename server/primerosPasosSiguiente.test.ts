/**
 * «Primeros pasos»: al terminar u omitir un paso se va al siguiente PENDIENTE del plan recién leído (lo hecho y lo
 * omitido no se repiten); y las comprobaciones de empresa española y los indicadores del Inicio (lógica pura).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildSetupPlan, emptyProgress, markStep, nextOpenStep, spanishFiscalErrors, stepAfter, type SetupFacts } from "../shared/setupWizard";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { madridPeriodStarts, summarizeSales } from "./coreHomeDb";

const FACTS: SetupFacts = { identity: true, fiscal: true, brand: false, activity: false, clients: 0, products: 0, sales: 0, documents: 0, webEdited: false, comms: false };
const ESSENTIAL = new Set(capabilitiesOfTier("essential"));
const plan = (facts: Partial<SetupFacts> = {}, progress = emptyProgress()) => buildSetupPlan({ progress, activity: null, capabilities: ESSENTIAL, facts: { ...FACTS, ...facts } }).steps;
const ALL = { activity: true, brand: true, webEdited: true, clients: 1, products: 1, sales: 1, documents: 1 };

describe("siguiente paso pendiente (nunca se repite lo hecho)", () => {
  it("salta los pasos ya hechos por datos reales", () => {
    // Datos de la empresa y fiscales ya constan: tras la bienvenida, el tipo de actividad
    expect(nextOpenStep(plan(), "welcome")).toBe("activity");
    // Con cliente y producto dados de alta, tras la web va la primera venta
    expect(nextOpenStep(plan({ clients: 1, products: 1 }), "web")).toBe("operation");
  });
  it("salta los omitidos y, al llegar al final, vuelve al primer pendiente; sin pendientes, el resumen", () => {
    const skipped = markStep(emptyProgress(), "activity", "skipped", 1);
    expect(nextOpenStep(plan({}, skipped), "welcome")).toBe("brand");
    expect(nextOpenStep(plan(ALL), "document")).toBe("comms");
    expect(nextOpenStep(plan(ALL), "comms")).toBe("finish");
    expect(nextOpenStep(plan({ webEdited: true }), "comms")).toBe("activity");
  });
  it("stepAfter se conserva para recorrer por posición", () => {
    const steps = plan();
    expect(stepAfter(steps, "finish")).toBe("finish");
    expect(stepAfter(steps, "users")).toBe(steps[0].id);
  });
  it("el asistente calcula el siguiente con el plan recién leído del servidor (nada en el navegador)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/setup/PrimerosPasos.tsx"), "utf8");
    expect(src).toContain("const fresh = await utils.setupWizard.status.fetch()");
    expect(src).toContain("setCurrent(nextOpenStep(fresh?.plan.steps ?? steps, shown))");
    expect(src).not.toContain("localStorage");
  });
});

describe("empresa española: NIF/CIF y código postal", () => {
  it("valida el dígito de control y el código postal; fuera de España no se aplica", () => {
    expect(spanishFiscalErrors("ES", { taxId: "B12345674", postalCode: "28001" })).toEqual({});
    expect(spanishFiscalErrors("ES", { taxId: "12345678Z", postalCode: "" })).toEqual({});
    expect(spanishFiscalErrors("ES", { taxId: "B12345678", postalCode: "28001" }).taxId).toMatch(/no es válido/);
    expect(spanishFiscalErrors("ES", { taxId: "B12345674", postalCode: "99001" }).postalCode).toMatch(/5 cifras/);
    // Sin país guardado se da por España
    expect(spanishFiscalErrors("", { taxId: "X" }).taxId).toBeTruthy();
    expect(spanishFiscalErrors("PT", { taxId: "PT123456789", postalCode: "1000-001" })).toEqual({});
  });
});

describe("indicadores del Inicio (hora de Madrid, importes cobrados)", () => {
  it("inicio del día y del mes en Madrid, en invierno y en verano", () => {
    // 1 nov 2026 00:30 en Madrid (invierno, UTC+1) = 31 oct 23:30 UTC
    const winter = madridPeriodStarts(Date.UTC(2026, 9, 31, 23, 30));
    expect(new Date(winter.dayStart).toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(new Date(winter.monthStart).toISOString()).toBe("2026-10-31T23:00:00.000Z");
    // 15 jul 2026 12:00 UTC (verano, UTC+2)
    const summer = madridPeriodStarts(Date.UTC(2026, 6, 15, 12));
    expect(new Date(summer.dayStart).toISOString()).toBe("2026-07-14T22:00:00.000Z");
    expect(new Date(summer.monthStart).toISOString()).toBe("2026-06-30T22:00:00.000Z");
  });
  it("suma lo cobrado (o el total si no consta cobro) de hoy y del mes; lo anterior no cuenta", () => {
    const starts = { dayStart: 1_000, monthStart: 100 };
    const out = summarizeSales(
      [
        { at: 50, amountTotal: 99_999, amountPaid: 99_999 },
        { at: 200, amountTotal: 1210, amountPaid: 0 },
        { at: 1_500, amountTotal: 5000, amountPaid: 2500 },
      ],
      starts,
    );
    expect(out).toEqual({ today: { amount: 25, count: 1 }, month: { amount: 37.1, count: 2 } });
    expect(summarizeSales([], starts)).toEqual({ today: { amount: 0, count: 0 }, month: { amount: 0, count: 0 } });
  });
});
