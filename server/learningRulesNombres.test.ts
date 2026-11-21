import { describe, expect, it } from "vitest";
import { describeRule, experienceLabel, modulesLabel, variantLabel } from "../shared/learningRules";

const refs = {
  experiences: [{ id: 7, title: "RECONNECT ONLINE" }, { id: 8, title: "   " }],
  variants: [{ id: 70, name: "Acceso 12 meses" }],
  modules: [
    { id: 1, title: "Teil 1", course_title: "RECONNECT" },
    { id: 2, title: "Teil 2", course_title: "RECONNECT" },
  ],
};
const rule = (over: Partial<{ experienceId: number; variantId: number | null; moduleIds: number[] }> = {}) => ({ id: 1, active: false, experienceId: 7, variantId: 70, moduleIds: [1, 2], ...over });

describe("reglas de acceso con nombres comerciales", () => {
  it("resuelve producto, modalidad, curso y módulos por nombre y conserva el resto de la regla", () => {
    const d = describeRule(rule(), refs);
    expect(d).toMatchObject({ experienceName: "RECONNECT ONLINE", variantName: "Acceso 12 meses", courseTitle: "RECONNECT", moduleTitles: ["Teil 1", "Teil 2"], active: false, id: 1 });
    expect(experienceLabel(d)).toBe("RECONNECT ONLINE");
    expect(variantLabel(d)).toBe("Acceso 12 meses");
    expect(modulesLabel(d)).toBe("Teil 1 · Teil 2");
  });

  it("si falta el producto, muestra «Producto n.º X» y no rompe", () => {
    const d = describeRule(rule({ experienceId: 999 }), refs);
    expect(d.experienceName).toBeNull();
    expect(experienceLabel(d)).toBe("Producto n.º 999");
  });

  it("un nombre vacío cuenta como ausente", () => {
    expect(experienceLabel(describeRule(rule({ experienceId: 8 }), refs))).toBe("Producto n.º 8");
  });

  it("modalidad: cualquiera si no hay variante; «Modalidad n.º X» si la referencia no existe", () => {
    expect(variantLabel(describeRule(rule({ variantId: null }), refs))).toBe("Cualquier modalidad");
    expect(variantLabel(describeRule(rule({ variantId: 123 }), refs))).toBe("Modalidad n.º 123");
  });

  it("módulos: los que faltan se rotulan por número y el curso sale de los que existen", () => {
    const d = describeRule(rule({ moduleIds: [2, 55] }), refs);
    expect(d.moduleTitles).toEqual(["Teil 2", "Módulo n.º 55"]);
    expect(d.courseTitle).toBe("RECONNECT");
    const none = describeRule(rule({ moduleIds: [55] }), refs);
    expect(none.courseTitle).toBeNull();
    expect(modulesLabel(describeRule(rule({ moduleIds: [] }), refs))).toBe("—");
  });

  it("sin catálogo (tablas ausentes o vacías) todas las referencias caen a etiquetas por número", () => {
    const d = describeRule(rule(), { experiences: [], variants: [], modules: [] });
    expect([experienceLabel(d), variantLabel(d), modulesLabel(d)]).toEqual(["Producto n.º 7", "Modalidad n.º 70", "Módulo n.º 1 · Módulo n.º 2"]);
  });

  it("no modifica la regla de entrada", () => {
    const r = rule();
    const copy = JSON.parse(JSON.stringify(r));
    describeRule(r, refs);
    expect(r).toEqual(copy);
  });
});
