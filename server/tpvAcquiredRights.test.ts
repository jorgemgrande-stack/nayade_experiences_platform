import { describe, it, expect } from "vitest";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { hadPlanCash, seedTpvAcquiredRights, TPV_ACQUIRED_RIGHTS_CAPABILITY, TPV_ACQUIRED_RIGHTS_SOURCE } from "./licensing/tpvAcquiredRights";
import { capabilitiesOfTier } from "./catalog/capabilities";

const now = Date.parse("2026-11-10T08:00:00Z");
const g = (status: string, capabilityId = "bill-cash", siteId = "") => ({ tenantId: "t", capabilityId, siteId, status: status as any, validUntil: null, source: "subscription:1", updatedAt: 0, updatedBy: "x" });

describe("Derecho adquirido del TPV: criterio de la siembra", () => {
  it("solo la caja del plan de toda la empresa en activo, solo lectura o suspendida", () => {
    for (const s of ["active", "read_only", "suspended"]) expect(hadPlanCash([g(s)])).toBe(true);
    for (const s of ["contracted", "pending_setup", "cancelled"]) expect(hadPlanCash([g(s)])).toBe(false);
    expect(hadPlanCash([g("active", "bill-cash", "norte")])).toBe(false);
    expect(hadPlanCash([g("active", "crm-leads")])).toBe(false);
  });

  it("concede una licencia propia a cada empresa que la tenía, una sola vez; simulación sin cambios; por plan", async () => {
    const store = new MemoryCapabilityStore();
    const base = (status: "active" | "cancelled") => capabilitiesOfTier("essential").map((capabilityId) => ({ capabilityId, siteId: "", status, validUntil: null, source: "subscription:1" }));
    await store.apply("con-caja", base("active"), { actor: "x", reason: null, now });
    await store.apply("cancelada", base("cancelled"), { actor: "x", reason: null, now });
    await store.apply("business", [...base("active"), { capabilityId: "multi-site", siteId: "", status: "active" as const, validUntil: null, source: "subscription:2" }], { actor: "x", reason: null, now });
    const d = { candidates: async () => ["con-caja", "cancelada", "business"], store, now: () => now };
    const dry = await seedTpvAcquiredRights(d, { apply: false });
    expect([dry.candidatas, dry.concedidas, dry.porPlan]).toEqual([2, ["business", "con-caja"], { business: 1, essential: 1 }]);
    expect((await store.list("con-caja")).some((x) => x.capabilityId === TPV_ACQUIRED_RIGHTS_CAPABILITY)).toBe(false);
    const done = await seedTpvAcquiredRights(d, { apply: true });
    expect(done.concedidas).toEqual(["business", "con-caja"]);
    const grant = (await store.list("con-caja")).find((x) => x.capabilityId === TPV_ACQUIRED_RIGHTS_CAPABILITY)!;
    expect([grant.status, grant.validUntil, grant.source]).toEqual(["active", null, TPV_ACQUIRED_RIGHTS_SOURCE]);
    expect((await seedTpvAcquiredRights(d, { apply: true })).yaConcedidas).toEqual(["business", "con-caja"]);
    expect((await store.list("cancelada")).some((x) => x.capabilityId === TPV_ACQUIRED_RIGHTS_CAPABILITY)).toBe(false);
  });
});
