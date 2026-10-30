/**
 * Tareas en cortocircuito por empresa → aviso a la administración (server/controlPlane/jobCircuits.ts): un aviso por
 * apertura, solo de los abiertos, y la recogida por el canal interno con empresas que no responden.
 */
import { describe, it, expect } from "vitest";
import { collectJobCircuits, jobCircuitAlerts } from "./controlPlane/jobCircuits";

const NOW = Date.UTC(2026, 9, 30, 14);

describe("avisos de tareas en cortocircuito", () => {
  it("solo los abiertos; la clave lleva la apertura, así que una reapertura avisa de nuevo y el mismo estado no", () => {
    const circuits = [
      { job: "imap-sync", tenantId: "t9-demo", state: "open", opens: 1, consecutiveFailures: 3, openUntil: NOW + 300_000, lastError: "ETIMEDOUT" },
      { job: "email-automation", tenantId: "t9-demo", state: "half_open", opens: 1 },
      { job: "imap-sync", tenantId: "t8-demo", state: "closed", opens: 0 },
    ];
    const a = jobCircuitAlerts(circuits, NOW);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ id: "admin.integration_error", facts: { key: "jobs:t9-demo:imap-sync:open:1", tenantId: "t9-demo", link: "#/clientes/t9-demo" } });
    expect(a[0].facts.summary).toMatch(/imap-sync/);
    expect(a[0].facts.details.map((d) => d.label)).toEqual(["Tarea", "Fallos seguidos", "Próximo intento", "Último error"]);
    expect(jobCircuitAlerts(circuits, NOW + 120_000)[0].facts.key).toBe(a[0].facts.key);
    const reopened = jobCircuitAlerts([{ ...circuits[0], opens: 2 }], NOW);
    expect(reopened[0].facts.key).toBe("jobs:t9-demo:imap-sync:open:2");
    expect(reopened[0].facts.status.tone).toBe("error");
    expect(jobCircuitAlerts([{ state: "open" }], NOW)).toEqual([]);
  });

  it("la recogida pregunta a cada empresa con panel y separa las que no responden", async () => {
    const calls: string[] = [];
    const client = {
      call: async (c: { tenantId: string; operator: string }) => {
        calls.push(`${c.tenantId}:${c.operator}`);
        if (c.tenantId === "t2") throw new Error("sin respuesta");
        return { status: 200, body: { jobs: { circuits: [{ job: "j", tenantId: c.tenantId, state: c.tenantId === "t1" ? "open" : "closed" }], hung: { j: 1 } } } };
      },
    };
    const v = await collectJobCircuits({ client: client as never, listTenants: async () => [{ id: "t1", status: "active" }, { id: "t2", status: "active" }, { id: "t3", status: "trial" }, { id: "t4", status: "deleted" }], operator: "system:admin-alerts" });
    expect(v.available).toBe(true);
    expect(v.circuits.map((c) => c.tenantId)).toEqual(["t1"]);
    expect(v.unreachable).toEqual(["t2"]);
    expect(v.hung).toEqual({ j: 1 });
    expect(calls.sort()).toEqual(["t1:system:admin-alerts", "t2:system:admin-alerts", "t3:system:admin-alerts"]);
    expect((await collectJobCircuits({ client: null, listTenants: async () => [], operator: "x" })).available).toBe(false);
  });
});
