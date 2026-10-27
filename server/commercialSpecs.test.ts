/**
 * Catálogo comercial unificado: una especificación por producto, sin precios escritos a mano, sin promesas de
 * activación inmediata y coherente con la política de planes.
 */
import { describe, it, expect } from "vitest";
import { PRODUCTS } from "./catalog/elephantSourceV1";
import { PRODUCT_SPECS } from "./catalog/commercial/specs";
import { CATALOG_POLICY, PROPOSED_POLICY } from "./catalog/commercial/policy";
import { validateSpecs } from "./catalog/commercial/validateSpecs";

describe("especificaciones comerciales", () => {
  it("58 productos, 58 especificaciones, sin incidencias con la política propuesta ni con la vigente", () => {
    expect(PRODUCTS).toHaveLength(58);
    expect(PRODUCT_SPECS).toHaveLength(58);
    expect(validateSpecs(PRODUCTS, PRODUCT_SPECS, PROPOSED_POLICY)).toEqual([]);
    expect(validateSpecs(PRODUCTS, PRODUCT_SPECS, CATALOG_POLICY)).toEqual([]);
  });
  it("el validador detecta duplicados, precios escritos a mano y promesas falsas", () => {
    const base = PRODUCT_SPECS.find((s) => s.key === "life-net")!;
    const bad = [...PRODUCT_SPECS, { ...base }, { ...PRODUCT_SPECS[0], key: "essential", longDescription: "Por solo 29 € con activación inmediata" }];
    const issues = validateSpecs(PRODUCTS, bad, PROPOSED_POLICY);
    expect(issues.some((i) => i.includes("duplicada"))).toBe(true);
    expect(issues.some((i) => i.includes("importe escrito a mano"))).toBe(true);
    expect(issues.some((i) => i.includes("activación inmediata"))).toBe(true);
  });
  it("el validador rechaza incluir una solución sectorial en un plan", () => {
    const pol = { ...PROPOSED_POLICY, inclusions: [...PROPOSED_POLICY.inclusions, { plan: "business", key: "hotel-net-pms", mode: "full" as const, status: "proposed" as const }] };
    expect(validateSpecs(PRODUCTS, PRODUCT_SPECS, pol)).toContain("política: hotel-net-pms (net_module) no puede incluirse en un plan");
  });
  it("lo que no tiene desarrollo se presenta como «Próximamente» con lista de espera", () => {
    const none = PRODUCT_SPECS.filter((s) => s.verified.grade === "none").map((s) => s.key).sort();
    expect(none).toEqual(["extra-accounting", "hotel-net-channel-manager", "hotel-net-housekeeping", "life-net"]);
  });
  it("Travel Net no atribuye circuitos ni transporte como existentes", () => {
    for (const s of PRODUCT_SPECS.filter((x) => x.key.startsWith("travel-net"))) for (const t of s.includes) expect(t).not.toMatch(/circuito|transporte/i);
  });
});
