/**
 * Honestidad del catálogo de Elephant Net en el CÓDIGO (fichas de shared/netProducts.ts, especificaciones comerciales y
 * semilla). Lo publicado en production se corrige aparte con el mecanismo de revisión del catálogo.
 *  - Care Net: profesionales y cabinas sin solapamientos no tienen pantalla todavía → «en implantación».
 *  - Care Net: los recordatorios que funcionan son los de cita por correo.
 *  - Hotel Net: housekeeping describe lo que hay (tareas por habitación, asignación, inspección e incidencias).
 *  - Social Token Net: comunidades y fidelización; ningún texto habla de eventos ni de entradas.
 */
import { describe, it, expect } from "vitest";
import { NET_PRODUCTS } from "../shared/netProducts";
import { PRODUCT_SPECS } from "./catalog/commercial/specs";
import { PRODUCTS } from "./catalog/elephantSourceV1";

const features = (key: string) => NET_PRODUCTS.find((p) => p.key === key)!.areas.flatMap((a) => a.features);
const textOf = (v: unknown): string => JSON.stringify(v);

describe("catálogo de Elephant Net: solo se da por operativo lo que funciona", () => {
  it("Care Net: profesionales y cabinas sin solapamientos, en implantación; nada operativo que los prometa", () => {
    const care = NET_PRODUCTS.find((p) => p.key === "care-net-complete")!;
    const f = features("care-net-complete");
    expect(f.find((x) => /profesionales/i.test(x.label))).toEqual({ label: "Gestión de profesionales y cabinas sin solapamientos", status: "coming_soon" });
    expect(f.filter((x) => x.status === "available" && /profesional|cabina|solapamiento/i.test(x.label))).toEqual([]);
    expect(care.benefits.join(" ")).not.toMatch(/profesionales|cabinas|solapamientos/i);
    expect(f.find((x) => /recordatorio/i.test(x.label))).toEqual({ label: "Recordatorios de cita por correo", status: "available" });
    const spec = PRODUCT_SPECS.find((s) => s.key === "care-net-complete")!;
    expect(spec.longDescription).toMatch(/profesionales y cabinas sin solapamientos y las fichas clínicas con seguimiento especializado están en implantación/);
    expect(spec.includes.find((i) => /profesionales/i.test(i))).toMatch(/en implantación/);
  });

  it("Hotel Net: housekeeping con lo que hay hoy", () => {
    const hk = features("hotel-net-complete").filter((x) => /limpieza|personal|housekeeping/i.test(x.label));
    expect(hk.map((x) => x.label)).toEqual(["Housekeeping", "Tareas de limpieza por habitación y estados", "Asignación de tareas al personal, inspección e incidencias"]);
    expect(PRODUCT_SPECS.find((s) => s.key === "hotel-net-housekeeping")!.includes.join(" ")).not.toMatch(/Previsto/);
  });

  it("Social Token Net: ningún texto propio menciona eventos ni entradas (salvo el slug publicado, que se conserva)", () => {
    const social = [
      ...NET_PRODUCTS.filter((p) => p.group === "social-token"),
      ...PRODUCTS.filter((p) => p.key.startsWith("social-token-net")),
      ...PRODUCT_SPECS.filter((s) => s.key.startsWith("social-token-net")).map((s) => ({ ...s, seo: { ...s.seo, slug: undefined } })),
    ];
    expect(social.length).toBeGreaterThanOrEqual(7);
    for (const p of social) expect(textOf(p)).not.toMatch(/eventos?|entradas?/i);
  });
});
