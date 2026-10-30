import { describe, expect, it } from "vitest";
import { allTestEmails, CIRCUIT, TEMPLATES } from "./testCatalog";

describe("circuito de cada plantilla", () => {
  const all = allTestEmails();
  it("las 115 plantillas (113 + verificación del correo nuevo + recordatorio de la gracia) tienen circuito y los ids son únicos", () => {
    expect(all.length).toBe(115);
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
    for (const t of all) expect(["automatica", "manual", "programada", "externa", "pendiente"]).toContain(t.circuit);
  });
  it("las excepciones apuntan a plantillas que existen", () => {
    const ids = new Set(TEMPLATES.map((t) => t.id));
    for (const id of Object.keys(CIRCUIT)) expect(ids.has(id)).toBe(true);
  });
  it("las pendientes explican por qué y las externas quién las envía", () => {
    for (const t of all.filter((x) => x.circuit === "pendiente")) expect(t.pending, t.id).toBeTruthy();
    for (const t of all.filter((x) => x.circuit === "externa")) expect(t.managedBy, t.id).toBeTruthy();
  });
  it("los avisos que ya envía Stripe están marcados como externos (no se duplican)", () => {
    const ext = all.filter((t) => t.circuit === "externa").map((t) => t.id);
    expect(ext).toEqual(expect.arrayContaining(["billing.upcoming_charge", "billing.payment_reminder"]));
  });
});
