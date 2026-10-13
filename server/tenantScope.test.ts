import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { TenantCache, TenantEventEmitter } from "./_core/tenantScope";
import { runWithTenant } from "./_core/tenant";

describe("TenantCache", () => {
  beforeEach(() => {
    process.env.TENANT_MODE = "multi";
  });
  afterEach(() => {
    delete process.env.TENANT_MODE;
  });

  it("no mezcla valores entre tenants con la misma clave", () => {
    const c = new TenantCache<string>(60_000);
    runWithTenant("a", () => c.set("brand_name", "Empresa A"));
    runWithTenant("b", () => c.set("brand_name", "Empresa B"));
    expect(runWithTenant("a", () => c.get("brand_name"))).toBe("Empresa A");
    expect(runWithTenant("b", () => c.get("brand_name"))).toBe("Empresa B");
    expect(runWithTenant("c", () => c.get("brand_name"))).toBeUndefined();
  });

  it("en multi sin contexto no lee ni guarda", () => {
    const c = new TenantCache<string>(60_000);
    c.set("k", "v");
    expect(c.get("k")).toBeUndefined();
    expect(c.tenants()).toEqual([]);
  });

  it("clear solo invalida el tenant actual", () => {
    const c = new TenantCache<number>(60_000);
    runWithTenant("a", () => c.set("k", 1));
    runWithTenant("b", () => c.set("k", 2));
    runWithTenant("a", () => c.clear());
    expect(runWithTenant("a", () => c.get("k"))).toBeUndefined();
    expect(runWithTenant("b", () => c.get("k"))).toBe(2);
  });

  it("caduca por TTL y acota las entradas por tenant", () => {
    let t = 1000;
    const c = new TenantCache<number>(100, 2, () => t);
    runWithTenant("a", () => {
      c.set("1", 1);
      c.set("2", 2);
      c.set("3", 3); // expulsa "1"
      expect(c.get("1")).toBeUndefined();
      expect(c.get("3")).toBe(3);
      t += 101;
      expect(c.get("3")).toBeUndefined();
    });
  });

  it("en single usa un único espacio (comportamiento actual)", () => {
    delete process.env.TENANT_MODE;
    const c = new TenantCache<string>(60_000);
    c.set("k", "v");
    expect(c.get("k")).toBe("v");
  });
});

describe("TenantEventEmitter", () => {
  beforeEach(() => {
    process.env.TENANT_MODE = "multi";
  });
  afterEach(() => {
    delete process.env.TENANT_MODE;
  });

  it("un evento solo llega a los oyentes de su tenant", () => {
    const e = new TenantEventEmitter();
    const a = vi.fn();
    const b = vi.fn();
    runWithTenant("a", () => e.on("update", a));
    runWithTenant("b", () => e.on("update", b));
    runWithTenant("a", () => e.emit("update", { n: 1 }));
    expect(a).toHaveBeenCalledWith({ n: 1 });
    expect(b).not.toHaveBeenCalled();
  });

  it("emit con tenant explícito (webhooks/jobs) y off sin contexto", () => {
    const e = new TenantEventEmitter();
    const b = vi.fn();
    runWithTenant("b", () => e.on("update", b));
    e.emit("update", 1, "b");
    expect(b).toHaveBeenCalledTimes(1);
    e.off("update", b); // sin contexto: el cierre de la conexión ya no lo tiene
    e.emit("update", 2, "b");
    expect(b).toHaveBeenCalledTimes(1);
    expect(e.listenerCount("update", "b")).toBe(0);
  });

  it("emitir sin contexto en multi lanza (nunca difunde a todos)", () => {
    const e = new TenantEventEmitter();
    expect(() => e.emit("update", 1)).toThrow();
  });
});
