/** Recursos huérfanos del aprovisionamiento: bases y usuarios sin empresa, empresas sin base y copias de restauración. */
import { describe, it, expect } from "vitest";
import { orphanReport } from "./_core/provisioning/orphans";
import { userNameFor } from "./_core/provisioning/mysqlAdapters";
import { restoredUserFor } from "./_core/ops/backupRestore";
import { isAllowedDrill } from "../scripts/deploy/esRailwayLib";

describe("recursos huérfanos", () => {
  const tenants = [
    { id: "t1-a", status: "active", activeDatabase: "es_t1_a" },
    { id: "t2-b", status: "trial", activeDatabase: "es_t2_b" },
    { id: "t3-c", status: "suspended", activeDatabase: null },
    { id: "t4-d", status: "archived", activeDatabase: null },
    { id: "t5-e", status: "provisioning", activeDatabase: null },
  ];
  it("todo en orden: sin huérfanos; la plataforma y las copias de restauración no cuentan como huérfanas", () => {
    const r = orphanReport({
      serverDatabases: { srv: ["es_registry", "es_crm", "es_erm", "es_t1_a", "es_t2_b", "es_t1_a_r20261024120000", "mysql", "information_schema"] },
      serverUsers: { srv: [userNameFor("t1-a"), userNameFor("t2-b"), restoredUserFor("es_t1_a_r20261024120000")] },
      tenants: tenants.slice(0, 2),
    });
    expect(r.ok).toBe(true);
    expect(r.restoreCopies).toEqual([{ server: "srv", database: "es_t1_a_r20261024120000", tenantId: "t1-a" }]);
  });
  it("detecta bases sin empresa, bases de empresas archivadas, empresas sin base y usuarios sueltos", () => {
    const r = orphanReport({
      serverDatabases: { srv: ["es_t1_a", "es_t2_b", "es_huerfana", "es_t4_d"], otro: [] },
      serverUsers: { srv: [userNameFor("t1-a"), "esu_0000000000000000", "esr_1111111111111111"] },
      tenants,
    });
    expect(r.ok).toBe(false);
    expect(r.orphanDatabases.map((x) => x.database).sort()).toEqual(["es_huerfana", "es_t4_d"]);
    expect(r.orphanDatabases.find((x) => x.database === "es_t4_d")!.reason).toMatch(/archived/);
    // t3 sin base activa; t5 en alta (todavía no se exige) y t4 archivada no cuentan
    expect(r.missingDatabases.map((x) => x.tenantId)).toEqual(["t3-c"]);
    expect(r.orphanUsers.map((x) => x.user).sort()).toEqual(["esr_1111111111111111", "esu_0000000000000000"]);
  });
  it("empresa con base activa que no existe en ningún servidor", () => {
    const r = orphanReport({ serverDatabases: { srv: [] }, serverUsers: { srv: [] }, tenants: [{ id: "t1-a", status: "active", activeDatabase: "es_t1_a" }] });
    expect(r.missingDatabases).toEqual([{ tenantId: "t1-a", status: "active", reason: "su base activa no existe en ningún servidor" }]);
  });
  it("restore-drill admite la orden de solo lectura y nada más", () => {
    expect(isAllowedDrill("node dist-cp/backup-job.js orphans")).toBe(true);
    expect(isAllowedDrill("node dist-cp/backup-job.js orphans --apply")).toBe(false);
  });
});
