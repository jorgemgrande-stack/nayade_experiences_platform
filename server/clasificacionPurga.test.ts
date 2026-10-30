/**
 * El código de la purga de empresas de prueba solo se ejecuta con la acción protegida `purgar-empresas-prueba` (con
 * aprobación): desplegarlo no borra nada, así que no convierte en extraordinarias las publicaciones posteriores. Retirar
 * un borrado tampoco. Las demás reglas críticas se siguen aplicando, y el módulo solo puede importarlo esa orden.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { extraordinaryChanges } from "../scripts/deploy/esRailwayLib";

const diffOf = (file: string, ...lines: string[]) => [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, "@@ -1 +1 @@", ...lines].join("\n");
const x = (files: string[], diff: string) => extraordinaryChanges(files, diff, () => null);
const PURGE = "server/_core/ops/purgeTestCompanies.ts";

describe("clasificación del código de la purga", () => {
  it("los borrados del módulo de la purga y los borrados retirados no bloquean el despliegue ordinario", () => {
    expect(x([PURGE], diffOf(PURGE, "+    await admin.query(`DROP DATABASE IF EXISTS ${database}`);", "+  await d.dropDatabase(x.tenantId);"))).toEqual([]);
    expect(x(["server/a.ts"], diffOf("server/a.ts", "-  await databases.dropDatabase(tenantId);"))).toEqual([]);
    expect(x(["server/a.ts"], diffOf("server/a.ts", '-  await pool.query("DELETE FROM tenants WHERE id = ?", [id]);'))).toEqual([]);
  });

  it("añadir un borrado fuera del módulo sigue siendo extraordinario; en el módulo, las demás reglas críticas siguen", () => {
    expect(x(["server/a.ts"], diffOf("server/a.ts", "+  await databases.dropDatabase(tenantId);"))).not.toEqual([]);
    expect(x(["server/controlPlane/backupJob.ts"], diffOf("server/controlPlane/backupJob.ts", "+  await admin.query(`DROP DATABASE x`);"))).not.toEqual([]);
    expect(x([PURGE], diffOf(PURGE, `+  const k = "${"sk"}_live_${"x".repeat(10)}";`))).not.toEqual([]);
    expect(x([PURGE], diffOf(PURGE, '-  r.post("/x", requireScope("ops:write"), h);'))).not.toEqual([]);
  });

  it("solo la orden purge-test-companies importa el módulo (si no, la exención no sería segura)", () => {
    const importers = execFileSync("git", ["grep", "-lE", `from ["'][^"']*purgeTestCompanies["']`, "--", "server", "scripts", "client"], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" })
      .split("\n")
      .map((p) => p.trim())
      .filter((p) => p && !/\.test\.ts$/.test(p) && p !== PURGE);
    expect(importers).toEqual(["server/controlPlane/backupJob.ts"]);
    const job = fs.readFileSync(path.resolve(__dirname, "controlPlane/backupJob.ts"), "utf8");
    const start = job.indexOf('case "purge-test-companies"');
    const next = job.indexOf("case ", start + 10);
    for (const fn of ["planPurge(", "applyPurge(", "purgeDatabaseDroppers(", "verifyPurge("]) {
      const at = job.indexOf(fn, job.indexOf("\n", job.indexOf("purgeTestCompanies")));
      expect(at, fn).toBeGreaterThan(start);
      expect(at, fn).toBeLessThan(next);
    }
  });
});

describe("borrado de la base restaurada de una empresa de prueba", () => {
  it("solo el nombre exacto de una restauración de una empresa de la lista cerrada; base y usuario en cada servidor", async () => {
    const { dropRestoredTestDatabase } = await import("./_core/ops/purgeTestCompanies");
    const calls: string[] = [];
    const admin = { query: async (sql: string) => void calls.push(sql) } as never;
    await dropRestoredTestDatabase([admin, admin], "t3-empresa-demo-elephant-01", "es_t3_empresa_demo_elephant_01_r20261016221031");
    expect(calls.filter((c) => c.startsWith("DROP DATABASE"))).toHaveLength(2);
    expect(calls.filter((c) => c.startsWith("DROP USER"))).toHaveLength(2);
    await expect(dropRestoredTestDatabase([admin], "t9-empresa-real", "es_t9_empresa_real_r20261016221031")).rejects.toThrow(/lista cerrada/);
    await expect(dropRestoredTestDatabase([admin], "t3-empresa-demo-elephant-01", "es_t5_skibox")).rejects.toThrow(/no es una base restaurada/);
    await expect(dropRestoredTestDatabase([admin], "t3-empresa-demo-elephant-01", "es_t3_empresa_demo_elephant_01")).rejects.toThrow(/no es una base restaurada/);
    expect(calls).toHaveLength(4);
  });
});
