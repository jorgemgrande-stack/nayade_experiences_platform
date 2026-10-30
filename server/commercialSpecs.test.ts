/**
 * Catálogo comercial unificado: una especificación por producto, sin precios escritos a mano, sin promesas de
 * activación inmediata y coherente con la política de planes.
 */
import { describe, it, expect } from "vitest";
import { PRODUCTS } from "./catalog/elephantSourceV1";
import { PRODUCT_SPECS } from "./catalog/commercial/specs";
import { CATALOG_POLICY, PROPOSED_POLICY } from "./catalog/commercial/policy";
import { validateSpecs } from "./catalog/commercial/validateSpecs";
import { INTERNAL_NOTE_RE, textProblems } from "./catalog/commercial/checks";

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
  it("la ficha pública de Life Net no lleva notas internas de desarrollo", () => {
    const s = PRODUCT_SPECS.find((x) => x.key === "life-net")!;
    const pub = [s.longDescription, s.problem, s.forWho, ...s.includes, ...s.excludes, ...s.capacityRules, s.publicContent.headline, ...s.publicContent.benefits, s.seo.title, s.seo.description];
    for (const t of pub) expect(t).not.toMatch(/repositorio|desarrollo|definición funcional/i);
    expect(s.verified.grade).toBe("none");
    expect(s.publicContent.cta).toBe("waitlist");
  });
  it("ninguna ficha pública lleva repositorios, arquitectura interna ni comentarios de desarrollo", () => {
    for (const s of PRODUCT_SPECS) {
      const pub = [s.longDescription, s.problem, s.forWho, ...s.excludes, ...s.capacityRules, ...s.integrations, s.publicContent.headline, ...s.publicContent.benefits, s.seo.title, s.seo.description];
      for (const t of pub) expect(t, s.key).not.toMatch(INTERNAL_NOTE_RE);
    }
    for (const t of ["SES Hospedajes (modo manual en hotelnayade)", "Channel Manager (sin desarrollo)", "Los circuitos se desarrollarán.", "Agregadores (solo diseño)", "Canje manual, sin API", "Basado en un sistema ya en uso en temporada real", "Prototipo en Skicenter con flag apagado"])
      expect(textProblems(t).some((p) => p.includes("nota interna")), t).toBe(true);
  });
  it("cada extensión publica para quién es, además del problema y los beneficios", () => {
    for (const s of PRODUCT_SPECS.filter((x) => x.category === "extension" || x.category === "extension_bundle")) {
      expect(s.forWho, s.key).not.toBe("");
      expect(s.problem, s.key).not.toBe("");
      expect(s.publicContent.benefits.length, s.key).toBeGreaterThan(0);
    }
  });
});
