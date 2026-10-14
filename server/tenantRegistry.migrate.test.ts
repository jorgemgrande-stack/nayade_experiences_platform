/**
 * Aplicador de migraciones del registro: objetos obligatorios y CLI (sin base de datos).
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expectedObjects, RegistryMigrationError } from "./_core/tenantRegistry/migrate";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = path.join(ROOT, "scripts", "registry-migrate.ts");

describe("objetos obligatorios de las migraciones del registro", () => {
  it("0000 declara las tablas base y los triggers de auditoría con su definición", () => {
    const exp = expectedObjects(fs.readFileSync(path.join(ROOT, "db/registry/0000_registry.sql"), "utf8"));
    expect(exp.tables).toEqual(["registry_meta", "tenants", "tenant_domains", "tenant_databases", "tenant_events"]);
    expect(exp.triggers).toEqual([
      {
        name: "trg_events_no_update",
        timing: "BEFORE",
        event: "UPDATE",
        table: "tenant_events",
        statement: "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'tenant_events es de solo anexado'",
      },
      {
        name: "trg_events_no_delete",
        timing: "BEFORE",
        event: "DELETE",
        table: "tenant_events",
        statement: "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'tenant_events es de solo anexado'",
      },
    ]);
  });

  it("falla si un trigger no puede interpretarse (no se omite en silencio)", () => {
    expect(() => expectedObjects("CREATE TRIGGER t2 FOLLOWS t1 BEFORE UPDATE ON x FOR EACH ROW SET @a = 1;")).toThrow(
      RegistryMigrationError,
    );
  });
});

describe("CLI scripts/registry-migrate.ts", () => {
  const run = (env: Record<string, string | undefined>) =>
    spawnSync(process.execPath, [TSX, SCRIPT], {
      cwd: ROOT,
      env: { ...process.env, REGISTRY_ADMIN_DATABASE_URL: undefined, ...env },
      encoding: "utf8",
      timeout: 60_000,
    });

  it("sin URL termina con código 2", () => {
    const r = run({});
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Falta REGISTRY_ADMIN_DATABASE_URL");
  });

  it("arranca como módulo ESM: resuelve el directorio de migraciones sin __dirname", () => {
    // Puerto cerrado: el proceso debe llegar a intentar la conexión (antes fallaba con ReferenceError).
    const r = run({ REGISTRY_ADMIN_DATABASE_URL: "mysql://nadie:nada@127.0.0.1:1/registro" });
    expect(r.status).toBe(1);
    expect(r.stderr).not.toMatch(/__dirname|ReferenceError/);
    expect(r.stderr).toMatch(/ECONNREFUSED|connect/i);
  });
});
