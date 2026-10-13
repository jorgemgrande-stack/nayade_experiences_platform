import { describe, it, expect, afterEach, vi } from "vitest";

const flags = vi.hoisted(() => ({ byTenant: {} as Record<string, boolean> }));
vi.mock("./config", async () => {
  const { getTenantId } = await import("./_core/tenant");
  return { getFeatureFlag: async (_k: string, fb: boolean) => flags.byTenant[getTenantId()] ?? fb };
});

import { runTenantJob, setJobFlag, setJobTenantLister, jobStatus } from "./_core/tenantRegistry/scheduler";
import { getTenantId } from "./_core/tenant";

afterEach(() => {
  delete process.env.TENANT_MODE;
  setJobTenantLister(null);
});

describe("flag de tarea por tenant", () => {
  it("cada tenant ejecuta la tarea solo si su flag está activo", async () => {
    process.env.TENANT_MODE = "multi";
    setJobTenantLister(async () => ["a", "b", "c"]);
    flags.byTenant = { a: true, b: false };
    setJobFlag("flagged", "some_flag", false); // c: sin valor → respaldo false
    const ran: string[] = [];
    await runTenantJob("flagged", async () => {
      ran.push(getTenantId());
    });
    expect(ran).toEqual(["a"]);
    const skipped = jobStatus().filter((j) => j.job === "flagged" && j.outcome === "skipped").map((j) => j.tenantId).sort();
    expect(skipped).toEqual(["b", "c"]);
  });

  it("el valor por defecto true activa a quien no tiene flag", async () => {
    process.env.TENANT_MODE = "multi";
    setJobTenantLister(async () => ["x"]);
    flags.byTenant = {};
    setJobFlag("default-on", "k", true);
    const ran = vi.fn();
    await runTenantJob("default-on", ran);
    expect(ran).toHaveBeenCalledTimes(1);
  });
});
