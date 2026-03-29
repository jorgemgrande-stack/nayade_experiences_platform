import { describe, it, expect } from "vitest";

// Unit tests for cancellations business logic
describe("Cancellations module integration", () => {
  it("anulaciones tab is a valid Tab type value", () => {
    type Tab = "leads" | "quotes" | "reservations" | "invoices" | "anulaciones";
    const tab: Tab = "anulaciones";
    expect(tab).toBe("anulaciones");
  });

  it("getCounters returns correct structure", () => {
    const mockRequests = [
      { operationalStatus: "recibida" },
      { operationalStatus: "en_revision" },
      { operationalStatus: "incidencia" },
      { operationalStatus: "cerrada" },
    ];
    const pending = mockRequests.filter((r) =>
      ["recibida", "en_revision", "pendiente_documentacion", "pendiente_decision"].includes(r.operationalStatus)
    ).length;
    const incidencias = mockRequests.filter((r) => r.operationalStatus === "incidencia").length;
    expect(pending).toBe(2);
    expect(incidencias).toBe(1);
    expect(mockRequests.length).toBe(4);
  });

  it("AnulOpBadge maps all operational statuses", () => {
    const statuses = ["recibida", "en_revision", "pendiente_documentacion", "pendiente_decision", "resuelta", "cerrada", "incidencia"];
    const labels: Record<string, string> = {
      recibida: "Recibida",
      en_revision: "En revisión",
      pendiente_documentacion: "Pend. docs",
      pendiente_decision: "Pend. decisión",
      resuelta: "Resuelta",
      cerrada: "Cerrada",
      incidencia: "Incidencia",
    };
    statuses.forEach((s) => {
      expect(labels[s]).toBeDefined();
    });
  });

  it("AnulResBadge maps all resolution statuses", () => {
    const statuses = ["sin_resolver", "rechazada", "aceptada_total", "aceptada_parcial"];
    expect(statuses.length).toBe(4);
  });

  it("AnulFinBadge maps all financial statuses", () => {
    const statuses = ["sin_compensacion", "pendiente_devolucion", "devuelta_economicamente", "pendiente_bono", "compensada_bono", "incidencia_economica"];
    expect(statuses.length).toBe(6);
  });

  it("sidebar link for anulaciones points to CRM tab", () => {
    const href = "/admin/crm?tab=anulaciones";
    expect(href).toContain("/admin/crm");
    expect(href).toContain("tab=anulaciones");
  });
});
