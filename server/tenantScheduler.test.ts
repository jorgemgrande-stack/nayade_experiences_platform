import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { runTenantJob, scheduleTenantInterval, setJobTenantLister, jobStatus } from "./_core/tenantRegistry/scheduler";
import { getTenantId } from "./_core/tenant";

afterEach(() => {
  delete process.env.TENANT_MODE;
  setJobTenantLister(null);
  vi.useRealTimers();
});

describe("scheduler: single", () => {
  it("ejecuta una vez en el tenant por defecto", async () => {
    const seen: string[] = [];
    const r = await runTenantJob("t-single", async () => {
      seen.push(getTenantId());
    });
    expect(seen).toEqual(["default"]);
    expect(r).toEqual([{ tenantId: "default", ok: true }]);
  });

  it("un error no se propaga (el cron no debe romper el proceso)", async () => {
    const r = await runTenantJob("t-err", async () => {
      throw new Error("boom");
    });
    expect(r).toEqual([]);
    expect(jobStatus().find((j) => j.job === "t-err")).toMatchObject({ outcome: "error", error: "boom" });
  });
});

describe("scheduler: multi", () => {
  beforeEach(() => {
    process.env.TENANT_MODE = "multi";
    setJobTenantLister(async () => ["a", "b", "c"]);
  });

  it("una ejecución por tenant, cada una en su contexto", async () => {
    const seen: Array<[string, string]> = [];
    await runTenantJob("t-multi", async (...[]) => {
      await new Promise((r) => setTimeout(r, 1));
      seen.push([getTenantId(), getTenantId()]);
    });
    expect(seen.map((s) => s[0]).sort()).toEqual(["a", "b", "c"]);
  });

  it("el fallo de un tenant no impide los demás y queda registrado", async () => {
    const done: string[] = [];
    const r = await runTenantJob("t-partial", async () => {
      if (getTenantId() === "b") throw new Error("fallo b");
      done.push(getTenantId());
    });
    expect(done.sort()).toEqual(["a", "c"]);
    expect(r.find((x) => x.tenantId === "b")).toMatchObject({ ok: false });
    expect(jobStatus().find((j) => j.job === "t-partial" && j.tenantId === "b")).toMatchObject({ outcome: "error" });
  });

  it("no solapa ejecuciones de la misma tarea y tenant", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = runTenantJob("t-lock", async () => {
      calls++;
      await gate;
    });
    await new Promise((r) => setTimeout(r, 5));
    await runTenantJob("t-lock", async () => {
      calls++;
    });
    // La primera ronda sigue ocupando `a`; la segunda lo omite y sí ejecuta b y c
    expect(calls).toBe(3);
    expect(jobStatus().filter((j) => j.job === "t-lock" && j.outcome === "skipped").map((j) => j.tenantId)).toEqual(["a"]);
    release();
    await first;
  });

  it("sin listado de tenants no ejecuta nada (fallo cerrado)", async () => {
    setJobTenantLister(null);
    const ran = vi.fn();
    expect(await runTenantJob("t-nolist", ran)).toEqual([]);
    expect(ran).not.toHaveBeenCalled();
  });
});

describe("scheduleTenantInterval", () => {
  it("reprograma tras terminar, sin solapar", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => undefined);
    const h = scheduleTenantInterval("t-int", 1000, 500, fn);
    await vi.advanceTimersByTimeAsync(500);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    h.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
