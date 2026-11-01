/**
 * «Primeros pasos»: tras elegir el tipo de actividad el servidor reordena los pasos; «siguiente» debe ir al paso
 * que sigue a «Tipo de actividad» en el plan nuevo, no al del índice del plan anterior (se saltaba del 4 al 7).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildSetupPlan, configurationStepNumber, emptyProgress, stepAfter, type SetupFacts } from "../shared/setupWizard";
import { capabilitiesOfTier } from "./catalog/capabilities";

const FACTS: SetupFacts = { identity: true, fiscal: true, brand: true, activity: false, clients: 0, products: 0, sales: 0, webEdited: false, comms: false };
const ESSENTIAL = new Set(capabilitiesOfTier("essential"));

describe("paso siguiente tras «Tipo de actividad»", () => {
  it("va al paso inmediato del plan reordenado (paso 4 → paso 5)", () => {
    const before = buildSetupPlan({ progress: emptyProgress(), activity: null, capabilities: ESSENTIAL, facts: FACTS }).steps;
    const after = buildSetupPlan({ progress: emptyProgress(), activity: "comercio", capabilities: ESSENTIAL, facts: { ...FACTS, activity: true } }).steps;
    const next = stepAfter(after, "activity");
    expect(configurationStepNumber(after, "activity")).toBe(4);
    expect(configurationStepNumber(after, next)).toBe(5);
    expect(next).toBe("product");
    // Con el plan anterior se caía en «client», que en el nuevo orden es el paso 7
    const staleOld = before[before.findIndex((s) => s.id === "activity") + 1].id;
    expect(configurationStepNumber(after, staleOld)).toBe(7);
  });

  it("en el último paso se queda en él; un paso que no está lleva al primero", () => {
    const steps = buildSetupPlan({ progress: emptyProgress(), activity: "servicios", capabilities: ESSENTIAL, facts: FACTS }).steps;
    expect(stepAfter(steps, "finish")).toBe("finish");
    expect(stepAfter(steps, "users")).toBe(steps[0].id);
  });

  it("el asistente calcula el siguiente con el plan más reciente", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/setup/PrimerosPasos.tsx"), "utf8");
    expect(src).toMatch(/const goNext = \(\) => setCurrent\(stepAfter\(utils\.setupWizard\.status\.getData\(\)\?\.plan\.steps \?\? steps, shown\)\)/);
  });
});
